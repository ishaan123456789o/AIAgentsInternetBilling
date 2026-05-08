#!/usr/bin/env python3
"""
End-to-end simulation script.

Proves the full pipeline works locally:
  1. Seeds Supabase with a test developer, provider, endpoint, and session.
  2. Fires a real HTTP request through the local gateway.
  3. Polls micro_transactions until the Verification Engine writes the ledger row.
  4. Prints a structured summary of the result.

Usage:
  python scripts/simulate_agent.py

Requires a .env file at the project root (or environment variables):
  SUPABASE_URL=...
  SUPABASE_SERVICE_KEY=...
  GATEWAY_URL=http://localhost:8000   (optional, default shown)
  ANTHROPIC_API_KEY=...               (optional — verification falls back to heuristics)
"""

import asyncio
import hashlib
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Allow running from repo root or from scripts/ subdirectory
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=_env_path)

SUPABASE_URL        = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GATEWAY_URL         = os.getenv("GATEWAY_URL", "http://localhost:8000")

# Deterministic test fixtures — safe to re-run; all ops are idempotent.
RAW_TOKEN           = "sim-agent-test-token-do-not-use-in-production"
TOKEN_HASH          = hashlib.sha256(RAW_TOKEN.encode()).hexdigest()
DEVELOPER_EMAIL     = "simulate@agentgateway.dev"
TARGET_URL          = "https://jsonplaceholder.typicode.com/posts/1"
AGENT_INTENT        = "Fetch the first blog post to read its title and body."
POLL_TIMEOUT_SEC    = 15   # how long to wait for the async verification to land
POLL_INTERVAL_SEC   = 1


# ---------------------------------------------------------------------------
# Seed helpers — all use upsert so the script is safe to run multiple times
# ---------------------------------------------------------------------------

def seed_developer(sb: Client) -> str:
    result = (
        sb.table("agent_developers")
        .upsert(
            {
                "email":          DEVELOPER_EMAIL,
                "company_name":   "Simulation Test Co.",
                "wallet_balance": 10.0,
                "is_active":      True,
            },
            on_conflict="email",
        )
        .execute()
    )
    dev_id = result.data[0]["id"]
    print(f"  ✓ Developer    {dev_id}  ({DEVELOPER_EMAIL})")
    return dev_id


def seed_provider(sb: Client) -> str:
    result = (
        sb.table("data_providers")
        .upsert(
            {
                "name":             "JSONPlaceholder",
                "base_url":         "https://jsonplaceholder.typicode.com",
                "rate_per_success": 0.0005,
                "revenue_share":    0.70,
                "is_active":        True,
            },
            on_conflict="base_url",
        )
        .execute()
    )
    provider_id = result.data[0]["id"]
    print(f"  ✓ Provider     {provider_id}  (jsonplaceholder.typicode.com)")
    return provider_id


def seed_endpoint(sb: Client, provider_id: str) -> str:
    result = (
        sb.table("api_endpoints")
        .upsert(
            {
                "provider_id":       provider_id,
                "path_pattern":      "/posts/*",
                "http_method":       "GET",
                "verification_mode": "standard",
                "is_active":         True,
            },
            on_conflict="provider_id,path_pattern,http_method",
        )
        .execute()
    )
    endpoint_id = result.data[0]["id"]
    print(f"  ✓ Endpoint     {endpoint_id}  (GET /posts/*)")
    return endpoint_id


def seed_session(sb: Client, developer_id: str) -> str:
    # Check first — bearer_token has a unique constraint
    existing = (
        sb.table("agent_sessions")
        .select("id")
        .eq("bearer_token", TOKEN_HASH)
        .limit(1)
        .execute()
    )
    if existing.data:
        session_id = existing.data[0]["id"]
        print(f"  ✓ Session      {session_id}  (existing)")
        return session_id

    result = (
        sb.table("agent_sessions")
        .insert(
            {
                "developer_id": developer_id,
                "bearer_token": TOKEN_HASH,
                "agent_name":   "Simulation Agent v1",
                "is_active":    True,
            }
        )
        .execute()
    )
    session_id = result.data[0]["id"]
    print(f"  ✓ Session      {session_id}  (new)")
    return session_id


# ---------------------------------------------------------------------------
# Gateway request
# ---------------------------------------------------------------------------

async def fire_request() -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{GATEWAY_URL}/proxy",
            params={"__target": TARGET_URL},
            headers={
                "Authorization":  f"Bearer {RAW_TOKEN}",
                "Accept":         "application/json",
                "X-Agent-Intent": AGENT_INTENT,
            },
        )
    return {
        "status":  resp.status_code,
        "body":    resp.text[:500],
        "headers": dict(resp.headers),
    }


# ---------------------------------------------------------------------------
# Poll for the ledger row
# ---------------------------------------------------------------------------

def poll_for_transaction(sb: Client, session_id: str) -> dict | None:
    deadline = time.monotonic() + POLL_TIMEOUT_SEC
    attempt  = 0
    while time.monotonic() < deadline:
        attempt += 1
        result = (
            sb.table("micro_transactions")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]
        sys.stdout.write(f"\r  ⏳ Waiting for verification engine... ({attempt}s)")
        sys.stdout.flush()
        time.sleep(POLL_INTERVAL_SEC)

    print()  # newline after spinner
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    print("\n═══════════════════════════════════════════════")
    print("  Agent Gateway — End-to-End Simulation")
    print("═══════════════════════════════════════════════\n")

    # 1. Seed
    print("[ 1/4 ] Seeding Supabase test fixtures…")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    developer_id = seed_developer(sb)
    provider_id  = seed_provider(sb)
    seed_endpoint(sb, provider_id)
    session_id   = seed_session(sb, developer_id)

    # 2. Health check
    print(f"\n[ 2/4 ] Checking gateway at {GATEWAY_URL}…")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            health = await client.get(f"{GATEWAY_URL}/health")
        health.raise_for_status()
        print(f"  ✓ Gateway healthy  ({health.json()})")
    except Exception as exc:
        print(f"  ✗ Gateway unreachable: {exc}")
        print("    → Start the stack with:  docker compose up --build")
        sys.exit(1)

    # 3. Fire proxied request
    print(f"\n[ 3/4 ] Sending proxied request…")
    print(f"  Target:  {TARGET_URL}")
    print(f"  Intent:  {AGENT_INTENT}")
    gateway_response = await fire_request()
    status = gateway_response["status"]
    status_icon = "✓" if 200 <= status < 300 else "✗"
    print(f"  {status_icon} Gateway response  HTTP {status}")
    print(f"  Body preview: {gateway_response['body'][:120]}…")

    if status == 401:
        print("\n  → Auth failed. Token hash may be wrong or session is inactive.")
        sys.exit(1)
    if status == 402:
        print("\n  → Wallet balance is 0. Seed the developer with credits.")
        sys.exit(1)

    # 4. Poll for ledger entry
    print(f"\n[ 4/4 ] Polling micro_transactions (timeout {POLL_TIMEOUT_SEC}s)…")
    txn = poll_for_transaction(sb, session_id)

    print()
    if txn is None:
        print("  ✗ No transaction found within timeout.")
        print("    Possible causes:")
        print("    - Verification engine is not running (check docker compose ps)")
        print("    - Verification scored below threshold (no charge = expected)")
        print("    - Endpoint not registered (check api_endpoints table)")
        sys.exit(1)

    meta = txn.get("proof_metadata") or {}
    print("  ✓ Transaction logged successfully!\n")
    print("  ┌─ Ledger Row ──────────────────────────────────────")
    print(f"  │  id                 {txn['id']}")
    print(f"  │  session_id         {txn['session_id']}")
    print(f"  │  amount_usd         ${float(txn['amount_usd']):.8f}")
    print(f"  │  provider_share     ${float(txn['provider_share']):.8f}")
    print(f"  │  platform_share     ${float(txn['platform_share']):.8f}")
    print(f"  │  verification_score {txn['verification_score']}")
    print(f"  │  response_status    {txn['response_status']}")
    print(f"  │  latency_ms         {txn['latency_ms']} ms")
    print(f"  │  model_version      {meta.get('model_version', 'heuristic')}")
    if meta.get("judge_reasoning"):
        print(f"  │  judge_reasoning    {meta['judge_reasoning']}")
    if meta.get("flags"):
        print(f"  │  flags              {meta['flags']}")
    print("  └───────────────────────────────────────────────────")
    print("\n  Pipeline verified. ✓\n")


if __name__ == "__main__":
    asyncio.run(main())

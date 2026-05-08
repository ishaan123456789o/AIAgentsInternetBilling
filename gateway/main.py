"""
Outcome-Verified Agent Gateway — Interceptor
Reverse proxy that authenticates agent sessions, forwards requests to the
target data provider, and ships telemetry bundles to the Verification Engine.
"""

import asyncio
import collections
import hashlib
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client

from config import Settings
from models import TelemetryBundle
from verification_client import VerificationClient

settings = Settings()
verification = VerificationClient(settings.verification_engine_url, settings.internal_secret)
supabase: Client = create_client(settings.supabase_url, settings.supabase_service_key)

# Shared async HTTP client — reuse connections across requests
_http_client: Optional[httpx.AsyncClient] = None

# ---------------------------------------------------------------------------
# Token auth cache — reduces per-request Supabase round-trips.
# Maps token_hash → (session_dict, cached_at_monotonic).
# Revoked tokens / drained wallets remain usable within SESSION_CACHE_TTL.
# Keep TTL short; 15 s is a reasonable tradeoff for billing infrastructure.
# ---------------------------------------------------------------------------
_session_cache: dict[str, tuple[dict, float]] = {}

# ---------------------------------------------------------------------------
# Per-developer sliding-window rate limiter.
# Maps developer_id → deque of request timestamps (monotonic seconds).
# One deque per worker process — not shared across uvicorn workers, so the
# effective limit is rate_limit_rpm * workers. Acceptable for initial scale;
# replace with Redis for multi-instance deployments.
# ---------------------------------------------------------------------------
_rate_buckets: dict[str, collections.deque] = {}
_RATE_WINDOW = 60.0  # seconds


def _check_rate_limit(developer_id: str) -> bool:
    """Returns True (blocked) if the developer exceeds rate_limit_rpm."""
    if not settings.rate_limit_rpm:
        return False
    now = time.monotonic()
    bucket = _rate_buckets.setdefault(developer_id, collections.deque())
    # Evict timestamps older than the window
    while bucket and now - bucket[0] > _RATE_WINDOW:
        bucket.popleft()
    if len(bucket) >= settings.rate_limit_rpm:
        return True
    bucket.append(now)
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _http_client
    _http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0),
        limits=httpx.Limits(max_connections=200, max_keepalive_connections=50),
        follow_redirects=True,
    )
    yield
    await _http_client.aclose()


_cors_origins = (
    [o.strip() for o in settings.allowed_origins.split(",")]
    if settings.allowed_origins != "*"
    else ["*"]
)

app = FastAPI(title="Agent Gateway", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _extract_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    return auth.removeprefix("Bearer ").strip()


def _validate_session(token: str) -> dict:
    """
    Validate the bearer token and return the active session row.
    Results are cached for SESSION_CACHE_TTL seconds to reduce DB load.
    Token is stored as a SHA-256 hex digest — raw token never persists in DB.
    """
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()

    cached = _session_cache.get(token_hash)
    if cached:
        session, cached_at = cached
        if now - cached_at < settings.session_cache_ttl:
            return session
        del _session_cache[token_hash]

    result = (
        supabase.table("agent_sessions")
        .select("*, agent_developers!inner(wallet_balance, is_active)")
        .eq("bearer_token", token_hash)
        .eq("is_active", True)
        .or_("expires_at.is.null,expires_at.gt.now()")
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    session = result.data
    developer = session["agent_developers"]

    if not developer["is_active"]:
        raise HTTPException(status_code=403, detail="Developer account suspended")
    if float(developer["wallet_balance"]) <= 0:
        raise HTTPException(status_code=402, detail="Insufficient wallet balance")

    _session_cache[token_hash] = (session, now)
    return session


# ---------------------------------------------------------------------------
# Request fingerprinting (loop detection)
# ---------------------------------------------------------------------------

def _fingerprint(method: str, url: str, body: bytes) -> str:
    content = f"{method}:{url}:{body[:512].hex()}"
    return hashlib.sha256(content.encode()).hexdigest()


def _check_loop(session: dict, fingerprint: str) -> bool:
    """Returns True if this request looks like a stuck loop."""
    if session.get("last_request_hash") == fingerprint:
        strikes = session.get("loop_strike_count", 0) + 1
        supabase.table("agent_sessions").update({
            "loop_strike_count": strikes,
            "updated_at": "now()",
        }).eq("id", session["id"]).execute()
        return strikes >= settings.loop_strike_threshold
    # Different fingerprint — reset stale strike count so a prior loop episode
    # doesn't bleed into the next one.
    if session.get("loop_strike_count", 0) > 0:
        supabase.table("agent_sessions").update({
            "loop_strike_count": 0,
            "updated_at": "now()",
        }).eq("id", session["id"]).execute()
    return False


# ---------------------------------------------------------------------------
# Core proxy endpoint
# ---------------------------------------------------------------------------

@app.post("/proxy")
@app.get("/proxy")
@app.put("/proxy")
@app.delete("/proxy")
@app.patch("/proxy")
async def proxy(request: Request):
    token   = _extract_token(request)
    session = await asyncio.to_thread(_validate_session, token)

    if _check_rate_limit(session["developer_id"]):
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: max {settings.rate_limit_rpm} requests/minute.",
        )

    target_url = (
        request.query_params.get("__target")
        or request.headers.get("X-Target-Url")
    )
    if not target_url:
        raise HTTPException(
            status_code=400,
            detail="Missing target URL (__target param or X-Target-Url header)",
        )

    body = await request.body()

    # Reject oversized request bodies before forwarding — protects upstream
    # and caps the size of telemetry bundles.
    if len(body) > settings.max_body_capture_bytes * 8:
        raise HTTPException(status_code=413, detail="Request body too large")

    fingerprint = _fingerprint(request.method, target_url, body)

    if await asyncio.to_thread(_check_loop, session, fingerprint):
        raise HTTPException(
            status_code=429,
            detail="Loop detected: identical requests exceed threshold. Session penalised.",
        )

    agent_intent = request.headers.get("X-Agent-Intent", "")

    forward_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in {
            "host", "authorization", "x-target-url",
            "content-length", "x-agent-intent",
        }
    }

    start_ms = time.monotonic()

    try:
        upstream = await _http_client.request(
            method=request.method,
            url=target_url,
            headers=forward_headers,
            content=body,
            params={k: v for k, v in request.query_params.items() if k != "__target"},
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream unreachable: {exc}")

    latency_ms = int((time.monotonic() - start_ms) * 1000)

    asyncio.create_task(asyncio.to_thread(_update_session_counters, session["id"], fingerprint))

    # Truncate captured bodies to max_body_capture_bytes before shipping
    # telemetry — prevents OOM on large upstream responses.
    cap = settings.max_body_capture_bytes
    request_body_str  = body.decode("utf-8", errors="replace")[:cap]
    response_body_str = upstream.text[:cap]

    bundle = TelemetryBundle(
        request_id=str(uuid.uuid4()),
        session_id=session["id"],
        developer_id=session["developer_id"],
        target_url=target_url,
        http_method=request.method,
        request_headers=dict(forward_headers),
        request_body=request_body_str,
        response_status=upstream.status_code,
        response_body=response_body_str,
        response_headers=dict(upstream.headers),
        latency_ms=latency_ms,
        request_hash=fingerprint,
        agent_intent=agent_intent,
    )
    await verification.submit(bundle)

    _strip = {"content-encoding", "content-length", "transfer-encoding"}
    response_headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _strip}

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )


def _update_session_counters(session_id: str, fingerprint: str):
    supabase.rpc("increment_session_counter", {
        "p_session_id":  session_id,
        "p_fingerprint": fingerprint,
    }).execute()


# ---------------------------------------------------------------------------
# Health check — verifies Supabase connectivity, not just process liveness
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    try:
        await asyncio.to_thread(
            lambda: supabase.table("data_providers").select("id").limit(1).execute()
        )
        db_ok = True
    except Exception:
        db_ok = False

    if not db_ok:
        raise HTTPException(status_code=503, detail="Database unreachable")

    return {"status": "ok", "db": "ok"}

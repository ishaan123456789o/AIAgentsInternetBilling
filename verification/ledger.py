"""
Ledger writer — called only after proof_of_execution == True.
Performs an atomic balance debit + transaction insert using a Postgres
function to prevent double-charges on retries.
"""

import asyncio
import logging
from decimal import Decimal

from supabase import Client

from models import TelemetryBundle, VerificationResult

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 0.5  # seconds; doubles each attempt


async def record_transaction(
    supabase: Client,
    bundle: TelemetryBundle,
    result: VerificationResult,
) -> None:
    """
    1. Resolve the api_endpoint row for this URL + method.
    2. Compute the micro-invoice amount.
    3. Atomically debit developer wallet and insert transaction row.

    All Supabase calls are dispatched via asyncio.to_thread so the sync
    supabase-py client never blocks the async event loop.
    """
    endpoint = await asyncio.to_thread(_resolve_endpoint, supabase, bundle)
    if not endpoint:
        logger.warning("No registered endpoint for %s %s — skipping billing",
                       bundle.http_method, bundle.target_url)
        return

    # Provider data is embedded in the join — no second DB roundtrip needed
    provider = endpoint["data_providers"]
    amount = Decimal(str(endpoint.get("rate_override") or provider["rate_per_success"]))
    provider_share = (amount * Decimal(str(provider["revenue_share"]))).quantize(Decimal("0.00000001"))
    platform_share = (amount - provider_share).quantize(Decimal("0.00000001"))

    params = {
        "p_session_id":         bundle.session_id,
        "p_endpoint_id":        endpoint["id"],
        "p_developer_id":       bundle.developer_id,
        "p_provider_id":        endpoint["provider_id"],
        "p_amount_usd":         str(amount),
        "p_provider_share":     str(provider_share),
        "p_platform_share":     str(platform_share),
        "p_verification_score": str(result.composite_score),
        "p_request_hash":       bundle.request_hash,
        "p_response_status":    bundle.response_status,
        "p_latency_ms":         bundle.latency_ms,
        "p_proof_metadata": {
            "scores":          result.individual_scores,
            "flags":           result.flags,
            "model_version":   result.model_version,
            "request_id":      result.request_id,
            "target_url":      bundle.target_url,
            "http_method":     bundle.http_method,
            "agent_intent":    bundle.agent_intent,
            "judge_reasoning": result.judge_reasoning,
        },
    }

    last_exc: Exception | None = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            await asyncio.to_thread(lambda: supabase.rpc("bill_agent_execution", params).execute())
            logger.info("Billed %s USD for session %s (score=%.4f)",
                        amount, bundle.session_id, result.composite_score)
            return
        except Exception as exc:
            last_exc = exc
            # P0002 = insufficient balance — not transient, don't retry
            if "P0002" in str(exc):
                logger.warning("Insufficient balance for developer %s — request %s not billed",
                               bundle.developer_id, bundle.request_id)
                return
            if attempt < _MAX_RETRIES:
                delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning("Ledger write attempt %d/%d failed for request %s: %s — retrying in %.1fs",
                               attempt, _MAX_RETRIES, bundle.request_id, exc, delay)
                await asyncio.sleep(delay)

    logger.error("Ledger write failed after %d attempts for request %s: %s",
                 _MAX_RETRIES, bundle.request_id, last_exc)
    raise last_exc


def _resolve_endpoint(supabase: Client, bundle: TelemetryBundle) -> dict | None:
    from urllib.parse import urlparse
    import fnmatch

    parsed = urlparse(bundle.target_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path or "/"
    method = bundle.http_method.upper()

    def _best_match(rows: list[dict], path: str) -> dict | None:
        candidates = [ep for ep in rows if fnmatch.fnmatch(path, ep["path_pattern"])]
        return max(candidates, key=lambda ep: len(ep["path_pattern"])) if candidates else None

    # Phase 1 — specific provider matched by base_url
    result = (
        supabase.table("api_endpoints")
        .select("*, data_providers!inner(base_url, rate_per_success, revenue_share)")
        .eq("data_providers.base_url", base_url)
        .eq("http_method", method)
        .eq("is_active", True)
        .execute()
    )
    specific = _best_match(result.data or [], path)
    if specific:
        return specific

    # Phase 2 — platform default (base_url = '') catches everything else
    fallback = (
        supabase.table("api_endpoints")
        .select("*, data_providers!inner(base_url, rate_per_success, revenue_share)")
        .eq("data_providers.base_url", "")
        .eq("http_method", method)
        .eq("is_active", True)
        .execute()
    )
    return _best_match(fallback.data or [], path)

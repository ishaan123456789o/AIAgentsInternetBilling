"""
Outcome-Verified Agent Gateway — Verification Engine
Receives telemetry bundles from the Interceptor, runs Proof-of-Execution checks,
and writes micro_transactions rows to Supabase on verified success.
"""

import logging

from fastapi import Depends, FastAPI, BackgroundTasks, Header, HTTPException
from supabase import Client, create_client

logger = logging.getLogger(__name__)

from config import Settings
from models import TelemetryBundle, VerificationResult
from judge import evaluate_with_judge
from ledger import record_transaction

settings = Settings()
supabase: Client = create_client(settings.supabase_url, settings.supabase_service_key)

app = FastAPI(title="Verification Engine", version="0.1.0")


def _require_internal_secret(x_internal_secret: str = Header(default="")) -> None:
    """Reject calls that don't carry the shared gateway secret.
    When INTERNAL_SECRET is not configured (empty string), auth is skipped so
    local dev works without extra setup."""
    if settings.internal_secret and x_internal_secret != settings.internal_secret:
        raise HTTPException(status_code=403, detail="Invalid internal secret")


@app.post("/verify", status_code=202)
async def verify(
    bundle: TelemetryBundle,
    background_tasks: BackgroundTasks,
    _: None = Depends(_require_internal_secret),
):
    """
    202 Accepted immediately — evaluation runs in the background so the
    gateway's fire-and-forget client never times out.
    """
    background_tasks.add_task(_run_verification, bundle)
    return {"accepted": True, "request_id": bundle.request_id}


async def _run_verification(bundle: TelemetryBundle):
    try:
        result: VerificationResult = await evaluate_with_judge(
            bundle, settings.gemini_api_key or None
        )
        if result.proof_of_execution:
            await record_transaction(supabase, bundle, result)
    except Exception as exc:
        logger.error("Verification failed for request %s: %s", bundle.request_id, exc)


@app.get("/health")
async def health():
    return {"status": "ok"}

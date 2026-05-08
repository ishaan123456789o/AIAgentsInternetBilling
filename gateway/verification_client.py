import asyncio
import logging

import httpx

from models import TelemetryBundle

logger = logging.getLogger(__name__)

# Fire-and-forget: gateway never blocks the agent response waiting for billing.
# If the verification service is down, bundles are dropped with a warning.
# Production upgrade: queue to SQS / Redis Streams for guaranteed delivery.

class VerificationClient:
    def __init__(self, base_url: str, internal_secret: str = ""):
        self._url = f"{base_url}/verify"
        self._client = httpx.AsyncClient(timeout=5.0)
        self._headers = {"X-Internal-Secret": internal_secret} if internal_secret else {}
        self._tasks: set[asyncio.Task] = set()

    async def submit(self, bundle: TelemetryBundle) -> None:
        task = asyncio.create_task(self._post(bundle))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _post(self, bundle: TelemetryBundle) -> None:
        try:
            await self._client.post(self._url, json=bundle.model_dump(), headers=self._headers)
        except Exception as exc:
            logger.warning("Verification engine unreachable — bundle dropped: %s", exc)

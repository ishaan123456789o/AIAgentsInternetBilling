from pydantic import BaseModel


class TelemetryBundle(BaseModel):
    """Wire format sent from Interceptor → Verification Engine."""
    request_id: str
    session_id: str
    developer_id: str
    target_url: str
    http_method: str
    request_headers: dict[str, str]
    request_body: str
    response_status: int
    response_body: str
    response_headers: dict[str, str]
    latency_ms: int
    request_hash: str
    agent_intent: str = ""  # must match verification/models.py — field included in JSON

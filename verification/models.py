from pydantic import BaseModel


class TelemetryBundle(BaseModel):
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
    agent_intent: str = ""  # from X-Agent-Intent header; empty = infer from URL


class VerificationResult(BaseModel):
    request_id: str
    proof_of_execution: bool
    composite_score: float
    individual_scores: dict[str, float]
    flags: list[str]
    model_version: str
    judge_reasoning: str = ""  # populated when LLM judge runs; empty on heuristic path

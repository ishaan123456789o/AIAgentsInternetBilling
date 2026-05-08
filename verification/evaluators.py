"""
Proof-of-Execution Evaluators

Each evaluator is a pure function:
    (TelemetryBundle) -> (score: float, flag: str | None)

The top-level evaluate_bundle aggregates all signals into a single
VerificationResult. Scores are 0.0–1.0; the final verdict uses a
weighted sum against a configurable threshold.

TO PLUG IN REAL MODELS:
  - Replace the _mock_* functions with calls to your LLM judge, embedding
    similarity scorer, or custom ML inference endpoint.
  - Each evaluator slot is isolated; swap one without touching the others.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Optional

from models import TelemetryBundle, VerificationResult

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

COMPOSITE_PASS_THRESHOLD = 0.55  # weighted score must exceed this to bill
WEIGHTS = {
    "http_success":     0.30,
    "non_empty_body":   0.15,
    "no_hallucination": 0.30,
    "context_coherent": 0.15,
    "no_loop":          0.10,
}

# ---------------------------------------------------------------------------
# Individual evaluators
# ---------------------------------------------------------------------------

def eval_http_success(bundle: TelemetryBundle) -> tuple[float, Optional[str]]:
    """HTTP 2xx = full score; 4xx = 0; 5xx = 0."""
    if 200 <= bundle.response_status < 300:
        return 1.0, None
    if bundle.response_status >= 500:
        return 0.0, "upstream_error"
    return 0.0, f"http_{bundle.response_status}"


def eval_non_empty_body(bundle: TelemetryBundle) -> tuple[float, Optional[str]]:
    """Response must carry a non-trivial body."""
    body = bundle.response_body.strip()
    if len(body) < 10:
        return 0.0, "empty_response"
    return 1.0, None


def eval_no_hallucination(bundle: TelemetryBundle) -> tuple[float, Optional[str]]:
    """
    MOCK: flags known hallucination signatures in the response body.
    Real implementation: LLM-as-judge or fine-tuned classifier scoring
    factual grounding between request intent and response content.
    """
    response = bundle.response_body.lower()

    hallucination_patterns = [
        r"\bi (cannot|can't|am unable to)\b",
        r"\bas an ai (language model|assistant)\b",
        r"\bi don't have (access|the ability)\b",
        r"\bI'm sorry, I (cannot|can't)\b",
        r"\bthis (url|page|site|content) (does not exist|is not available)\b",
    ]

    for pattern in hallucination_patterns:
        if re.search(pattern, response):
            return 0.2, "hallucination_detected"

    # Reward structured data — JSON/XML suggests a real data response
    try:
        json.loads(bundle.response_body)
        return 1.0, None
    except (json.JSONDecodeError, ValueError):
        pass

    # Plain text with substance passes at a reduced score
    word_count = len(response.split())
    if word_count > 20:
        return 0.8, None

    return 0.5, "low_confidence_content"


def eval_context_coherent(bundle: TelemetryBundle) -> tuple[float, Optional[str]]:
    """
    MOCK: checks that the response content type matches the request's Accept
    header and that the URL path correlates with the response topic.
    Real implementation: embedding cosine similarity between request intent
    extracted from the agent's prompt and the response content.
    """
    accept = bundle.request_headers.get("accept", "").lower()
    content_type = bundle.response_headers.get("content-type", "").lower()

    if "application/json" in accept and "application/json" not in content_type:
        return 0.4, "content_type_mismatch"

    return 1.0, None


def eval_no_loop(bundle: TelemetryBundle) -> tuple[float, Optional[str]]:
    """
    Soft loop signal based on URL structure.
    Hard loop blocking is handled by the gateway; this evaluator catches
    suspiciously self-referential or recursive target URLs.
    Real implementation: locality-sensitive hashing against session history.
    """
    try:
        from urllib.parse import urlparse
        parsed = urlparse(bundle.target_url)
        # Flag if the path contains the full origin (recursive proxy call)
        if parsed.netloc and parsed.netloc in (parsed.path or ""):
            return 0.6, "possible_recursive_url"
    except Exception:
        pass
    return 1.0, None


# ---------------------------------------------------------------------------
# Composite evaluator
# ---------------------------------------------------------------------------

async def evaluate_bundle(bundle: TelemetryBundle) -> VerificationResult:
    evaluators = {
        "http_success":     eval_http_success(bundle),
        "non_empty_body":   eval_non_empty_body(bundle),
        "no_hallucination": eval_no_hallucination(bundle),
        "context_coherent": eval_context_coherent(bundle),
        "no_loop":          eval_no_loop(bundle),
    }

    scores: dict[str, float] = {}
    flags: list[str] = []

    for name, (score, flag) in evaluators.items():
        scores[name] = score
        if flag:
            flags.append(flag)

    composite = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)
    passed = composite >= COMPOSITE_PASS_THRESHOLD

    return VerificationResult(
        request_id=bundle.request_id,
        proof_of_execution=passed,
        composite_score=round(composite, 4),
        individual_scores=scores,
        flags=flags,
        model_version="mock-v0.1",
    )

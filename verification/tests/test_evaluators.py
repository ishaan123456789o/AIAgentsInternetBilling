"""
pytest test suite for the Verification Engine evaluators.
Run with: pytest verification/tests/
"""

import asyncio
import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from models import TelemetryBundle
from evaluators import (
    evaluate_bundle,
    eval_http_success,
    eval_non_empty_body,
    eval_no_hallucination,
    COMPOSITE_PASS_THRESHOLD,
)


def _bundle(**kwargs) -> TelemetryBundle:
    defaults = dict(
        request_id="test-001",
        session_id="sess-001",
        developer_id="dev-001",
        target_url="https://httpbin.org/get",
        http_method="GET",
        request_headers={"accept": "application/json"},
        request_body="",
        response_status=200,
        response_body='{"status": "ok", "data": {"result": "found relevant article about quantum computing"}}',
        response_headers={"content-type": "application/json"},
        latency_ms=142,
        request_hash="abc123",
    )
    defaults.update(kwargs)
    return TelemetryBundle(**defaults)


class TestHttpSuccess:
    def test_2xx_passes(self):
        assert eval_http_success(_bundle(response_status=200))[0] == 1.0
        assert eval_http_success(_bundle(response_status=201))[0] == 1.0

    def test_4xx_fails(self):
        score, flag = eval_http_success(_bundle(response_status=404))
        assert score == 0.0
        assert flag == "http_404"

    def test_5xx_fails(self):
        score, flag = eval_http_success(_bundle(response_status=503))
        assert score == 0.0
        assert flag == "upstream_error"


class TestNonEmptyBody:
    def test_empty_body_fails(self):
        score, flag = eval_non_empty_body(_bundle(response_body=""))
        assert score == 0.0
        assert flag == "empty_response"

    def test_short_body_fails(self):
        score, flag = eval_non_empty_body(_bundle(response_body="ok"))
        assert score == 0.0

    def test_substantial_body_passes(self):
        assert eval_non_empty_body(_bundle())[0] == 1.0


class TestHallucinationDetector:
    def test_ai_refusal_flagged(self):
        score, flag = eval_no_hallucination(
            _bundle(response_body="I cannot access that URL as an AI language model.")
        )
        assert score < 0.5
        assert flag == "hallucination_detected"

    def test_json_response_passes(self):
        score, flag = eval_no_hallucination(_bundle())
        assert score == 1.0
        assert flag is None


class TestCompositePipeline:
    @pytest.mark.parametrize("status", [301, 400, 404, 429, 500, 503])
    def test_failed_http_status_cannot_pass_with_good_content(self, status):
        result = asyncio.run(evaluate_bundle(_bundle(response_status=status)))
        assert result.proof_of_execution is False
        assert result.individual_scores["http_success"] == 0.0

    @pytest.mark.parametrize("body", ["", "   ", "{}"])
    def test_empty_or_trivial_body_cannot_pass(self, body):
        result = asyncio.run(evaluate_bundle(_bundle(response_body=body)))
        assert result.proof_of_execution is False
        assert "empty_response" in result.flags

    def test_clean_response_passes(self):
        result = asyncio.run(evaluate_bundle(_bundle()))
        assert result.proof_of_execution is True
        assert result.composite_score >= COMPOSITE_PASS_THRESHOLD

    def test_hallucinated_response_fails(self):
        b = _bundle(
            response_body="I'm sorry, I cannot access this content.",
            response_status=200,
        )
        result = asyncio.run(evaluate_bundle(b))
        assert result.proof_of_execution is False
        assert "hallucination_detected" in result.flags

    def test_upstream_error_fails(self):
        b = _bundle(response_status=500, response_body="Internal Server Error")
        result = asyncio.run(evaluate_bundle(b))
        assert result.proof_of_execution is False

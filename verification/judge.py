"""
LLM-as-a-Judge — Proof-of-Execution verification via Gemini.

Uses the Google Gen AI SDK with forced function calling so the response is always
a structured JSON object — never free-form text that needs parsing.

Fallback path: if GEMINI_API_KEY is absent or the API call fails for any
reason, evaluate_with_judge() delegates to the heuristic evaluators in
evaluators.py so the billing pipeline stays live.
"""

import logging
from typing import Optional

from google import genai
from google.genai import types

from evaluators import evaluate_bundle
from models import TelemetryBundle, VerificationResult

logger = logging.getLogger(__name__)

_MAX_BODY_CHARS = 3_000
_MODEL = "gemini-2.0-flash"
_client_cache: dict[str, genai.Client] = {}

_SYSTEM_PROMPT = """\
You are a strict, impartial Proof-of-Execution verifier for an AI agent billing system.
Your only job is to call grade_execution exactly once with an honest verdict.
Grading rules:
  - proof_of_execution is True only when the response is coherent, substantive, and
    directly answers the agent's request.
  - CAPTCHA pages, Cloudflare challenge pages, 403/429 blocks, empty bodies, and
    AI-generated refusals ("I cannot", "as an AI") always produce proof_of_execution=False.
  - When in doubt, fail the execution. We never want to bill for noise."""

_GRADE_FUNCTION = types.FunctionDeclaration(
    name="grade_execution",
    description=(
        "Record the Proof-of-Execution verdict for one HTTP request/response pair. "
        "Called exactly once per verification."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "proof_of_execution": types.Schema(
                type=types.Type.BOOLEAN,
                description=(
                    "True if and only if the agent received a genuine, coherent, "
                    "non-empty response that satisfies its intent."
                ),
            ),
            "coherence_score": types.Schema(
                type=types.Type.NUMBER,
                description=(
                    "0.0–1.0. How well does the response body answer the agent's request? "
                    "0 = completely irrelevant or blocked; 1 = perfectly answers the intent."
                ),
            ),
            "anti_bot_detected": types.Schema(
                type=types.Type.BOOLEAN,
                description=(
                    "True if the response is a bot-block: CAPTCHA, Cloudflare challenge, "
                    "access denied page, or HTTP 403/429 with a gating body."
                ),
            ),
            "hallucination_detected": types.Schema(
                type=types.Type.BOOLEAN,
                description=(
                    'True if the response contains an AI-generated refusal or fabricated content: '
                    '"I cannot", "as an AI language model", clearly invented facts, etc.'
                ),
            ),
            "reasoning": types.Schema(
                type=types.Type.STRING,
                description="One concise sentence explaining the verdict.",
            ),
        },
        required=[
            "proof_of_execution",
            "coherence_score",
            "anti_bot_detected",
            "hallucination_detected",
            "reasoning",
        ],
    ),
)


async def _call_judge(bundle: TelemetryBundle, client: genai.Client) -> dict:
    """Send the telemetry bundle to Gemini and return the raw function-call args dict."""
    intent_line = f"Agent Intent: {bundle.agent_intent}\n" if bundle.agent_intent else ""
    body_line = (
        f"\nRequest Body:\n{bundle.request_body[:500]}\n"
        if bundle.request_body.strip()
        else ""
    )
    truncated_body = bundle.response_body[:_MAX_BODY_CHARS]
    was_truncated = len(bundle.response_body) > _MAX_BODY_CHARS

    user_prompt = f"""\
Verify this AI agent execution and call grade_execution with your verdict.

{intent_line}Request:  {bundle.http_method} {bundle.target_url}{body_line}
Response Status:  {bundle.response_status}
Content-Type:     {bundle.response_headers.get("content-type", "unknown")}
Latency:          {bundle.latency_ms} ms
Response Body{" (truncated)" if was_truncated else ""}:
---
{truncated_body}
---"""

    response = await client.aio.models.generate_content(
        model=_MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_PROMPT,
            tools=[types.Tool(function_declarations=[_GRADE_FUNCTION])],
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(
                    mode="ANY",
                    allowed_function_names=["grade_execution"],
                )
            ),
        ),
    )

    part = response.candidates[0].content.parts[0]
    return dict(part.function_call.args)


async def evaluate_with_judge(
    bundle: TelemetryBundle,
    gemini_api_key: Optional[str],
) -> VerificationResult:
    """
    Primary path: call the Gemini judge and map its verdict to VerificationResult.
    Fallback: heuristic evaluators when the key is absent or the API call fails.
    """
    if gemini_api_key:
        try:
            if gemini_api_key not in _client_cache:
                _client_cache[gemini_api_key] = genai.Client(api_key=gemini_api_key)
            client = _client_cache[gemini_api_key]
            verdict = await _call_judge(bundle, client)

            flags: list[str] = []
            if verdict["anti_bot_detected"]:
                flags.append("anti_bot_detected")
            if verdict["hallucination_detected"]:
                flags.append("hallucination_detected")

            return VerificationResult(
                request_id=bundle.request_id,
                proof_of_execution=verdict["proof_of_execution"],
                composite_score=round(float(verdict["coherence_score"]), 4),
                individual_scores={
                    "llm_coherence":       float(verdict["coherence_score"]),
                    "anti_bot_clear":      0.0 if verdict["anti_bot_detected"] else 1.0,
                    "hallucination_clear": 0.0 if verdict["hallucination_detected"] else 1.0,
                },
                flags=flags,
                model_version=_MODEL,
                judge_reasoning=verdict["reasoning"],
            )

        except Exception as exc:
            logger.warning(
                "LLM judge failed for request %s — falling back to heuristics: %s",
                bundle.request_id,
                exc,
            )

    return await evaluate_bundle(bundle)

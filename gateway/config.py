from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_key: str         # service_role key — never exposed to clients
    verification_engine_url: str = "http://verification:9000"
    loop_strike_threshold: int = 3    # identical requests before flagging a loop
    internal_secret: str = ""         # shared with verification engine; empty = auth disabled

    # Auth cache: validated sessions are cached for this many seconds to reduce
    # Supabase round-trips. Revoked tokens remain usable within this window.
    session_cache_ttl: float = 15.0

    # Max bytes of request/response body captured in telemetry bundles.
    # Prevents OOM from large upstream responses.
    max_body_capture_bytes: int = 131_072  # 128 KB

    # Comma-separated allowed CORS origins. "*" allows all (dev default).
    allowed_origins: str = "*"

    # Per-developer rate limit — max requests per 60-second sliding window.
    # 0 = disabled.
    rate_limit_rpm: int = 120

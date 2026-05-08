from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_key: str
    gemini_api_key: str = ""  # leave blank to fall back to heuristic evaluators
    internal_secret: str = ""    # must match gateway's INTERNAL_SECRET; empty = auth disabled

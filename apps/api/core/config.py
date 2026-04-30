from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    api_key: str = "dev-secret"

    # AI 分類のプロバイダ。"openrouter" (推奨) | "anthropic" (直接呼び出し)
    ai_provider: str = "openrouter"
    # OpenRouter (https://openrouter.ai) を使う場合のキーとモデル
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-haiku-4-5"
    # Anthropic API を直接使う場合（後方互換）
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5"

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    debug: bool = False


settings = Settings()

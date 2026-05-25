from pydantic_settings import BaseSettings, SettingsConfigDict

# 安全でない既定値。本番 (debug=False) でこの値のままだと起動を拒否する。
INSECURE_API_KEYS = {"", "dev-secret", "dev-secret-key", "your-secret-key-here"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # 開発時のみ既定値で動く。本番では必ず環境変数で上書きすること。
    api_key: str = "dev-secret"

    # CORS 許可オリジン (カンマ区切り)。財務 API なのでワイルドカードは使わない。
    # 主呼び出し元は Next.js サーバ (server-to-server) のため、未設定でも通常運用は動作する。
    cors_origins: str = ""

    # アップロード PDF の最大バイト数 (DoS 対策)
    max_upload_bytes: int = 15 * 1024 * 1024

    # AI 再分類を使うか。既定 False = ルールベースのみ (AI 課金ゼロ)。
    # コストを抑えたい運用ではこれを False のままにする。
    # 有効化するには ai_enabled=true かつ各プロバイダのキーが必要。
    ai_enabled: bool = False

    # AI 分類のプロバイダ。"openrouter" (推奨) | "anthropic" (直接呼び出し)
    ai_provider: str = "openrouter"
    # OpenRouter (https://openrouter.ai) を使う場合のキーとモデル
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-haiku-4-5"
    # Anthropic API を直接使う場合（後方互換）
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5"

    debug: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def api_key_is_insecure(self) -> bool:
        return self.api_key in INSECURE_API_KEYS

    def assert_production_ready(self) -> None:
        """本番起動前のフェイルファスト検証。debug=False で安全でない設定なら例外。"""
        if self.debug:
            return
        if self.api_key_is_insecure:
            raise RuntimeError(
                "API_KEY が未設定または既定の安全でない値です。"
                "本番環境では強力なランダム値を環境変数 API_KEY に設定してください。"
            )


settings = Settings()

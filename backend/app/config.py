from functools import lru_cache
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_ROOT_DIR = _BACKEND_DIR.parent
_ENV_FILE = _ROOT_DIR / ".env"
if _ENV_FILE.is_file():
    # Repo-root .env overrides a global/shell DATABASE_URL (common Cursor/IDE env).
    load_dotenv(_ENV_FILE, override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_anon_key: str = Field(default="", alias="SUPABASE_ANON_KEY")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")
    database_url: str = Field(..., alias="DATABASE_URL")

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

    jwt_secret_key: str = Field(..., alias="JWT_SECRET_KEY")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_access_token_expire_minutes: int = Field(
        default=1440, alias="JWT_ACCESS_TOKEN_EXPIRE_MINUTES"
    )

    admin_email: str = Field(..., alias="ADMIN_EMAIL")
    admin_password: str = Field(..., alias="ADMIN_PASSWORD")

    email_address: str = Field(default="", alias="EMAIL_ADDRESS")
    email_app_password: str = Field(default="", alias="EMAIL_APP_PASSWORD")
    smtp_host: str = Field(default="smtp.gmail.com", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")

    frontend_url: str = Field(default="http://localhost:3000", alias="FRONTEND_URL")
    backend_cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="BACKEND_CORS_ORIGINS",
    )

    run_startup_db_setup: bool = Field(default=True, alias="RUN_STARTUP_DB_SETUP")

    default_timezone: str = Field(default="Asia/Kolkata", alias="DEFAULT_TIMEZONE")
    visitor_overstay_check_cron_seconds: int = Field(
        default=60, alias="VISITOR_OVERSTAY_CHECK_CRON_SECONDS"
    )
    grace_period_minutes_default: int = Field(
        default=15, alias="GRACE_PERIOD_MINUTES_DEFAULT"
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        if not v:
            return v
        if v.startswith("postgresql+asyncpg://"):
            v = v.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        elif v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql+psycopg2://", 1)
        elif v.startswith("postgresql://") and "+psycopg2" not in v:
            v = v.replace("postgresql://", "postgresql+psycopg2://", 1)
        if "supabase.co" in v and "sslmode" not in v.lower():
            sep = "&" if "?" in v else "?"
            v = f"{v}{sep}sslmode=require"
        return v

    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.backend_cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def clear_settings_cache() -> None:
    get_settings.cache_clear()

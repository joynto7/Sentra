from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, read from environment variables (or a .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Sentra API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://sentra:sentra@localhost:5432/sentra"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:3000"]
    web_url: str = "http://localhost:3000"
    # Run every module's startup.py when the API starts (switched off in the tests).
    run_startup_hooks: bool = True

    # E-mail: "smtp" sends through SMTP (Mailpit in development); "memory" keeps
    # messages in app.core.email.outbox (used by the tests).
    email_backend: str = "smtp"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    mail_from: str = "Sentra <no-reply@sentra.local>"

    # Sessions (NFR-3.5)
    session_cookie_name: str = "sentra_session"
    session_idle_minutes: int = 30
    cookie_secure: bool = True

    # Slowing down repeated failed logins (UC-1.2)
    login_max_failures: int = 5
    login_lock_minutes: int = 15

    # Encryption of target credentials (FR-2.2, NFR-3.1): an AES-256 key, base64-encoded, kept
    # outside the database. Make one with:
    #   python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
    credentials_key: str = ""
    # Server-side request forgery protection (NFR-3.4): targets on private network addresses are
    # refused, unless an on-premises deployment allows them.
    allow_private_targets: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()

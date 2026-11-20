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
    # The second step of a login with two-step verification (FR-1.2)
    second_step_cookie_name: str = "sentra_second_step"
    # How long an entered password allows changing security settings (UC-1.7 step 2)
    password_confirmation_minutes: int = 10

    # Slowing down repeated failed logins (UC-1.2)
    login_max_failures: int = 5
    login_lock_minutes: int = 15

    # Encryption of stored secrets, such as target credentials (FR-2.2) and the secrets of
    # two-step verification (FR-1.2), NFR-3.1: an AES-256 key, base64-encoded, kept outside the
    # database. Make one with:
    #   python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
    credentials_key: str = ""
    # The LLM layer (NFR-7.3): LiteLLM model names, "provider/model", such as
    # "anthropic/claude-sonnet-5-5", "openai/gpt-5" or "ollama/llama3.1" (a local model).
    # llm_model serves every task unless llm_task_models names another one for a task, e.g.
    # LLM_TASK_MODELS='{"llm_judge": "anthropic/claude-haiku-5-5"}'. The providers' keys come from
    # their own variables (ANTHROPIC_API_KEY, OPENAI_API_KEY). FR-10.3 moves this to the database.
    llm_model: str = ""
    llm_task_models: dict[str, str] = {}
    llm_api_base: str = ""  # e.g. http://host.docker.internal:11434 for Ollama on the laptop
    llm_timeout_seconds: int = 60
    llm_retries: int = 2

    # The Target Connector (FR-5.7): how long a target may take to answer.
    connector_timeout_seconds: int = 60
    # Host names of Sentra's own lab targets in the isolated lab network (FR-11.2). Only the
    # connector may reach their private addresses; users can't register such addresses.
    lab_hosts: list[str] = []
    # The lab targets' own administration token: Sentra places the ownership token of a lab target
    # itself and reads its current canary tokens with it (FR-11.1, lifecycle diagram of a target).
    lab_admin_token: str = "lab-admin-rag-chatbot"
    # The API key with which Sentra registers its RAG chatbot lab target (UC-11.1 step 4).
    lab_api_key: str = "lab-key-rag-chatbot"

    # Background jobs (connection tests, ownership checks, profile mapping, campaign runs) run on
    # the workers. The tests set this to run them at once, inside the request.
    run_jobs_inline: bool = False

    # Server-side request forgery protection (NFR-3.4): targets on private network addresses are
    # refused, unless an on-premises deployment allows them.
    allow_private_targets: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()

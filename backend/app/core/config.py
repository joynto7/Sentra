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
    # Sentra's own API as a browser reaches it. Single sign-on needs it (FR-1.3): the identity
    # provider sends its answer straight here, because the session cookie is set in that answer.
    api_url: str = "http://localhost:8000/api"
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

    # Campaign runs (FR-5.4, FR-5.7). A worker works on one run for at most run_slice_seconds, then
    # puts it back at the end of the queue, so every run gets its turn (NFR-6.4).
    run_slice_seconds: int = 25
    # A target that answers "overloaded" (HTTP 429 or 503) this many times in a row stops the run
    # (FR-5.7); other errors in a row stop it after run_max_errors.
    run_max_overloads: int = 3
    run_max_errors: int = 5
    # A target that can't be reached pauses the run, which retries after these delays in seconds
    # and stops after the last one (NFR-2.3).
    run_retry_delays: list[int] = [15, 30, 60, 120, 240]
    # Sentra's own code failing this many times in a row on one run stops the run (NFR-2.3).
    run_max_worker_errors: int = 3
    # The platform's default monthly limits of an organization (UC-10.6, 1a1), in force until a
    # Platform Administrator sets limits for that organization on Screen 61 (FR-10.4).
    default_monthly_campaign_runs: int = 100
    default_monthly_attempts: int = 50_000
    default_monthly_llm_cost_usd: float = 100.0
    # The share of a limit at which an organization is warned (FR-10.4, UC-10.6 step 3).
    default_usage_warn_percent: int = 80

    # System health (FR-10.6, UC-10.9 step 3): the platform's default alert thresholds, until a
    # Platform Administrator sets them on Screen 63.
    default_queue_length_alert: int = 1_000  # jobs waiting in the Task Queue
    default_error_rate_alert: float = 2.0  # per cent of the API's requests
    default_worker_load_alert: int = 90  # per cent of the workers' capacity in use
    default_storage_alert: int = 85  # per cent of the object storage's disk in use
    default_gateway_silence_minutes: int = 5  # a Sentra Shield gateway that stopped reporting
    # Where an alert links to (UC-10.9 step 5). Empty means the alert carries no such link.
    grafana_url: str = ""
    logs_url: str = ""
    # When set, GET /api/metrics needs `Authorization: Bearer <token>` (NFR-5.5).
    metrics_token: str = ""
    # The LLM judge (FR-6.1; UC-6.1, 3a): a judge that can't answer (the provider fails, or the
    # monthly LLM cost limit is reached) tries again after these delays in seconds; after the last
    # one the attempt is marked as not evaluated by the judge.
    detection_judge_retry_delays: list[int] = [60, 300, 900]
    # The adaptive testing agent (FR-5.5; UC-5.5 step 6). It refines one test at most this many
    # times in a row, and may use at most this share of a run's attempt budget, so a run can never
    # spend everything on refinements. Its instructions are app/workers/agent/instructions.py.
    agent_max_refinements_per_test: int = 3
    agent_budget_share: float = 0.3
    # Three more limits that stop the agent for the rest of a run (FR-5.7): its refinements in
    # all, what its requests cost in US dollars, and how many requests in a row may fail (an
    # answer that can't be used, or a proposal outside the scope).
    agent_max_refinements_per_run: int = 50
    agent_cost_cap_usd: float = 2.0
    agent_max_failures_in_a_row: int = 4
    # Sentra's own clock (FR-5.3, app/workers/scheduler.py): how often it looks for work that is
    # due. A campaign scheduled for 02:00 therefore starts within a minute of 02:00.
    scheduler_tick_seconds: int = 60

    # Live events of campaign runs (FR-5.6): "redis" (a stream per run), or "memory" in the tests.
    live_events_backend: str = "redis"
    # The live stream of a run closes after this many seconds and the browser reconnects with the
    # last event it saw, so the session and the membership are checked again (NFR-3.3).
    live_stream_seconds: int = 60
    # The object storage (app/core/storage.py): a directory that the API and the workers share,
    # a Docker volume in compose.yaml. It holds evidence documents over 64 KB (FR-6.3, NFR-6.2).
    object_storage_dir: str = "/data/objects"

    # Server-side request forgery protection (NFR-3.4): targets on private network addresses are
    # refused, unless an on-premises deployment allows them.
    allow_private_targets: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()

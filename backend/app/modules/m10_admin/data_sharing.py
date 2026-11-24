"""Data sharing with LLM providers (UC-10.5, NFR-9.6, Screen 59): for each task of Sentra's own
AI, which provider and model processes the organization's data, whether it runs outside the
platform, what it receives and how often it was used this month; and the setting "Local models
only", which the LLM layer enforces at every request (app/llm/layer.py), so no module can bypass it.

The model of each task is the one a Platform Administrator assigned on Screen 62 (FR-10.3),
or, while a task has none, the one the settings name (app/llm/config.py).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.audit import AuditLogEntry
from app.core.email import send_email
from app.core.errors import FieldValidationError
from app.core.models import Organization
from app.llm.config import LLMTask, model_for
from app.llm.models import LLMUsage
from app.modules.m01_users.members import WRONG_PASSWORD
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.security import verify_password

ACTION = "data.llm_sharing_changed"

# The functions on the page, in the report's words (UC-10.4, UC-10.5).
FUNCTIONS = {
    LLMTask.ADAPTIVE_TESTING: "Adaptive testing agent",
    LLMTask.LLM_JUDGE: "LLM judge",
    LLMTask.THREAT_MODELING: "Threat Model generation",
    LLMTask.REMEDIATION: "Remediation generation",
    LLMTask.ASSISTANT: "Assistant",
}
# Only the data a task needs reaches its model, masked first (NFR-9.6, UC-10.5 quality req. 1).
RECEIVES = {
    LLMTask.ADAPTIVE_TESTING: "Masked target replies of a campaign run",
    LLMTask.LLM_JUDGE: "Masked attempts and replies",
    LLMTask.THREAT_MODELING: "Masked Target Profiles",
    LLMTask.REMEDIATION: "Masked findings and evidence",
    LLMTask.ASSISTANT: "Masked chat messages and the lists and records the assistant reads for you",
}
# What a function does without a model, as when the LLM Provider is unavailable (UC-10.5, 4a1):
# UC-5.5 2a, UC-6.1 3a, UC-3.1 4a and UC-8.2 4a.
WITHOUT_MODEL = {
    LLMTask.ADAPTIVE_TESTING: "Campaign runs send their planned tests only.",
    LLMTask.LLM_JUDGE: "Attempts are evaluated by the other detection methods only.",
    LLMTask.THREAT_MODELING: "Threat models are created with the baseline threats only.",
    LLMTask.REMEDIATION: "Remediation proposals are built from the test's recommended mitigation.",
    LLMTask.ASSISTANT: "The assistant answers from the product guide and links to the pages.",
}
PROVIDERS = {
    "anthropic": "Anthropic",
    "azure": "Azure OpenAI",
    "bedrock": "Amazon Bedrock",
    "gemini": "Google Gemini",
    "hosted_vllm": "vLLM",
    "llamafile": "llamafile",
    "lm_studio": "LM Studio",
    "mistral": "Mistral AI",
    "ollama": "Ollama",
    "ollama_chat": "Ollama",
    "openai": "OpenAI",
    "vertex_ai": "Google Vertex AI",
}
MASKING = "Secrets and personal data are masked before any request leaves Sentra."


@dataclass
class TaskRow:
    task: str
    function: str
    model: str | None  # the model's name without its provider, e.g. "claude-sonnet-5-5"
    provider: str | None  # e.g. "Anthropic"
    deployment: str | None  # "external" or "local"; None without a model
    receives: str
    requests_this_month: int
    local_model: bool  # a local model serves it, so it stays available with local models only
    available: bool  # with the organization's current setting
    without_model: str


@dataclass
class Overview:
    local_models_only: bool
    changed_by: str | None
    changed_at: datetime | None
    tasks: list[TaskRow]
    masking: str = MASKING


def _month_start() -> datetime:
    return datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def requests_this_month(db: Session, organization_id: uuid.UUID) -> dict[str, int]:
    """UC-10.5 step 2: the organization's requests per task since the 1st, failed ones included,
    because their data reached the provider too."""
    rows = db.execute(
        select(LLMUsage.task, func.count())
        .where(LLMUsage.organization_id == organization_id, LLMUsage.created_at >= _month_start())
        .group_by(LLMUsage.task)
    )
    return dict(rows.all())


def unavailable_with_local_only(db: Session) -> list[LLMTask]:
    """UC-10.5 step 4: the tasks without a local model."""
    return [task for task in LLMTask if model_for(db, task, local_only=True) is None]


def overview(db: Session, organization: Organization) -> Overview:
    """UC-10.5 steps 1-2."""
    counts = requests_this_month(db, organization.id)
    rows = []
    for task in LLMTask:
        choice = model_for(db, task)
        local = model_for(db, task, local_only=True) is not None
        provider = choice.provider if choice else None
        rows.append(
            TaskRow(
                task=task,
                function=FUNCTIONS[task],
                model=choice.model.split("/", 1)[-1] if choice else None,
                provider=(choice.provider_label or PROVIDERS.get(provider, provider))
                if provider
                else None,
                deployment=choice.deployment if choice else None,
                receives=RECEIVES[task],
                requests_this_month=counts.get(task, 0),
                local_model=local,
                available=local if organization.local_models_only else choice is not None,
                without_model=WITHOUT_MODEL[task],
            )
        )
    last = db.scalar(
        select(AuditLogEntry)
        .where(
            AuditLogEntry.chain == audit.chain_key(organization.id), AuditLogEntry.action == ACTION
        )
        .order_by(AuditLogEntry.seq.desc())
        .limit(1)
    )
    return Overview(
        local_models_only=organization.local_models_only,
        changed_by=last.actor_name if last else None,
        changed_at=last.occurred_at if last else None,
        tasks=rows,
    )


def set_local_models_only(
    db: Session,
    admin: Membership,
    admin_user: User,
    enabled: bool,
    password: str,
    background: BackgroundTasks,
) -> Organization:
    """UC-10.5 steps 3-6 and 3a: confirmed with the password (NFR-3.5), applied to the next LLM
    request of the organization, recorded in the audit log. When tasks lose their model, the
    Platform Administrators are told, so they can assign local models (4a1)."""
    if not verify_password(admin_user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    organization = db.get_one(Organization, admin.organization_id)
    if organization.local_models_only == enabled:
        return organization
    missing = [FUNCTIONS[task] for task in unavailable_with_local_only(db)] if enabled else []
    organization.local_models_only = enabled
    audit.record(
        db,
        organization_id=organization.id,
        actor=admin_user,
        action=ACTION,
        summary="Restricted Sentra's AI to local models only"
        if enabled
        else "Allowed external LLM providers again",
        item=audit.Item("organization", organization.id, organization.name),
        details={
            "before": {"local_models_only": not enabled},
            "after": {"local_models_only": enabled},
            **({"unavailable": missing} if missing else {}),
        },
    )
    db.commit()
    if missing:
        for platform_admin in db.scalars(select(User).where(User.platform_admin.is_(True))):
            background.add_task(
                send_email,
                platform_admin.email,
                f"Sentra: {organization.name} uses local models only",
                f"Hello {platform_admin.name},\n\n{organization.name} now uses local models only. "
                f"No local model is configured for: {', '.join(missing)}. These functions are "
                "unavailable for the organization until a local model is assigned to them.\n",
            )
    return organization

"""Module 10, operations part (Joynto): the LLM providers (FR-10.3), the usage and cost limits
(FR-10.4) and the system health (FR-10.6), for Platform Administrators.

These endpoints belong to no organization, so they never touch organization data (NFR-3.3), and
only a Platform Administrator gets through (`platform_admin`). Changing anything here needs the
password again, confirmed in the last ten minutes (NFR-3.5).
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import platform_admin, recent_password_confirmation
from app.modules.m01_users.models import User
from app.modules.m10_admin import health, llm_providers, usage_limits
from app.modules.m10_admin.operations_schemas import (
    AlertOut,
    AssignmentIn,
    AssignmentOut,
    ComponentOut,
    HealthOut,
    LimitOut,
    LimitsIn,
    LLMConfigurationOut,
    ModelOut,
    NewModelIn,
    OrganizationUsageOut,
    ProviderIn,
    ProviderOut,
    TestResultOut,
    ThresholdsIn,
    ThresholdsOut,
    UsageOverviewOut,
)

router = APIRouter(prefix="/admin/platform", tags=["M10 Platform operations"])
confirmed = Depends(recent_password_confirmation)


def _provider_out(row: llm_providers.ProviderRow) -> ProviderOut:
    return ProviderOut(
        **{**row.__dict__, "models": [ModelOut(**model.__dict__) for model in row.models]}
    )


def _new(data: ProviderIn) -> llm_providers.NewProvider:
    return llm_providers.NewProvider(
        kind=data.kind,
        name=data.name,
        base_url=data.base_url,
        api_key=data.api_key,
        models=[llm_providers.NewModel(name=m.name, label=m.label) for m in data.models],
    )


# ---------------------------------------------------------------- LLM providers (UC-10.4)


@router.get("/llm")
def llm_configuration(
    admin: User = Depends(platform_admin), db: Session = Depends(get_db)
) -> LLMConfigurationOut:
    """Screen 62: the providers with their models and last connection test, and the model that
    does each task of Sentra's own AI."""
    found = llm_providers.configuration(db)
    return LLMConfigurationOut(
        providers=[_provider_out(provider) for provider in found.providers],
        assignments=[AssignmentOut(**row.__dict__) for row in found.assignments],
        recorded=found.recorded,
    )


@router.post("/llm/test")
def test_connection(
    data: ProviderIn,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> TestResultOut:
    """UC-10.4 step 3: "Test connection" of the panel, before anything is saved. It asks the
    provider's first model and answers with the reply, the time and the cost."""
    return TestResultOut(**llm_providers.test_new(db, _new(data)).__dict__)


@router.post("/llm/providers", status_code=201)
def add_provider(
    data: ProviderIn,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> ProviderOut:
    """UC-10.4 steps 1-3 and 5, and 3a1: the provider is tested once more and saved only if that
    request worked; a failed test saves nothing and answers with what the provider said."""
    return _provider_out(llm_providers.row_of(db, llm_providers.add(db, admin, _new(data))))


@router.post("/llm/providers/{provider_id}/test")
def test_provider(
    provider_id: uuid.UUID,
    model_id: uuid.UUID | None = None,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> TestResultOut:
    """The test panel of Screen 62: the same request to a provider that is already configured,
    with its stored key. The result stays on the provider's card."""
    return TestResultOut(**llm_providers.test_saved(db, provider_id, model_id).__dict__)


@router.post("/llm/providers/{provider_id}/models", status_code=201)
def add_model(
    provider_id: uuid.UUID,
    data: NewModelIn,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> ModelOut:
    """One more model of a configured provider, kept only when a request to it works."""
    model = llm_providers.add_model(
        db, admin, provider_id, llm_providers.NewModel(name=data.name, label=data.label)
    )
    return ModelOut(id=model.id, name=model.name, label=model.label, tasks=[])


@router.delete("/llm/providers/{provider_id}", status_code=204)
def remove_provider(
    provider_id: uuid.UUID,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> None:
    """UC-10.4, 5a1: refused while a task still uses one of its models."""
    llm_providers.remove(db, admin, provider_id)


@router.put("/llm/tasks/{task}")
def assign_model(
    task: str,
    data: AssignmentIn,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> AssignmentOut:
    """UC-10.4 step 4: the model of one task. New requests use it at once (step 6), and for the
    LLM judge the row carries the recommendation of 4a1."""
    row = llm_providers.assign(db, admin, llm_providers.task_of(task), data.provider_model_id)
    return AssignmentOut(**row.__dict__)


# ---------------------------------------------------------------- usage and cost limits (UC-10.6)


def _usage_out(row: usage_limits.OrganizationRow) -> OrganizationUsageOut:
    return OrganizationUsageOut(
        **{**row.__dict__, "limits": [LimitOut(**limit.__dict__) for limit in row.limits]}
    )


@router.get("/organizations")
def organizations(
    admin: User = Depends(platform_admin), db: Session = Depends(get_db)
) -> UsageOverviewOut:
    """Screen 61 (UC-10.6 step 1): every organization's usage this month against its limits, with
    the platform's defaults for the limits nobody has set."""
    found = usage_limits.overview(db)
    return UsageOverviewOut(
        organizations=[_usage_out(row) for row in found.organizations],
        defaults=found.defaults,
        warn_percent_default=found.warn_percent_default,
        notice=found.notice,
        warn_at=found.warn_at,
    )


@router.put("/organizations/{organization_id}/limits")
def set_limits(
    organization_id: uuid.UUID,
    data: LimitsIn,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> OrganizationUsageOut:
    """UC-10.6 steps 2-4: the monthly limits of one organization, in force from the next launch
    and the next attempt. A limit at or below this month's usage answers `409
    below_this_months_usage` with what that means, until `confirmed` says it was read (2a1)."""
    row = usage_limits.save(
        db,
        admin,
        organization_id,
        usage_limits.NewLimits(
            campaign_runs=data.campaign_runs,
            attempts=data.attempts,
            llm_cost_usd=data.llm_cost_usd,
            warn_percent=data.warn_percent,
        ),
        confirmed=data.confirmed,
    )
    return _usage_out(row)


# ---------------------------------------------------------------- system health (UC-10.9)


def _health_out(found: health.Health) -> HealthOut:
    return HealthOut(
        status=found.status,
        headline=found.headline,
        components=[
            ComponentOut(key=c.key, label=c.label, status=c.status, lines=c.lines)
            for c in found.components
        ],
        open_alerts=[AlertOut(**alert.__dict__) for alert in found.open_alerts],
        history=[AlertOut(**alert.__dict__) for alert in found.history],
        thresholds=ThresholdsOut(**found.thresholds.__dict__),
        grafana_url=found.grafana_url,
        logs_url=found.logs_url,
        notice=found.notice,
    )


@router.get("/health")
def system_health(
    admin: User = Depends(platform_admin), db: Session = Depends(get_db)
) -> HealthOut:
    """Screen 63 (UC-10.9 steps 1-2): every component's status as it is right now, the open
    alerts with what they mean, the thresholds and the alert history."""
    return _health_out(health.page(db))


@router.put("/health/thresholds")
def set_thresholds(
    data: ThresholdsIn,
    admin: User = Depends(platform_admin),
    _session=confirmed,
    db: Session = Depends(get_db),
) -> HealthOut:
    """UC-10.9 step 3: the thresholds the Monitoring component measures against."""
    health.save_thresholds(
        db,
        admin,
        health.Thresholds(
            queue_length=data.queue_length,
            error_rate_percent=data.error_rate_percent,
            worker_load_percent=data.worker_load_percent,
            storage_percent=data.storage_percent,
            gateway_silence_minutes=data.gateway_silence_minutes,
        ),
    )
    return _health_out(health.page(db))

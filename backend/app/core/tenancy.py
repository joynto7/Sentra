import uuid

from sqlalchemy import Select, select

from app.core.models import OrganizationScoped


def scoped_select[M: OrganizationScoped](
    model: type[M], organization_id: uuid.UUID
) -> Select[tuple[M]]:
    """SELECT that only returns rows of one organization.

    Always start queries on organization-scoped tables with this helper, so that one
    organization can never read another organization's data.
    """
    return select(model).where(model.organization_id == organization_id)

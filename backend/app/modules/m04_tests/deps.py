import uuid

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users import organizations
from app.modules.m01_users.deps import current_session
from app.modules.m01_users.models import UserSession


def organization_id(
    session: UserSession = Depends(current_session), db: Session = Depends(get_db)
) -> uuid.UUID | None:
    """The member's organization, whose custom tests and suites they see; None for a user
    without one, who sees only the built-in ones."""
    membership = organizations.current(db, session)
    return membership.organization_id if membership else None

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.search import service
from app.modules.search.schemas import SearchIn, SearchOut

router = APIRouter(prefix="/search", tags=["Search"])


@router.post("", response_model=SearchOut)
def search(
    data: SearchIn,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> dict:
    """POST although it only reads: people search for sensitive things, and in a POST the words stay
    out of the address, so out of the access logs and the browser's history. Every member may read
    their organization's targets, findings and campaigns (FR-1.6, M1), so no role is checked
    here."""
    if not service.limiter.allow(membership.user_id):
        raise AppError(
            "Too many searches in a short time. Wait a minute and try again.",
            code="too_many_searches",
            status_code=429,
        )
    return service.search(db, membership.organization_id, data.q)

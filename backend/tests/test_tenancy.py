from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import Organization, OrganizationScoped, UUIDPrimaryKey
from app.core.tenancy import scoped_select


class Note(UUIDPrimaryKey, OrganizationScoped, Base):
    """Table used only by this test."""

    __tablename__ = "test_notes"

    text: Mapped[str] = mapped_column(String(100))


def test_scoped_select_returns_only_own_organization_rows(db):
    bank = Organization(name="Halcyon Bank", slug="halcyon-bank")
    other = Organization(name="Other Org", slug="other-org")
    db.add_all([bank, other])
    db.flush()
    db.add_all(
        [
            Note(organization_id=bank.id, text="ours"),
            Note(organization_id=other.id, text="theirs"),
        ]
    )
    db.flush()

    rows = db.scalars(scoped_select(Note, bank.id)).all()

    assert [row.text for row in rows] == ["ours"]

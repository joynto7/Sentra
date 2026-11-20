"""Give or take the Platform Administrator role (report 2.4). It is not an organization role, so
no page can grant it: only someone who runs the server can, with this command.

    docker compose run --rm api python -m app.modules.m10_admin.platform_admin grant <e-mail>
    docker compose run --rm api python -m app.modules.m10_admin.platform_admin revoke <e-mail>

Each change is recorded in the platform audit log (FR-10.2).
"""

import argparse
import sys

from sqlalchemy import select

from app.core import audit
from app.core.database import SessionLocal
from app.modules import load_models


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grant or revoke the Platform Administrator role.")
    parser.add_argument("change", choices=["grant", "revoke"])
    parser.add_argument("email")
    args = parser.parse_args(argv)
    load_models()
    from app.modules.m01_users.models import User

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
        if user is None:
            print(f"No account uses {args.email}. The person must register first.")
            return 1
        granted = args.change == "grant"
        if user.platform_admin == granted:
            print(f"{user.name} {'already is' if granted else 'is not'} a Platform Administrator.")
            return 0
        user.platform_admin = granted
        audit.record(
            db,
            organization_id=None,
            action="platform.admin_granted" if granted else "platform.admin_revoked",
            summary=f"{'Gave' if granted else 'Took'} the Platform Administrator role "
            f"{'to' if granted else 'from'} {user.name} (server command)",
            item=audit.Item("account", user.id, user.name),
            source_address=None,
        )
        db.commit()
        print(f"{user.name} is {'now' if granted else 'no longer'} a Platform Administrator.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

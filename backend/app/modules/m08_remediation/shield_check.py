"""UC-8.1 step 5: the harmless test request that proves a gateway is in the target's traffic path.

Sentra sends the connection test of UC-2.2 through the Target Connector — the only code that
sends anything to a target — with a one-time marker. The gateway reports the markers it has seen
with its heartbeat, so the answer here says what Sentra knows at once and the page asks again
until the gateway has reported (or the window has passed, which is 5a1).
"""

from sqlalchemy.orm import Session

from app.core.crypto import CryptoError
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m08_remediation import gateways
from app.modules.m08_remediation.models import GatewayStatus, ShieldGateway
from app.modules.m08_remediation.schemas import GatewayCheckOut


def run(db: Session, gateway: ShieldGateway) -> GatewayCheckOut:
    """Sends the test request and returns what it proved so far."""
    from app.modules.m08_remediation.shield_routes import _out
    from app.workers.connector import connector
    from app.workers.connector.errors import ConnectorError

    target = db.get_one(Target, gateway.target_id)
    if gateway.status == GatewayStatus.REVOKED:
        return GatewayCheckOut(
            gateway=_out(db, gateway, target),
            seen=False,
            waiting=False,
            message="This gateway is revoked. Connect a new one before you check the traffic.",
        )
    if target.status != TargetStatus.VERIFIED:
        return GatewayCheckOut(
            gateway=_out(db, gateway, target),
            seen=False,
            waiting=False,
            message="Verify that you own this target before Sentra sends anything to it.",
        )
    marker = gateways.start_check(db, gateway)
    try:
        connector.check_connection(db, target, marker=marker)
    except ConnectorError as exc:
        # The request didn't arrive, so it proves nothing about the gateway (4a1 and 5a1 are
        # about the gateway; this is about the target).
        return GatewayCheckOut(
            gateway=_out(db, gateway, target),
            seen=False,
            waiting=False,
            message=f"The test request didn't reach the application: {exc}",
        )
    except CryptoError:
        return GatewayCheckOut(
            gateway=_out(db, gateway, target),
            seen=False,
            waiting=False,
            message="The stored credentials of this target can't be read. Enter them again.",
        )
    state = gateways.check_state(db, gateway)
    seen = state == gateways.CHECK_SEEN
    return GatewayCheckOut(
        gateway=_out(db, gateway, target),
        seen=seen,
        waiting=state == gateways.CHECK_WAITING,
        message=(
            None
            if seen
            else "The request was sent. The gateway reports what it sees every "
            f"{gateways.HEARTBEAT_SECONDS} seconds."
        ),
    )

"""Role-based access control (FR-1.6): what each role in an organization may do.

The table follows the report: an action is allowed for the roles that are the primary actors of its
use cases (Chapter 3). Every member may read their organization's data; this table decides who may
change it. The server checks it on every request, so hiding a button in the browser is never the
only protection (FR-1.6). The Platform Administrator is not an organization role (UC-10.1).

Use it in any module:
    membership: Membership = Depends(require(Action.MANAGE_TARGETS))
"""

from dataclasses import dataclass
from enum import StrEnum

from fastapi import Depends

from app.core.errors import PermissionDeniedError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import ROLE_LABELS, Membership, Role

ANALYST, DEVELOPER, MANAGER, ADMIN = (
    Role.SECURITY_ANALYST,
    Role.TARGET_OWNER,
    Role.SECURITY_MANAGER,
    Role.ORG_ADMIN,
)


class Action(StrEnum):
    MANAGE_ORGANIZATION_SECURITY = "manage_organization_security"
    MANAGE_MEMBERS = "manage_members"
    MANAGE_TARGETS = "manage_targets"
    VERIFY_TARGETS = "verify_targets"
    TEST_TARGET_CONNECTIONS = "test_target_connections"
    MAP_TARGET_PROFILES = "map_target_profiles"
    MANAGE_THREAT_MODELS = "manage_threat_models"
    MANAGE_CUSTOM_TESTS = "manage_custom_tests"
    MANAGE_TEST_SUITES = "manage_test_suites"
    MANAGE_CAMPAIGNS = "manage_campaigns"
    APPROVE_CAMPAIGN_SCOPE = "approve_campaign_scope"
    PAUSE_CAMPAIGN_RUNS = "pause_campaign_runs"
    STOP_CAMPAIGN_RUNS = "stop_campaign_runs"
    TRIAGE_FINDINGS = "triage_findings"
    REQUEST_REMEDIATIONS = "request_remediations"
    APPROVE_REMEDIATIONS = "approve_remediations"
    MANAGE_SHIELD = "manage_shield"
    ROLL_BACK_SHIELD_POLICIES = "roll_back_shield_policies"
    GENERATE_REPORTS = "generate_reports"
    MANAGE_SECURITY_GATES = "manage_security_gates"
    MANAGE_API_KEYS_AND_WEBHOOKS = "manage_api_keys_and_webhooks"
    VIEW_AUDIT_LOG = "view_audit_log"
    MANAGE_DATA_SETTINGS = "manage_data_settings"
    USE_SECURITY_LAB = "use_security_lab"


@dataclass(frozen=True)
class Permission:
    label: str  # shown to people, for example in the change-role dialog (Screen 14)
    roles: frozenset[Role]
    use_cases: str  # where the report defines who does it


def _p(label: str, use_cases: str, *roles: Role) -> Permission:
    return Permission(label, frozenset(roles), use_cases)


PERMISSIONS: dict[Action, Permission] = {
    Action.MANAGE_ORGANIZATION_SECURITY: _p("Configure organization security", "UC-1.7", ADMIN),
    Action.MANAGE_MEMBERS: _p(
        "Invite, remove and change members", "UC-1.8, UC-1.10, UC-10.1, UC-10.2", ADMIN
    ),
    Action.MANAGE_TARGETS: _p("Register and change targets", "UC-2.1, UC-2.5, UC-2.6", DEVELOPER),
    Action.VERIFY_TARGETS: _p("Verify target ownership", "UC-2.3", DEVELOPER),
    Action.TEST_TARGET_CONNECTIONS: _p("Test target connections", "UC-2.2", DEVELOPER, ANALYST),
    Action.MAP_TARGET_PROFILES: _p("Map target profiles", "UC-2.4", DEVELOPER, ANALYST),
    Action.MANAGE_THREAT_MODELS: _p(
        "Review and approve threat models", "UC-3.1 to UC-3.4", ANALYST
    ),
    Action.MANAGE_CUSTOM_TESTS: _p("Create custom tests", "UC-4.2, UC-4.3", ANALYST),
    Action.MANAGE_TEST_SUITES: _p("Build test suites", "UC-4.4, UC-4.5", ANALYST),
    Action.MANAGE_CAMPAIGNS: _p("Create and launch campaigns", "UC-5.1, UC-5.3", ANALYST),
    Action.APPROVE_CAMPAIGN_SCOPE: _p("Approve campaign scope", "UC-5.2", MANAGER),
    Action.PAUSE_CAMPAIGN_RUNS: _p("Pause and resume campaign runs", "UC-5.7", ANALYST),
    # UC-5.7, 1b: developers may stop a run as an emergency measure, but not pause or resume it.
    Action.STOP_CAMPAIGN_RUNS: _p("Stop campaign runs", "UC-5.7", ANALYST, DEVELOPER),
    Action.TRIAGE_FINDINGS: _p("Triage findings", "UC-6.6, UC-7.1", ANALYST),
    Action.REQUEST_REMEDIATIONS: _p(
        "Request and adapt remediations", "UC-8.2, UC-8.3", DEVELOPER, ANALYST
    ),
    Action.APPROVE_REMEDIATIONS: _p("Approve remediations", "UC-8.3", ANALYST, MANAGER),
    Action.MANAGE_SHIELD: _p(
        "Connect Sentra Shield and deploy fixes", "UC-8.1, UC-8.4, UC-8.5", DEVELOPER
    ),
    Action.ROLL_BACK_SHIELD_POLICIES: _p("Roll back Shield Policies", "UC-8.8", DEVELOPER, ANALYST),
    Action.GENERATE_REPORTS: _p(
        "Generate and schedule reports", "UC-9.1, UC-9.2", ANALYST, MANAGER
    ),
    Action.MANAGE_SECURITY_GATES: _p("Configure security gates", "UC-9.4", ANALYST),
    Action.MANAGE_API_KEYS_AND_WEBHOOKS: _p(
        "Manage API keys and webhooks", "UC-9.6, UC-9.7", ADMIN
    ),
    Action.VIEW_AUDIT_LOG: _p("Review the audit log", "UC-10.3", ADMIN),
    Action.MANAGE_DATA_SETTINGS: _p(
        "Set data sharing and retention", "UC-10.5, UC-10.7, UC-10.8", ADMIN
    ),
    Action.USE_SECURITY_LAB: _p(
        "Run the Security Lab and benchmarks", "UC-11.1 to UC-11.6", ANALYST
    ),
}

# One line per role, shown where a role is chosen (Screens 05 and 13).
ROLE_DESCRIPTIONS = {
    Role.SECURITY_ANALYST: (
        "Runs campaigns, reviews threat models, triages findings, generates reports."
    ),
    Role.TARGET_OWNER: "Registers targets, proves ownership, reviews and applies fixes.",
    Role.SECURITY_MANAGER: "Approves campaign scope and remediations, reviews risk and reports.",
    Role.ORG_ADMIN: "Manages members, roles, API keys and organization settings.",
}


def allowed(role: str, action: Action) -> bool:
    return Role(role) in PERMISSIONS[action].roles


def actions_for(role: str) -> list[Action]:
    return [action for action in Action if allowed(role, action)]


def require(action: Action):
    """FastAPI dependency: only the roles allowed to do `action` get through. The endpoint receives
    the membership, whose organization_id limits every query to the member's organization."""

    def dependency(membership: Membership = Depends(current_membership)) -> Membership:
        if not allowed(membership.role, action):
            role = ROLE_LABELS[Role(membership.role)]
            raise PermissionDeniedError(
                f"Your role ({role}) doesn't allow this: {PERMISSIONS[action].label}."
            )
        return membership

    return dependency

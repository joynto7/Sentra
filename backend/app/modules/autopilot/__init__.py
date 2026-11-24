"""Autopilot: one button that does the whole assessment of a verified target, from the threat
model to the remediation proposals, and stops wherever a person has to decide.

It is not one of the 62 requirements. Like the assistant, it is another way to use the features that
exist: every stage calls the same functions as the pages (the threat model job of M3, the campaign
and run of M5, the remediation job of M8), with the permissions of the person who started it, so
roles (FR-1.6), tenancy (NFR-3.3), the verified-target rule (NFR-8.1), the rate and budget limits
and the audit log (FR-10.2) apply exactly as when that person clicks.

What it never does for a person: approve a threat model, approve a campaign's scope, or approve a
remediation. Those stay human decisions (NFR-9.4); the autopilot waits and says what it waits for.
"""

"""The assistant: a chat that guides people through Sentra and does their work for them.

It is not one of the 62 requirements. It is a second way to use the same features: every action it
takes is a call of Sentra's own API with the logged-in person's own session, so roles (FR-1.6),
tenancy (NFR-3.3), validation and the audit log (FR-10.2) apply exactly as on the pages, and it can
never do what the person could not. Anything that changes data waits for the person's confirmation.
"""

"""Why a request to a target failed, in words meant for the user: the connection test (FR-2.4)
shows them, and a campaign run records them (FR-5.7)."""


class ConnectorError(Exception):
    """Base class; str(error) is the message for the user."""


class NotVerified(ConnectorError):
    def __init__(self) -> None:
        super().__init__("Only a verified target can be tested. Verify its ownership first.")


class BudgetExhausted(ConnectorError):
    def __init__(self) -> None:
        super().__init__("The attempt budget is used up, so no further attempt is sent.")


class AddressRefused(ConnectorError):
    """The endpoint's address may not be called (NFR-3.4); the message says why."""


class TargetUnreachable(ConnectorError):
    pass


class TargetTimeout(ConnectorError):
    def __init__(self, seconds: int) -> None:
        super().__init__(f"The target didn't answer within {seconds} seconds.")


class TargetOverloaded(ConnectorError):
    """HTTP 429 or 503: repeated, they stop a campaign run (FR-5.7)."""

    def __init__(self, status_code: int, retry_after: str | None) -> None:
        wait = f" It asks to wait {retry_after} seconds." if retry_after else ""
        super().__init__(f"The target is overloaded (HTTP {status_code}).{wait}")
        self.status_code = status_code


class TargetHTTPError(ConnectorError):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"The target answered with HTTP {status_code}.")
        self.status_code = status_code


class TargetRedirect(ConnectorError):
    def __init__(self, status_code: int) -> None:
        super().__init__(
            f"The target answered with a redirect (HTTP {status_code}). Sentra doesn't follow "
            "redirects: register the final URL instead."
        )


class BadResponse(ConnectorError):
    """The answer isn't JSON, is too large, or has no reply where the target's format says.
    `excerpt` is the start of the answer, so the user can see what Sentra couldn't read
    (UC-2.2, 4a)."""

    def __init__(self, message: str, excerpt: str = "") -> None:
        super().__init__(message)
        self.excerpt = excerpt[:500]

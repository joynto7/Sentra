"""Server-side request forgery protection (NFR-3.4).

Sentra sends requests to addresses that its users type in: target endpoints now, and webhook
addresses later (FR-9.6). Without a check, a user could make Sentra call a service inside its own
network, such as the database, or a cloud metadata service that hands out credentials. So such an
address must resolve only to public internet addresses, unless an on-premises deployment allows
private ones (ALLOW_PRIVATE_TARGETS).

This check runs when an address is saved. The Target Connector repeats it before every request,
because a host name can point to a different address later.
"""

import ipaddress
import socket
from urllib.parse import urlsplit

BAD_URL = "Enter a URL that starts with https:// or http://."
CREDENTIALS_IN_URL = "Don't put a user name or password in the URL. Add them as credentials."
UNKNOWN_HOST = "This host can't be found. Check the endpoint URL."
PRIVATE_ADDRESS = "Private network and cloud metadata addresses can't be used as targets."


class AddressNotAllowed(Exception):
    """The URL cannot be used; the message is meant for the user."""


def resolve(host: str, port: int) -> list[str]:
    """All IP addresses of a host name. The tests replace it, because they run without DNS."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return sorted({str(info[4][0]) for info in infos})


def is_public(address: str) -> bool:
    """True only for public internet addresses: not private, loopback, link-local (which includes
    the 169.254.169.254 metadata service), reserved, shared or multicast."""
    ip = ipaddress.ip_address(address.split("%")[0])  # drop an IPv6 zone such as %eth0
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def check_url(url: str, *, allow_private: bool = False) -> str:
    """Return the URL (trimmed) if Sentra may call it, otherwise raise AddressNotAllowed."""
    url = url.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise AddressNotAllowed(BAD_URL)
    if parts.username or parts.password:
        raise AddressNotAllowed(CREDENTIALS_IN_URL)
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:  # a port outside 0-65535
        raise AddressNotAllowed(BAD_URL) from exc
    if allow_private:
        return url

    try:
        addresses = [str(ipaddress.ip_address(parts.hostname))]  # the host is an IP address
    except ValueError:
        try:
            addresses = resolve(parts.hostname, port)
        except (OSError, UnicodeError) as exc:
            raise AddressNotAllowed(UNKNOWN_HOST) from exc
    if not addresses or not all(is_public(address) for address in addresses):
        raise AddressNotAllowed(PRIVATE_ADDRESS)
    return url

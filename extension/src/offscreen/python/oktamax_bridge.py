"""Runs okta-mcp-server, unmodified, inside Pyodide, speaking MCP JSON-RPC with JavaScript.

There's no stdio in the browser, so instead of `mcp.run()` each `Session` connects
the server to two in-memory streams: `receive(json)` feeds it a message from
JavaScript, and each message it sends is passed to the `post` callback.

There's no access token: the admin console sends the server's Okta requests with
the admin's session (see oktamax_fetch.py). The server still checks for a token
before it starts, so a keyring backend hands it a placeholder that never expires.
"""

import asyncio
import base64
import json
import logging
import os
import sys

import anyio
import keyring
import oktamax_fetch
from keyring.backend import KeyringBackend
from mcp.shared.message import SessionMessage
from mcp.types import JSONRPCMessage


def _placeholder_token():
    """A JWT-shaped token that passes the server's expiry check; it's never sent to Okta."""

    def part(claims):
        return base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")

    return f"{part({'alg': 'none'})}.{part({'exp': 2**31 - 1})}."


class SessionKeyring(KeyringBackend):
    priority = 1

    def get_password(self, service, username):
        return _placeholder_token() if username == "api_token" else None

    def set_password(self, service, username, password):
        pass

    def delete_password(self, service, username):
        pass


_mcp = None


def load(env):
    """Loads okta-mcp-server with the given environment (OKTA_ORG_URL, OKTA_SCOPES, ...)."""
    global _mcp
    # Required by the server, for the sign-in it never gets to do.
    os.environ["OKTA_CLIENT_ID"] = "admin-console-session"
    os.environ.update(env)
    keyring.set_keyring(SessionKeyring())

    import oktamax_stubs

    oktamax_stubs.install()
    oktamax_fetch.install()

    from loguru import logger

    logger.remove()
    logger.add(sys.stderr, level=os.environ.get("OKTA_LOG_LEVEL", "WARNING"))

    # What okta_mcp_server.server.main() does, minus mcp.run(): register every tool.
    from okta_mcp_server.server import mcp

    # FastMCP sets up logging at INFO, which logs every request ("Processing request of type ...").
    logging.getLogger().setLevel(os.environ.get("OKTA_LOG_LEVEL", "WARNING"))

    from okta_mcp_server.tools.applications import applications  # noqa: F401
    from okta_mcp_server.tools.customization.brands import brands  # noqa: F401
    from okta_mcp_server.tools.customization.custom_domains import custom_domains  # noqa: F401
    from okta_mcp_server.tools.customization.themes import themes  # noqa: F401
    from okta_mcp_server.tools.customization.custom_pages import custom_pages  # noqa: F401
    from okta_mcp_server.tools.customization.custom_templates import custom_templates  # noqa: F401
    from okta_mcp_server.tools.customization.email_domains import email_domains  # noqa: F401
    from okta_mcp_server.tools.device_assurance import device_assurance  # noqa: F401
    from okta_mcp_server.tools.groups import groups  # noqa: F401
    from okta_mcp_server.tools.policies import policies  # noqa: F401
    from okta_mcp_server.tools.system_logs import system_logs  # noqa: F401
    from okta_mcp_server.tools.system_logs import login_failures  # noqa: F401
    from okta_mcp_server.tools.user_resources import user_resources  # noqa: F401
    from okta_mcp_server.tools.users import users  # noqa: F401
    from okta_mcp_server.utils import scope_stubs  # noqa: F401

    _mcp = mcp


class Session:
    """One MCP session (like one stdio process): messages in with `receive`, out through `post`.

    Its Okta requests go to `fetch`, which sends them from the session's admin console tab.
    """

    def __init__(self, post, fetch):
        self._to_server, server_in = anyio.create_memory_object_stream(64)
        server_out, from_server = anyio.create_memory_object_stream(64)

        async def serve():
            oktamax_fetch.session_fetch.set(fetch)  # inherited by every task the server starts
            server = _mcp._mcp_server
            await server.run(server_in, server_out, server.create_initialization_options())

        async def forward():
            async for message in from_server:
                post(message.message.model_dump_json(by_alias=True, exclude_none=True))

        # Keep references, or the event loop may drop the tasks.
        self._tasks = [asyncio.ensure_future(serve()), asyncio.ensure_future(forward())]

    def receive(self, text):
        self._to_server.send_nowait(SessionMessage(JSONRPCMessage.model_validate_json(text)))

    def close(self):
        self._to_server.close()

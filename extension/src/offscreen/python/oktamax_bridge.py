"""Runs okta-mcp-server, unmodified, inside Pyodide, speaking MCP JSON-RPC with JavaScript.

There's no stdio in the browser, so instead of `mcp.run()` each `Session` connects
the server to two in-memory streams: `receive(json)` feeds it a message from
JavaScript, and each message it sends is passed to the `post` callback.

As on the chat server (server/python/oktamax_keyring.py), the admin's access
token reaches the server through a keyring backend, read on every tool call:
here it calls `get_token`, a JavaScript function returning the current token.
"""

import asyncio
import os
import sys

import anyio
import keyring
from keyring.backend import KeyringBackend
from mcp.shared.message import SessionMessage
from mcp.types import JSONRPCMessage


class JsTokenKeyring(KeyringBackend):
    priority = 1

    def __init__(self, get_token):
        super().__init__()
        self._get_token = get_token

    def get_password(self, service, username):
        if username != "api_token":
            return None  # no refresh token: renewing is the extension's job
        return self._get_token() or None

    def set_password(self, service, username, password):
        pass

    def delete_password(self, service, username):
        pass


_mcp = None


def load(env, get_token):
    """Loads okta-mcp-server with the given environment (OKTA_ORG_URL, OKTA_SCOPES, ...)."""
    global _mcp
    os.environ.update(env)
    keyring.set_keyring(JsTokenKeyring(get_token))

    import oktamax_fetch
    import oktamax_stubs

    oktamax_stubs.install()
    oktamax_fetch.install()

    from loguru import logger

    logger.remove()
    logger.add(sys.stderr, level=os.environ.get("OKTA_LOG_LEVEL", "WARNING"))

    # What okta_mcp_server.server.main() does, minus mcp.run(): register every tool.
    from okta_mcp_server.server import mcp
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
    """One MCP session (like one stdio process): messages in with `receive`, out through `post`."""

    def __init__(self, post):
        self._to_server, server_in = anyio.create_memory_object_stream(64)
        server_out, from_server = anyio.create_memory_object_stream(64)

        async def serve():
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

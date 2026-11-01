"""Keyring backend that hands one admin's Okta access token to okta-mcp-server.

okta-mcp-server reads its token from the OS keyring (service "OktaAuthManager",
user "api_token") on every tool call. The oktamax gateway runs one server process
per admin and writes that admin's current access token to OKTAMAX_TOKEN_FILE
before forwarding each request, so the server always acts as - and only as -
that admin, and never runs its own (interactive) sign-in.

Selected with PYTHON_KEYRING_BACKEND=oktamax_keyring.TokenFileKeyring.
"""

import os

from keyring.backend import KeyringBackend


class TokenFileKeyring(KeyringBackend):
    priority = 1  # only ever selected explicitly

    def get_password(self, service, username):
        if username != "api_token":
            return None  # no refresh token: expired tokens are the gateway's job
        try:
            with open(os.environ["OKTAMAX_TOKEN_FILE"], encoding="utf-8") as f:
                return f.read().strip() or None
        except FileNotFoundError:
            return None

    def set_password(self, service, username, password):
        # Tokens come only from the gateway; ignore anything the server tries to store.
        pass

    def delete_password(self, service, username):
        pass

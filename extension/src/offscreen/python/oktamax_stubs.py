"""Stand-ins for pycryptodomex and jwcrypto, which have no Pyodide build.

Okta's SDK imports them at startup for private-key (client assertion) sign-in.
The extension always passes the admin's access token, so they're never used.
"""

import sys
from types import ModuleType


def _module(name, **attrs):
    module = ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module
    return module


class _Unavailable:
    def __init__(self, *args, **kwargs):
        raise NotImplementedError("private-key sign-in isn't available in the browser")


def install():
    _module("Cryptodome")
    _module("Cryptodome.PublicKey")
    _module("Cryptodome.PublicKey.RSA", import_key=_Unavailable, importKey=_Unavailable)
    _module("jwcrypto")
    _module("jwcrypto.jwk", JWK=_Unavailable, InvalidJWKType=type("InvalidJWKType", (Exception,), {}))
    _module("jwcrypto.jwt", JWT=_Unavailable)

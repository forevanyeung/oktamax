"""Sends the Okta SDK's requests through the admin's console tab.

The SDK makes every API call through `okta.http_client.HTTPClient.send_request`,
with aiohttp, which has no sockets under Pyodide. This replaces that one method:
each request goes to the JavaScript `fetch` of the MCP session making it, which
has the admin console send it with the admin's session (`oktaGet` in
src/content/oktaGet.ts). It returns a response object with the attributes the
SDK reads from aiohttp's.
"""

import json
import re
from contextvars import ContextVar

from multidict import CIMultiDict, CIMultiDictProxy
from okta.http_client import HTTPClient
from yarl import URL

#: The current MCP session's `fetch(request_json) -> Promise<response_json>`, set by
#: `oktamax_bridge.Session` for everything the session runs.
session_fetch = ContextVar("session_fetch")


def _links(header):
    """aiohttp's `ClientResponse.links`: {rel: {"url": URL}} from a Link header."""
    links = {}
    for part in header.split(","):
        match = re.match(r'\s*<([^>]*)>\s*;(.*)', part)
        if not match:
            continue
        rel = re.search(r'rel="?([^";]+)"?', match.group(2))
        if rel:
            links[rel.group(1)] = {"url": URL(match.group(1))}
    return links


class FetchResponse:
    def __init__(self, response, headers):
        self.status = response["status"]
        self.reason = response["statusText"]
        self.url = URL(response["url"])
        self.headers = CIMultiDictProxy(headers)
        self.content_type = headers.get("Content-Type", "").split(";")[0].strip()
        self.links = _links(", ".join(headers.getall("Link", [])))
        self.request_info = None


async def send_request(self, request):
    if request["data"] or request.get("json") or request["form"]:
        # The admin console only sends GETs for the assistant: it can't change anything.
        return (None, None, None, ValueError("the on-device assistant can only read"))
    try:
        fetch = session_fetch.get()
        response = json.loads(
            await fetch(json.dumps({"url": request["url"], "method": request["method"]}))
        )
        if "error" in response:
            raise RuntimeError(response["error"])
        headers = CIMultiDict()
        for name, value in response["headers"]:
            headers.add(name, value)
        return (None, FetchResponse(response, headers), response["body"], None)
    except Exception as error:  # the tab was closed, the session ended, ...
        return (None, None, None, error)


def install():
    HTTPClient.send_request = send_request

"""Sends the Okta SDK's requests with the browser's fetch.

The SDK makes every API call through `okta.http_client.HTTPClient.send_request`,
with aiohttp, which has no sockets under Pyodide. This replaces that one method,
returning a response object with the attributes the SDK reads from aiohttp's.
"""

import json
import re

from multidict import CIMultiDict, CIMultiDictProxy
from okta.http_client import HTTPClient
from pyodide.http import pyfetch
from yarl import URL


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
        self.status = response.status
        self.reason = response.status_text
        self.url = URL(response.url)
        self.headers = CIMultiDictProxy(headers)
        self.content_type = headers.get("Content-Type", "").split(";")[0].strip()
        self.links = _links(", ".join(headers.getall("Link", [])))
        self.request_info = None


async def send_request(self, request):
    headers = {**self._default_headers, **request["headers"]}
    # okta 3.4.x builds "Bearer<token>", without the space, for its generated API methods.
    authorization = headers.get("Authorization", "")
    if authorization.startswith("Bearer") and not authorization.startswith("Bearer "):
        headers["Authorization"] = f"Bearer {authorization[len('Bearer'):]}"
    body = None
    if request["data"]:
        body = json.dumps(request["data"])
    elif request.get("json"):
        body = json.dumps(request["json"])
        headers.setdefault("Content-Type", "application/json")
    elif request["form"]:
        # Forms are only used for sign-in and uploads, which the extension never does.
        return (None, None, None, ValueError("form requests aren't supported in the browser"))
    try:
        response = await pyfetch(request["url"], method=request["method"], headers=headers, body=body)
        response_headers = CIMultiDict()
        for name, value in response.js_response.headers.entries():
            response_headers.add(name, value)
        return (None, FetchResponse(response, response_headers), await response.string(), None)
    except Exception as error:  # network errors surface as JS exceptions
        return (None, None, None, error)


def install():
    HTTPClient.send_request = send_request

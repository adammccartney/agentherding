#!/usr/bin/env python3
"""Stdlib-only test suite for bin/cb — no live network, no pytest.

    python3 tests/cb_test.py

Spins an in-process Bearer-checked coLAB API stub and exercises bin/cb as a
subprocess: rendering, JSON shapes, HTML cleanup, caps, config precedence,
error paths, and the promise that tokens never leak.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CB = os.environ.get("CB_BIN", os.path.join(REPO_ROOT, "bin", "cb"))
TOKEN = "test-token"
CAP_MARKER = "… [body capped at 4000 chars]"

# ---------------------------------------------------------------------------
# Synthetic payloads modeled on the Confluence response shapes, never live data.

SPACES = [
    {"id": 101, "key": "ASC", "name": "ASC", "type": "global", "status": "current"},
    {"id": 102, "key": "VSC", "name": "ASC Operations", "type": "global", "status": "current"},
]
SEARCH_RESULTS = [
    {
        "title": "@@@hl@@@Synthetic@@@endhl@@@ Modules Handbook",
        "content": {
            "id": "1001",
            "type": "page",
            "status": "current",
            "title": "Synthetic Modules Handbook",
            "space": {"id": 101, "key": "ASC", "name": "ASC", "type": "global"},
        },
    },
    {
        "title": "Synthetic Operations Notes",
        "content": {
            "id": "1002",
            "type": "blogpost",
            "status": "current",
            "title": "Synthetic Operations Notes",
            "space": {"id": 102, "key": "VSC", "name": "ASC Operations", "type": "global"},
        },
    },
]
HTML_BODY = """
<style>hidden style</style><script>hidden script</script>
<h2>Gateway &amp; modules</h2>
<p>First&nbsp;line<br>Second &lt;tag&gt; &quot;quoted&quot; &#x41; &#66; &#39;ok&#39;</p>
<ul><li>Alpha</li><li>Beta &gt; gamma</li></ul>
"""
PAGE_1001 = {
    "id": "1001",
    "type": "page",
    "status": "current",
    "title": "Synthetic Modules Handbook",
    "space": {"id": 101, "key": "ASC", "name": "ASC", "type": "global"},
    "version": {"number": 7, "when": "2026-11-03T14:15:16.000+01:00"},
    "history": {"latest": True, "createdDate": "2026-10-01T09:00:00.000+02:00"},
    "body": {"view": {"value": HTML_BODY, "representation": "view"}},
}
PAGE_1002 = {
    "id": "1002",
    "type": "page",
    "status": "current",
    "title": "Synthetic Long Page",
    "space": {"id": 102, "key": "VSC", "name": "ASC Operations", "type": "global"},
    "version": {"number": 2, "when": "2026-11-04T08:30:00.000+01:00"},
    "history": {"latest": True},
    "body": {"view": {"value": "<p>" + "Z" * 4500 + "</p>", "representation": "view"}},
}


class StubHandler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self._send(401, {"message": "synthetic authentication failure"})
            return
        parts = urllib.parse.urlsplit(self.path)
        params = urllib.parse.parse_qs(parts.query, keep_blank_values=True)
        path = parts.path
        SEEN.append({
            "path": path,
            "params": params,
            "accept": self.headers.get("Accept"),
        })
        if self.headers.get("Accept") != "application/json":
            self._send(400, {"message": "JSON Accept header required"})
            return

        if path == "/rest/api/space":
            limit = int((params.get("limit") or ["25"])[0])
            self._send(200, {"results": SPACES[:limit], "size": min(limit, len(SPACES))})
        elif path == "/rest/api/search":
            cql = (params.get("cql") or [""])[0]
            limit = int((params.get("limit") or ["5"])[0])
            if cql == 'siteSearch ~ "no-such-page"':
                results = []
            else:
                results = SEARCH_RESULTS[:limit]
            self._send(200, {
                "results": results,
                "size": len(results),
                "limit": limit,
                "cqlQuery": cql,
                "totalSize": len(results),
            })
        elif path == "/rest/api/content/1001":
            self._send(200, PAGE_1001)
        elif path == "/rest/api/content/1002":
            self._send(200, PAGE_1002)
        elif path == "/rest/api/content/3000":
            self._send(200, ["not", "a", "page"])
        else:
            self._send(404, {"message": "synthetic missing page"})

    def log_message(self, *args):
        pass


# ---------------------------------------------------------------------------
# Harness. Every CLI environment is new and uses a scratch HOME.

SEEN = []
server = ThreadingHTTPServer(("127.0.0.1", 0), StubHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
PORT = server.server_address[1]
BASE_URL = f"http://127.0.0.1:{PORT}"

_tmp = tempfile.mkdtemp(prefix="cb-test-")
TEST_HOME = os.path.join(_tmp, "home")
os.mkdir(TEST_HOME)
TOKEN_FILE = os.path.join(_tmp, "token")
with open(TOKEN_FILE, "w", encoding="utf-8") as fh:
    fh.write(TOKEN + "\n")
os.chmod(TOKEN_FILE, 0o600)


def run(*args, token_file=TOKEN_FILE, base_url=BASE_URL, extra_env=None):
    env = {
        "HOME": TEST_HOME,
        "PATH": os.defpath,
        "PYTHONIOENCODING": "utf-8",
        "COLAB_BASE_URL": base_url,
    }
    if token_file is not None:
        env["COLAB_TOKEN_FILE"] = token_file
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, CB, *args], capture_output=True, text=True, env=env, check=False
    )


FAILED = []
COUNT = 0


def check(name, cond, detail=""):
    global COUNT
    COUNT += 1
    if cond:
        print(f"ok {COUNT:2d} {name}")
    else:
        FAILED.append(name)
        print(f"FAIL {COUNT:2d} {name}  {detail}")


# ---------------------------------------------------------------------------
# Tests

# --help needs no config at all.
r = subprocess.run([sys.executable, CB, "--help"], capture_output=True, text=True, env={})
check("help exits 0 without env", r.returncode == 0 and "Usage: cb" in r.stdout, r.stderr[:120])
check("help lists all verbs", all(v in r.stdout for v in ("spaces", "search", "get")))

# spaces: text, JSON, and the limit query parameter.
r = run("spaces")
check("spaces text exit 0", r.returncode == 0, r.stderr[:120])
check("spaces text header and table", "## coLAB spaces (2 shown)" in r.stdout and "| key | name | type |" in r.stdout)
check("spaces text rows", "| ASC | ASC | global |" in r.stdout and "| VSC | ASC Operations | global |" in r.stdout)
r = run("spaces", "--json")
data = json.loads(r.stdout)
check("spaces --json shape", r.returncode == 0 and set(data) == {"spaces"} and len(data["spaces"]) == 2)
check("spaces --json row keys", all(set(s) == {"key", "name", "type"} for s in data["spaces"]))
r = run("spaces", "--limit", "1")
check("spaces --limit is sent and honored", r.returncode == 0 and "(1 shown)" in r.stdout and SEEN[-1]["params"]["limit"] == ["1"] and "VSC" not in r.stdout)

# search: preserve raw CQL and shape nested content into flat rows.
CQL = 'space=ASC AND title ~ "modules" AND type=page'
r = run("search", CQL)
check("search text exit 0", r.returncode == 0, r.stderr[:120])
check("search text header uses raw CQL", f'## coLAB search — "{CQL}" (2 shown)' in r.stdout)
check("search text table and row", "| id | title | space | type |" in r.stdout and "| 1001 | Synthetic Modules Handbook | ASC | page |" in r.stdout)
check("search request preserves CQL, limit, and expand", SEEN[-1]["params"] == {"cql": [CQL], "limit": ["5"], "expand": ["content.space"]}, repr(SEEN[-1]))
r = run("search", CQL, "--json")
data = json.loads(r.stdout)
check("search --json outer shape", r.returncode == 0 and set(data) == {"results"} and len(data["results"]) == 2)
check("search --json row keys and values", data["results"][0] == {"id": "1001", "title": "Synthetic Modules Handbook", "space": "ASC", "type": "page"})
r = run("search", CQL, "--limit", "1")
check("search --limit shows one row", "(1 shown)" in r.stdout and "Synthetic Operations Notes" not in r.stdout)
r = run("search", 'siteSearch ~ "no-such-page"')
check("empty search has exact no-results line", r.returncode == 0 and r.stdout == 'No results for CQL "siteSearch ~ "no-such-page"".\n', r.stdout)

# get: metadata, the shared HTML cleanup pipeline, and no comments hint.
r = run("get", "1001")
check("get text exit 0", r.returncode == 0, r.stderr[:120])
check("get text title", "1001 — Synthetic Modules Handbook" in r.stdout)
check("get text metadata", "space: ASC · type: page · version: 7 · updated: 2026-11-03" in r.stdout)
check("get removes HTML and non-content blocks", all(tag not in r.stdout for tag in ("<h2>", "<p>", "<li>", "<script>", "<style>", "hidden style", "hidden script")))
check("get decodes entities in pipeline order", "Gateway & modules" in r.stdout and 'Second <tag> "quoted" A B \'ok\'' in r.stdout)
check("get keeps line and list structure", "First line\nSecond <tag>" in r.stdout and "- Alpha\n- Beta > gamma" in r.stdout)
check("get has no follow-on hint", "Use action" not in r.stdout and "comments" not in r.stdout)
r = run("get", "1001", "--json")
data = json.loads(r.stdout)
check("get --json outer shape", r.returncode == 0 and set(data) == {"page"})
page = data["page"]
check("get --json page keys", set(page) == {"id", "title", "space", "type", "version", "updated", "body", "body_capped"})
check("get --json metadata types", page["id"] == "1001" and page["version"] == 7 and page["updated"] == "2026-11-03T14:15:16.000+01:00" and page["space"] == "ASC" and page["type"] == "page")
check("get --json uncapped flag", page["body_capped"] is False and CAP_MARKER not in page["body"])
check("get requests all expansions", SEEN[-1]["params"]["expand"] == ["space,body.view,version,history"])

# get: a body over 4000 characters receives the same cap in text and JSON.
r = run("get", "1002")
check("long body text cap and marker", r.returncode == 0 and CAP_MARKER in r.stdout)
check("long body keeps exactly 4000 body chars", "Z" * 4000 in r.stdout and "Z" * 4001 not in r.stdout)
r = run("get", "1002", "--json")
page = json.loads(r.stdout)["page"]
check("long body JSON cap, marker, and flag", page["body_capped"] is True and page["body"].startswith("Z" * 4000) and "Z" * 4001 not in page["body"] and page["body"].endswith(CAP_MARKER))

# Runtime errors: HTTP status, no token leak, and clear response-shape errors.
r = run("get", "999")
check("get 404 is a clean runtime error", r.returncode == 1 and "coLAB GET /rest/api/content/999 failed: HTTP 404" in r.stderr and "synthetic missing page" in r.stderr)
bad_file = os.path.join(_tmp, "bad-token")
with open(bad_file, "w", encoding="utf-8") as fh:
    fh.write("wrong-token")
r = run("spaces", token_file=bad_file)
check("401 exits 1 with HTTP status", r.returncode == 1 and "HTTP 401" in r.stderr)
check("401 and normal output leak no tokens", TOKEN not in r.stderr + r.stdout and "wrong-token" not in r.stderr + r.stdout)
r = run("get", "3000")
check("response shape mismatch is clean", r.returncode == 1 and "unexpected response" in r.stderr and "Traceback" not in r.stderr)

# Token-file diagnostics and COLAB_TOKEN precedence.
missing = os.path.join(_tmp, "absent")
r = run("spaces", token_file=missing)
check("missing token file exits 1", r.returncode == 1 and "not readable" in r.stderr)
check("missing token error names path and fix", missing in r.stderr and "chmod 600" in r.stderr and "COLAB_TOKEN" in r.stderr)
empty_file = os.path.join(_tmp, "empty-token")
with open(empty_file, "w", encoding="utf-8"):
    pass
r = run("spaces", token_file=empty_file)
check("empty token file has clear error", r.returncode == 1 and empty_file in r.stderr and "empty" in r.stderr and "COLAB_TOKEN" in r.stderr)
r = run("spaces", token_file=bad_file, extra_env={"COLAB_TOKEN": TOKEN})
check("environment token beats wrong token file", r.returncode == 0 and "## coLAB spaces (2 shown)" in r.stdout)

# All trailing slashes are stripped before the API path is appended.
r = run("spaces", base_url=BASE_URL + "///")
check("base URL trailing slashes are stripped", r.returncode == 0 and SEEN[-1]["path"] == "/rest/api/space", r.stderr[:120])

# Usage failures use stderr and exit 2 (the normal config remains available).
usage_cases = [
    ("unknown verb exits 2", ("frobnicate",), 'unknown verb "frobnicate"'),
    ("search without CQL exits 2", ("search",), "search requires a <cql>"),
    ("get without id exits 2", ("get",), "get requires an <id>"),
    ("zero limit exits 2", ("spaces", "--limit", "0"), "positive integer"),
    ("nonnumeric limit exits 2", ("search", CQL, "--limit", "many"), "positive integer"),
    ("misplaced limit exits 2", ("get", "1001", "--limit", "3"), 'does not apply to "get"'),
    ("unknown option exits 2", ("spaces", "--bogus"), 'unknown option "--bogus"'),
    ("bare invocation exits 2", (), "Usage: cb"),
    ("spaces rejects arguments", ("spaces", "extra"), "unexpected extra argument"),
    ("limit without value exits 2", ("spaces", "--limit"), "expects a value"),
]
for name, args, message in usage_cases:
    r = run(*args)
    check(name, r.returncode == 2 and message in r.stderr, r.stderr[:160])

print()
if FAILED:
    print(f"{COUNT - len(FAILED)}/{COUNT} passed; FAILED: {', '.join(FAILED)}")
    sys.exit(1)
print(f"{COUNT}/{COUNT} passed")

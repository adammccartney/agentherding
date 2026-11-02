#!/usr/bin/env python3
"""Stdlib-only test suite for bin/zt — no network, no pytest.

    python3 tests/zt_test.py

Spins an in-process stub of the Zammad API (auth-checked) and exercises
bin/zt as a subprocess: rendering, --json shapes, windowing, caps, error and
exit-code paths, and the promise that the token never leaks into output.
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
ZT = os.environ.get("ZT_BIN", os.path.join(REPO_ROOT, "bin", "zt"))
TOKEN = "test-token"

# ---------------------------------------------------------------------------
# Canned Zammad payloads — shapes mirror the real API (see extensions/zammad).

TICKET_1 = {
    "id": 9001, "number": "206540", "title": "Install PyTorch on VSC",
    "state_id": 2, "group_id": 7, "customer_id": 42, "article_count": 5,
    "created_at": "2026-10-28T08:00:00.000Z", "updated_at": "2026-10-30T12:00:00.000Z",
}
TICKET_2 = {
    "id": 9002, "number": "206541", "title": "Long-body ticket",
    "state_id": 3, "group_id": 7, "customer_id": 42, "article_count": 2,
    "created_at": "2026-10-01T08:00:00.000Z", "updated_at": "2026-10-02T12:00:00.000Z",
}
SEARCH_ASSETS = {
    "Ticket": {"9001": TICKET_1, "9002": TICKET_2},
    "Group": {"7": {"name": "Users"}},
    "User": {"42": {"name": "", "firstname": "Jane", "lastname": "Doe", "login": "jdoe"}},
}
STATES = [{"id": 1, "name": "new"}, {"id": 2, "name": "open"}, {"id": 3, "name": "closed"}]
ARTICLES_1 = [
    {"id": 5000 + i, "body": f"<p>body {i}</p>", "from": "Jane Doe",
     "sender_id": 1 if i % 2 == 0 else 2, "created_at": f"2026-10-2{i}T08:00:00.000Z"}
    for i in range(5)
]
ARTICLES_2 = [
    {"id": 6001, "body": "<p>" + "A" * 5000 + "</p>", "from": "Jane Doe",
     "sender_id": 1, "created_at": "2026-10-01T08:00:00.000Z"},
    {"id": 6002, "body": "<p>short</p>", "from": "Support",
     "sender_id": 2, "created_at": "2026-10-02T09:00:00.000Z"},
]


class StubHandler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Authorization") != f"Token token={TOKEN}":
            self._send(401, {"error": "Not authenticated (token)"})
            return
        parts = urllib.parse.urlsplit(self.path)
        params = urllib.parse.parse_qs(parts.query)
        path = parts.path

        if path == "/api/v1/tickets/search":
            query = (params.get("query") or [""])[0]
            limit = int((params.get("limit") or ["5"])[0])
            if query.startswith("number:"):
                num = query.split(":", 1)[1]
                by_num = {"206540": "9001", "206541": "9002"}
                if num in by_num:
                    ident = by_num[num]
                    self._send(200, {"tickets": [int(ident)], "tickets_count": 1,
                                     "assets": {"Ticket": {ident: SEARCH_ASSETS["Ticket"][ident]}}})
                else:
                    self._send(200, {"tickets": [], "tickets_count": 0, "assets": {}})
                return
            if query == "zzz-nothing":
                self._send(200, {"tickets": [], "tickets_count": 0, "assets": {}})
                return
            ids = [9001, 9002][:limit]
            self._send(200, {"tickets": ids, "tickets_count": 2, "assets": SEARCH_ASSETS})
        elif path == "/api/v1/ticket_states":
            self._send(200, STATES)
        elif path == "/api/v1/tags":
            self._send(200, {"tags": ["software", "pytorch"]})
        elif path == "/api/v1/ticket_articles/by_ticket/9001":
            self._send(200, ARTICLES_1)
        elif path == "/api/v1/ticket_articles/by_ticket/9002":
            self._send(200, ARTICLES_2)
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass


# ---------------------------------------------------------------------------
# Harness

server = ThreadingHTTPServer(("127.0.0.1", 0), StubHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
PORT = server.server_address[1]

_tmp = tempfile.mkdtemp(prefix="zt-test-")
TOKEN_FILE = os.path.join(_tmp, "token")
with open(TOKEN_FILE, "w") as fh:
    fh.write(TOKEN)
os.chmod(TOKEN_FILE, 0o600)

def run(*args, token_file=TOKEN_FILE):
    env = dict(os.environ)
    env["ZAMMAD_TOKEN_FILE"] = token_file
    env["ZAMMAD_BASE_URL"] = f"http://127.0.0.1:{PORT}"
    return subprocess.run([sys.executable, ZT, *args], capture_output=True, text=True, env=env)


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

# --help exits 0 without any config (flag scan precedes config load).
r = subprocess.run([sys.executable, ZT, "--help"], capture_output=True, text=True, env={})
check("help exits 0 without env", r.returncode == 0 and "Usage: zt" in r.stdout, r.stderr[:120])

# search, text rendering
r = run("search", "pytorch")
check("search text exit 0", r.returncode == 0, r.stderr[:120])
check("search text header", '## Ticket search — "pytorch" (2 hit(s), showing 2)' in r.stdout)
check("search text table", r.stdout.count("\n| 20") == 2 and "| number | title | state | group | requester | updated | arts |" in r.stdout)
check("search row fields resolved", "| 206540 | Install PyTorch on VSC | open | Users | Jane Doe | 2026-10-30 | 5 |" in r.stdout, r.stdout[:200])

# search, --json
r = run("search", "pytorch", "--json")
data = json.loads(r.stdout)
check("search --json shape", r.returncode == 0 and set(data) == {"tickets", "total"} and data["total"] == 2)
check("search --json row keys", set(data["tickets"][0]) == {"number", "title", "state", "group", "requester", "updated_at", "articles"})

# search, no hits
r = run("search", "zzz-nothing")
check("search empty", r.returncode == 0 and 'No tickets found for query "zzz-nothing".' in r.stdout)

# search, --limit honored and validated
r = run("search", "pytorch", "--limit", "1")
check("search --limit 1 shows one", "showing 1)" in r.stdout and "| 206541 |" not in r.stdout)
r = run("search", "pytorch", "--limit", "0")
check("--limit 0 is usage error", r.returncode == 2 and "positive integer" in r.stderr)

# get, text + tags
r = run("get", "206540")
check("get exit 0", r.returncode == 0, r.stderr[:120])
check("get header", "#206540 — Install PyTorch on VSC" in r.stdout)
check("get tags line", "tags: software, pytorch" in r.stdout)
check("get dates", "created: 2026-10-28 · updated: 2026-10-30" in r.stdout)

# get, --json
r = run("get", "206540", "--json")
data = json.loads(r.stdout)
check("get --json keys", set(data["ticket"]) >= {"number", "title", "tags", "created_at", "articles"})

# get, unknown number
r = run("get", "999")
check("get unknown number exit 1", r.returncode == 1 and "No ticket with number 999." in r.stderr)

# articles, windowing: 5 articles, max 3 → first 2 + last 1, 2 omitted
r = run("articles", "206540", "--max-articles", "3")
check("articles exit 0", r.returncode == 0, r.stderr[:120])
check("articles header", "5 article(s), showing 3, 2 omitted" in r.stdout, r.stdout[:160])
check("articles omission note", "[note: 2 middle article(s) omitted (kept first 2 and last 1).]" in r.stdout)
check("articles keeps first two + last", "body 0" in r.stdout and "body 1" in r.stdout and "body 4" in r.stdout and "body 2" not in r.stdout and "body 3" not in r.stdout)

# articles, html stripping sanity
check("articles html stripped", "<p>" not in r.stdout)

# articles, per-article cap
r = run("articles", "206541")
check("cap note", "[note: Long articles capped at 4000 chars.]" in r.stdout)
check("cap truncation", "A" * 4000 in r.stdout and "A" * 4001 not in r.stdout)
check("cap marker", "… [article truncated]" in r.stdout)

# 401 from the API: exit 1, status surfaced, token nowhere
bad_file = os.path.join(_tmp, "bad-token")
with open(bad_file, "w") as fh:
    fh.write("wrong-token")
r = run("get", "206540", token_file=bad_file)
check("401 exit 1", r.returncode == 1 and "HTTP 401" in r.stderr, r.stderr[:160])
check("401 leaks no token", TOKEN not in r.stderr + r.stdout and "wrong-token" not in r.stderr + r.stdout)

# missing token file: exit 1, points at the fix, leaks nothing
r = run("get", "206540", token_file=os.path.join(_tmp, "absent"))
check("missing token exit 1", r.returncode == 1 and "not readable" in r.stderr and "chmod 600" in r.stderr)

# usage errors, post-config (token present): exit 2
r = run("get")
check("get without number exit 2", r.returncode == 2 and "get requires a <number>" in r.stderr)
r = run("frobnicate")
check("unknown verb exit 2", r.returncode == 2 and 'unknown verb "frobnicate"' in r.stderr)
r = run("search", "pytorch", "--bogus")
check("unknown option exit 2", r.returncode == 2 and 'unknown option "--bogus"' in r.stderr)
r = run("get", "206540", "--limit", "3")
check("misplaced option exit 2", r.returncode == 2 and 'does not apply to "get"' in r.stderr)
r = run()
check("bare invocation exit 2", r.returncode == 2 and "Usage: zt" in r.stderr)

print()
if FAILED:
    print(f"{COUNT - len(FAILED)}/{COUNT} passed; FAILED: {', '.join(FAILED)}")
    sys.exit(1)
print(f"{COUNT}/{COUNT} passed")

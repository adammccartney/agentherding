#!/usr/bin/env python3
"""Stdlib-only test suite for bin/yt — no network, no pytest.

    python3 tests/yt_test.py

Spins an in-process stub of the YouTrack API (auth-checked) and exercises
bin/yt as a subprocess: rendering, --json shapes, Stage/State fallback,
windowing, caps, the config-precedence matrix, error and exit-code paths,
and the promise that the token never leaks into output.

Hygiene: the host may hold real credentials at ~/.config/youtrack/.env.
Every subprocess here gets an env dict built from scratch (explicit
YOUTRACK_* values, HOME pointed at an empty temp dir), so the real file
can never be read or printed by a test.
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
YT = os.environ.get("YT_BIN", os.path.join(REPO_ROOT, "bin", "yt"))
TOKEN = "test-token"
BOGUS = "wrong-token-bogus"
DEAD_PORT_BASE = "http://127.0.0.1:1"  # closed port: proves no network was tried

# Epoch-millisecond fixtures; the expected ISO strings are hardcoded below so
# the JS toISOString formatting is verified, not just round-tripped.
MS_CREATED = 1793174400000     # 2026-10-28T08:00:00.000Z
MS_UPDATED = 1793361600000     # 2026-10-30T12:00:00.000Z
MS_RESOLVED = 1792508711793    # 2026-10-20T15:05:11.793Z
MS_C = [1792569600000, 1792656000000, 1792742400000, 1792828800000, 1792915200000]
#      2026-10-21T08:00 ... 2026-10-25T08:00

# ---------------------------------------------------------------------------
# Canned YouTrack payloads — shapes mirror the real API (see
# extensions/youtrack/api.ts). SAM-2 deliberately has no Stage field and
# carries State instead, so the Stage→State fallback is exercised.

ISSUE_1 = {
    "idReadable": "SAM-1",
    "summary": "Install pytorch module",
    "description": "Install pytorch on the login node, please.",
    "created": MS_CREATED,
    "updated": MS_UPDATED,
    "resolved": None,
    "commentsCount": 6,
    "project": {"shortName": "SAM"},
    "reporter": {"login": "jdoe", "fullName": "Jane Doe"},
    "customFields": [
        {"name": "Stage", "value": {"name": "Open"}},
        {"name": "Priority", "value": {"name": "High"}},
        {"name": "Assignee", "value": {"name": "Jane Doe"}},
    ],
}
ISSUE_2 = {
    "idReadable": "SAM-2",
    "summary": "State fallback issue",
    "description": "",
    "created": MS_CREATED,
    "updated": MS_RESOLVED,
    "resolved": MS_RESOLVED,
    "commentsCount": 0,
    "project": {"shortName": "SAM"},
    "reporter": {"login": "asmith", "fullName": ""},
    "customFields": [
        {"name": "State", "value": {"name": "In Progress"}},
        {"name": "Priority", "value": {"name": "Normal"}},
        {"name": "Assignee", "value": [{"name": "Jane Doe"}, {"name": "John Roe"}]},
    ],
}
ISSUE_3 = {
    "idReadable": "SAM-3",
    "summary": "Tags endpoint broken",
    "description": "",
    "created": MS_CREATED,
    "updated": MS_UPDATED,
    "resolved": None,
    "commentsCount": 0,
    "project": {"shortName": "SAM"},
    "reporter": {"login": "jdoe", "fullName": "Jane Doe"},
    "customFields": [
        {"name": "Stage", "value": {"name": "Open"}},
        {"name": "Priority", "value": {"name": "High"}},
    ],
}
ISSUE_4 = dict(ISSUE_1, idReadable="SAM-4", summary="Long comment issue")
ISSUE_5 = dict(ISSUE_1, idReadable="SAM-5", summary="Long description issue",
               description="D" * 2500)
ISSUES = {i["idReadable"]: i for i in (ISSUE_1, ISSUE_2, ISSUE_3, ISSUE_4, ISSUE_5)}

# SAM-1: one deleted comment among 5 live ones (deleted sits mid-list).
COMMENTS_1 = [
    {"id": "c1", "created": MS_C[0], "author": {"login": "jdoe", "fullName": "Jane Doe"},
     "text": "comment one", "deleted": False},
    {"id": "c2", "created": MS_C[1], "author": {"login": "sup", "fullName": "Support"},
     "text": "comment two", "deleted": False},
    {"id": "cd", "created": MS_C[1], "author": {"login": "sup", "fullName": "Support"},
     "text": "gone comment", "deleted": True},
    {"id": "c3", "created": MS_C[2], "author": {"login": "jdoe", "fullName": "Jane Doe"},
     "text": "comment three", "deleted": False},
    {"id": "c4", "created": MS_C[3], "author": {"login": "sup", "fullName": "Support"},
     "text": "comment four", "deleted": False},
    {"id": "c5", "created": MS_C[4], "author": {"login": "jdoe", "fullName": ""},
     "text": "comment five", "deleted": False},
]
COMMENTS_4 = [
    {"id": "x1", "created": MS_C[0], "author": {"login": "jdoe", "fullName": "Jane Doe"},
     "text": "X" * 4500, "deleted": False},
    {"id": "x2", "created": MS_C[1], "author": {"login": "sup", "fullName": "Support"},
     "text": "short reply", "deleted": False},
]
COMMENTS = {"SAM-1": COMMENTS_1, "SAM-4": COMMENTS_4}
TAGS = {"SAM-1": [{"name": "backend"}, {"name": "urgent"}],
        "SAM-2": [{"name": "refactor"}]}


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
            self._send(401, {"error": "Not authenticated (token)"})
            return
        parts = urllib.parse.urlsplit(self.path)
        params = urllib.parse.parse_qs(parts.query)
        path = parts.path

        if path == "/api/issues":
            query = (params.get("query") or [""])[0]
            if query == "zzz":
                self._send(200, [])
            elif query == "bad-response":
                self._send(200, {"error": "query blew up"})
            else:
                self._send(200, [ISSUE_1, ISSUE_2])
            return
        m = path.split("/")
        # /api/issues/<id>[/tags|/comments]
        if len(m) >= 4 and m[1] == "api" and m[2] == "issues":
            ident, sub = m[3], m[4] if len(m) > 4 else ""
            if ident not in ISSUES:
                self._send(404, {"error": "issue not found"})
            elif sub == "tags":
                if ident == "SAM-3":
                    self._send(500, {"error": "tag store on fire"})
                else:
                    self._send(200, TAGS.get(ident, []))
            elif sub == "comments":
                self._send(200, COMMENTS.get(ident, []))
            else:
                self._send(200, ISSUES[ident])
            return
        self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass


# ---------------------------------------------------------------------------
# Harness. Every subprocess env is built from scratch: real credentials on
# the host (env vars or ~/.config/youtrack/.env) can never leak into a test.

server = ThreadingHTTPServer(("127.0.0.1", 0), StubHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
PORT = server.server_address[1]
BASE = f"http://127.0.0.1:{PORT}"

_tmp = tempfile.mkdtemp(prefix="yt-test-")
HOME_TMP = os.path.join(_tmp, "home")
os.mkdir(HOME_TMP)  # empty: no .config/youtrack/.env inside

def run(*args, env=None):
    if env is None:
        env = {"YOUTRACK_TOKEN": TOKEN, "YOUTRACK_BASE_URL": BASE}
    full = {"PATH": "/usr/bin:/bin", "HOME": HOME_TMP}
    full.update(env)
    return subprocess.run([sys.executable, YT, *args], capture_output=True, text=True, env=full)


def write_file(name, content, mode=None):
    path = os.path.join(_tmp, name)
    with open(path, "w") as fh:
        fh.write(content)
    if mode is not None:
        os.chmod(path, mode)
    return path


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

# --help exits 0 with a completely empty environment (flag scan precedes
# config load); usage lands on stdout.
r = subprocess.run([sys.executable, YT, "--help"], capture_output=True, text=True, env={})
check("help exits 0 without env", r.returncode == 0 and "Usage: yt" in r.stdout, r.stderr[:120])

# search: text rendering, Stage and State rows side by side
r = run("search", "pytorch")
check("search text exit 0", r.returncode == 0, r.stderr[:120])
check("search text header", '## Issue search — "pytorch" (2 shown)' in r.stdout)
check("search text table header",
      "| id | summary | project | stage | pri | resolved | comments | updated |" in r.stdout)
check("search row SAM-1 (Stage, unresolved)",
      "| SAM-1 | Install pytorch module | SAM | Open | High |  | 6 | 2026-10-30 |" in r.stdout,
      r.stdout[:300])
check("search row SAM-2 (State fallback, resolved)",
      "| SAM-2 | State fallback issue | SAM | In Progress | Normal | yes | 0 | 2026-10-20 |"
      in r.stdout, r.stdout[:300])

# search: --json shape, field shaping, ISO timestamps
r = run("search", "pytorch", "--json")
data = json.loads(r.stdout)
check("search --json shape", r.returncode == 0 and set(data) == {"issues"} and len(data["issues"]) == 2)
row1, row2 = data["issues"]
check("search --json row keys",
      set(row1) == {"id", "summary", "project", "stage", "priority", "resolved",
                    "comments", "updated"})
check("search --json values SAM-1",
      row1["stage"] == "Open" and row1["priority"] == "High" and row1["resolved"] is False
      and row1["comments"] == 6 and row1["updated"] == "2026-10-30T12:00:00.000Z")
check("search --json State fallback + ms timestamp SAM-2",
      row2["stage"] == "In Progress" and row2["resolved"] is True
      and row2["updated"] == "2026-10-20T15:05:11.793Z", row2["updated"])

# search: no hits
r = run("search", "zzz")
check("search empty", r.returncode == 0 and 'No issues found for query "zzz".' in r.stdout)

# search: --limit slices client-side even when the stub returns more
r = run("search", "pytorch", "--limit", "1")
check("search --limit 1 shows one", "(1 shown)" in r.stdout and "| SAM-2 |" not in r.stdout)

# search: non-list response is a runtime error
r = run("search", "bad-response")
check("search non-list exit 1",
      r.returncode == 1 and "Unexpected search response: query blew up" in r.stderr,
      r.stderr[:160])

# parity pin: extra positionals are ignored (cli.ts has no rejection)
r = run("search", "q1", "q2")
check("search ignores extra positional",
      r.returncode == 0 and '"q1" (2 shown)' in r.stdout and "q2" not in r.stdout,
      (r.stderr + r.stdout)[:200])

# get: text rendering with tags, dates, description, final pointer line
r = run("get", "SAM-1")
check("get exit 0", r.returncode == 0, r.stderr[:120])
check("get header", "SAM-1 — Install pytorch module" in r.stdout)
check("get field line",
      "project: SAM · stage: Open · priority: High · assignee: Jane Doe · tags: backend, urgent"
      in r.stdout, r.stdout[:300])
check("get date line (no resolved)",
      "reporter: Jane Doe · comments: 6 · created: 2026-10-28 · updated: 2026-10-30\n"
      in r.stdout, r.stdout[:400])
check("get description + pointer",
      "Install pytorch on the login node, please." in r.stdout
      and 'Use action "comments" with this id to read the comment thread.' in r.stdout)

# get SAM-2: State fallback, array assignee join, empty fullName → login, resolved date
r = run("get", "SAM-2")
check("get SAM-2 fallbacks",
      "stage: In Progress" in r.stdout
      and "assignee: Jane Doe, John Roe" in r.stdout
      and "reporter: asmith" in r.stdout
      and "· resolved: 2026-10-20" in r.stdout,
      r.stdout[:300])
check("get SAM-2 empty description omitted",
      "\n\n" not in r.stdout and "tags: refactor" in r.stdout, repr(r.stdout[-200:]))

# get: --json shape
r = run("get", "SAM-1", "--json")
data = json.loads(r.stdout)
check("get --json keys",
      set(data) == {"issue"}
      and set(data["issue"]) == {"id", "summary", "project", "stage", "priority", "resolved",
                                 "comments", "updated", "description", "description_capped",
                                 "reporter", "assignee", "created", "resolved_at", "tags"})
issue = data["issue"]
check("get --json values",
      issue["tags"] == ["backend", "urgent"] and issue["description_capped"] is False
      and issue["created"] == "2026-10-28T08:00:00.000Z" and issue["resolved_at"] == "")

# get SAM-3: tags endpoint answers HTTP 500 — get still succeeds, tags []
r = run("get", "SAM-3", "--json")
data = json.loads(r.stdout)
check("tags 500 swallowed to []",
      r.returncode == 0 and data["issue"]["tags"] == [], r.stderr[:160])
r = run("get", "SAM-3")
check("tags 500: no tags segment in text",
      r.returncode == 0 and " · tags:" not in r.stdout, r.stdout[:300])

# get SAM-5: description over the 2000-char cap
r = run("get", "SAM-5", "--json")
data = json.loads(r.stdout)
check("description capped in --json",
      data["issue"]["description_capped"] is True
      and len(data["issue"]["description"]) == 2000)
r = run("get", "SAM-5")
check("description cap marker in text",
      "… [description capped at 2000 chars]" in r.stdout
      and "D" * 2001 not in r.stdout)

# parity pin: --limit on get is parsed but silently ignored (exit 0)
r = run("get", "SAM-1", "--limit", "3")
check("get ignores --limit", r.returncode == 0 and "SAM-1 — Install pytorch module" in r.stdout,
      r.stderr[:160])

# comments: 5 live + 1 deleted, --max-comments 3 → first 2 + last 1
r = run("comments", "SAM-1", "--max-comments", "3")
check("comments exit 0", r.returncode == 0, r.stderr[:120])
check("comments header",
      "SAM-1 — Install pytorch module — 5 comment(s), showing 3, 2 omitted · tags: backend, urgent"
      in r.stdout, r.stdout[:200])
check("comments omission note",
      "[note: 2 middle comment(s) omitted (kept first 2 and last 1).]" in r.stdout)
check("comments window keeps first 2 + last 1",
      "comment one" in r.stdout and "comment two" in r.stdout
      and "comment five" in r.stdout and "comment three" not in r.stdout
      and "comment four" not in r.stdout)
check("comments deleted filtered", "gone comment" not in r.stdout)
check("comments author fallback + timestamp",
      "### 2026-10-25 08:00 · jdoe" in r.stdout, r.stdout[-400:])

# comments: --json shape
r = run("comments", "SAM-1", "--max-comments", "3", "--json")
data = json.loads(r.stdout)
check("comments --json keys",
      set(data) == {"thread"}
      and set(data["thread"]) == {"id", "summary", "tags", "total", "shown", "omitted",
                                  "comments", "notes"})
th = data["thread"]
check("comments --json values",
      th["total"] == 5 and th["shown"] == 3 and th["omitted"] == 2 and th["id"] == "SAM-1"
      and th["notes"] == ["2 middle comment(s) omitted (kept first 2 and last 1)."])
check("comments --json comment keys + values",
      all(set(c) == {"at", "from", "text"} for c in th["comments"])
      and th["comments"][2]["from"] == "jdoe"
      and th["comments"][0]["at"] == "2026-10-21T08:00:00.000Z")

# comments: >4000-char comment capped, one-time note
r = run("comments", "SAM-4")
check("comment cap note once",
      r.stdout.count("[note: Long comments capped at 4000 chars.]") == 1)
check("comment cap marker + truncation",
      "… [comment truncated]" in r.stdout
      and "X" * 4000 in r.stdout and "X" * 4001 not in r.stdout)
r = run("comments", "SAM-4", "--json")
th = json.loads(r.stdout)["thread"]
check("comment cap in --json",
      len(th["comments"][0]["text"]) == 4000 + len(" … [comment truncated]")
      and th["comments"][0]["text"].endswith(" … [comment truncated]")
      and "Long comments capped at 4000 chars." in th["notes"])

# ---------------------------------------------------------------------------
# Config matrix — env beats file, bare-line and TOKEN_CMD fallbacks, and the
# missing-token error fires before the missing-base-URL error.

envfile = write_file("cfg-env", f"YOUTRACK_TOKEN={BOGUS}\nYOUTRACK_BASE_URL={BASE}\n")
r = run("search", "pytorch", env={"YOUTRACK_TOKEN_FILE": envfile, "YOUTRACK_TOKEN": TOKEN})
check("env token beats file token", r.returncode == 0, r.stderr[:160])

r = run("search", "pytorch", env={"YOUTRACK_TOKEN_FILE": envfile})
check("401 exit 1", r.returncode == 1 and "YouTrack GET /issues failed: HTTP 401" in r.stderr,
      r.stderr[:200])
check("401 leaks no token",
      TOKEN not in r.stderr + r.stdout and BOGUS not in r.stderr + r.stdout)

deadfile = write_file("cfg-dead", f"YOUTRACK_TOKEN={TOKEN}\nYOUTRACK_BASE_URL={DEAD_PORT_BASE}\n")
r = run("search", "pytorch", env={"YOUTRACK_TOKEN_FILE": deadfile, "YOUTRACK_BASE_URL": BASE})
check("env base URL beats file base URL", r.returncode == 0, r.stderr[:160])

barefile = write_file("cfg-bare", TOKEN + "\n")
r = run("search", "pytorch", env={"YOUTRACK_TOKEN_FILE": barefile, "YOUTRACK_BASE_URL": BASE})
check("bare-line file accepted as token", r.returncode == 0, r.stderr[:160])

cmd_script = write_file("print-token.sh", f"#!/bin/sh\n/bin/echo {TOKEN}\n", 0o755)
cmdfile = write_file("cfg-cmd", f"YOUTRACK_TOKEN_CMD={cmd_script}\n")
r = run("search", "pytorch", env={"YOUTRACK_TOKEN_FILE": cmdfile, "YOUTRACK_BASE_URL": BASE})
check("TOKEN_CMD from file works", r.returncode == 0, r.stderr[:160])

fail_script = write_file("fail-token.sh", "#!/bin/sh\nexit 1\n", 0o755)
failfile = write_file("cfg-fail", f"YOUTRACK_TOKEN_CMD={fail_script}\n")
r = run("search", "pytorch", env={"YOUTRACK_TOKEN_FILE": failfile, "YOUTRACK_BASE_URL": BASE})
check("TOKEN_CMD failure message",
      r.returncode == 1
      and f'YOUTRACK_TOKEN_CMD "{fail_script}" failed or printed nothing.' in r.stderr,
      r.stderr[:200])

r = run("search", "pytorch", env={})
check("token-missing fires before base-URL-missing",
      r.returncode == 1 and "YouTrack token missing — set YOUTRACK_TOKEN" in r.stderr
      and "base URL" not in r.stderr, r.stderr[:200])

# bad id: runtime error before config and any network (dead base URL proves
# it would fail differently if it tried)
r = run("get", "notanid", env={"YOUTRACK_BASE_URL": DEAD_PORT_BASE})
check("bad id exit 1 with readable-form message",
      r.returncode == 1
      and '"notanid" is not an issue id — expected the readable form, e.g. "PROJ-123".'
      in r.stderr, r.stderr[:200])

# trailing slashes on the base URL are stripped
r = run("search", "pytorch", env={"YOUTRACK_TOKEN": TOKEN, "YOUTRACK_BASE_URL": BASE + "///"})
check("base URL trailing slashes stripped", r.returncode == 0, r.stderr[:160])

# ---------------------------------------------------------------------------
# Usage exits: exit 2, usage on stderr. All pre-config, so env is irrelevant.
for name, args, needle in [
    ("bare run exit 2", (), "Usage: yt"),
    ("unknown verb exit 2", ("frobnicate",), 'unknown verb "frobnicate"'),
    ("unknown flag exit 2", ("search", "pytorch", "--bogus"), 'unknown flag "--bogus"'),
    ("search without query exit 2", ("search",), 'verb "search" requires a query'),
    ("bad --limit exit 2", ("search", "pytorch", "--limit", "abc"),
     '"--limit" expects a positive integer, got "abc".'),
    ("--max-comments 0 exit 2", ("comments", "SAM-1", "--max-comments", "0"),
     '"--max-comments" expects a positive integer, got "0".'),
    ("flag without value exit 2", ("--limit",), '"--limit" requires a value.'),
]:
    r = run(*args, env={})
    check(name, r.returncode == 2 and needle in r.stderr and "Usage: yt" in r.stderr,
          f"rc={r.returncode} {r.stderr[:160]}")

print()
if FAILED:
    print(f"{COUNT - len(FAILED)}/{COUNT} passed; FAILED: {', '.join(FAILED)}")
    sys.exit(1)
print(f"{COUNT}/{COUNT} passed")

#!/usr/bin/env python3
"""yt-sync — manual, user-gated sync between local .pi todos and YouTrack issues.

Subcommands (all GET-only except apply/set-stage, which require an explicit
write flag or explicit write intent):

  candidates --dir <path>        list open/in_progress todos, flagging synced ones
  stages     --project <SHORT>   print the project's Stage/State values (* = resolved)
  apply      --todo <file> --project <SHORT> [--type Task] [--stage NAME]
             [--parent WP-ID] [--apply]
                                 plan (default) or execute create+link+back-link
  reconcile  --dir <path>        drift report: local status vs issue Stage, for
                                 every todo carrying a "youtrack:" marker
  set-stage  --issue <ID> --stage NAME
                                 explicit Stage change (write; use only on
                                 explicit user approval)

Config: YOUTRACK_TOKEN / YOUTRACK_BASE_URL from the environment or dotenv-style
~/.config/youtrack/.env (override with YOUTRACK_TOKEN_FILE); YOUTRACK_TOKEN_CMD
(argv, no shell) resolves the token via an external secrets tool when no token
is found. Nothing instance- or project-specific is baked into this file.
Exit codes: 0 ok, 1 api/data error, 2 usage.
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

MARKER = re.compile(r"youtrack:\s*([A-Z][A-Z0-9_]*-\d+)")


def load_cfg():
    file_vals = {}
    token_file = pathlib.Path(
        os.environ.get("YOUTRACK_TOKEN_FILE")
        or pathlib.Path.home() / ".config" / "youtrack" / ".env"
    )
    try:
        for line in token_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                file_vals[k.strip()] = v.strip().strip("\"'")
            else:
                file_vals.setdefault("YOUTRACK_TOKEN", line)  # bare token tolerated
    except FileNotFoundError:
        pass

    def get(k):
        return os.environ.get(k) or file_vals.get(k)

    token = get("YOUTRACK_TOKEN")
    if not token:
        cmd = get("YOUTRACK_TOKEN_CMD")
        if cmd:
            try:
                token = subprocess.run(
                    cmd.split(), capture_output=True, text=True, timeout=5, check=True
                ).stdout.strip()
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
                die(f'YOUTRACK_TOKEN_CMD "{cmd}" failed: {e}')
    if not token:
        die("YouTrack token missing — set YOUTRACK_TOKEN (env or ~/.config/youtrack/.env) or YOUTRACK_TOKEN_CMD.")
    base = (get("YOUTRACK_BASE_URL") or "").rstrip("/")
    if not base:
        die("YouTrack base URL missing — set YOUTRACK_BASE_URL (env or ~/.config/youtrack/.env).")
    return base, token


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def build_http():
    base, token = load_cfg()

    def http(method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            die(f"{method} {path}: HTTP {e.code} {e.read().decode()[:200]}")
        except urllib.error.URLError as e:
            die(f"{method} {path}: {e.reason}")

    return http


# ---------------------------------------------------------------------------
# todos

def parse_todo(path):
    raw = pathlib.Path(path).read_text()
    try:
        fm, end = json.JSONDecoder().raw_decode(raw)
    except json.JSONDecodeError:
        return None
    body = raw[end:].strip()
    link = MARKER.search(body)
    return {
        "id": fm.get("id", pathlib.Path(path).stem),
        "title": fm.get("title", ""),
        "status": fm.get("status", "?"),
        "tags": fm.get("tags", []),
        "issue": link.group(1) if link else None,
        "body": body,
        "path": str(path),
    }


def todos_dir_arg(d):
    p = pathlib.Path(d)
    sub = p / ".pi" / "todos"
    if sub.is_dir():
        return sub
    if p.is_dir():
        return p
    die(f"no todo directory at {d} (looked for {sub})")


def find_sync_section(body):
    """Return (insertion_index, needs_new_section) for a back-link bullet."""
    m = re.search(r"^# YouTrack\s*$", body, re.M)
    if m:
        return m.end(), False
    return len(body.rstrip()), True


def write_back_link(todo_path, body, issue, stage, parent):
    today = __import__("datetime").date.today().isoformat()
    lane = f', swimlane via subtask of {parent}' if parent else ""
    bullet = f"- **youtrack: {issue}** — synced {today}. Stage {stage}{lane}."
    idx, new_section = find_sync_section(body)
    if new_section:
        addition = f"\n\n# YouTrack\n\n{bullet}\n"
        new_body = body.rstrip() + addition
    else:
        new_body = body[:idx] + "\n\n" + bullet + body[idx:]
    pathlib.Path(todo_path).write_text(
        pathlib.Path(todo_path).read_text().replace(body, new_body, 1)
    )


# ---------------------------------------------------------------------------
# subcommands

def cmd_candidates(args):
    d = todos_dir_arg(args.dir)
    rows = []
    for f in sorted(d.glob("*.md")):
        t = parse_todo(f)
        if not t:
            print(f"{f.stem:<10} PARSE-FAIL (front matter unreadable)")
            continue
        if t["status"] == "done":
            continue
        rows.append(t)
    if not rows:
        print("no open/in_progress todos here")
        return
    for t in rows:
        flag = f"-> {t['issue']}" if t["issue"] else ""
        print(f"{t['id']:<10} [{t['status']:<12}] {flag:<12} {t['title'][:76]}")
    unsynced = sum(1 for t in rows if not t["issue"])
    print(f"({unsynced} unsynced of {len(rows)} active)")


def cmd_stages(args, http):
    res = http("GET", f"/api/admin/projects/{args.project}/customFields"
                      "?fields=field(name),bundle(values(name,isResolved))")
    found = False
    for cf in res if isinstance(res, list) else []:
        name = cf.get("field", {}).get("name")
        if name in ("Stage", "State"):
            found = True
            vals = ", ".join(v["name"] + ("*" if v.get("isResolved") else "")
                             for v in cf.get("bundle", {}).get("values", []))
            print(f"{name}: {vals}")
    if not found:
        print(f"no Stage/State field on project {args.project}")


def issue_stage(issue):
    for cf in issue.get("customFields", []):
        if cf.get("name") == "Stage":
            v = cf.get("value")
            if isinstance(v, dict) and v.get("name"):
                return v["name"]
        if cf.get("name") == "State":  # fallback only
            state = cf.get("value")
            if isinstance(state, dict):
                return state.get("name", "")
    return ""


def cmd_apply(args, http):
    t = parse_todo(args.todo)
    if not t:
        die(f"cannot parse todo {args.todo}")
    if t["issue"]:
        die(f'{t["id"]} already synced to {t["issue"]} — use reconcile')
    if t["status"] == "done":
        die(f'{t["id"]} is done — nothing to sync')
    stage = args.stage or ("In Progress" if t["status"] == "in_progress" else "To Do")
    parent = (args.parent or "").upper().strip() or None

    print("PLAN")
    print(f"  todo:     {t['id']} [{t['status']}] {t['title'][:80]}")
    print(f"  create:   project={args.project} type={args.type}")
    print(f"  fields:   Stage={stage}" + (f", subtask of {parent}" if parent else ""))
    print(f"  desc:     {len(t['body'])} chars from {t['path']}")
    print(f"  post:     back-link 'youtrack: <NEW-ID>' appended to the todo file")
    if not args.apply:
        print("\nplan only — re-run with --apply after user approval")
        return

    res = http("POST", "/api/issues?fields=idReadable", {
        "project": {"shortName": args.project},
        "summary": t["title"],
        "description": t["body"],
        "customFields": [
            {"$type": "SingleEnumIssueCustomField", "name": "Type", "value": {"name": args.type}},
        ],
    })
    new_id = res["idReadable"]
    query = f"Stage {stage}" + (f" subtask of {parent}" if parent else "")
    http("POST", "/api/commands", {"query": query, "issues": [{"idReadable": new_id}]})
    chk = http("GET", f"/api/issues/{new_id}?fields=customFields(name,value(name)),"
                      "links(direction,linkType(name),issues(idReadable))")
    got_stage = issue_stage(chk)
    parents = [x["idReadable"] for l in chk.get("links", []) if l.get("direction") == "INWARD"
               and l.get("linkType", {}).get("name") == "Subtask" for x in l.get("issues", [])]
    ok = got_stage == stage and (not parent or parents == [parent])
    print(f"created {new_id}: Stage={got_stage or '?'} parent={'/'.join(parents) or '-'} "
          f"{'OK' if ok else 'MISMATCH — check manually'}")
    write_back_link(t["path"], t["body"], new_id, got_stage or stage, parent)
    print(f"back-link written to {t['path']}")


def stage_to_local(stage, resolved):
    if resolved:
        return "done"
    if stage in ("In Progress", "Review"):
        return "in_progress"
    return "open"


def cmd_reconcile(args, http):
    d = todos_dir_arg(args.dir)
    synced = []
    for f in sorted(d.glob("*.md")):
        t = parse_todo(f)
        if t and t["issue"]:
            synced.append(t)
    if not synced:
        print("no synced todos (no youtrack: markers) here")
        return
    drift = 0
    for t in synced:
        issue = http("GET", f"/api/issues/{t['issue']}?fields=summary,resolved,"
                            "customFields(name,value(name))")
        stage = issue_stage(issue)
        remote = stage_to_local(stage, issue.get("resolved") is not None)
        arrow = "==" if remote == t["status"] else "DRIFT"
        if remote != t["status"]:
            drift += 1
        print(f"{t['id']:<10} {t['status']:<12} {arrow:<5} {remote:<12} "
              f"({t['issue']}: {stage or '?'} "
              f"{'· resolved' if issue.get('resolved') is not None else ''})")
    if drift:
        print(f"\n{drift} drifted item(s). Align with `set-stage` (push local) "
              f"or edit the todo status (pull remote) — by explicit decision, per item.")
    else:
        print("all aligned")


def cmd_set_stage(args, http):
    http("POST", "/api/commands", {"query": f"Stage {args.stage}",
                                   "issues": [{"idReadable": args.issue}]})
    print(f"{args.issue}: Stage {args.stage} command accepted")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("candidates"); p.add_argument("--dir", required=True)
    p = sub.add_parser("stages"); p.add_argument("--project", required=True)
    p = sub.add_parser("apply")
    p.add_argument("--todo", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--type", default="Task")
    p.add_argument("--stage")
    p.add_argument("--parent")
    p.add_argument("--apply", action="store_true")
    p = sub.add_parser("reconcile"); p.add_argument("--dir", required=True)
    p = sub.add_parser("set-stage")
    p.add_argument("--issue", required=True)
    p.add_argument("--stage", required=True)

    args = ap.parse_args()
    if args.cmd == "candidates":
        cmd_candidates(args)  # local files only — no network needed
    else:
        http = build_http()
        if args.cmd == "stages":
            cmd_stages(args, http)
        elif args.cmd == "apply":
            cmd_apply(args, http)
        elif args.cmd == "reconcile":
            cmd_reconcile(args, http)
        elif args.cmd == "set-stage":
            cmd_set_stage(args, http)


if __name__ == "__main__":
    main()

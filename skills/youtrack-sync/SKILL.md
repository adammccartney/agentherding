---
name: youtrack-sync
description: "Manually sync selected local .pi todos into linked YouTrack issues for team visibility, and reconcile status drift later. Use when the user wants to push local todos onto a YouTrack board, place issues in a swimlane (Work Package), or check whether local statuses still match their linked YouTrack issues. Never runs automatically; every write is gated on an explicit user decision."
---

Sync local `.pi/todos` items into YouTrack for visibility — plan/apply, item by
item. The companion script is `scripts/yt-sync.py` (run with `python3` or `uv
run`; stdlib only) next to this file.

## Hard rules

1. **Never automatic.** Sync and any Stage change require an explicit user
   decision per item. `apply` without `--apply` is plan-only — show the plan,
   wait for approval, then re-run with `--apply`.
2. A todo with a `youtrack:` marker is already synced: do not re-create it;
   use `reconcile` instead.
3. agentherding-area todos (agentherding repo, meta tooling) stay local
   unless the user says otherwise.
4. Reads for exploration go through the `youtrack` extension tool (search /
   get / comments); this script's `stages` is for vocabulary inspection.

## Config (injected, private — nothing about our instance lives here)

- `YOUTRACK_TOKEN` and `YOUTRACK_BASE_URL`: environment, or dotenv-style
  `~/.config/youtrack/.env` (override: `YOUTRACK_TOKEN_FILE`).
  `YOUTRACK_TOKEN_CMD` (argv, no shell) is the seam for secret-store tools.
- **Project resolution** (which YouTrack project a todo goes to), precedence
  high→low:
  1. `track:<P>` tag in the todo's front matter,
  2. `git config youtrack.project` on the enclosing repo (uncommitted
     `.git/config` binding; set once per clone),
  3. ordered globs in `~/.config/youtrack/context-map.json` (private),
     e.g. `{ "rules": [ { "glob": "**/my-repo-subdir", "project": "ABC" } ] }`,
  4. unresolved → ask the user, or keep the todo local.

## Workflow

### 1. Enumerate candidates

```bash
python3 scripts/yt-sync.py candidates --dir <repo-or-todos-dir>
```

Lists open/in_progress todos, flags those already carrying a `youtrack:` marker.
(Tip: `--dir .` from a repo root resolves `<root>/.pi/todos` automatically.)

### 2. Propose — for each candidate the user names

- Resolve the **project** via the precedence chain above.
- Choose **Stage** from the live vocabulary:

  ```bash
  python3 scripts/yt-sync.py stages --project <SHORT>
  ```

  Defaults without `--stage`: `open`→`To Do`, `in_progress`→`In Progress`.
- Choose a **swimlane**: on the ASC-template boards swimlanes are Work
  Packages; cards join a swimlane as a **subtask of that Work Package**.
  Find parents with the youtrack tool: e.g. search `project: <SHORT>` and
  read the `Type` values, or ask the user which Work Package.
- Default **Type**: `Task` (override with `--type`).

Present the candidate list, project, stage, and parent choice as a table and
confirm before any write.

### 3. Apply (after approval)

```bash
python3 scripts/yt-sync.py apply --todo <file> --project <SHORT> \
    [--type Task] [--stage <name>] [--parent <WP-ID>]           # plan
python3 scripts/yt-sync.py apply ... --apply                    # execute
```

`--apply` creates the issue (title, full markdown body), sets Stage and the
subtask link via one command call, verifies Type/Stage/parent with a GET,
then appends the back-link to the todo body:

```
# YouTrack
- **youtrack: ABC-123** — synced <date>. Stage In Progress, swimlane via subtask of CFS-46.
```

### 4. Reconcile (status drift, read-only report)

```bash
python3 scripts/yt-sync.py reconcile --dir <repo-or-todos-dir>
```

Maps each linked issue's Stage back to a local status (`resolved ⇒ done`;
`In Progress`/`Review ⇒ in_progress`; everything else ⇒ `open`) and prints
`==` or `DRIFT` per item. Alignment is a **decision, per item, never bulk**:
push local state with

```bash
python3 scripts/yt-sync.py set-stage --issue <ID> --stage <name>   # write; needs approval
```

or pull remote by editing the todo's status (ordinary todo update).

## Filing and promotion

- Design context and the first manual sync (CFS-48/CFS-49) live in the
  agentherding todo ledger `TODO-3b5d4bd8`.
- **Promotion trigger**: after ~3–4 sync episodes stabilize these steps, the
  proven write shapes graduate into the `youtrack` extension behind a guard.
- Divergent vocabularies: most scoped projects share one Stage template;
  INC differs (`Mitigated`/`Remediated`/`Risk accepted` are its resolved
  values). Always read `stages` output for the target project when unsure.

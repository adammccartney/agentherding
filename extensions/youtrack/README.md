# youtrack

Read-only YouTrack tool. One tool, three actions:

| Action     | Key params            | Returns                                                            |
| ---        | ---                   | ---                                                                |
| `search`   | `query`, `limit?`     | `<id, summary, project, stage, pri, resolved, comments, updated>` rows |
| `get`      | `id`                  | one issue's metadata, tags, and description (capped at 2000 chars) — id is the readable form, e.g. `PROJ-123` |
| `comments` | `id`, `maxComments?`  | comment thread as plain text; long threads keep first 2 + last comments |

The workflow column is **`Stage`**, surfaced as `stage` (with `State` as
fallback for boards that use it, such as the software development board).
`resolved` is distinct from open/closed vocabulary: any resolved stage sets
it.

## Configuration — nothing private is baked in

No instance host, project name, or board id appears in this repo. Both
credentials resolve at execute time, in this order:

1. Environment variables: `YOUTRACK_TOKEN` and `YOUTRACK_BASE_URL`.
2. A dotenv-style file (default `~/.config/youtrack/.env`, override with
   `YOUTRACK_TOKEN_FILE`):

   ```
   YOUTRACK_TOKEN=perm-<your-permanent-token>
   YOUTRACK_BASE_URL=https://youtrack.example.com
   ```

   A file containing only a raw token line (no `KEY=`) is also accepted as
   the token. Keep the file mode `0600`.
3. Token-only fallback: `YOUTRACK_TOKEN_CMD` (either config location) runs an
   argv command — no shell interpolation, 5 s timeout — and trims its stdout
   to the token. This is the seam for secret-store tools (`keks`, `papiere`,
   or any `mycreds get youtrack/token`-style CLI) once one is deployed.

Tokens are personal permanent tokens (YouTrack profile → Account security →
New token). They never appear in tool output.

## Design rules

GET-only (there is no write path in `api.ts`); descriptions capped (2000
chars) and comments capped (4000 chars each, first-2 + last-N windowing) so
issue context stays lean; `structuredContent` carries typed data for codemode
callers; annotated `readOnlyHint`.

`api.ts` is a pure fetch core with no pi imports — testable standalone, e.g.

```sh
YOUTRACK_BASE_URL=https://youtrack.example.com node --experimental-strip-types test-api.ts
```

## Query language

YouTrack's query language, e.g.
`project: PROJ Stage: Open AND #Unresolved someterm`. Useful fields:
`project`, `Stage`, `State`, `Priority`, `Assignee`, `#Unresolved` /
`#Resolved`, `-{...}` negation, free text over summary/description/comments.

Phase 2 (todo↔YouTrack sync, tracked in the todo ledger) resolves the target
project per context via `track:<P>` tags, `git config youtrack.project`, and a
private `~/.config/youtrack/context-map.json` — never from this repo.

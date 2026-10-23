# zammad

Read-only Zammad tool for support.vsc.ac.at. One tool, three actions:

| Action    | Key params          | Returns                                                  |
| ---       | ---                 | ---                                                      |
| `search`  | `query`, `limit?`   | `<number, title, state, group, requester, updated, arts>` rows |
| `get`     | `number`            | one ticket's metadata incl. its tags (public number, from `[Ticket#NNN]`) |
| `articles`| `number`, `maxArticles?` | conversation as plain text; long threads keep first 2 + last articles |

Auth: Zammad personal access token (profile → Token Access → `ticket.agent`
scope) stored at `~/.config/zammad/token`, mode `0600`. Overrides:
`ZAMMAD_BASE_URL`, `ZAMMAD_TOKEN_FILE`.

Design rules: GET-only; HTML bodies stripped to text; output pre-digested and
capped so ticket context stays lean; `structuredContent` carries typed data
for codemode callers; annotated `readOnlyHint`.

Search syntax: `state.name:closed AND group.name:"software package" AND
<term>`; tags are searchable (`tags:<name>`). Software requests land in the
`software package` group. Note: the tag vocabulary endpoint (`/tag_list`)
needs admin — `get`/`articles` surface a ticket's tags, which is what triage
needs.

`api.ts` is a pure fetch core with no pi imports — testable standalone, e.g.

```sh
node test-api.ts   # scratch script, not shipped
```

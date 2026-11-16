---
name: commit
description: "Create git commits using Conventional Commits format"
---

Create a git commit for the current changes using a concise Conventional
Commits-style subject. When using this skill,
`skills/commit/scripts/commit.sh` is the canonical commit invocation. Its
helper preserves the message structure and never changes repository identity.

## Format

```
<type>(<scope>): <summary>
```

- **type** REQUIRED. Use:
  - `feat` - New features
  - `fix` - Bug fixes
  - `docs` - Documentation only
  - `style` - Formatting, missing semicolons, etc (no code change)
  - `refactor` - Code refactoring (no feature/change in behavior)
  - `perf` - Performance improvements
  - `test` - Adding or updating tests
  - `chore` - Maintenance tasks, dependencies, build changes
- **scope** OPTIONAL. Short noun in parentheses for the affected area (for
  example, `api`, `parser`, `ui`, or `auth`).
- **summary** REQUIRED. Short, imperative, <= 72 chars, no trailing period.

Good subjects:

```
feat(auth): add OAuth2 token refresh
fix(parser): handle empty input gracefully
docs: update API reference for v2
refactor(db): extract connection pooling logic
chore(deps): bump lodash to 4.17.21
```

Bad subjects:

```
fixed stuff
WIP
updated files
feat: add feature that does the thing (#123)
```

## Body and message formatting

Add a body when more context is needed. Explain what changed and why, rather
than listing implementation mechanics. Do not add breaking-change markers.
Pass real multiline text to the helper: Bash does not expand `\n` inside
ordinary double quotes, so `-m "line one\nline two"` stores a literal
backslash-n. Use an actual multiline quoted string instead.

The helper wraps only ordinary prose body paragraphs at 72 columns. It joins
and greedily reflows their words without splitting an oversized word. Blank
lines remain paragraph separators. List items stay on separate lines;
indented lines, fenced blocks and their contents, block quotes, and Git-style
trailers pass through unchanged. Long words and URLs remain intact. The
subject is never reflowed, and every co-author trailer is appended separately
with its own `git commit -m` argument.

## Author, Committer, and agent attribution

For a commit with significant agent contribution, the human user/operator
driving the agent is **always both Git Author and Committer**. The assisting
runtime and model **always** appear in a final `Co-Authored-by` trailer. An
agent never takes either human metadata field, supplies itself with
`--author`, substitutes `ASC Agent`, or fabricates an identity. Purely
human-only commits need no AI trailer.

A trailer records attribution only; it does not set Author or Committer.
Before committing, verify both fields independently and stop if either is
missing or names an agent instead of the operator:

```bash
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

Normal repository configuration should supply the verified human identity.
Do not use a service account in place of the operator. On GitLab instances
that validate Author-email account and project membership, a human Author
still must be authorized; attribution does not bypass publication checks.

### Runtime and provider/model discovery

Use the provider and model of the **active session**, not a stale example, a
configured default selected in another session, or a different runtime. The
trailer form is:

```text
Co-Authored-by: <runtime> (<provider-or-endpoint>/<model>) <runtime-identifier>
```

The runtime name, provider or endpoint, model, and identifier must all be
verified. If the active session does not expose enough information, ask the
operator instead of guessing.

- **Pi:** Inspect the active session's selected provider and model first.
  `~/.config/pi/settings.json` and `~/.pi/agent/settings.json` are fallback
  discovery sources only when their `defaultProvider` and `defaultModel` are
  verified to match that active selection; a later `/model` selection wins.
  An illustrative, complete Pi message is:

  ```text
  docs(commit): document Pi attribution

  Co-Authored-by: Pi (openai/gpt-4o) <pi-coding-agent>
  ```

- **Prospero:** Read the active session's endpoint and model from the model
  selector on the Prompt status line. The endpoint and model are distinct
  parts of the selection. If configuration inspection is needed, use the
  file named by the Settings pane; its default is
  `~/.config/prospero/prospero.ini`, but `-c` and includes can change the
  effective source. A `[model NAME]` section can also set a different request
  `id`. Never substitute Pi settings for the active Prospero selection.

  ```text
  docs(commit): document Prospero attribution

  Co-Authored-by: Prospero (moonshotai/Kimi-K3.1-Pro) <https://github.com/skeeto/prospero>
  ```

- **OpenCode:** Use the active session information exposed by OpenCode or
  verified operator-provided session metadata. Do not invent an OpenCode
  configuration location or assume that an example is the current model.
  Note the two spaces between `OpenCode` and its provider/model pair:

  ```text
  docs(commit): document OpenCode attribution

  Co-Authored-by: OpenCode  (moonshotai/Kimi-K3.1-Pro) <opencode-agent>
  ```

  The existing agent-rules `git-author` plugin is inconsistent legacy
  tooling: it still forces `ASC Agent` as Author and Committer. This skill
  and its helper do not neutralize that environment injection. Disable the
  installed plugin or separately rework it before OpenCode can obey this
  policy, then verify both Git identity fields again.

## Canonical helper usage

Run the helper from the target repository. Repeat `-f` for each file to stage;
leading-dash filenames and filenames containing spaces are safe. Any `-f`
makes that list the complete commit scope. Before staging anything, the helper
rejects every already-staged path that does not exactly match a `-f` value,
reports each path with shell quoting, and leaves the index unchanged. Reconcile
the staged selection explicitly before retrying; the helper never unstages an
excluded path or adds it to `-f` implicitly. If `-f` is omitted, the helper
commits the changes already staged. Positional operands are usage errors.

`-m` is required and receives the complete Conventional Commit subject. `-b`
is optional body text. Repeat `-c` once per co-author, in the required order;
each value is the entire text **after** `Co-Authored-by:`, without that prefix.

```bash
bash skills/commit/scripts/commit.sh \
  -f 'skills/commit/SKILL.md' \
  -f 'skills/commit/scripts/commit.sh' \
  -m 'docs(commit): document Prospero attribution' \
  -b 'Explain the attribution policy.

Keep real blank lines in multiline body text.' \
  -c 'Prospero (moonshotai/Kimi-K3.1-Pro) <https://github.com/skeeto/prospero>'
```

A purely human commit omits `-c`. For significant agent contribution, always
pass the active runtime and model's verified trailer. The helper uses separate
`-m` arguments for subject, body, and each trailer, so Git inserts the blank
lines between them. It does not invoke `eval`, set identity, or print body
content in its own diagnostics.

## Steps

1. **Check repository state and branch:**

   ```bash
   git status
   git branch --show-current
   git diff --stat
   ```

2. **Review every included change and select scope:**

   ```bash
   git diff
   git diff --cached
   git log -n 50 --pretty=format:%s
   ```

   If the requested file set is ambiguous, ask the user. Commit only the
   intended files, respect sandbox boundaries, and confirm the intended
   branch again immediately before committing.

3. **Verify human Author and Committer independently:**

   ```bash
   git var GIT_AUTHOR_IDENT
   git var GIT_COMMITTER_IDENT
   ```

   Stop on an absent, fabricated, service-account, or agent identity rather
   than repairing it with an agent override.

4. **Discover the active runtime and model** as described above. An agent
   that materially produced the changes supplies its exact `-c` value.

5. **Create the commit through the canonical helper.** Use `-f` for every
   intended file, or verify the existing staged set first when omitting it.

6. **Inspect the resulting identities and complete message separately:**

   ```bash
   git show -s --format='Author: %an <%ae>%nCommitter: %cn <%ce>%n%B' HEAD
   git log --format=%B -1 | grep -F '\n'
   ```

   The first command must show the operator as both Author and Committer, the
   unchanged Conventional Commit subject, and every required trailer in full
   at the end. The second command must print nothing. Tests and lint results
   do not replace these metadata checks.

## Amend, cherry-pick, and rebase

Adding a trailer is not an Author rewrite. An ordinary amend preserves the
original Author identity and Author date, while creating a new Committer
identity/date from the active environment; verify that this environment is
the operator's. Cherry-pick ordinarily preserves Author and message while
selecting a new Committer. Rebase recreates commits and likewise needs exact
metadata inspection. None of these operations licenses replacing a human
field with an agent or silently discarding existing attribution.

Any intentional local history rewrite requires separate operator
authorization. After an authorized amend, cherry-pick, or rebase, inspect
every affected commit's Author, Committer, and trailers before publication.
Do not rewrite existing history solely to normalize old attribution.

## Notes

- Only commit; do NOT push.
- If uncertain about files to include, ask the user.
- Treat user instructions as guidance for scope, summary, and body.
- Work in the current repository and respect sandbox boundaries.
- Leave the operator's configured identity in place; never manufacture an
  email or use an agent as Author or Committer.

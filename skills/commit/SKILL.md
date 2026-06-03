---
name: commit
description: "Create git commits using Conventional Commits format"
---

Create a git commit for the current changes using a concise Conventional Commits-style subject.

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
- **scope** OPTIONAL. Short noun in parentheses for the affected area (e.g., `api`, `parser`, `ui`, `auth`).
- **summary** REQUIRED. Short, imperative, <= 72 chars, no trailing period.

## Body (Optional)

If more context is needed:
- Add a blank line after the subject
- Write short paragraphs explaining what and why (not how)
- Keep lines <= 72 chars
- No breaking-change markers or footers
- No sign-offs (no `Signed-off-by`)

## Steps

1. **Check repository state**
   ```bash
   git status
   git diff --stat
   ```

2. **Review changes** (if needed for context)
   ```bash
   git diff
   ```

3. **See recent scopes** (optional, for consistency)
   ```bash
   git log -n 50 --pretty=format:%s
   ```

4. **Stage files** (if not already staged)
   - If user specified files: `git add <files>`
   - If ambiguous: ask user which files to include
   - Otherwise: commit all changes

5. **Create commit**
   ```bash
   git commit -m "<type>(<scope>): <summary>"
   # Add body if needed:
   git commit -m "<subject>" -m "<body>"
   ```

## Examples

Good commits:
```
feat(auth): add OAuth2 token refresh
fix(parser): handle empty input gracefully
docs: update API reference for v2
refactor(db): extract connection pooling logic
chore(deps): bump lodash to 4.17.21
```

Bad commits:
```
fixed stuff
WIP
updated files
feat: add feature that does the thing (#123)
```

## Notes

- Only commit; do NOT push
- If uncertain about files to include, ask the user
- Treat user instructions as guidance for scope, summary, and body
- If files are specified, only commit those unless user says otherwise
- Work in the current repository (respect sandbox boundaries if in a sandbox)

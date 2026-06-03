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
- No breaking-change markers

## Co-Authorship (AI Assistance)

When an AI agent significantly contributes to the changes, add a `Co-Authored-by` trailer:

```
Co-Authored-by: <agent-name> <agent-identifier>
```

**Always include model and provider information.** Query the current session settings before creating commits:

```bash
cat ~/.config/pi/settings.json 2>/dev/null || cat ~/.pi/agent/settings.json 2>/dev/null
```

Extract `defaultProvider` and `defaultModel` from the settings, then format as:
```
Co-Authored-by: Pi (<provider>/<model>) <pi-coding-agent>
```

Examples for this session (aqueduct/qwen-3.5-397b):
```
Co-Authored-by: Pi (aqueduct/qwen-3.5-397b) <pi-coding-agent>
```

Other examples:
```
Co-Authored-by: Pi (openai/gpt-4o) <pi-coding-agent>
Co-Authored-by: Pi (anthropic/claude-sonnet-4-5-20250929) <pi-coding-agent>
Co-Authored-by: Claude Code <claude-code>
Co-Authored-by: GitHub Copilot <copilot@github.com>
```

**Format rules:**
- Add a blank line between body and trailers
- Use `Co-Authored-by:` (not `Signed-off-by:`)
- One trailer per line
- Include at the end of the commit message

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

5. **Query current model/provider** (REQUIRED for co-author trailer)
   ```bash
   cat ~/.config/pi/settings.json 2>/dev/null || cat ~/.pi/agent/settings.json 2>/dev/null
   # Extract defaultProvider and defaultModel
   ```

6. **Create commit**
   ```bash
   git commit -m "<type>(<scope>): <summary>"
   # Add body if needed:
   git commit -m "<subject>" -m "<body>"
   # Add co-author trailer with actual model info:
   git commit -m "<subject>" -m "<body>" -m "Co-Authored-by: Pi (aqueduct/qwen-3.5-397b) <pi-coding-agent>"
   ```

## Examples

Good commits:
```
feat(auth): add OAuth2 token refresh
fix(parser): handle empty input gracefully
docs: update API reference for v2
refactor(db): extract connection pooling logic
chore(deps): bump lodash to 4.17.21

feat(ui): implement dark mode toggle

Adds theme switching with system preference detection.

Co-Authored-by: Pi (aqueduct/qwen-3.5-397b) <pi-coding-agent>
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
- Use `Co-Authored-by` when AI assistance was significant (not for minor edits)

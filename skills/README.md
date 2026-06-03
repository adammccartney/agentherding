# Skills

Skills are self-contained capability packages that pi loads on-demand.

## Available Skills

### commit

Create git commits using Conventional Commits format.

**Usage:**
```
/skill:commit
```

Or let the agent discover it naturally when you ask to commit changes.

**Format:**
```
<type>(<scope>): <summary>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

**Example:**
```
feat(auth): add OAuth2 token refresh
fix(parser): handle empty input gracefully
chore(deps): bump lodash to 4.17.21
```

## Skill Structure

```
skills/
├── commit/
│   ├── SKILL.md           # Main skill definition
│   └── scripts/
│       └── commit.sh      # Helper script (optional)
└── README.md              # This file
```

## Locations

Pi loads skills from:
- `~/.pi/agent/skills/` (global)
- `.pi/skills/` (project-local)
- `skills/` in repository root (this location)
- Paths specified in settings.json

## Creating New Skills

1. Create a directory: `skills/my-skill/`
2. Add `SKILL.md` with frontmatter:
   ```markdown
   ---
   name: my-skill
   description: What this skill does
   ---
   
   # Instructions
   ...
   ```
3. Add helper scripts in `scripts/` if needed
4. Make scripts executable: `chmod +x scripts/*.sh`

## Testing Skills

```bash
# Test a skill directly
/skill:commit

# Or trigger naturally
"commit these changes"
```

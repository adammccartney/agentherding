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

### shannon

Interact with Neovim via RPC to annotate code, navigate files, and do walkthroughs.

**Usage:**
```
/skill:shannon
```

Or let the agent discover it naturally when a prompt arrives from Shannon or
you ask to show something "in Neovim".

Requires the [wincent/shannon](https://github.com/wincent/shannon) nvim plugin
installed at the standard pack location
(`~/.config/nvim/pack/bundle/opt/shannon/`). The bundled
`scripts/shannon-find-nvim.sh` locates the Neovim server socket of an nvim
running in a sibling tmux pane.

Adapted from [wincent/wincent-agent-plugins](https://github.com/wincent/wincent-agent-plugins/tree/main/claude/shannon).

## Skill Structure

```
skills/
├── commit/
│   └── SKILL.md           # Main skill definition
├── uv/
│   └── SKILL.md
├── shannon/
│   ├── SKILL.md
│   └── scripts/
│       └── shannon-find-nvim.sh  # Helper script (optional)
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

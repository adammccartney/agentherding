# Sandbox Todos Extension

Lightweight todo tracking that integrates with the sandbox-workflow extension.

## Features

- **File-based storage** - Todos stored in sandbox's `AGENTS.md` under `## Tasks`
- **Session injection** - Active todos injected into system prompt
- **Simple commands** - Add, complete, list, and clear todos
- **Sandbox-aware** - Only works when a sandbox is active

## Installation

```bash
./bin/install-extension sandbox-todos
```

Requires `sandbox-workflow` extension to be installed.

## Usage

### Add a todo

```
/todo:add Implement feature X
```

Creates a new todo with a unique ID:
```markdown
## Tasks

- [ ] **A1B2C3**: Implement feature X
```

### List todos

```
/todo:list
```

Shows open and completed todos.

### Mark todo as done

```
/todo:done A1B2C3
```

Updates the todo to checked state:
```markdown
## Tasks

- [x] **A1B2C3**: Implement feature X
```

### Clear completed todos

```
/todo:clear
```

Removes all completed todos from AGENTS.md (with confirmation).

## How It Works

1. Todos are stored in `<sandbox>/AGENTS.md` under the `## Tasks` section
2. Each todo has a unique 6-character ID (e.g., `A1B2C3`)
3. The extension reads todos on every prompt and injects active ones into the system prompt
4. This gives the agent awareness of current work items

## Example Workflow

```bash
# Create sandbox
/sandbox:create ~/path/to/repo

# Add work items
/todo:add Add logging to auth module
/todo:add Write tests for new feature
/todo:add Update documentation

# Check progress
/todo:list

# Complete items
/todo:done A1B2C3

# Clean up when done
/todo:clear
```

## AGENTS.md Format

```markdown
## Tasks

- [ ] **ABC123**: Add logging to auth module
  - Using winston
  - Add request ID tracing
- [x] **DEF456**: Write tests
  - Done: 2026-06-03
```

Notes can be added as indented lines under a todo.

## Commands Summary

| Command | Description |
|---------|-------------|
| `/todo:add <text>` | Add new todo |
| `/todo:done <id>` | Mark todo complete |
| `/todo:list` | Show all todos |
| `/todo:clear` | Remove completed todos |

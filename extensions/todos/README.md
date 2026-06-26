# Todo Extension

A comprehensive file-based todo management system for Pi. Stores todos as individual markdown files with JSON front matter in the `.pi/todos` directory.

## Features

- **File-based storage**: Each todo is a standalone `.md` file in `.pi/todos/`
- **JSON front matter**: Todos contain structured metadata (id, title, tags, status, created_at, assignment)
- **Markdown body**: Full markdown support for todo details and notes
- **Locking mechanism**: Prevents concurrent edits with automatic lock expiration
- **Session assignment**: Claim todos to mark them as being worked on by your session
- **Garbage collection**: Automatically removes old closed todos (configurable)
- **Visual TUI**: Interactive todo manager with search, filtering, and actions
- **Tool integration**: LLM can manage todos programmatically via the `todo` tool

## File Format

Each todo file (`.pi/todos/<id>.md`) contains:

```json
{
  "id": "deadbeef",
  "title": "Add tests",
  "tags": ["qa"],
  "status": "open",
  "created_at": "2026-01-25T17:00:00.000Z",
  "assigned_to_session": "session.json"
}

Notes about the work go here in markdown format.
```

## Commands

### `/todos`

Opens the visual todo manager with:
- Search/filter functionality
- Navigate with ↑↓ arrows
- Press Enter to open action menu
- Ctrl+Shift+W to work on selected todo
- Ctrl+Shift+R to refine selected todo
- Esc to close

## Tool Actions

The `todo` tool supports these actions:

| Action | Description | Parameters |
|--------|-------------|------------|
| `list` | List open and assigned todos (excludes closed) | - |
| `list-all` | List all todos including closed | - |
| `get` | Get a specific todo | `id` |
| `create` | Create a new todo | `title`, `tags?`, `status?`, `body?` |
| `update` | Update a todo (replaces body) | `id`, `title?`, `status?`, `tags?`, `body?` |
| `append` | Append to todo body | `id`, `body` |
| `delete` | Delete a todo | `id` |
| `claim` | Claim a todo for current session | `id`, `force?` |
| `release` | Release a todo assignment | `id`, `force?` |

## Todo IDs

- IDs are displayed as `TODO-<8 hex chars>` (e.g., `TODO-deadbeef`)
- Tool parameters accept either `TODO-deadbeef` or just `deadbeef`
- IDs are case-insensitive

## Configuration

Settings are stored in `.pi/todos/settings.json`:

```json
{
  "gc": true,
  "gcDays": 7
}
```

- `gc`: Enable garbage collection of closed todos
- `gcDays`: Delete closed todos older than this many days

## Environment Variables

- `PI_TODO_PATH`: Override the default `.pi/todos` directory location

## Workflow

1. **List todos**: Use `/todos` or `todo: list` to see current tasks
2. **Claim a todo**: Mark it as assigned to your session before working
3. **Work on it**: Use the todo as context for your work
4. **Update progress**: Use `todo: append` to add notes
5. **Close when done**: Mark status as `closed` or `done`

## Locking

When modifying todos, a lock file (`.pi/todos/<id>.lock`) is created:
- Locks expire after 30 minutes
- In interactive mode, you can steal stale locks
- In non-interactive mode, stale locks require manual intervention

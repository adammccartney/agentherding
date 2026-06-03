# Sandbox Workflow Extension

A pi extension that provides a sandboxed environment for safe agent experimentation.

## Features

- **Repository sandboxing** - Copy any repository to `~/src/sandbox/` with one command
- **Automatic AGENTS.md** - Creates constraint file with sandbox-specific rules
- **Path protection** - Blocks all write/edit operations outside the sandbox
- **Command guards** - Blocks dangerous commands (`sudo`, `rm -rf`, `dd`, `mkfs`, `curl | bash`, etc.)
- **Sync support** - Pull updates from the original repository when needed
- **Session persistence** - Remembers your sandbox across pi restarts

## Installation

The extension is already in the project's `extensions/` directory. To use it globally, copy it:

```bash
cp -r ./extensions/sandbox-workflow ~/.pi/agent/extensions/
```

## Usage

### Create a Sandbox

```bash
pi -e ./extensions/sandbox-workflow
# or if installed globally, just: pi
```

Then run:

```
/sandbox:create ~/src/gitlab.tuwien.ac.at/vsc/virtualisation/ansible-rke2/
```

This will:
1. Ask for confirmation
2. Copy the repo to `~/src/sandbox/ansible-rke2/` (excluding `.git/`)
3. Create `AGENTS.md` with sandbox constraints
4. Enable path protection
5. Enable dangerous command guards

**Note:** The sandbox is a **non-git working copy**. The `.git` directory is intentionally excluded to keep the sandbox as a disposable experimentation space. Git history and branches are managed in the original repository.

### Sync Updates

When you've added new features to the original repo and want them in the sandbox:

```
/sandbox:sync
```

You'll be presented with sync options:

1. **Merge (default)** - Copies new and changed files from original to sandbox.
   Files that exist only in the sandbox are **preserved** (not deleted).
2. **Preview only** - Shows what would change without modifying anything.

The sync:
- Preserves `AGENTS.md` (never overwritten)
- Preserves sandbox-only files (generated/experimental content)
- Updates files that exist in both locations
- Adds new files from the original

### Check Status

```
/sandbox:status
```

Shows current sandbox configuration.

### Clear State

```
/sandbox:clear
```

Clears sandbox tracking (does not delete files on disk).

## Generated AGENTS.md

The extension creates an `AGENTS.md` file in the sandbox with these constraints:

- Ignore TASK_DONE items
- Do TASK items
- Never edit files outside the sandbox path
- Generated content is experimental (manual copy required)

## How Protection Works

### Non-Git Sandbox

The sandbox is created as a **git-free working copy** - the `.git` directory is excluded during copy. This is intentional:

- The sandbox is a disposable experimentation space, not a fork
- Git state (branches, commits, index) lives in the original repository
- Submodules are copied as working files without git initialization
- Syncing is simpler without git state conflicts

When you adopt changes from the sandbox, copy them manually to the original repository and commit there.

### Path Protection
The extension intercepts all `write` and `edit` tool calls and checks if the target path is within the sandbox boundary. Attempts to modify files outside are blocked with an error message.

### Command Guards
The extension intercepts all `bash` tool calls and checks for dangerous patterns:

**Blocked commands:**
- `sudo` - Privilege escalation
- `rm -rf` / `rm -fr` - Recursive force delete
- `dd` - Low-level disk operations
- `mkfs` - Filesystem creation
- `curl | bash` / `wget | bash` - Remote code execution
- Fork bombs

**Warned commands (require confirmation):**
- `chmod 777` - Overly permissive permissions
- `eval` - Dynamic code execution

## Commands

| Command | Description |
|---------|-------------|
| `/sandbox:create <path>` | Create sandbox from source repository |
| `/sandbox:sync` | Sync changes from original to sandbox |
| `/sandbox:status` | Show current sandbox state |
| `/sandbox:clear` | Clear sandbox state (keep files) |

## Blocked Commands

The following commands are automatically blocked in the sandbox:

- `sudo` - Privilege escalation
- `rm -rf`, `rm -fr` - Recursive force delete  
- `dd` - Disk operations
- `mkfs` - Filesystem creation
- `curl | bash`, `wget | bash` - Remote code execution
- Fork bombs

The following commands trigger a confirmation prompt:

- `chmod 777` - Overly permissive permissions
- `eval` - Dynamic code execution

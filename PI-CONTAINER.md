# Running pi in a Container

This guide explains how to run the pi coding agent inside a Docker container instead of directly on your host system.

## Benefits

- **Isolation**: pi and its dependencies don't clutter your host system
- **Security**: Container provides a boundary between pi and your host (though note: pi still has full access to mounted volumes)
- **Consistency**: Same environment across different machines
- **Easy cleanup**: Remove the container and image to completely uninstall
- **Version testing**: Easy to test different pi versions side-by-side

## Quick Start

### Option 1: Using the helper script (recommended)

```bash
# Build and run interactively
./docker-pi.sh

# Run with a prompt
./docker-pi.sh -p "Review this codebase"

# Continue previous session
./docker-pi.sh -c
```

The script will automatically build the image on first run.

### Option 2: Using docker-compose

```bash
# Interactive session
docker compose -f docker-compose.pi.yml run --rm pi

# With a prompt
docker compose -f docker-compose.pi.yml run --rm pi -p "Summarize README.md"

# Continue session
docker compose -f docker-compose.pi.yml run --rm pi -c

# Run pi commands
docker compose -f docker-compose.pi.yml run --rm pi pi list
```

### Option 3: Manual Docker commands

```bash
# Build the image
docker build -f Dockerfile.pi -t pi-agent .

# Run interactively
docker run -it --rm \
  -v ~/.pi/agent:/root/.pi/agent \
  -v $(pwd):/workspace \
  -w /workspace \
  -e ANTHROPIC_API_KEY \
  pi-agent
```

## Configuration

### API Keys

You need to pass API keys via environment variables. The container will have access to whatever keys you export:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./docker-pi.sh
```

Or authenticate interactively with `/login` inside the container (credentials saved to `~/.pi/agent/auth.json`).

### Persistent Configuration

Your pi configuration is stored in `~/.pi/agent/` and includes:
- `settings.json` - Global settings
- `auth.json` - Authentication credentials
- `sessions/` - Session history
- `extensions/` - Custom extensions
- `skills/` - Custom skills
- `prompts/` - Prompt templates
- `themes/` - Custom themes
- `models.json` - Custom model configurations

This directory is mounted into the container, so all your settings persist between runs.

### Workspace Access

The current directory is mounted at `/workspace` in the container. pi runs with this as its working directory, so it can access and modify your project files.

To access additional directories, add more volume mounts:

```bash
docker run -it --rm \
  -v ~/.pi/agent:/root/.pi/agent \
  -v $(pwd):/workspace \
  -v /path/to/other/project:/projects/other \
  -w /workspace \
  -e ANTHROPIC_API_KEY \
  pi-agent
```

## Advanced Usage

### Different pi versions

Create multiple Dockerfiles for different versions:

```dockerfile
# Dockerfile.pi-v0.70.0
FROM node:22-slim
RUN npm install -g @mariozechner/pi-coding-agent@0.70.0
WORKDIR /workspace
CMD ["pi"]
```

Then build with a different tag:
```bash
docker build -f Dockerfile.pi-v0.70.0 -t pi-agent-v0.70.0 .
```

### Custom extensions and tools

Install extensions in your host's `~/.pi/agent/extensions/` directory, and they'll be available in the container.

Or mount additional extension directories:
```bash
-v /path/to/custom/extensions:/root/.pi/agent/extensions-extra
```

### Running without network access

For offline development or air-gapped environments:
```bash
docker run -it --rm \
  -v ~/.pi/agent:/root/.pi/agent \
  -v $(pwd):/workspace \
  -w /workspace \
  -e PI_OFFLINE=1 \
  pi-agent
```

### Resource limits

Limit container resources if needed:
```bash
docker run -it --rm \
  --memory=2g \
  --cpus=2 \
  -v ~/.pi/agent:/root/.pi/agent \
  -v $(pwd):/workspace \
  -w /workspace \
  pi-agent
```

## Security Considerations

### Container is NOT a security boundary for file access

⚠️ **Important**: While the container provides process isolation, pi has full access to:
- Your `~/.pi/agent/` directory (including auth tokens)
- Any directories you mount as volumes
- The ability to run arbitrary commands via `bash` tool

The container does **not** protect your files from pi's actions. If you need true isolation:
1. Use a dedicated API key with limited permissions
2. Only mount specific project directories (not your entire home)
3. Consider using a VM for untrusted code execution

### Network access

The container has the same network access as your host. pi can make outbound connections to:
- LLM provider APIs
- npm registries (for package installs)
- GitHub (for git-based packages)

To restrict network access, use Docker network policies or run in offline mode.

## Troubleshooting

### Terminal issues

If you experience terminal rendering problems:
```bash
# Ensure TERM is set correctly
export TERM=xterm-256color
./docker-pi.sh
```

### Permission errors

If you get permission errors on mounted volumes:
```bash
# The container runs as root by default
# Your files will be created/modified as root
# To fix, either:
# 1. Run container as your user (may cause other issues)
docker run -it --rm \
  -u $(id -u):$(id -g) \
  -v ~/.pi/agent:/root/.pi/agent \
  ...

# 2. Or fix permissions on your host files
sudo chown -R $(whoami) ~/.pi/agent
```

### Session not found

Sessions are stored per working directory. If you run pi from different directories, you'll have separate session histories. Use `--session` or `-c` to continue from a specific session.

### API authentication issues

If authentication isn't persisting:
1. Check that `~/.pi/agent/auth.json` exists and is writable
2. Verify the volume mount: `docker inspect <container> | grep Mounts`
3. Try interactive login: `/login` inside pi

## Migration from Host Installation

To migrate your existing pi setup to container:

1. Your configuration is already in `~/.pi/agent/` - no migration needed!
2. Build the container image: `./docker-pi.sh` (auto-builds on first run)
3. Start using the container: `./docker-pi.sh`
4. (Optional) Uninstall host pi: `npm uninstall -g @mariozechner/pi-coding-agent`

To migrate back to host installation:

1. Your configuration remains in `~/.pi/agent/` - no migration needed!
2. Install pi on host: `npm install -g @mariozechner/pi-coding-agent`
3. Use pi normally
4. (Optional) Remove container: `docker rmi pi-agent`

## Tips

### Shell alias

Add to your `.bashrc` or `.zshrc`:
```bash
alias pi='docker run -it --rm \
  -v ~/.pi/agent:/root/.pi/agent \
  -v "$(pwd)":/workspace \
  -w /workspace \
  -e ANTHROPIC_API_KEY \
  -e OPENAI_API_KEY \
  pi-agent'
```

Then just run `pi` as usual!

### Pre-build the image

To avoid the build delay on first run:
```bash
docker build -f Dockerfile.pi -t pi-agent .
```

### Use docker-compose for complex setups

If you need to mount multiple directories or configure complex networking, use the docker-compose file which is easier to maintain than long command lines.

### Debug container issues

```bash
# Run a shell in the container instead of pi
docker run -it --rm \
  -v ~/.pi/agent:/root/.pi/agent \
  -v $(pwd):/workspace \
  pi-agent /bin/bash

# Inspect a running container
docker ps  # Find container ID
docker exec -it <container-id> /bin/bash

# View container logs (if running in detached mode)
docker logs <container-id>
```

## Files in this Repository

- `Dockerfile.pi` - Docker image definition
- `docker-pi.sh` - Helper script to build and run
- `docker-compose.pi.yml` - Docker Compose configuration
- `PI-CONTAINER.md` - This documentation

## Resources

- [pi documentation](https://pi.dev)
- [Docker documentation](https://docs.docker.com)
- [pi GitHub repository](https://github.com/badlogic/pi-mono)

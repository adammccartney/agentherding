#!/bin/bash
#
# Helper script to run pi in a Docker container
#
# Security: Runs as non-root user matching your host UID/GID
#
# Usage:
#   ./docker-pi.sh [pi arguments...]
#
# Examples:
#   ./docker-pi.sh                          # Interactive mode
#   ./docker-pi.sh -p "Review this code"    # Print mode with prompt
#   ./docker-pi.sh @README.md "Summarize"   # With file context
#
# Sandbox Workflow:
#   If you're running from ~/src/sandbox/<project>, the script
#   automatically mounts ~/src/sandbox and sets the working directory
#   to match the container path structure.
#
# Configuration:
#   Set environment variables or use a .env file:
#   - UID, GID: Your user ID (defaults to current user)
#   - PI_CONFIG_DIR: Pi config directory (default: ~/.pi/agent)
#   - SANDBOX_BASE_HOST: Host path for sandbox (default: ~/src/sandbox)
#   - SANDBOX_BASE_CONTAINER: Container path for sandbox (default: /home/node/src/sandbox)
#   - ORIGINAL_REPO_PATH: Path to original repo for sync (optional)

set -e

# Configuration
IMAGE_NAME="pi-agent"

# Get current user's UID/GID (or use provided values)
HOST_UID=${UID:-$(id -u)}
HOST_GID=${GID:-$(id -g)}

# Pi config directory - always use ~/.pi/agent (where extensions/skills are copied)
# PI_CONFIG_DIR env var is ignored - the actual config is always ~/.pi/agent
PI_CONFIG_DIR_HOST="$HOME/.pi/agent"

# Sandbox base paths
SANDBOX_BASE_HOST=${SANDBOX_BASE_HOST:-$HOME/src/sandbox}
SANDBOX_BASE_CONTAINER=${SANDBOX_BASE_CONTAINER:-/home/node/src/sandbox}

# Optional: original repo path (for sandbox sync)
ORIGINAL_REPO_PATH=${ORIGINAL_REPO_PATH:-}

# Expand tilde in paths (only handles literal ~ at start)
expand_tilde() {
    local path="$1"
    if [[ "$path" == "~" ]]; then
        echo "$HOME"
    elif [[ "$path" == "~"/* ]]; then
        echo "$HOME${path#\~/}"
    else
        echo "$path"
    fi
}

SANDBOX_BASE_HOST=$(expand_tilde "$SANDBOX_BASE_HOST")
ORIGINAL_REPO_PATH=$(expand_tilde "$ORIGINAL_REPO_PATH")

# Check if image exists, build if not
if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
    echo "Building Docker image (UID=$HOST_UID, GID=$HOST_GID)..."
    docker build \
        --build-arg HOST_UID="$HOST_UID" \
        --build-arg HOST_GID="$HOST_GID" \
        -f Dockerfile.pi \
        -t "$IMAGE_NAME" \
        .
fi

# Ensure config directory exists
mkdir -p "$HOME/.pi/agent"

# Determine working directory and mount points
WORKDIR=""

# Mount the pi config directory (always ~/.pi/agent where symlinks live)
VOLUMES=(
    -v "$HOME/.pi/agent:/home/node/.pi/agent"
)

# Check if we're running from within the sandbox base directory
if [[ "$(pwd)" == "$SANDBOX_BASE_HOST"/* ]]; then
    # We're in a sandbox project
    REL_PATH="${PWD#$SANDBOX_BASE_HOST/}"
    CONTAINER_WORKDIR="$SANDBOX_BASE_CONTAINER/$REL_PATH"
    
    # Mount the entire sandbox directory
    VOLUMES+=(-v "$SANDBOX_BASE_HOST:$SANDBOX_BASE_CONTAINER")
    WORKDIR="$CONTAINER_WORKDIR"
    
    echo "Sandbox mode detected:"
    echo "  Host: $(pwd)"
    echo "  Container: $CONTAINER_WORKDIR"
else
    # Generic mode - mount current directory as /workspace
    VOLUMES+=(-v "$(pwd):/workspace")
    WORKDIR="/workspace"
fi

# Add original repo mount if specified (for sandbox sync)
if [[ -n "$ORIGINAL_REPO_PATH" && -d "$ORIGINAL_REPO_PATH" ]]; then
    # Mount at the same path inside container for rsync to work
    VOLUMES+=(-v "$ORIGINAL_REPO_PATH:$ORIGINAL_REPO_PATH")
    echo "Original repo mounted: $ORIGINAL_REPO_PATH"
fi

# Run pi in container
# -t: Allocate a pseudo-TTY (needed for interactive mode)
# -i: Keep stdin open (needed for interactive mode)
# --rm: Clean up container after exit
# -v: Mount volumes
# -e: Pass environment variables
# -w: Set working directory
# --user: Run as non-root user matching host
echo "Starting pi container..."
docker run -it --rm \
    "${VOLUMES[@]}" \
    -w "$WORKDIR" \
    --user "$HOST_UID:$HOST_GID" \
    -e OPENAI_API_KEY \
    "$IMAGE_NAME" \
    "$@"

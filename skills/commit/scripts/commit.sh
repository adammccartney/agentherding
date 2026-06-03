#!/usr/bin/env bash
#
# Helper script for creating git commits
# Usage: ./scripts/commit.sh [-f <files>] [-m <message>] [-b <body>]
#
# This script is called by the commit skill to create commits with proper formatting.
#

set -euo pipefail

FILES=()
MESSAGE=""
BODY=""

while getopts "f:m:b:h" opt; do
    case $opt in
        f) FILES+=("$OPTARG") ;;
        m) MESSAGE="$OPTARG" ;;
        b) BODY="$OPTARG" ;;
        h)
            echo "Usage: $0 [-f <file>]... -m <message> [-b <body>]"
            echo "  -f  File to stage (can be repeated)"
            echo "  -m  Commit message (required)"
            echo "  -b  Optional body text"
            exit 0
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$MESSAGE" ]]; then
    echo "Error: Commit message is required (-m)" >&2
    exit 1
fi

# Stage files if specified
if [[ ${#FILES[@]} -gt 0 ]]; then
    echo "Staging files: ${FILES[*]}"
    git add "${FILES[@]}"
fi

# Create commit
if [[ -n "$BODY" ]]; then
    echo "Creating commit with body..."
    git commit -m "$MESSAGE" -m "$BODY"
else
    echo "Creating commit..."
    git commit -m "$MESSAGE"
fi

echo "✓ Commit created successfully"

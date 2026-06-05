#!/bin/sh
# Docker entrypoint script for pi coding agent
# This script ensures pi is always run, with any additional arguments passed through

# If arguments are provided, pass them to pi
# If no arguments, run pi interactively
if [ $# -gt 0 ]; then
    exec pi "$@"
else
    exec pi
fi

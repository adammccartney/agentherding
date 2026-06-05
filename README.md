agentherding
============

Like oxherding, but for agents.

## Setup

The `docker-pi.sh` script automatically:
1. Mounts your `~/.pi/agent` config (with symlinks to extensions/skills)
2. Detects symlinked repos and mounts them at the same absolute path inside the container

This allows extensions and skills to be version-controlled in this repo while
keeping your auth/models/settings in `~/.pi/agent`.

## Extensions

* [sandbox-workflow](./extensions/sandbox-workflow/) create a sandboxed copy of
  a repository in order to explore ideas


### Example: sandbox workflow in a container

```
docker compose -f docker-compose.pi.base.yml -f docker-compose.pi.sandbox.yml --env-file .env run --rm pi
```

#!/usr/bin/env bash

docker compose -f ~/src/github.com/adammccartney/agentherding/docker-compose.pi.base.yml run -v "$(pwd):/home/node/agentherding" --rm -w /home/node/agentherding pi

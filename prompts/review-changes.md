---
description: Read-only review of recent changes via the reviewer subagent
argument-hint: "[ref range or paths, default: uncommitted diff]"
---
Delegate a review to the reviewer subagent: ${@:-the current uncommitted diff}.

Give it: the diff range or paths, the todo/sketch the change implements, and
the repo AGENTS.md gates that apply. Ask for the severity-ordered verdict
table (blocker / major / minor / nit) and an explicit APPROVE or CHANGES
REQUESTED.

Present its verdict verbatim, then add your own one-line assessment. Do not
edit anything until the user reacts to the verdict.

# subagent

Delegate tasks to specialized subagents in isolated `pi` subprocesses.

Vendored from pi's `examples/extensions/subagent` (pi 1.0.3): `index.ts` and
`agents.ts` are unmodified upstream; local value lives outside this directory:

- `../../agents/` — agent definitions, symlinked into
  `~/.pi/agent/agents/`: code fleet (`scout`, `worker`, `reviewer`) and
  didactic fleet (`evaluator`, `teaching-assistant`, `researcher`,
  `professor`);
- `../../prompts/` — workflow prompts (`/explore` delegates wide recon to
  scout; `/implement-delegated`; `/review-changes`; didactic: `/evaluate`,
  `/lab`, `/research`, `/lecture`, `/topics`). The didactic loop passes
  state through the todo ledger: evaluations (tag evaluation) feed labs,
  sheets (tag lab) feed the next evaluation, digests (tag research) feed
  lectures, and the professor reads all of it when suggesting topics (tag
  topics).

Modes (upstream): single `{ agent, task }`, parallel (max 8, 4 concurrent),
chain with `{previous}` placeholder. Agents inherit the session model and
thinking level. Only user-level agents load by default; project `.pi/agents`
needs `agentScope` opt-in and stays off here.

Subagent children are full pi processes: they load these user extensions,
so the `deny-remote` gate applies inside every child too.

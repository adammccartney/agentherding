# handoff

`/handoff <goal for new thread>` — transfer context to a new focused session
instead of compacting a bloated one.

Adapted from pi's `examples/extensions/handoff.ts`. Mechanics: serialize the
current branch (compaction-aware), one side model call generates a structured
prompt (`## Context / ## Files / ## Task`), the prompt opens in the editor for
review, a new parent-linked session is created with the edited prompt as a
draft. Nothing submits itself.

Tuning vs. the stock example, in the transfer system prompt:

- cite the todo ledger and agent-context paths instead of re-pasting content;
- preserve negative results as one-line REJECTED entries with reasons;
- carry approval state forward (approved vs. awaiting approval).

Cost note: one full-conversation side call per use — a quality goal matters
(`/handoff implement it` produces mush). TUI only.

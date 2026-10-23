---
description: Explore possible strategies for implementing a specific idea. Steps are read-only recon -> findings -> recommendation -> stop
---

Explore: $1

Working mode: read-only reconnaissance. Do not change code, config, or live
state. Produce findings, a recommendation, and a minimal sketch — then stop
and await my approval.

## Start
- Being in ${2:-the current repo}. Check its AGENTS.md and .pi/todos/ first:
  reuse prior arcs, preserve negative results.
- Read the real code, not assumptions; follow the import cone.
- Wide recon (multiple repos, large trees, upstream surveys): delegate to the
  `scout` subagent via the subagent tool, single mode. Pass the whole goal and
  constraints; expect compressed findings in this same format, then continue
  from step 1 with your own verification. Serial reading is for narrow recon.

## Do
1. **Verified facts first** - what is true (patch, call sites, existing precedents),
   always show file:line evidence.
2. **Candidates (2-4)** - evaluate in a small table: fit, complexity, failure modes.
   Reject loudly, with reasons. Include a minimal/do-nothing option if honest.
3. **Recommend one** - implementation sketch keep code examples small (~20 lines) reference (files,
   symbols, test impact); for strategy questions, a small offline demo instead.
4. Record open questions and negative results.

## Don't

- Implent, refactor, prepare changes in the actual repositories.
- Allow scope creep. If more work is discovered, make seperate todo items.


## Deliverable

Verified facts -> evaluation table -> recommendation -> sketch -> "awaiting approval to implement"

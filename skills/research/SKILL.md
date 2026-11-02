---
name: research
description: Deep literature research on a question via the researcher subagent — cited digests over papers
disable-model-invocation: true
---

Research via the researcher role: the argument of this invocation

1. Frame the question: scope (venues, years, depth) and what the digest
   is for — a lecture, the learner's reading list, your own decision.
2. Check .pi/todos for earlier research notes (tag research); cite them
   in the task so the subagent extends them instead of repeating the
   search.
3. Dispatch the task tool with role `researcher`, one task-tool dispatch
   per round. Task text: the question, the constraints, the purpose, and
   citations of prior digests.
4. Present the answer and synthesis; record the full digest to the todo
   ledger (tag research) so lectures and later searches cite it by id.

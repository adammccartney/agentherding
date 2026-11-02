---
name: topics
description: Suggest or refine study topics via the professor subagent — calibrated to the learner's state and the open literature
disable-model-invocation: true
---

Suggest study topics via the professor role: the argument of this
invocation (a broad interest to sharpen, or none for open suggestions)

1. Assemble the ledger: recent evaluation notes (tag evaluation) for gaps
   still open, lab notes (tag lab) for what the learner has mastered, and
   research digests (tag research) for what the field leaves open. Cite
   each by id.
2. Dispatch the task tool with role `professor`, one task-tool dispatch
   per round. Task text: topics mode, the ledger citations, and the
   interest to sharpen if one was given. Ask for 3–5 candidates,
   strongest first, each with motivation, prerequisites met, the stretch
   it adds, and a first step.
3. Present the candidates with the professor's recommendation and its
   rejections. Once the learner picks one, record the set to the todo
   ledger (tag topics), marking the choice — later /research, /lecture,
   and /lab dispatches cite that note.

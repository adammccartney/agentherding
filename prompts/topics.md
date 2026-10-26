---
description: Suggest or refine study topics via the professor subagent — calibrated to the learner's state and the open literature
argument-hint: "[broad interest to sharpen, or empty for open suggestions]"
---

Suggest study topics via the professor subagent: $@

1. Assemble the ledger: recent evaluation notes (tag evaluation) for gaps
   still open, lab notes (tag lab) for what the learner has mastered, and
   research digests (tag research) for what the field leaves open. Cite
   each by id.
2. Call the subagent tool, single mode, agent `professor`. Task text:
   topics mode, the ledger citations, and the interest to sharpen if one
   was given. Ask for 3–5 candidates, strongest first, each with
   motivation, prerequisites met, the stretch it adds, and a first step.
3. Present the candidates with the professor's recommendation and its
   rejections. Once the learner picks one, record the set to the todo
   ledger (tag topics), marking the choice — later /research, /lecture,
   and /lab dispatches cite that note.

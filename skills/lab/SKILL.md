---
name: lab
description: Run a lab session — tailored exercises from the teaching-assistant subagent, targeting the evaluator's latest findings
disable-model-invocation: true
---

Run a lab session via the teaching-assistant role: the argument of this
invocation

1. Find the evaluator's latest findings on this topic in .pi/todos (tag
   evaluation). If none exist, stop and propose running /evaluate first —
   an uncalibrated lab session is wasted effort.
2. Cite the learner's relevant artifacts (paths inside the current
   repository, unless the argument says otherwise) and any prior lab
   notes, so the new exercises build on them rather than repeat.
3. Dispatch the task tool with role `teaching-assistant`, one task-tool
   dispatch per round. Task text: the topic, citations of the evaluator's
   notes, the artifact paths, and how much time the session should fill.
4. Record the returned exercise sheet to the todo ledger (tag lab) and
   present it to the learner. The next /evaluate round assesses the
   learner's work against that note.

---
description: Run a lab session — tailored exercises from the teaching-assistant subagent, targeting the evaluator's latest findings
argument-hint: "<topic or evaluation note id>"
---

Run a lab session via the teaching-assistant subagent: $@

1. Find the evaluator's latest findings on this topic in .pi/todos (tag
   evaluation). If none exist, stop and propose running /evaluate first —
   an uncalibrated lab session is wasted effort.
2. Cite the learner's relevant artifacts (paths inside ${2:-the current
   repo}) and any prior lab notes, so the new exercises build on them
   rather than repeat.
3. Call the subagent tool, single mode, agent `teaching-assistant`. Task
   text: the topic, citations of the evaluator's notes, the artifact paths,
   and how much time the session should fill.
4. Record the returned exercise sheet to the todo ledger (tag lab) and
   present it to the learner. The next /evaluate round assesses the
   learner's work against that note.

---
description: Evaluate a learner's work on a problem via the evaluator subagent — read-only, didactic feedback, one round per dispatch
argument-hint: "<problem: lab exercise, assignment, …>"
---

Evaluate via the evaluator subagent: $@

1. Locate the materials in ${2:-the current repo}: the problem statement and
   the learner's attempted solution. Check AGENTS.md and .pi/todos for prior
   evaluation arcs and earlier feedback rounds; cite their paths rather than
   re-pasting them.
2. Wide pre-read (multiple documents or repos, large trees, books): delegate
   to the `scout` subagent via the subagent tool, single mode. Narrow reads
   you do yourself.
3. Call the subagent tool, single mode, agent `evaluator`. Task text: paths
   to the problem statement and the learner's work, what the exercise is
   meant to teach, and citations of any earlier feedback rounds. Point at
   the files; avoid paraphrasing the learner's work in your own words.
4. Record the evaluation to the todo ledger (tag evaluation) — later
   dispatches (/lab, the next round) cite this note by id. Then present it
   as-is, keeping its didactic voice: guiding questions, smaller problems,
   no answers. Stop there: the next round is a fresh dispatch against the
   learner's revised state.

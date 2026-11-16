---
description: Hand an approved task to the worker subagent, then verify and commit yourself
argument-hint: "<task or todo id>"
---
Implement via the worker subagent: $@

1. Confirm the task is approved — the explore note's sketch carries
   "approved", or I say so now. Otherwise stop and ask.
2. Call the subagent tool, single mode, agent `worker`. Task text: cite the
   todo id, the sketch's location, and the repo path plus constraints. Point
   at the sketch; do not paraphrase it away.
3. On return: inspect the diff yourself. Run build and tests. Fix nits
   directly; send anything larger back to the worker with specifics, or to
   the `reviewer` subagent for a verdict.
4. Commit only after you have seen every line and run the relevant
   verification. Follow the repo's conventions and `skills/commit/SKILL.md`;
   the shared skill is canonical for Conventional Commits, human
   Author/Committer identity, active-runtime attribution, and helper usage.
   Never commit unseen worker output.

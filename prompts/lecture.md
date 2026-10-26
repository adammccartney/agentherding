---
description: A lecture from the professor subagent — big-picture teaching on a topic, or a review of a paper (learner draft or research digest)
argument-hint: "<topic, or path to a draft/digest to review>"
---

Call the professor subagent: $@

1. Decide the mode: if the argument resolves to existing files (learner
   drafts or researcher digests), this is a review of those papers;
   otherwise it is a lecture on the topic. Requests about what to study
   next go to /topics.
2. Gather context: the audience's level from the .pi/todos evaluation and
   lab notes, plus relevant research digests (tag research) to weave in.
   Cite those notes by id in the task.
3. Call the subagent tool, single mode, agent `professor`. Task text: the
   mode, the topic or the draft paths, the audience level, and citations of
   context notes — including current assignments, so the professor teaches
   around them.
4. Present the result. Record lectures worth keeping to the todo ledger
   (tag lecture); record reviews of researcher digests likewise, so the
   digest's note can cite the review. Reviews of the learner's writing
   stay in the session unless the learner asks to keep them.

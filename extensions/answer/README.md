# answer

`/answer` (or `ctrl+.`) — extract the questions out of the last assistant
message, answer them one at a time in an interactive TUI, and send the
compiled answers back as a turn-triggering message.

Ported from mitsuhiko's agent-stuff `answer.ts`. Mechanics: the handler
takes the last complete assistant message on the current branch (a
non-`stop` stop reason aborts with a notice), a side model call extracts
the questions as structured JSON, a custom component walks them (Tab/Enter
next, Shift+Tab prev, Shift+Enter newline, Esc cancel, confirmation on the
last question), and the compiled `Q: … > context A: …` text goes to the
session as a custom message with `customType: "answers"`, `display: true`,
`triggerTurn: true`. That entry participates in LLM context and stays
greppable in the session JSONL, so adoption is measurable in usage reviews.

TUI only — the command refuses outside interactive mode.

## Extraction shape

The side call asks for a strict JSON object:

```json
{
  "questions": [
    { "question": "string, required", "context": "string, optional" }
  ]
}
```

Synthetic example — for an assistant message ending with

> Two things before I write the migration: should the `sessions` table keep
> its UUID primary keys, and do you want the backfill batched or single-shot?

the extractor is expected to return

```json
{
  "questions": [
    {
      "question": "Should the `sessions` table keep its UUID primary keys?",
      "context": "Two decisions are needed before the migration is written."
    },
    {
      "question": "Do you want the backfill batched or single-shot?"
    }
  ]
}
```

Responses wrapped in a ```json fence, with prose around the object, or with
minor syntax damage are salvaged before giving up.

## Extraction model selection

Upstream's hardcoded codex/haiku shortlist is replaced by a policy ladder
over the model registry, resolved per invocation so roster churn degrades
gracefully:

1. enumerate the registry's models and score them — ids matching
   `exp|experimental` score out; a parameter size parsed from the id (the
   `\d+b` suffix) in the 20–40B band scores up; a `-vllm`-suffixed twin
   scores highest within the band; ties break toward the larger parsed
   size (measured tie-break: the smaller band candidate burned 96% of its
   budget on reasoning tokens);
2. walk the ranking and take the first model whose credentials resolve via
   the registry's request-time auth;
3. fall back to the current model when no candidate qualifies.

The side call itself runs through the registry's `complete` with
request-time auth, `cacheRetention: "none"`, and a fresh session id.

The extractor prompt keeps upstream's JSON contract and adds one rule:
skip rhetorical questions, code-comment TODOs, and plan-approval prompts —
only questions directed at the user are extracted.

## Notes

- Nothing is configured per extension: selection policy is compiled in and
  auth resolves through the provider configuration the registry already
  knows — the extension reads no credential files itself.
- Deferred (tracked in the todo ledger): optional transcript renderer for
  `customType: "answers"`; todo-ledger write-back of compiled answers once
  real usage shows they deserve persistence.

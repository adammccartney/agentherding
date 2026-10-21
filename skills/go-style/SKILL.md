---
name: go-style
description: "Go code style rules to apply when writing or reviewing Go code, doc comments, and inline comments in any Go repository."
---

Go style law for code and comments. Baseline is Effective Go: <https://go.dev/doc/effective_go>. These rules are stated in our words; the content laws for comments descend from Kernighan and Pike, *The Practice of Programming*, ch. 1 §1.6 (consult your own copy).

## Doc comments (exported surface)

- Every exported identifier - package, type, function, method, constant, variable - carries a doc comment. No exceptions for "obvious" names.
- Start with the declared name in sentence form: `// Package vault implements ...`, `// EnsureVaultSession returns ...`. Never start with "This", "A", or "The" before the name.
- Complete sentences, period at the end. One sentence is often enough; a second earns its place only for contracts, invariants, or failure behavior.
- Package doc: one primary package comment per package, at the top of any one file; it states the package's purpose and its laws/invariants. Do not repeat it per file.
- Document behavior callers must depend on: failure modes, ownership of returned values, concurrency posture, side effects (files written, env read, network touched).

## Inline comments

- Comment WHY, not WHAT. If a comment paraphrases the statement below it, delete it.
- If understanding a statement requires a comment, fix the statement first (rename, extract, simplify); comment the residue, if any.
- Flag the unusual and the negotiated: deliberate divergences, spec-pinned shapes, byte-level contracts, accepted exposures, sentinel orderings. These are pin comments - they earn permanence because they encode laws, not prose.
- Never state what the compiler knows (types, signatures) or what the diff shows (refactors move the code, not the comment).
- Keep comments agreeing with the code. When code changes, its nearby comments change in the same commit. A comment that trails the code is a bug report against itself.

## Comment hygiene

- No commentary masquerading as restatement: `i++ // increment i`. Never.
- No emotional content in code comments (no sarcasm, no hedging the law; plain voice, present tense).
- No large comment blocks atop functions restating the whole contract per-field; structure the field docs on the fields.
- Comments are prose: complete sentences, serial comma, present tense, no filler ("Note that", "Basically", "Just").

## Review checklist

- [ ] Exported surface documented; doc comments start with the noun.
- [ ] Package purpose readable from one package comment.
- [ ] No comment restates code it sits next to.
- [ ] Non-obvious behavior carries a WHY; negotiated invariants named as pins.
- [ ] Comments changed in the same commit as the code they describe.

## References

- Effective Go - Commentary: <https://go.dev/doc/effective_go#commentary>
- Kernighan and Pike, *The Practice of Programming*, Addison-Wesley, 1999, ch. 1 §1.6 (comments). Consult your own copy.

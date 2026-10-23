---
description: Triage a Zammad software ticket — fetch, find precedent, recommend install mode
argument-hint: "<ticket-number>"
---
Triage ticket $1 on support.vsc.ac.at. Use the `zammad` tool; never curl.
(Requests arrive by email; if the API is unreachable, accept the pasted mail
body as the article text and mark it as such.)

Software requests land in the `software package` group. Group names may shift;
other groups may come into scope later.

## Steps

1. `zammad get $1` — orientation: title, group, requester, tags, article
   count. If the ticket is not in `software package`, say so and continue
   anyway — miscategorized requests happen.
2. `zammad articles $1` — extract: software + version, target system
   (VSC/MUSICA/GH), OS stack, GPU need, urgency. Quoted mail chains are
   context, not signal.
3. Precedent search — widen in passes, stop when you have enough:
   1. `state.name:closed AND group.name:"software package" AND <software>`
   2. same software, all groups: `state.name:closed AND <software>` —
      SLURM / Login / General Support tickets are not install requests but
      often carry install discussion or environment clues.
   3. keyword variants if still thin: module name, binary, Python package,
      error signature.
   Open `articles` only on genuinely relevant hits: what install mode was
   used, what went wrong. Note which pass produced your evidence.
4. Check agent-context for prior arcs on this software (asc-software-stack
   areas, eb-dev skill).

## Deliverable

Short note into the matching agent-context area:
**request** (one line) → **verdict**: container | venv | EasyBuild (existing
module | new recipe) → **evidence** (ticket numbers, which search pass, doc
paths) → **suggested tags** for classification (prefer tags already in use;
invent sparingly) → **risks / open questions** → **suggested first reply** to
the requester.

## Don't

- No Zammad writes, no state changes, no building. Triage only.
- Do not treat other groups' tickets as install requests; cite them as
  context, not precedent.

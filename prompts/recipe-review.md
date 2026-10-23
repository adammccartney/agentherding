---
description: Evaluate the EasyBuild build route for a piece of software and open the install ledger entry
argument-hint: "<name-version> [toolchain] [system] [ticket]"
---
Build-route evaluation for: $@

Establish first (ask if not clear from $@):
software + exact version · toolchain generation (e.g. foss/2025b) · target
stack (VSC/MUSICA/GH) · accel variant (CPU tree, accel/nvidia/cc90, or both) ·
originating Zammad ticket number (provenance only).

Load the eb-dev skill before touching recipes.

## Steps

1. **Prior arcs** — agent-context asc-software-layer area and its .pi/todos.
   Reuse lessons (dep-trio coherence, accel subdir conventions, sm policy);
   preserve negative results.
2. **Upstream survey** — easybuild-easyconfigs develop. Closest recipe?
   Generation gap? Open PRs? Easyblock, patch set, dep list. Note the survey
   date.
3. **Route decision**, per axis with reasons; reject loudly:
   - toolchain (foss vs NVHPC vs …) — wrong-compiler routes die here, with
     the reason on record;
   - external CUDA/cuDNN as SYSTEM vs tree-built — take one answer per lane;
   - compute-capability policy (autodetect 9.0a → sm_90a vs pinned entries +
     `cuda-sanity-check-accept-missing-ptx`);
   - placement: CPU tree vs accel subdir.
4. **Port vs write** — fork the closest upstream recipe or start fresh;
   check python dep-set alignment with sibling lanes (PyTorch/TF generation
   coherence — no cross-generation mixing).
5. **Risks** — hooks interplay (asc_eb_hooks.py), build-system friction
   (bazel pins, vendored deps), test cost scoping.

## Deliverable

A route note for asc-software-stack/asc-software-layer:
**upstream survey → decisions table (adopt | port | patch | write | reject,
per axis) → plan checklist → risks → open questions → negative results**.
Then create the implementation todo in the area's .pi/todos ledger (status
open, linking the ticket and this note) — and stop for approval. Nothing
builds here; execution happens in the implementation step (today: a normal
session; later: delegated to the easybuild scout/worker subagents).

## Don't

- No builds, no recipe commits, no easyconfig edits.
- No verdict without the upstream survey.

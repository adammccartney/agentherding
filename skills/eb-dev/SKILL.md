---
name: eb-dev
description: Bootstrap and use an EasyBuild development environment on HPC hosts (LiSC/MUSICA nodes, sandbox VMs). Scripted lua/luarocks/tcl/bc + Lmod bootstrap, per-task dev-env scaffolding, easyconfig work loop, and the site-specific traps (from-pr ordering, SYSTEM-filtered loads, EULA packages, host-image boost-devel, EESSI accel interplay). Use when authoring, validating, or testing EasyBuild recipes without EESSI's prebuilt lmod.
---

# eb-dev — EasyBuild development environments

Stand up a repeatable EasyBuild dev environment on hosts that lack a site-provided lmod, then work recipes through the site-proven loop. Provenance: TODO-3711c47c, LiSC + PyTorch/foss-2025b arc (2026-10).

## Lmod bootstrap

`scripts/lmod-bootstrap.sh <prefix>` builds the chain lua → luarocks(+luaposix, luafilesystem) → tcl → bc → Lmod, root-free, sha256-pinned per fetched tarball. Proven end-to-end 2026-10-22 on test1 (Fedora 44 Cloud, no sudo, no zlib-devel): Lmod 9.4 green including `module load` smoke.

```bash
scripts/lmod-bootstrap.sh /srv/eb-dev/lmod-toolchain   # one toolchain prefix
source /srv/eb-dev/lmod-toolchain/lmod/9.4/init/profile
module --version
```

Profiles:

| profile | lua/tcl/bc | lmod | status |
|---|---|---|---|
| `source` (default) | all from source, pinned | from source, links own tcl, bakes lua paths | proven |
| `distro` | dnf packages (`lua`, `luarocks`, `tcl`) | from source | **designed, not implemented** — payload verified 2026-10-22: luarocks 3.9.2 (EPEL asc-rocky-10, Fedora 44 repo); lua 5.4.6 AppStream (Rocky 10), 5.4.8 @System (Fedora 44). Package set + whether Lmod links distro lua still open (see script header). |

Site traps the bootstrap dodges, each cost ≥1 trial; read script comments before "fixing":

- **tcl 9.0.2 + no zlib-devel**: configure picks the bundled zlib, compiles its objects into libtcl, but never adds `-Icompat/zlib` to generic compile lines → `tclEvent.c` dies on `zlib.h`. Fix: `EXTRA_CFLAGS=-I<src>/compat/zlib` on the make line. `--enable-zipfs=no` alone does NOT suffice.
- **`make generic` lua**: ANSI build, no `io.popen`, no `dlopen` → luarocks aborts. Use the `linux` target (POSIX+dlopen, no readline).
- **Lmod needs `bc`** at configure AND runtime (bc-gh builds with bare cc, unlike GNU bc's flex/bison).
- **`--prefix` rule**: Lmod appends `lmod/<ver>` itself; pass the parent or the layout doubles.

## Dev-environment scaffolding

`scripts/ebdev-mk <topic>` materializes the per-task layout. Envs are short-lived and single-purpose.

- sandbox/VM: `/srv/eb-dev/<topic>/` — admin contract per machine: `sudo install -d -o ad -g ad /srv/eb-dev` once. **Never** under `~/src` or `~/agent-context` (both rsync).
- cluster: `EBDEV_BASE="$SCRATCH" scripts/ebdev-mk <topic>` → `${SCRATCH}/EasyBuild-<topic>/` (live convention).

## Running EB

- **sandbox (ephemeral)**: `uvx --from 'easybuild==5.4.1' eb ...` — no install, pin explicit.
- **cluster (persistent)**: EB_VENV inside the env dir, used with EESSI-extend so EB resolves against the layered stack; full dependency resolution happens cluster-side **by design** — the sandbox parses, the cluster resolves.

## Recipe work loop

1. clone trio into `clones/` (easybuild framework, easyconfigs, easyblocks — dev branches), edit recipe.
2. Local validation gates: parse gate; unknown-parameter registry check; poser-test discipline (fake dependencies stand in for unresolved ancestors).
3. Vendoring two surfaces, do not conflate: **canonical mirror** (`sources/`, sha256-stamped, `SHA256SUMS`) vs **as-run surface** (what the eb invocation actually consumed).
4. Full resolution + build on cluster, receipts timestamped under `logs/`.

## Site traps checklist (recipe work)

- **from-pr append-last**: EasyBuild appends the PR's easyconfigs to the robot search path LAST. If a same-named recipe exists in cloned easyconfigs, the robot may silently pick the wrong one. Enforce robot-path order explicitly; confirm with `eb --dry-run --search-paths` / robot-path echo before test builds.
- **SYSTEM-filtered module loads**: modules shipping in the OS image can shadow or satisfy deps with `SYSTEM` toolchain treatment; check `module avail`/spider shape before declaring a dep missing.
- **EULA set**: cuDNN and Intel-oneAPI packages gate source fetch behind license acceptance; fetch path differs from normal vendoring — confirm `eb --fetch` actually landed content, not a EULA stub page.
- **host-image boost-devel**: OS-provided boost-devel in the image lets `find_package(Boost)` succeed against the wrong Boost; pin explicit Boost dependency/version in the easyconfig or the build opportunistically links the image copy.
- **EESSI accel 4-step** for GPU builds atop EESSI: (1) hermetic unset of inherited accel env, (2) explicit accelerator target (compute capabilities), (3) `module unuse` of the EESSI accel modulepath so it stops shadowing, (4) explicit accel path in the build commands. Skipping (3) is the classic silent-wrong-GPU-deps failure.
- **zipfs/zlib (bootstrap)**: see trap above; latent in any tcl-from-source recipe too.

## Ledger habit

Keep trial receipts: each failed run gets a log (`/tmp/lmod-trial-*.log` pattern) and a one-line root-cause entry. Three harness trials preceded the green bootstrap; the receipts, not memory, drove the fixes.

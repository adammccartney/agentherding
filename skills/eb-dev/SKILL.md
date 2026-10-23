---
name: eb-dev
description: Author and validate EasyBuild easyconfigs — per-task dev envs on an lmod-bootstrapped host (this sandbox included), style.py/test-suite/eb-parse validation loop, NO builds in the sandbox (builds go to the future build machine). Scripted lua/luarocks/tcl/bc + Lmod bootstrap, and the site-specific traps (from-pr ordering, SYSTEM-filtered loads, EULA packages, host-image boost-devel, EESSI accel interplay). Use when authoring, validating, or testing EasyBuild recipes without EESSI's prebuilt lmod.
---

# eb-dev — EasyBuild development environments

Stand up a repeatable EasyBuild dev environment on hosts that lack a
site-provided lmod, then work recipes through the site-proven loop.

## Sandbox scope

Author and **validate** easyconfigs here: lint (style.py), the easyconfigs
test suite, `eb --dry-run` / `--check-*`. **Never run builds in the
sandbox** — builds belong to the (future) API-fronted build machine; the
agent has no remote access (deny-remote policy).

Provenance: `./scripts/install-EasyBuild-develop.sh` is a verbatim copy of
upstream <https://github.com/easybuilders/easybuild-framework/blob/main/easybuild/scripts/install-EasyBuild-develop.sh>,
re-synced 2026-10-23 from the librarian cache (upstream commit 136bfd14e)
after an earlier HTML-page truncation was found and replaced. Drift check =
the cache's fetch date. Use it only for the fork/PR flow (see scaffolding).

## Lmod bootstrap

`scripts/lmod-bootstrap.sh [prefix]` builds the chain lua →
luarocks(+luaposix, luafilesystem) → tcl → bc → Lmod, root-free,
sha256-pinned per fetched tarball. Proven end-to-end 2026-10-22 on test1
(Fedora 44 Cloud, no sudo, no zlib-devel): Lmod 9.4 green including
`module load` smoke. Default prefix: `/opt/lmod-toolchain` — FHS
add-on software area (the site's /opt-wide convention, cf. slurm).
test1 (this sandbox) is bootstrapped; the selector symlink
`/opt/lmod-toolchain/lmod/lmod` → `9.4` is live.

**.sources rule: always check the default path first** — before any fetch,
look in `/opt/lmod-toolchain/.sources/` for the version-pinned tarball
(LiSC images may ship it pre-populated); download only on miss.
Placement history: /srv/eb-dev (FHS-miscast) → /opt/eb-dev (user call) →
$HOME/eb-dev for workspaces (final: dev envs are user data; /opt stays
the toolchain home only).

**TACC `/opt/apps` convention (the upstream archetype of this shape, doc-
cited)**: Lmod's own install guide (TACC-authored) — "it is assumed that
all optional software is going to be installed in /opt/apps". The idiom:
per-package version-isolated payload dirs (`/opt/apps/lua/X.Y.Z`,
`/opt/apps/lmod/X.Y`), a **current-selector symlink per package**
(`/opt/apps/lua → X.Y.Z`, `/opt/apps/lmod/lmod → <ver>`) with boot wiring
pointing at the selector and not the version
(`/etc/profile.d/z00_lmod.sh`, z-ordered after other profile.d), and
modulefiles as a sibling tree (`/opt/apps/modulefiles/{Linux,Core}`).
Upgrade = repoint the symlink; nothing user-facing hardcodes a version.
Our `/opt/lmod-toolchain` is the deliberately narrower single-toolchain
specialization; the selector-symlink layer is future-proofing we have
not yet adopted (our starter docs still hardcode `…/lmod/9.4/init/profile`
— when that changes, `ln -s <ver> lmod` is the TACC-faithful fix).
(Lmod docs, 030_installing.html; read as authority, not lore.)

Admin once per machine: `sudo install -d -o $USER -g $USER /opt/lmod-toolchain`.

```bash
scripts/lmod-bootstrap.sh                 # -> /opt/lmod-toolchain
source /opt/lmod-toolchain/lmod/9.4/init/profile
module --version
```

Profiles:

| profile            | lua/tcl/bc                                                       | lmod                                        | status                                                                  |
| ---                | ---                                                              | ---                                         | ---                                                                     |
| `source` (default) | all from source, pinned                                          | from source, links own tcl, bakes lua paths | proven                                                                  |
| `distro`           | dnf (sudo), incl. `tcl-devel`; rocks as RPMs — luarocks unneeded | from source, plain pkg-config tcl probe     | **implemented 2026-10-22** — unified set verified on
|                    |                                                                  |                                             | both targets: `lua lua-devel lua-posix lua-filesystem tcl               |
|                    |                                                                  |                                             | tcl-devel bc` (Fedora 44: 5.4.8/5.4.8/36.3/1.8.0/9.0.2/1.08.2;          |
|                    |                                                                  |                                             | Rocky 10 via AppStream+CRB+EPEL+BaseOS: 5.4.6/5.4.6                     |
|                    |                                                                  |                                             | (CRB!)/36.2.1/1.8.0/8.6.13/1.07.1). lua-devel needed because            |
|                    |                                                                  |                                             | no-`term`-module Lmod builds its bundled lua-term (needs lua.h); real   |
|                    |                                                                  |                                             | lua knobs are `--with-lua=/--with-luac=/--with-lua_include=`. Real-host |
|                    |                                                                  |                                             | runs 2026-10-22 on test1 exposed both findings before the final set     |
|                    |                                                                  |                                             | landed; first green rerun pending. tcl decision: DISTRO — Lmod          |
|                    |                                                                  |                                             | accepts 8.4+, distro tcl sidesteps the bundled-zlib traps (Lmod's probe |
|                    |                                                                  |                                             | overrides PKG_CONFIG_PATH with the tcl.pc dir, which on real distros    |
|                    |                                                                  |                                             | also holds zlib.pc). Doc trap: Lmod INSTALL's "Lua 5.1–5.3" is stale;   |
|                    |                                                                  |                                             | real gate configure.ac:1013 = 5.1..5.5 (see script header).             |

Site traps the bootstrap dodges, each cost ≥1 trial; read script comments before "fixing":

- **tcl 9.0.2 + no zlib-devel**: configure picks the bundled zlib,
  compiles its objects into libtcl, but never adds `-Icompat/zlib`
  to generic compile lines → `tclEvent.c` dies on `zlib.h`. Fix:
  `EXTRA_CFLAGS=-I<src>/compat/zlib` on the make line. `--enable-zipfs=no`
  alone does NOT suffice.
- **`make generic` lua**: ANSI build, no `io.popen`, no `dlopen` → luarocks aborts. Use the `linux` target (POSIX+dlopen, no readline).
- **Lmod needs `bc`** at configure AND runtime (bc-gh builds with bare cc, unlike GNU bc's flex/bison).
- **`--prefix` rule**: Lmod appends `lmod/<ver>` itself; pass the parent or the layout doubles.

## Dev-environment scaffolding

1. Scaffold: `bash scripts/ebdev-mk <topic>` → `$HOME/eb-dev/<topic>/` with
   `clones/ sources/ logs/ venv/ modules/`, an `EasyBuild-develop`
   modulefile, and an `activate` file. Scripts live next to this SKILL.md
   (never `~/scripts`). Env roots stay OUT of `~/src` (incl. the mounted
   `~/src/sandbox`) and `~/agent-context`. Machine-level roots override via
   `EBDEV_BASE` (e.g. `/var/tmp/eb-dev` — tmpfiles' 30-day reaping).
2. Fill the repos — two paths, do not mix in one env:
   a. validation (default, offline-friendly): clone into `<env>/clones/` with
      local object reuse from the librarian cache:
      `git clone --reference ~/.cache/checkouts/github.com/easybuilders/<r> git@github.com:easybuilders/<r>.git`
      for r ∈ {easybuild-framework, easybuild-easyblocks, easybuild-easyconfigs}.
   b. fork/PR flow: `bash scripts/install-EasyBuild-develop.sh <GITHUB_USER> <env>`
      clones your forks (ssh) at the env ROOT and refreshes the modulefile.
      GITHUB_USER: infer from origin's github user; ask if unsure.
3. Activate in EVERY agent bash call (shells are non-persistent):
   `source <env>/activate && eb --version`

## Running EB

- **sandbox (dev install, default)**: `source <env>/activate` → `eb ...` via the loaded EasyBuild-develop.
- **sandbox (ephemeral, no env)**: `uvx --from 'easybuild==5.4.1' eb ...` — no install, pin explicit.

## Recipe work loop (validation only — never builds)

1. Lint: `python <env>/clones/easybuild-easyconfigs/test/easyconfigs/style.py`
   on the new/changed easyconfigs.
2. Targeted suite: from the easyconfigs checkout,
   `python -m test.easyconfigs.suite` — select the relevant tests; a full
   run is slow.
3. Parse/plan checks: `eb --dry-run <ec>`; `eb --check-*` variants as needed.
4. Codemode: drive runs from a codemode script and return only the failing
   step + error lines — the suite prints thousands of lines.

Builds (`eb <ec>`) never happen here; they go to the future build machine.

## Ledger habit

Keep trial receipts: each failed run gets a log (`/tmp/lmod-trial-*.log`
pattern) and a one-line root-cause entry. Three harness trials preceded
the green bootstrap; the receipts, not memory, drove the fixes.

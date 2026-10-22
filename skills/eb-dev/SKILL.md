---
name: eb-dev
description: Bootstrap and use an EasyBuild development environment on HPC hosts (LiSC/MUSICA nodes, sandbox VMs). Scripted lua/luarocks/tcl/bc + Lmod bootstrap, per-task dev-env scaffolding, easyconfig work loop, and the site-specific traps (from-pr ordering, SYSTEM-filtered loads, EULA packages, host-image boost-devel, EESSI accel interplay). Use when authoring, validating, or testing EasyBuild recipes without EESSI's prebuilt lmod.
---

# eb-dev — EasyBuild development environments

Stand up a repeatable EasyBuild dev environment on hosts that lack a
site-provided lmod, then work recipes through the site-proven loop.

The basic procedure is to run the `./scripts/install-EasyBuild-develop.sh`
This script is a hard copy of the upstream
<https://github.com/easybuilders/easybuild-framework/blob/main/easybuild/scripts/install-EasyBuild-develop.sh>
There **may** be version drift between the local copy and upstream over time.
We can periodically check for updates (once per new easybuild release), 
and pull the new version if there are changes.

## Lmod bootstrap

`scripts/lmod-bootstrap.sh [prefix]` builds the chain lua →
luarocks(+luaposix, luafilesystem) → tcl → bc → Lmod, root-free,
sha256-pinned per fetched tarball. Proven end-to-end 2026-10-22 on test1
(Fedora 44 Cloud, no sudo, no zlib-devel): Lmod 9.4 green including
`module load` smoke. Default prefix: `/opt/lmod-toolchain` — FHS
add-on software area (the site's /opt-wide convention, cf. slurm)

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


The invocation of the development script is 

`bash ~/scripts/install-EasyBuild-develop.sh <GITHUB_USER> <INSTALL_PREFIX>`

The skill should ask for input about
+ GITHUB_USER (this can be inferred from the github user of the remote `origin` of the repo
  containing this SKILL.md). This inferral can take place during the installation of the skill
  i.e. the skill in `~/.pi/skills` won't convey the required info. Ask the user if unsure.
+ `<INSTALL_PREFIX>` is typically something like `EasyBuild-<topic>`
  - sandbox/VM: `$HOME/eb-dev/EasyBuild-<topic>/` — zero admin; 
    **never** under `~/src` (incl. the container-mounted `~/src/sandbox`) or
    `~/agent-context` (both sync/mount). This is the same FHS re-cast as the
    toolchain: workspaces are a user's local working data; `/srv` was wrong
    there too (slurm pattern: build env in home, install in `/opt`).
- machine-level installs that must span users stay overridable via `EBDEV_BASE` (e.g. `/var/tmp/eb-dev` — mind systemd-tmpfiles' 30-day reaping).

## Running EB

- **sandbox (ephemeral)**: `uvx --from 'easybuild==5.4.1' eb ...` — no install, pin explicit.

## Recipe work loop

1. run the install script to clone the required repos (easybuild framework, easyconfigs, easyblocks — dev branches)
2.
 + easybuild-easyconfigs/test/easyconfigs/style.py is the way to perform linting on easyconfigs
 + easybuild-easyconfigs/test/easyconfigs/suite.py will run the test suite

## Ledger habit

Keep trial receipts: each failed run gets a log (`/tmp/lmod-trial-*.log`
pattern) and a one-line root-cause entry. Three harness trials preceded
the green bootstrap; the receipts, not memory, drove the fixes.

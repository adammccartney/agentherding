# Runbook: Prospero engine in the VM, GUI on the laptop

Prospero splits into a **window** (the GUI on the laptop) and an
**engine** (the headless host in the VM). The window connects to the VM
over ssh, where it runs `prospero attach`; that starts a persistent host
(`prospero serve`) behind a per-user socket in the VM's state directory.
Sessions run in the VM, under the VM's own configuration — which matters,
because only the VM can reach both model endpoints (`10.77.29.5` is a
private VSC address; Aqueduct is on the TU Wien network). The laptop can
roam anywhere; the session's model picker shows the VM's models.

Versions must match on both sides (protocol errors are otherwise
"operations disabled" in the window). This runbook pins **main@c429cd9**
(2026-11-01, "Rewind to here takes the conversation back too"): the VM
engine is a source build of that commit, newer than release v0.10.0, so
the laptop builds from the same commit rather than using a release.

VM facts, gathered 2026-11-01:

- x86_64, glibc 2.43, hostname `test1`, guest IP 10.0.2.15 (QEMU user-NAT
  address — see step 1)
- sshd active on :22
- cmake 4.3, gcc 16.2.1 (supports `#embed`)
- **engine already built** 2026-11-01: `~/src/github.com/skeeto/prospero`
  at main@c429cd9, headless (`PROSPERO_GUI=off`, dynamic), binary at
  `~/src/github.com/skeeto/prospero/build/prospero` — verified running
- config already in place: `~/.config/prospero/prospero.ini` → symlink to
  this repo's `prospero/prospero.ini`, endpoints `asc` and `aqueduct`

Placeholders: `<vm>` is whatever ssh name the laptop uses to reach the VM
(Host stanza in the laptop's `~/.ssh/config`); `<user>` is `ad`.

## 1. Laptop → VM ssh (prerequisite)

The VM's only address is 10.0.2.15, the default QEMU user-mode NAT
address: not routable from the laptop. Expose sshd one of these ways,
once:

- **Host port-forward**: run QEMU with `-netdev user,hostfwd=tcp::2222-:22`
  and add to the laptop's `~/.ssh/config`:

      Host vm
          HostName 127.0.0.1
          Port 2222
          User ad

- **libvirt/bridge NAT**: give the VM a reachable address
  (`virsh domifaddr <domain>`) and use that as HostName.

Verify from the laptop:

    ssh vm 'echo ok'            # prints ok
    ssh vm 'command -v prospero || echo not-yet'

## 2. VM: engine — done (source build)

Built from `~/src/github.com/skeeto/prospero` (main@c429cd9) with
`PROSPERO_GUI=off`, headless as a VM engine wants. The laptop's
`[remote vm]` `path` (step 4) points straight at the build tree:
`/home/ad/src/github.com/skeeto/prospero/build/prospero`. Absolute path
is required either way: a non-interactive ssh session gets sshd's
default PATH, so a bare `path = prospero` would not be found.

Tradeoffs, pick as needed:

- **Frozen copy**: `install -Dm755 build/prospero ~/.local/bin/prospero`
  and use that as `path` instead, so a wiped or rebuilt build tree
  cannot break or silently change a connected setup.
- **Rebuild after pulling main**: `git -C ~/src/github.com/skeeto/prospero pull`
  then `cmake --build ~/src/github.com/skeeto/prospero/build -j$(nproc)`
  updates the binary in place — and rebuild the laptop from the same
  commit before connecting again.

Fallback (not recommended while following main): release v0.10.0
predates this build, so a release engine risks a protocol mismatch with
the laptop's main build.

## 3. VM: keys as files (not env vars)

The engine starts under `ssh -T`, which carries neither your login
profile nor the shell's `VLLM_API_KEY` / `OPENAI_API_KEY`. Prospero's
`file:` key source exists for exactly this ("an engine whose environment
you cannot set, such as one on a remote host"). Once:

    mkdir -p ~/.config/prospero/keys
    printf '%s' "$VLLM_API_KEY"   > ~/.config/prospero/keys/asc.key
    printf '%s' "$OPENAI_API_KEY" > ~/.config/prospero/keys/aqueduct.key
    chmod 600 ~/.config/prospero/keys/*.key

The key files stay in the VM home only — never in this repo. Then switch
the two endpoint lines in `prospero/prospero.ini` (this repo):

    [endpoint asc]
    url = http://10.77.29.5:8000/v1/
    key = file:~/.config/prospero/keys/asc.key

    [endpoint aqueduct]
    url = https://aqueduct.ai.datalab.tuwien.ac.at/v1/
    key = file:~/.config/prospero/keys/aqueduct.key

`file:` keys work for interactive use too, so nothing else changes.

Optional, in the same file: keep the host alive longer when the laptop
drops between turns (default is 10 min idle; reconnect grace is 3 h
either way).

    [host]
    idle_exit = 3600

Sanity-check the asc endpoint from the VM (private address; only works here):

    curl -fsS -H "Authorization: Bearer $(cat ~/.config/prospero/keys/asc.key)" \
         http://10.77.29.5:8000/v1/models | head -c 400

## 4. Laptop: GUI (same commit) + remote entry

Build the GUI from source off **the same commit** so the protocols
match (release v0.10.0 is older than the VM's engine):

    git clone https://github.com/skeeto/prospero
    cd prospero && git checkout c429cd9
    cmake -B build                 # GUI on by default
    cmake --build build -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

On macOS the build wraps `Prospero.app` in the build directory; on
Linux the GUI binary runs where X11/Wayland exist; Windows builds use
the w64devkit toolchain files (docs/building.md).

Then add to the laptop's own `~/.config/prospero/prospero.ini`:

    [remote vm]
    ssh = vm
    path = /home/ad/src/github.com/skeeto/prospero/build/prospero
    deploy = ask
    list = connected

- `path` is the build-tree binary from step 2 (or its frozen
  `~/.local/bin` copy), so the laptop never needs to deploy an engine:
  a self-built GUI is its own engine only for its own platform, and
  GitHub releases carry no Linux engine for it to upload.
- `list = connected` keeps `vm` out of the sidebar until attached;
  drop it if you want the entry always visible.

(The window's Hosts panel can add the same remote interactively instead.)

## 5. Connect and verify

1. Start Prospero on the laptop. The first run shows Help; Settings
   opens when no model is configured locally — expected: models come
   from the VM host.
2. Hosts panel → `vm` → Connect. The window runs
   `ssh -T vm /home/ad/src/github.com/skeeto/prospero/build/prospero attach`,
   which starts the VM host if none runs. A broken link resumes where it
   left off; the host keeps the window's place for 3 h.
3. In the VM, confirm the host: `~/src/github.com/skeeto/prospero/build/prospero hosts`
   lists it.
4. New session: pick a VM directory (the dialog's Browse lists VM
   folders), model `asc/moonshotai/Kimi-K3`, send a short prompt. The
   model picker lists exactly the VM config's models — asc and aqueduct.

The VM host keeps running after the window closes (it exits after
`idle_exit` with no client and nothing running). Closing the laptop
window with "Keep running in background" applies to the laptop process
only; VM-side turns continue regardless, and asks with nobody to answer
time out and are denied — answer them before walking away, or use plan
mode, where questions wait indefinitely.

## Day two

- **Upgrade**: `git pull` the VM checkout to a new main, rebuild the
  VM engine, then pull and rebuild the laptop to the same commit before
  connecting. Mismatched protocol: operations the older side lacks show
  disabled; a host's menu has Update engine once nothing runs.
- **Host restart**: on the VM, `build/prospero hosts` shows running
  hosts; a host quits cleanly on SIGTERM.
- **Config changes**: edit `prospero/prospero.ini` in this repo (read
  again at once by a running engine) — commit to keep both machines'
  history honest.

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Connect fails instantly | wrong `path`, or non-absolute path | `ssh vm /home/ad/src/github.com/skeeto/prospero/build/prospero hosts` |
| Connect fails, offers "Deploy engine" | `path` unset and no engine found | set absolute `path` (step 4) |
| Sessions fail: 401/403 at endpoint | engine read no key (env not exported under `ssh -T`) | step 3 `file:` keys; `chmod 600` |
| Sessions fail: endpoint timeout | `asc` is VSC-internal, reachable from the VM only | `curl … /v1/models` from step 3, run in the VM |
| Model picker empty | endpoints unreachable or keyless | engine diagnostics pane; endpoint `curl` checks |
| Feature greyed out after upgrade | laptop/VM commit mismatch | both on the same main commit |
| ssh works interactively but Prospero cannot connect | proxy/jump entries missing for `vm`, or sshd env | `ssh -T vm true` non-interactively |

Reference: `docs/remote.md`, `docs/usage.md`, `docs/configuration.md` in
`~/src/github.com/skeeto/prospero/docs`.

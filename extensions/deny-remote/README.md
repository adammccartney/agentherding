# deny-remote

Hard policy gate on the agent's `bash` tool: **no remote execution from the
sandbox**.

| Blocked                                   | Allowed                                     |
| ---                                       | ---                                         |
| `ssh`, `scp`, `sftp`, `mosh`, `sshfs`, `sshpass`, `ssh-copy-id` (any shell segment, incl. after `sudo`, env prefixes, pipes, `bash -c`) | `ssh-keygen`, `ssh-add`, `ssh-agent` (local key management) |
| `rsync` with remote syntax (`host:path`, `-e ssh`) | `rsync` local-to-local                     |
| `ansible` ad-hoc without `--list-*`, `ansible-playbook` without `--syntax-check`/`--list-*` (incl. `--check` — dry-run still connects) | `ansible-doc`, `ansible-lint`, `ansible-galaxy`, `ansible-playbook --syntax-check`/`--list-tasks`/`--list-hosts`/`--list-tags`, `ansible --list-hosts` |
|                                           | `git` over ssh (transport, not remote exec) |

Design note: remote access enters only through purpose-built tools — the
`zammad` extension today, an API-fronted build machine (sami behind a web
interface) tomorrow. Such a service lands as a *tool*, never as an ssh
exception, so this gate keeps no escape hatch.

This is policy, not a security boundary: a determined model can obfuscate
past token matching; the sandbox VM remains the isolation layer. The gate's
block reason explicitly tells the model not to retry with obfuscation.

Rules live in `guard.ts` (pure, node-testable). To change policy — e.g. to
permit one allowlisted build host later — edit the constants there.

/**
 * deny-remote guard — pure command-inspection logic, no pi imports.
 *
 * Policy: the agent's bash never reaches remote machines from the sandbox.
 * Remote execution enters only through purpose-built tools (the zammad tool
 * today; an API-fronted build machine for sami tomorrow) — never through an
 * ad-hoc shell.
 *
 * Matched as command words of any shell segment (handles ;, |, &&, ||,
 * backticks, $(...), newlines, env-prefixes and sudo-style prefixes):
 *   ssh, scp, sftp, mosh, sshfs, sshpass, ssh-copy-id
 * Special cases:
 *   rsync with remote syntax (user@host:path, host:path, -e ssh)
 *   ansible            — ad-hoc commands are always remote: block
 *   ansible-playbook   — block unless --syntax-check (only offline form)
 *   sh|bash -c "..."   — payload is inspected recursively
 * Local members of the ssh family (ssh-keygen, ssh-add, ssh-agent) are
 * different tokens and never match. git over ssh stays free: transport to a
 * remote runs upload-pack/receive-pack there, not arbitrary commands.
 *
 * This is a policy gate, not a security boundary — it stops the agent from
 * *choosing* remote execution; the sandbox VM remains the real isolation.
 */

export interface GuardHit {
	fragment: string;
	rule: string;
}

const BLOCKED_TOKENS = new Set(["ssh", "scp", "sftp", "mosh", "sshfs", "sshpass", "ssh-copy-id"]);

const PREFIX_TOKENS = new Set(["sudo", "doas", "command", "builtin", "time", "env", "nohup", "exec", "nice"]);

// flags of prefix commands that consume the following token as their argument
const PREFIX_FLAGS_WITH_ARG = new Set(["-u", "-g", "-h", "-p", "-C", "-T", "-U"]);

const SHELL_SEGMENTS = /;|&&|\|\||\||`|\$\(|\n/;

function basename(token: string): string {
	const i = token.lastIndexOf("/");
	return i === -1 ? token : token.slice(i + 1);
}

function segmentTokens(segment: string): string[] {
	// naive whitespace split; good enough for leading tokens
	return segment.trim().split(/\s+/).filter(Boolean);
}

function commandWord(tokens: string[]): { word: string; rest: string[] } {
	let i = 0;
	while (i < tokens.length) {
		const t = tokens[i];
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; } // env assignment
		if (PREFIX_TOKENS.has(basename(t))) { i++; continue; }
		if (/^-/.test(t)) {
			// flag of a prefix token; some consume the following token as their argument
			i++;
			if (PREFIX_FLAGS_WITH_ARG.has(t) && i < tokens.length) i++;
			continue;
		}
		break;
	}
	return { word: i < tokens.length ? basename(tokens[i]) : "", rest: tokens.slice(i + 1) };
}

const RSYNC_REMOTE = /(^|\s)([\w.-]+@)?[\w.-]+:\S/;
const SHELL_C = /^(?:sh|bash|zsh|dash)\s+.*?-c\s+(['"])([\s\S]*)\1/;

export function findBlock(command: string, depth = 0): GuardHit | null {
	if (depth > 3) return null;
	for (const rawSegment of command.split(SHELL_SEGMENTS)) {
		const segment = rawSegment.trim();
		if (!segment) continue;

		// sh -c "..." — inspect the payload
		const shellC = segment.match(SHELL_C);
		if (shellC) {
			const inner = findBlock(shellC[2], depth + 1);
			if (inner) return inner;
			continue;
		}

		const { word, rest } = commandWord(segmentTokens(segment));
		if (!word) continue;

		if (BLOCKED_TOKENS.has(word)) {
			return { fragment: segment.length > 60 ? segment.slice(0, 60) + "…" : segment, rule: word };
		}
		if (word === "rsync" && (RSYNC_REMOTE.test(segment) || /\s-e\s+(['"]?)ssh\b/.test(segment))) {
			return { fragment: segment.length > 60 ? segment.slice(0, 60) + "…" : segment, rule: "rsync remote" };
		}
		if (word === "ansible") {
			return { fragment: segment.slice(0, 60), rule: "ansible ad-hoc (always remote)" };
		}
		if (word === "ansible-playbook" && !rest.includes("--syntax-check")) {
			return { fragment: segment.slice(0, 60), rule: "ansible-playbook without --syntax-check" };
		}
	}
	return null;
}

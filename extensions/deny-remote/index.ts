/**
 * deny-remote — hard policy gate: no remote execution from the agent's bash.
 *
 * Blocks ssh-family commands, rsync remote syntax, and remote-capable
 * ansible invocations before they run (see guard.ts for the exact rules and
 * the reasoning). Policy, not a security boundary: the sandbox VM is the
 * real isolation; this keeps the agent from choosing remote access as a
 * routine path.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findBlock } from "./guard.js";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string | undefined;
		if (!command) return undefined;

		const hit = findBlock(command);
		if (!hit) return undefined;

		const reason =
			`deny-remote: blocked (${hit.rule}): "${hit.fragment}". ` +
			`Remote execution from this sandbox is not allowed — remote access enters only ` +
			`through purpose-built tools (the zammad tool today; an API-fronted build machine ` +
			`is the intended shape for builds). Do not retry with obfuscation; if this step is ` +
			`genuinely needed, report it to the user so they can run it themselves.`;

		if (ctx.hasUI) {
			ctx.ui.notify(`deny-remote: blocked ${hit.rule}`, "warning");
		}
		return { block: true, reason };
	});
}

/**
 * Sandbox Workflow Extension
 *
 * Provides a sandboxed environment for agent experimentation:
 * - Copy repositories to sandbox location
 * - Create AGENTS.md with sandbox constraints
 * - Block all writes/edits outside sandbox
 * - Sync changes from original repo to sandbox
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";

interface SandboxState {
	sandboxPath?: string;
	originalPath?: string;
	initialized: boolean;
}

const STATE_KEY = "sandbox-workflow-state";

function expandTilde(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	if (path === "~") {
		return homedir();
	}
	return path;
}

function normalizePath(path: string): string {
	return resolve(expandTilde(path));
}

function getSandboxBase(): string {
	return normalizePath("~/src/sandbox");
}

function extractRepoName(path: string): string {
	const normalized = normalizePath(path);
	return normalized.split("/").pop() || "sandbox";
}

function createAgentsMd(sandboxPath: string): string {
	const sandboxName = extractRepoName(sandboxPath);
	return `# Sandbox Constraints

## Rules for this Sandbox

- **Never edit files outside this sandbox** - All write/edit operations must stay within \`${sandboxPath}\`
- **Generated content is experimental** - Only manually copy generated content back to the original repository
- **No destructive commands** - Commands like \`rm -rf\`, \`sudo\`, etc. are blocked for safety

## Sandbox Info

- **Sandbox Path**: \`${sandboxPath}\`
- **Created**: ${new Date().toISOString()}
- **Git Status**: This is a **non-git working copy** (no .git directory)

## Task Tracking

Use \`TASK:\` and \`TASK_DONE:\` markers to track exploration:

\`\`\`markdown
### TASK: Add logging to the auth module
- Investigate current logging approach
- Add structured logging
- Test with sample requests

### TASK_DONE: Add logging to the auth module
- Used winston instead of console.log
- Added request ID tracing
- Tests passing
\`\`\`

**Guidelines:**
- Start a new \`TASK:\` section when exploring a new idea
- Move to \`TASK_DONE:\` when you've explored enough to evaluate
- Add brief notes about what was tried and results
- Keep both TASK and TASK_DONE sections for history

## Workflow

1. Add todos with \`/todo:add <description>\` to track work items
2. View todos with \`/todo:list\`
3. Mark todos done with \`/todo:done <id>\`
4. Optionally use \`TASK:\`/\`TASK_DONE:\` sections for detailed exploration notes
5. When satisfied, manually copy changes to the original repository
6. Use \`/sandbox:sync\` to pull updates from the original repository

## Tasks

<!-- This section is managed by the /todo commands -->

## About This Sandbox

This sandbox is a **git-free working copy** of the original repository. The \`.git\` directory is intentionally excluded because:

- This is a disposable experimentation space, not a fork
- Git state (branches, commits, index) is managed in the original repository
- Submodules are copied as working files without git initialization
- Syncing is simpler without git state conflicts

When you adopt changes, copy them manually back to the original repository and commit there.

The \`TASK\`/\`TASK_DONE\` convention helps you track what ideas were explored in this sandbox. Review \`TASK_DONE\` sections when deciding what to adopt.
`;
}

export default function (pi: ExtensionAPI) {
	let sandboxState: SandboxState = { initialized: false };

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		sandboxState = { initialized: false };
		
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === STATE_KEY) {
				const data = entry.data as Partial<SandboxState>;
				if (data.sandboxPath && data.originalPath) {
					sandboxState = {
						sandboxPath: data.sandboxPath,
						originalPath: data.originalPath,
						initialized: true,
					};
					if (ctx.hasUI) {
						ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("accent", `🔒 Sandbox: ${sandboxState.sandboxPath}`));
					}
					break;
				}
			}
		}
	});

	// Dangerous command patterns
	const dangerousPatterns = [
		{ pattern: /^sudo\b/i, name: "sudo", severity: "block" },
		{ pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)*(-[a-zA-Z]*f[a-zA-Z]*\s+)*[^\s]/i, name: "rm -rf", severity: "block" },
		{ pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r/i, name: "rm -fr", severity: "block" },
		{ pattern: /\bdd\s+/i, name: "dd", severity: "block" },
		{ pattern: /\bmkfs\b/i, name: "mkfs", severity: "block" },
		{ pattern: /\bchmod\s+777/i, name: "chmod 777", severity: "warn" },
		{ pattern: /\bcurl.*\|.*\b(bash|sh)\b/i, name: "curl | bash", severity: "warn" },
		{ pattern: /\bwget.*\|.*\b(bash|sh)\b/i, name: "wget | bash", severity: "warn" },
		{ pattern: /\beval\b/i, name: "eval", severity: "warn" },
		{ pattern: /\b(:\|\|:)/i, name: "fork bomb", severity: "block" },
	];

	function checkDangerousCommand(command: string): { blocked: boolean; reason?: string; warn?: boolean } | null {
		for (const { pattern, name, severity } of dangerousPatterns) {
			if (pattern.test(command)) {
				if (severity === "block") {
					return { blocked: true, reason: `Dangerous command detected: ${name}` };
				}
				if (severity === "warn") {
					return { blocked: false, warn: true, reason: `Potentially dangerous command: ${name}` };
				}
			}
		}
		return null;
	}

	// Path protection - block writes/edits outside sandbox
	pi.on("tool_call", async (event, ctx) => {
		// Handle bash command guards
		if (event.toolName === "bash") {
			if (!sandboxState.initialized || !sandboxState.sandboxPath) {
				return undefined;
			}

			const command = event.input.command as string;
			const check = checkDangerousCommand(command);

			if (check?.blocked) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`Blocked dangerous command:\n  ${command}\n\nReason: ${check.reason}`,
						"error"
					);
				}
				return { block: true, reason: check.reason };
			}

			// For warnings, ask for confirmation
			if (check?.warn && ctx.hasUI) {
				const confirmed = await ctx.ui.confirm(
					"Potentially Dangerous Command",
					`Command: ${command}\n\n${check.reason}\n\nProceed?`
				);
				if (!confirmed) {
					return { block: true, reason: "Cancelled by user" };
				}
			}

			return undefined;
		}

		// Handle write/edit path protection
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		// If sandbox not initialized, allow all (no restrictions yet)
		if (!sandboxState.initialized || !sandboxState.sandboxPath) {
			return undefined;
		}

		const filePath = normalizePath(event.input.path as string);
		const sandboxPath = normalizePath(sandboxState.sandboxPath);

		// Check if file is within sandbox
		const relPath = relative(sandboxPath, filePath);
		const isInside = !relPath.startsWith("..") && !isAbsolute(relPath);

		if (!isInside) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Blocked: Cannot ${event.toolName} outside sandbox\n` +
					`  Attempted: ${event.input.path}\n` +
					`  Sandbox: ${sandboxState.sandboxPath}`,
					"error"
				);
			}
			return {
				block: true,
				reason: `Path "${event.input.path}" is outside the sandbox boundary "${sandboxState.sandboxPath}"`,
			};
		}

		return undefined;
	});

	// Command: /sandbox:create <source-path>
	pi.registerCommand("sandbox:create", {
		description: "Create a new sandbox from a source repository",
		getArgumentCompletions: (prefix: string) => {
			// Could add path completion here
			return null;
		},
		handler: async (args, ctx) => {
			if (!args || args.trim() === "") {
				ctx.ui.notify("Usage: /sandbox:create <source-path>\nExample: /sandbox:create ~/src/gitlab.tuwien.ac.at/vsc/virtualisation/ansible-rke2/", "error");
				return;
			}

			const originalPath = normalizePath(args.trim());

			// Validate source exists
			if (!existsSync(originalPath)) {
				ctx.ui.notify(`Source path does not exist: ${originalPath}`, "error");
				return;
			}

			const repoName = extractRepoName(originalPath);
			const sandboxPath = join(getSandboxBase(), repoName);

			// Confirm with user
			if (!ctx.hasUI) {
				ctx.ui.notify("Sandbox creation requires interactive mode for confirmation", "error");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Create Sandbox",
				`Copy:\n  ${originalPath}\n  →\n  ${sandboxPath}\n\nThis will create AGENTS.md with sandbox constraints.`
			);

			if (!confirmed) {
				ctx.ui.notify("Sandbox creation cancelled", "info");
				return;
			}

			try {
				// Ensure sandbox base directory exists
				const sandboxBase = getSandboxBase();
				if (!existsSync(sandboxBase)) {
					mkdirSync(sandboxBase, { recursive: true });
				}

				// Copy the repository
				ctx.ui.notify(`Copying ${originalPath} to ${sandboxPath}...`, "info");
				
				await pi.exec("cp", ["-a", originalPath, sandboxPath]);

				// Create AGENTS.md
				const agentsPath = join(sandboxPath, "AGENTS.md");
				const agentsContent = createAgentsMd(sandboxPath);
				writeFileSync(agentsPath, agentsContent, "utf-8");

				// Update state
				sandboxState = {
					sandboxPath,
					originalPath,
					initialized: true,
				};

				// Persist state
				pi.appendEntry(STATE_KEY, sandboxState);

				// Update UI
				if (ctx.hasUI) {
					ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("accent", `🔒 Sandbox: ${sandboxPath}`));
				}

				ctx.ui.notify(
					`Sandbox created successfully!\n\n` +
					`  Source: ${originalPath}\n` +
					`  Sandbox: ${sandboxPath}\n` +
					`  AGENTS.md: ${agentsPath}\n\n` +
					`All write/edit operations are now restricted to the sandbox directory.`,
					"success"
				);

			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to create sandbox: ${msg}`, "error");
			}
		},
	});

	// Command: /sandbox:sync
	pi.registerCommand("sandbox:sync", {
		description: "Sync changes from original repository to sandbox",
		handler: async (_args, ctx) => {
			if (!sandboxState.initialized) {
				ctx.ui.notify("No active sandbox. Use /sandbox:create <source-path> first.", "error");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Sandbox sync requires interactive mode for confirmation", "error");
				return;
			}

			const { sandboxPath, originalPath } = sandboxState;

			// Offer sync mode options
			const mode = await ctx.ui.select(
				"Sync Mode",
				[
					"Merge (default) - Copy new/changed files, keep sandbox-only files",
					"Preview only - Show what would change without modifying anything",
					"Cancel",
				]
			);

			if (!mode || mode.startsWith("Cancel")) {
				ctx.ui.notify("Sandbox sync cancelled", "info");
				return;
			}

			const isPreview = mode.startsWith("Preview");

			try {
				ctx.ui.notify(`Analyzing ${originalPath}...`, "info");

				// Use rsync with --dry-run to preview changes
				const rsyncAvailable = await pi.exec("which", ["rsync"], { timeout: 5 }).then(() => true).catch(() => false);

				if (!rsyncAvailable) {
					ctx.ui.notify("rsync is required for sync. Please install it.", "error");
					return;
				}

				// Build rsync command
				const rsyncArgs = [
					"-av",
					"--exclude", "AGENTS.md",
					"--exclude", ".git/",
				];

				if (isPreview) {
					rsyncArgs.push("--dry-run");
				}

				rsyncArgs.push(originalPath + "/", sandboxPath + "/");

				const result = await pi.exec("rsync", rsyncArgs, { timeout: 60 });

				if (isPreview) {
					// Show preview output
					const output = result.stdout?.trim() || "No changes detected.";
					ctx.ui.notify(
						"Sync Preview:\n\n" + output + "\n\n" +
						"Files in the sandbox that don't exist in the original will be KEPT.\n" +
						"Run /sandbox:sync again and select 'Merge' to apply changes.",
						"info"
					);
					return;
				}

				// Confirm before applying
				const confirmed = await ctx.ui.confirm(
					"Apply Sync",
					`Sync changes from:\n  ${originalPath}\n  →\n  ${sandboxPath}\n\n` +
					`This will copy new and changed files from the original.\n` +
					`Files unique to the sandbox will be PRESERVED.\n` +
					`AGENTS.md will not be modified.`
				);

				if (!confirmed) {
					ctx.ui.notify("Sandbox sync cancelled", "info");
					return;
				}

				ctx.ui.notify("Sandbox synced successfully!", "success");

			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to sync sandbox: ${msg}`, "error");
			}
		},
	});

	// Command: /sandbox:status
	pi.registerCommand("sandbox:status", {
		description: "Show current sandbox status and configuration",
		handler: async (_args, ctx) => {
			if (!sandboxState.initialized) {
				ctx.ui.notify("No active sandbox.\n\nUse /sandbox:create <source-path> to create one.", "info");
				return;
			}

			const lines = [
				"Sandbox Status",
				"==============",
				"",
				`Active: Yes`,
				`Original: ${sandboxState.originalPath}`,
				`Sandbox: ${sandboxState.sandboxPath}`,
				"",
				"Constraints:",
				"  - Writes/edits blocked outside sandbox",
				"  - Dangerous commands blocked (sudo, rm -rf, etc.)",
				"  - AGENTS.md enforces workflow rules",
				"",
				"Commands:",
				"  /sandbox:enter <path> - Enter/resume a sandbox",
				"  /sandbox:sync         - Pull updates from original",
				"  /sandbox:status       - Show this message",
			];

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// Command: /sandbox:clear
	pi.registerCommand("sandbox:clear", {
		description: "Clear the current sandbox state (does not delete files)",
		handler: async (_args, ctx) => {
			if (!sandboxState.initialized) {
				ctx.ui.notify("No active sandbox to clear.", "info");
				return;
			}

			if (!ctx.hasUI) {
				sandboxState = { initialized: false };
				ctx.ui.notify("Sandbox state cleared. Files remain on disk.", "info");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Clear Sandbox State",
				"This will clear the sandbox tracking state.\n" +
				"Files on disk will NOT be deleted.\n" +
				"Path restrictions will be lifted."
			);

			if (!confirmed) {
				ctx.ui.notify("Clear cancelled", "info");
				return;
			}

			sandboxState = { initialized: false };
			
			if (ctx.hasUI) {
				ctx.ui.setStatus("sandbox", undefined);
			}

			ctx.ui.notify("Sandbox state cleared. Files remain on disk.", "info");
		},
	});

	// Command: /sandbox:enter <path>
	pi.registerCommand("sandbox:enter", {
		description: "Enter an existing sandbox by path",
		getArgumentCompletions: (prefix: string) => {
			// Discover existing sandboxes in ~/src/sandbox/
			const sandboxBase = getSandboxBase();
			if (!existsSync(sandboxBase)) {
				return null;
			}

			try {
				const { readdirSync } = require("node:fs");
				const { join } = require("node:path");
				const sandboxes = readdirSync(sandboxBase, { withFileTypes: true })
					.filter(d => d.isDirectory())
					.map(d => join(sandboxBase, d.name));

				const items = sandboxes.map(s => ({ value: s, label: s.replace(homedir(), "~") }));
				const filtered = prefix
					? items.filter(i => i.value.startsWith(normalizePath(prefix)))
					: items;

				return filtered.length > 0 ? filtered : null;
			} catch {
				return null;
			}
		},
		handler: async (args, ctx) => {
			if (!args || args.trim() === "") {
				ctx.ui.notify("Usage: /sandbox:enter <sandbox-path>\nExample: /sandbox:enter ~/src/sandbox/my-repo", "error");
				return;
			}

			const sandboxPath = normalizePath(args.trim());

			// Validate sandbox exists
			if (!existsSync(sandboxPath)) {
				ctx.ui.notify(`Sandbox path does not exist: ${sandboxPath}`, "error");
				return;
			}

			// Validate it looks like a sandbox (has AGENTS.md)
			const agentsPath = join(sandboxPath, "AGENTS.md");
			if (!existsSync(agentsPath)) {
				ctx.ui.notify(
					`Not a valid sandbox: ${sandboxPath}\n\n` +
					`A sandbox must have an AGENTS.md file.\n` +
					`Create one with /sandbox:create or add AGENTS.md manually.`,
					"error"
				);
				return;
			}

			// Try to find the original path from AGENTS.md
			let originalPath: string | undefined;
			try {
				const agentsContent = readFileSync(agentsPath, "utf-8");
				const pathMatch = agentsContent.match(/\*\*Sandbox Path\*\*: `([^`]+)`/);
				if (pathMatch) {
					originalPath = pathMatch[1];
				}
			} catch {
				// Ignore - original path is optional
			}

			// Confirm with user
			if (!ctx.hasUI) {
				ctx.ui.notify("Sandbox enter requires interactive mode for confirmation", "error");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Enter Sandbox",
				`Activate sandbox at:\n  ${sandboxPath}\n\n` +
				`This will enable:\n` +
				`  - Path protection (writes blocked outside sandbox)\n` +
				`  - Dangerous command guards\n` +
				`  - Todo tracking via /todo:* commands`
			);

			if (!confirmed) {
				ctx.ui.notify("Sandbox enter cancelled", "info");
				return;
			}

			// Update state
			sandboxState = {
				sandboxPath,
				originalPath,
				initialized: true,
			};

			// Persist state
			pi.appendEntry(STATE_KEY, sandboxState);

			// Update UI
			if (ctx.hasUI) {
				ctx.ui.setStatus("sandbox", ctx.ui.theme.fg("accent", `🔒 Sandbox: ${sandboxPath}`));
			}

			ctx.ui.notify(
				`Entered sandbox successfully!\n\n` +
				`  Sandbox: ${sandboxPath}\n` +
				`  AGENTS.md: ${agentsPath}\n\n` +
				`All write/edit operations are now restricted to the sandbox directory.\n` +
				`Use /todo:list to see your tasks, /sandbox:sync to pull updates.`,
				"success"
			);
		},
	});

	// Inject sandbox constraints into system prompt when active
	pi.on("before_agent_start", async (event, ctx) => {
		if (!sandboxState.initialized || !sandboxState.sandboxPath) {
			return undefined;
		}

		const constraint = `\n\n## Sandbox Mode Active\n\nYou are working in a sandboxed environment at \`${sandboxState.sandboxPath}\`.\n` +
			`- All file modifications must stay within this directory\n` +
			`- Ignore TASK_DONE items - focus on completing TASK items\n` +
			`- Generated content is experimental - do not assume it should be committed\n` +
			`- The user will manually copy approved changes back to the original repository`;

		return {
			systemPrompt: event.systemPrompt + constraint,
		};
	});
}

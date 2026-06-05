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
import { join, relative, resolve, isAbsolute } from "node:path";
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
- **Git Status**: This is an **independent git repository** (copied from original at creation)

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

This sandbox is an **independent copy** of the original repository, including its \`.git\` directory. Key characteristics:

- **Independent git history**: The \`.git\` directory is copied from the original at creation time
- **No git sync**: The \`/sandbox:sync\` command excludes \`.git\`, so git history is NOT updated during sync
- **Disposable experimentation space**: You can commit in the sandbox, but this is for local tracking only
- **Manual adoption**: When you adopt changes, copy them manually back to the original repository and commit there

This design gives you:
- Full git functionality within the sandbox for tracking your experiments
- Clean separation from the original repo's git state
- No risk of accidental pushes or branch conflicts with the original
- Simpler syncing without git merge conflicts

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

			let { sandboxPath, originalPath } = sandboxState;

			// Validate paths exist in current environment
			if (!existsSync(sandboxPath)) {
				ctx.ui.notify(
					`Sandbox path does not exist: ${sandboxPath}\n\n` +
					`This may happen if the sandbox was created outside a container.\n` +
					`Use /sandbox:enter <path> with the correct container path.`,
					"error"
				);
				return;
			}

			if (originalPath && !existsSync(originalPath)) {
				// Original path doesn't exist - likely a host/container path mismatch
				if (!ctx.hasUI) {
					ctx.ui.notify(
						`Original repository path does not exist: ${originalPath}\n\n` +
						`This may happen if the sandbox was created outside a container.\n` +
						`Please provide the correct path within this environment.`,
						"error"
					);
					return;
				}

				const confirmed = await ctx.ui.confirm(
					"Path Mismatch Detected",
					`The original repository path (${originalPath}) does not exist in this environment.\n\n` +
					`This often happens when a sandbox created on the host is used inside a container.\n\n` +
					`Would you like to provide the correct path for this environment?`
				);

				if (!confirmed) {
					ctx.ui.notify("Sync cancelled", "info");
					return;
				}

				// Prompt for correct path
				const newPath = await ctx.ui.input(
					"Original Repository Path",
					`Enter the path to the original repository in this environment:`,
					originalPath
				);

				if (!newPath || !existsSync(newPath)) {
					ctx.ui.notify(`Invalid path: ${newPath}`, "error");
					return;
				}

				originalPath = normalizePath(newPath);
				// Update state with corrected path
				sandboxState = { ...sandboxState, originalPath };
				pi.appendEntry(STATE_KEY, sandboxState);
				ctx.ui.notify(`Updated original path to: ${originalPath}`, "info");
			}

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

				// For Merge mode: first do dry-run to show what will change
				// Rebuild rsyncArgs without the --dry-run that was added for preview
				const mergeRsyncArgs = [
					"-av",
					"--exclude", "AGENTS.md",
					"--exclude", ".git/",
					originalPath + "/",
					sandboxPath + "/",
				];

				// Step 1: Run dry-run to show what will change
				const previewResult = await pi.exec("rsync", [...mergeRsyncArgs, "--dry-run"], { timeout: 60 });

				// Step 2: Show preview and ask for confirmation
				const previewOutput = previewResult.stdout?.trim() || "No changes detected.";
				const confirmed = await ctx.ui.confirm(
					"Apply Sync",
					`Sync changes from:\n  ${originalPath}\n  →\n  ${sandboxPath}\n\n` +
					`Preview of changes:\n${previewOutput}\n\n` +
					`This will copy new and changed files from the original.\n` +
					`Files unique to the sandbox will be PRESERVED.\n` +
					`AGENTS.md will not be modified.`
				);

				if (!confirmed) {
					ctx.ui.notify("Sandbox sync cancelled", "info");
					return;
				}

				// Step 3: Run actual sync (without --dry-run)
				await pi.exec("rsync", mergeRsyncArgs, { timeout: 60 });

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

			const sandboxExists = sandboxState.sandboxPath && existsSync(sandboxState.sandboxPath);
			const originalExists = sandboxState.originalPath && existsSync(sandboxState.originalPath);

			const lines = [
				"Sandbox Status",
				"==============",
				"",
				`Active: Yes`,
				`Original: ${sandboxState.originalPath || "(not set)"} ${originalExists ? "✓" : "✗"}`,
				`Sandbox: ${sandboxState.sandboxPath} ${sandboxExists ? "✓" : "✗"}`,
				"",
			];

			if (!sandboxExists) {
				lines.push("⚠️  WARNING: Sandbox path does not exist!");
				lines.push("   Use /sandbox:enter <path> to point to the correct location.");
				lines.push("");
			}
			if (!originalExists && sandboxState.originalPath) {
				lines.push("⚠️  WARNING: Original repository path does not exist!");
				lines.push("   This may indicate a host/container path mismatch.");
				lines.push("   Use /sandbox:repair to fix the path.");
				lines.push("");
			}

			lines.push(
				"Constraints:",
				"  - Writes/edits blocked outside sandbox",
				"  - Dangerous commands blocked (sudo, rm -rf, etc.)",
				"  - AGENTS.md enforces workflow rules",
				"",
				"Commands:",
				"  /sandbox:enter <path> - Enter/resume a sandbox",
				"  /sandbox:sync         - Pull updates from original",
				"  /sandbox:repair       - Fix path mismatches (e.g., container)",
				"  /sandbox:status       - Show this message",
			);

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

	// Command: /sandbox:repair
	pi.registerCommand("sandbox:repair", {
		description: "Repair sandbox paths when running in a different environment (e.g., container)",
		handler: async (_args, ctx) => {
			if (!sandboxState.initialized) {
				ctx.ui.notify("No active sandbox to repair.", "info");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Sandbox repair requires interactive mode", "error");
				return;
			}

			const lines = [
				"Sandbox Path Repair",
				"===================",
				"",
				`Current sandbox path: ${sandboxState.sandboxPath}`,
				`  Exists: ${existsSync(sandboxState.sandboxPath!) ? "Yes" : "No"}`,
				`Current original path: ${sandboxState.originalPath || "(not set)"}`,
				`  Exists: ${sandboxState.originalPath && existsSync(sandboxState.originalPath) ? "Yes" : "No"}`,
				"",
			];

			if (!sandboxState.sandboxPath || !existsSync(sandboxState.sandboxPath)) {
				ctx.ui.notify(lines.join("\n") + "\nSandbox path is invalid. Use /sandbox:enter instead.", "error");
				return;
			}

			if (sandboxState.originalPath && existsSync(sandboxState.originalPath)) {
				ctx.ui.notify(lines.join("\n") + "\nAll paths are valid. No repair needed.", "info");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Repair Original Path",
				lines.join("\n") + "\nThe original repository path is not accessible in this environment.\n\n" +
				"This commonly happens when:\n" +
				"- A sandbox created on the host is used inside a container\n" +
				"- Paths differ between environments\n\n" +
				"Would you like to update the original path?"
			);

			if (!confirmed) {
				ctx.ui.notify("Repair cancelled", "info");
				return;
			}

			const newPath = await ctx.ui.input(
				"Original Repository Path",
				"Enter the correct path to the original repository:",
				sandboxState.originalPath || ""
			);

			if (!newPath) {
				ctx.ui.notify("No path provided", "error");
				return;
			}

			const normalizedPath = normalizePath(newPath);
			if (!existsSync(normalizedPath)) {
				ctx.ui.notify(`Path does not exist: ${normalizedPath}`, "error");
				return;
			}

			sandboxState = { ...sandboxState, originalPath: normalizedPath };
			pi.appendEntry(STATE_KEY, sandboxState);

			ctx.ui.notify(
				`Sandbox paths repaired!\n\n` +
				`  Sandbox: ${sandboxState.sandboxPath}\n` +
				`  Original: ${sandboxState.originalPath}`,
				"success"
			);
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
				// Look for "Original:" or "Sandbox Path:" patterns
				const pathMatch = agentsContent.match(/(?:Original|Sandbox Path): `([^`]+)`/);
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

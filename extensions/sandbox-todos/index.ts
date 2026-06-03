/**
 * Sandbox Todos Extension
 *
 * Simple todo tracking for sandbox experimentation sessions.
 * Stores todos in the sandbox's AGENTS.md file under a ## Tasks section.
 *
 * Commands:
 * - /todo:add "description" - Add a new todo
 * - /todo:done <id> - Mark todo as done
 * - /todo:list - Show all todos
 * - /todo:clear - Clear completed todos
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface TodoItem {
	id: string;
	title: string;
	status: "open" | "done";
	notes?: string;
	createdAt: string;
	doneAt?: string;
}

interface SandboxState {
	sandboxPath?: string;
	originalPath?: string;
	initialized: boolean;
}

const STATE_KEY = "sandbox-workflow-state";
const TODO_SECTION = "## Tasks";

function generateId(): string {
	return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function parseTodos(content: string): { todos: TodoItem[]; sectionStart: number; sectionEnd: number } {
	const todos: TodoItem[] = [];
	const lines = content.split("\n");
	let sectionStart = -1;
	let sectionEnd = -1;
	let inTasksSection = false;
	let currentTodo: TodoItem | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Find Tasks section
		if (line.startsWith("## Tasks")) {
			sectionStart = i;
			inTasksSection = true;
			continue;
		}

		// End of Tasks section (next ## header)
		if (inTasksSection && line.startsWith("## ") && !line.startsWith("## Tasks")) {
			sectionEnd = i;
			break;
		}

		if (inTasksSection) {
			// Parse todo item: - [ ] or - [x] or - [X]
			const todoMatch = line.match(/^- \[([ xX])\] \*\*(\d+)\*\*: (.+)$/);
			if (todoMatch) {
				// Save previous todo
				if (currentTodo) {
					todos.push(currentTodo);
				}
				currentTodo = {
					id: todoMatch[2],
					title: todoMatch[3].trim(),
					status: todoMatch[1] === " " ? "open" : "done",
					createdAt: new Date().toISOString(),
				};
			} else if (currentTodo && line.startsWith("  ")) {
				// Continuation line (notes)
				currentTodo.notes = (currentTodo.notes || "") + line + "\n";
			}
		}
	}

	// Don't forget the last todo
	if (currentTodo) {
		todos.push(currentTodo);
	}

	// If no section found, mark where it should be inserted
	if (sectionStart === -1) {
		// Insert before "## Workflow" section or at end
		const workflowIndex = lines.findIndex(l => l.startsWith("## Workflow"));
		sectionStart = workflowIndex > 0 ? workflowIndex : lines.length;
		sectionEnd = sectionStart;
	}

	if (sectionEnd === -1) {
		sectionEnd = lines.length;
	}

	return { todos, sectionStart, sectionEnd };
}

function formatTodos(todos: TodoItem[]): string {
	if (todos.length === 0) {
		return "";
	}

	const lines = [TODO_SECTION, ""];
	for (const todo of todos) {
		const checkbox = todo.status === "done" ? "[x]" : "[ ]";
		lines.push(`- ${checkbox} **${todo.id}**: ${todo.title}`);
		if (todo.notes) {
			const notes = todo.notes.trim().split("\n").map(l => `  ${l}`).join("\n");
			lines.push(notes);
		}
	}
	lines.push("");

	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	// Get current sandbox path from sandbox-workflow state
	function getSandboxPath(ctx: ExtensionContext): string | undefined {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === STATE_KEY) {
				const data = entry.data as Partial<SandboxState>;
				if (data.sandboxPath && data.initialized) {
					return data.sandboxPath;
				}
			}
		}
		return undefined;
	}

	function getAgentsPath(ctx: ExtensionContext): string | null {
		const sandboxPath = getSandboxPath(ctx);
		if (!sandboxPath) return null;
		const agentsPath = join(sandboxPath, "AGENTS.md");
		return existsSync(agentsPath) ? agentsPath : null;
	}

	// Command: /todo:add "description"
	pi.registerCommand("todo:add", {
		description: "Add a new todo item",
		handler: async (args, ctx) => {
			if (!args || args.trim() === "") {
				ctx.ui.notify("Usage: /todo:add <description>", "error");
				return;
			}

			const agentsPath = getAgentsPath(ctx);
			if (!agentsPath) {
				ctx.ui.notify("No active sandbox found. Use /sandbox:create first.", "error");
				return;
			}

			const content = readFileSync(agentsPath, "utf-8");
			const { todos, sectionStart, sectionEnd } = parseTodos(content);

			const newTodo: TodoItem = {
				id: generateId(),
				title: args.trim(),
				status: "open",
				createdAt: new Date().toISOString(),
			};

			todos.push(newTodo);

			// Rebuild file content
			const lines = content.split("\n");
			const todoSection = formatTodos(todos);

			if (sectionStart >= 0 && sectionStart < lines.length && lines[sectionStart].startsWith("## Tasks")) {
				// Replace existing section
				lines.splice(sectionStart, sectionEnd - sectionStart, todoSection);
			} else {
				// Insert new section
				const insertIndex = sectionStart;
				lines.splice(insertIndex, 0, todoSection);
			}

			writeFileSync(agentsPath, lines.join("\n"), "utf-8");

			ctx.ui.notify(`Added todo #${newTodo.id}: ${newTodo.title}`, "success");
		},
	});

	// Command: /todo:done <id>
	pi.registerCommand("todo:done", {
		description: "Mark a todo as done",
		handler: async (args, ctx) => {
			if (!args || args.trim() === "") {
				ctx.ui.notify("Usage: /todo:done <id>", "error");
				return;
			}

			const agentsPath = getAgentsPath(ctx);
			if (!agentsPath) {
				ctx.ui.notify("No active sandbox found.", "error");
				return;
			}

			const todoId = args.trim().toUpperCase();
			const content = readFileSync(agentsPath, "utf-8");
			const { todos } = parseTodos(content);

			const todo = todos.find(t => t.id === todoId);
			if (!todo) {
				ctx.ui.notify(`Todo #${todoId} not found`, "error");
				return;
			}

			if (todo.status === "done") {
				ctx.ui.notify(`Todo #${todoId} is already done`, "info");
				return;
			}

			todo.status = "done";
			todo.doneAt = new Date().toISOString();

			// Rebuild file
			const lines = content.split("\n");
			const { sectionStart, sectionEnd } = parseTodos(content);
			const todoSection = formatTodos(todos);

			if (sectionStart >= 0 && sectionStart < lines.length && lines[sectionStart].startsWith("## Tasks")) {
				lines.splice(sectionStart, sectionEnd - sectionStart, todoSection);
			}

			writeFileSync(agentsPath, lines.join("\n"), "utf-8");

			ctx.ui.notify(`Marked todo #${todoId} as done: ${todo.title}`, "success");
		},
	});

	// Command: /todo:list
	pi.registerCommand("todo:list", {
		description: "List all todos",
		handler: async (_args, ctx) => {
			const agentsPath = getAgentsPath(ctx);
			if (!agentsPath) {
				ctx.ui.notify("No active sandbox found.", "error");
				return;
			}

			const content = readFileSync(agentsPath, "utf-8");
			const { todos } = parseTodos(content);

			if (todos.length === 0) {
				ctx.ui.notify("No todos yet. Use /todo:add to add one.", "info");
				return;
			}

			const open = todos.filter(t => t.status === "open");
			const done = todos.filter(t => t.status === "done");

			const lines = ["Tasks:", ""];
			if (open.length > 0) {
				lines.push(`Open (${open.length}):`);
				for (const t of open) {
					lines.push(`  #${t.id}: ${t.title}`);
				}
				lines.push("");
			}
			if (done.length > 0) {
				lines.push(`Done (${done.length}):`);
				for (const t of done) {
					lines.push(`  #${t.id}: ${t.title}`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// Command: /todo:clear
	pi.registerCommand("todo:clear", {
		description: "Remove completed todos from AGENTS.md",
		handler: async (_args, ctx) => {
			const agentsPath = getAgentsPath(ctx);
			if (!agentsPath) {
				ctx.ui.notify("No active sandbox found.", "error");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("This command requires interactive mode", "error");
				return;
			}

			const confirmed = await ctx.ui.confirm("Clear Completed", "Remove all completed todos from AGENTS.md?");
			if (!confirmed) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			const content = readFileSync(agentsPath, "utf-8");
			const { todos } = parseTodos(content);
			const openTodos = todos.filter(t => t.status === "open");

			const lines = content.split("\n");
			const { sectionStart, sectionEnd } = parseTodos(content);
			const todoSection = formatTodos(openTodos);

			if (sectionStart >= 0 && sectionStart < lines.length && lines[sectionStart].startsWith("## Tasks")) {
				if (openTodos.length === 0) {
					// Remove entire section
					lines.splice(sectionStart, sectionEnd - sectionStart);
				} else {
					lines.splice(sectionStart, sectionEnd - sectionStart, todoSection);
				}
			}

			writeFileSync(agentsPath, lines.join("\n"), "utf-8");

			ctx.ui.notify(`Removed ${todos.length - openTodos.length} completed todos`, "success");
		},
	});

	// Inject todo context into system prompt
	pi.on("before_agent_start", async (event, ctx) => {
		const agentsPath = getAgentsPath(ctx);
		if (!agentsPath) return undefined;

		const content = readFileSync(agentsPath, "utf-8");
		const { todos } = parseTodos(content);

		if (todos.length === 0) return undefined;

		const openTodos = todos.filter(t => t.status === "open");
		if (openTodos.length === 0) return undefined;

		const todoList = openTodos.map(t => `- #${t.id}: ${t.title}`).join("\n");
		const context = `\n\n## Current Tasks\n\nYou have active tasks in this session:\n\n${todoList}\n\nFocus on completing these tasks. Use the AGENTS.md file to track progress.`;

		return {
			systemPrompt: event.systemPrompt + context,
		};
	});
}

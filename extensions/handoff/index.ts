/**
 * Handoff Extension — transfer context to a new focused session.
 *
 * Adapted from pi's examples/extensions/handoff.ts, with the transfer
 * assistant tuned to this environment's idiom:
 *
 * - The todo ledger (.pi/todos/*.md) and agent-context are the record of
 *   decisions — the generated prompt cites them instead of re-pasting.
 * - Negative results and rejected approaches are preserved with reasons,
 *   so the new session does not re-litigate them.
 * - Approval state is carried forward explicitly (approved vs awaiting).
 *
 * Usage:
 *   /handoff implement the --build-env flag per todo 1686930c
 *
 * The generated prompt opens in the editor for review; submitting it in the
 * new (parent-linked) session is the user's call.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Message, uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, produce the prompt that starts the new thread. The new thread begins cold: everything it needs is in your prompt, or in a place your prompt points to.

Rules:
1. The todo ledger (.pi/todos/*.md) and the agent-context areas are the record of decisions. CITE them (todo ids, file paths) instead of re-pasting their content. Quote content only when it exists nowhere on disk.
2. Keep verified facts with file:line evidence. Drop conversational filler.
3. Preserve negative results: one line per rejected approach or dead end, with its reason, marked REJECTED. The new session must not re-litigate them.
4. State the next task from the user's goal. If the conversation contains an explicit approval, carry it forward; if not, mark the task awaiting approval.
5. Self-contained beats exhaustive. A tight prompt with pointers beats a copy of the session.

Output only the prompt itself — no preamble, no commentary. Format:

## Context
<decisions and findings with citations; REJECTED lines>

## Files
<paths, one per line, with a word on why>

## Task
<what to do next; scope boundary; approval state>`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") {
		return entry.message;
	}
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) {
		return branch.map(entryToMessage).filter((message) => message !== undefined);
	}

	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	const compactedBranch = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return compactedBranch.map(entryToMessage).filter((message) => message !== undefined);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Transfer context to a new focused session (tuned: ledger-first, keeps negative results and approval state)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff requires interactive mode", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
				return;
			}

			// Gather conversation context from current branch. If the branch was compacted,
			// include the compaction summary plus entries from firstKeptEntryId onward.
			const messages = getHandoffMessages(ctx.sessionManager.getBranch());

			if (messages.length === 0) {
				ctx.ui.notify("No conversation to hand off", "error");
				return;
			}

			// Convert to LLM format and serialize
			const llmMessages = convertToLlm(messages);
			const conversationText = serializeConversation(llmMessages);
			const currentSessionFile = ctx.sessionManager.getSessionFile();

			// Generate the handoff prompt with loader UI
			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `Generating handoff prompt...`);
				loader.onAbort = () => done(null);

				const doGenerate = async () => {
					const userMessage: Message = {
						role: "user",
						content: [
							{
								type: "text",
								text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
							},
						],
						timestamp: Date.now(),
					};

					const response = await ctx.modelRegistry.complete(
						ctx.model!,
						{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
						{
							signal: loader.signal,
							cacheRetention: "none",
							sessionId: uuidv7(),
						},
					);

					if (response.stopReason === "aborted") {
						return null;
					}

					return response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n");
				};

				doGenerate()
					.then(done)
					.catch((err) => {
						console.error("Handoff generation failed:", err);
						done(null);
					});

				return loader;
			});

			if (result === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// Let user edit the generated prompt
			const editedPrompt = await ctx.ui.editor("Edit handoff prompt", result);

			if (editedPrompt === undefined) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// Create new session with parent tracking. Use the replacement-session
			// context for post-switch UI work; the original ctx is stale after a
			// successful session replacement.
			const newSessionResult = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (replacementCtx) => {
					replacementCtx.ui.setEditorText(editedPrompt);
					replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
				},
			});

			if (newSessionResult.cancelled) {
				ctx.ui.notify("New session cancelled", "info");
			}
		},
	});
}

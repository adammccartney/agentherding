/**
 * Zammad Extension — read-only access to the ASC ticket system
 * (support.vsc.ac.at).
 *
 * Tools:
 * - zammad: actions "search" | "get" | "articles"
 *
 * All network access is GET-only. The API token is read from
 * ~/.config/zammad/token at execute time and never appears in output.
 * Article bodies are converted from HTML to plain text and long threads are
 * truncated (first 2 + last N articles) so ticket context stays lean.
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, searchTickets, getTicketByNumber, getArticles } from "./api.js";

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MAX_ARTICLES = 8;

const RowSchema = Type.Object({
	number: Type.String(),
	title: Type.String(),
	state: Type.String(),
	group: Type.String(),
	requester: Type.String(),
	updated_at: Type.String(),
	articles: Type.Number(),
});

const TicketDetailSchema = Type.Object({
	number: Type.String(),
	title: Type.String(),
	state: Type.String(),
	group: Type.String(),
	requester: Type.String(),
	articles: Type.Number(),
	created_at: Type.String(),
	updated_at: Type.String(),
	first_response_at: Type.String(),
	last_contact_at: Type.String(),
});

const ThreadSchema = Type.Object({
	number: Type.String(),
	title: Type.String(),
	total: Type.Number(),
	shown: Type.Number(),
	omitted: Type.Number(),
	articles: Type.Array(
		Type.Object({
			at: Type.String(),
			from: Type.String(),
			sender: Type.String(),
			text: Type.String(),
		}),
	),
	notes: Type.Array(Type.String()),
});

const OutputSchema = Type.Object({
	total: Type.Optional(Type.Number({ description: "total hits for search, may exceed rows shown" })),
	tickets: Type.Optional(Type.Array(RowSchema)),
	ticket: Type.Optional(TicketDetailSchema),
	thread: Type.Optional(ThreadSchema),
});

const Params = Type.Object({
	action: StringEnum(["search", "get", "articles"], {
		description: "search: full-text query over tickets; get: one ticket's metadata by public number; articles: one ticket's conversation by public number",
	}),
	number: Type.Optional(Type.String({ description: "Public ticket number, e.g. \"206540\" (the [Ticket#206540] in mail subjects). Required for get/articles." })),
	query: Type.Optional(Type.String({ description: "Search query, e.g. 'state.name:closed AND pytorch'. Required for search." })),
	limit: Type.Optional(Type.Number({ description: `Max rows for search (default ${DEFAULT_SEARCH_LIMIT}).` })),
	maxArticles: Type.Optional(Type.Number({ description: `Max articles returned for a ticket (default ${DEFAULT_MAX_ARTICLES}). Long threads keep the first 2 and last N-2 articles.` })),
});

interface ZammadDetails {
	action: string;
	number?: string;
	query?: string;
	rows?: number;
	total?: number;
	shown?: number;
	omitted?: number;
	error?: string;
}

function errorResult(details: ZammadDetails, message: string) {
	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details: { ...details, error: message },
		isError: true,
		structuredContent: {},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "zammad",
		label: "Zammad",
		description: `Read-only access to the ASC Zammad ticket system (support.vsc.ac.at).

Actions:
- search: full-text ticket search. Query syntax: 'field:value AND term', e.g. 'state.name:closed AND tensorflow'. Useful fields: state.name (new/open/closed), group.name, number, title, article.body. Returns <number, title, state, group, requester, updated, article count> rows.
- get: one ticket's metadata by public number (from the [Ticket#NNN] mail subject). No conversation content.
- articles: one ticket's conversation by public number: sender type, date, plain text (HTML stripped). Long threads return the first 2 and last articles; 'omitted' in the output tells you how many were skipped — call again with a higher maxArticles to widen the window.

Typical triage flow: get the ticket, read its articles, then search similar closed tickets (same software/keywords) for precedent. This tool never writes; replies stay with the user.`,
		parameters: Params,
		outputSchema: OutputSchema,
		annotations: { readOnlyHint: true, openWorldHint: true },

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { action, number, query } = params;
			const base: ZammadDetails = { action, number, query };

			let cfg;
			try {
				cfg = loadConfig();
			} catch (err: any) {
				return errorResult(base, err.message);
			}

			try {
				switch (action) {
					case "search": {
						if (!query?.trim()) return errorResult(base, 'action "search" requires "query", e.g. { action: "search", query: "state.name:closed AND pytorch" }');
						const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
						const { rows, total } = await searchTickets(cfg, query, limit, signal);
						const text = rows.length === 0
							? `No tickets found for query "${query}".`
							: [
									`## Ticket search — "${query}" (${total} hit(s), showing ${rows.length})`,
									"",
									"| number | title | state | group | requester | updated | arts |",
									"|---|---|---|---|---|---|---|",
									...rows.map((r) => `| ${r.number} | ${r.title} | ${r.state} | ${r.group} | ${r.requester} | ${r.updated_at.slice(0, 10)} | ${r.articles} |`),
								].join("\n");
						return {
							content: [{ type: "text" as const, text }],
							details: { ...base, rows: rows.length, total },
							structuredContent: { tickets: rows, total },
						};
					}

					case "get": {
						if (!number?.trim()) return errorResult(base, 'action "get" requires "number", e.g. { action: "get", number: "206540" }');
						const t = await getTicketByNumber(cfg, number, signal);
						const text = [
							`#${t.number} — ${t.title}`,
							`state: ${t.state} · group: ${t.group} · requester: ${t.requester}`,
							`articles: ${t.articles} · created: ${t.created_at.slice(0, 10)} · updated: ${t.updated_at.slice(0, 10)}`,
							'Use action "articles" with this number to read the conversation.',
						].join("\n");
						return {
							content: [{ type: "text" as const, text }],
							details: base,
							structuredContent: { ticket: t },
						};
					}

					case "articles": {
						if (!number?.trim()) return errorResult(base, 'action "articles" requires "number", e.g. { action: "articles", number: "206540" }');
						const max = params.maxArticles ?? DEFAULT_MAX_ARTICLES;
						const thread = await getArticles(cfg, number, max, signal);
						const parts = [
							`#${thread.number} — ${thread.title} — ${thread.total} article(s), showing ${thread.shown}${thread.omitted ? `, ${thread.omitted} omitted` : ""}`,
						];
						for (const a of thread.articles) {
							parts.push(`---\n### ${a.at.replace("T", " ").slice(0, 16)} · ${a.sender} · ${a.from}\n${a.text}`);
						}
						for (const note of thread.notes) parts.push(`[note: ${note}]`);
						return {
							content: [{ type: "text" as const, text: parts.join("\n") }],
							details: { ...base, shown: thread.shown, omitted: thread.omitted },
							structuredContent: { thread },
						};
					}

					default:
						return errorResult(base, `unknown action "${action}" — use "search", "get", or "articles".`);
				}
			} catch (err: any) {
				return errorResult(base, err.message);
			}
		},
	});
}

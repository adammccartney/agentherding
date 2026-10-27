/**
 * YouTrack Extension — read-only access to a YouTrack instance.
 *
 * Tools:
 * - youtrack: actions "search" | "get" | "comments"
 *
 * All network access is GET-only. Credentials resolve at execute time from
 * YOUTRACK_TOKEN / YOUTRACK_BASE_URL (environment or dotenv-style
 * ~/.config/youtrack/.env), never appear in output, and no instance host,
 * project name, or board id is baked into this repo. Comments and issue
 * descriptions are capped so context stays lean; long comment threads keep
 * the first 2 and last N comments.
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	loadConfig,
	searchIssues,
	getIssue,
	getComments,
	DESCRIPTION_CAP,
} from "./api.js";

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MAX_COMMENTS = 8;

const RowSchema = Type.Object({
	id: Type.String(),
	summary: Type.String(),
	project: Type.String(),
	stage: Type.String(),
	priority: Type.String(),
	resolved: Type.Boolean(),
	comments: Type.Number(),
	updated: Type.String(),
});

const IssueDetailSchema = Type.Object({
	id: Type.String(),
	summary: Type.String(),
	project: Type.String(),
	stage: Type.String(),
	priority: Type.String(),
	resolved: Type.Boolean(),
	comments: Type.Number(),
	updated: Type.String(),
	description: Type.String(),
	description_capped: Type.Boolean(),
	reporter: Type.String(),
	assignee: Type.String(),
	created: Type.String(),
	resolved_at: Type.String(),
	tags: Type.Array(Type.String()),
});

const ThreadSchema = Type.Object({
	id: Type.String(),
	summary: Type.String(),
	tags: Type.Array(Type.String()),
	total: Type.Number(),
	shown: Type.Number(),
	omitted: Type.Number(),
	comments: Type.Array(
		Type.Object({
			at: Type.String(),
			from: Type.String(),
			text: Type.String(),
		}),
	),
	notes: Type.Array(Type.String()),
});

const OutputSchema = Type.Object({
	issues: Type.Optional(Type.Array(RowSchema)),
	issue: Type.Optional(IssueDetailSchema),
	thread: Type.Optional(ThreadSchema),
});

const Params = Type.Object({
	action: StringEnum(["search", "get", "comments"], {
		description: "search: YouTrack-query-language search; get: one issue's metadata by readable id; comments: one issue's comment thread by readable id",
	}),
	id: Type.Optional(
		Type.String({ description: 'Readable issue id, e.g. "PROJ-123". Required for get/comments.' }),
	),
	query: Type.Optional(
		Type.String({ description: 'YouTrack query language, e.g. \'project: PROJ Stage: "In Progress" term\'. Required for search.' }),
	),
	limit: Type.Optional(Type.Number({ description: `Max rows for search (default ${DEFAULT_SEARCH_LIMIT}).` })),
	maxComments: Type.Optional(
		Type.Number({ description: `Max comments returned (default ${DEFAULT_MAX_COMMENTS}). Long threads keep the first 2 and last N-2 comments.` }),
	),
});

interface YtDetails {
	action: string;
	id?: string;
	query?: string;
	rows?: number;
	shown?: number;
	omitted?: number;
	error?: string;
}

function errorResult(details: YtDetails, message: string) {
	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details: { ...details, error: message },
		isError: true,
		structuredContent: {},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "youtrack",
		label: "YouTrack",
		description: `Read-only access to a YouTrack issue tracker.

Actions:
- search: YouTrack query language search. Useful fields: project:<short>, Stage:"<stage>" (workflow field; on the software development board the field is State), Priority, Assignee, resolved (e.g. '-resolved: *' for unresolved only is '#Unresolved'). Free text matches summary/description/comments. Returns <id, summary, project, stage, priority, resolved, comments, updated> rows.
- get: one issue's metadata by readable id (e.g. "PROJ-123"): stage, priority, reporter, assignee, tags, timestamps, and the description (capped at ${DESCRIPTION_CAP} chars).
- comments: one issue's comment thread by readable id as plain text. Long threads return the first 2 and last comments; 'omitted' tells you how many were skipped — call again with a higher maxComments to widen the window.

Typical flow: search for candidates, get the issue, read its comments. This tool never writes.`,
		parameters: Params,
		outputSchema: OutputSchema,
		annotations: { readOnlyHint: true, openWorldHint: true },

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { action, id, query } = params;
			const base: YtDetails = { action, id, query };

			let cfg;
			try {
				cfg = loadConfig();
			} catch (err: any) {
				return errorResult(base, err.message);
			}

			try {
				switch (action) {
					case "search": {
						if (!query?.trim())
							return errorResult(base, 'action "search" requires "query", e.g. { action: "search", query: "project: PROJ Stage: Open" }');
						const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
						const rows = await searchIssues(cfg, query, limit, signal);
						const text =
							rows.length === 0
								? `No issues found for query "${query}".`
								: [
										`## Issue search — "${query}" (${rows.length} shown)`,
										"",
										"| id | summary | project | stage | pri | resolved | comments | updated |",
										"|---|---|---|---|---|---|---|---|",
										...rows.map(
											(r) =>
												`| ${r.id} | ${r.summary} | ${r.project} | ${r.stage} | ${r.priority} | ${r.resolved ? "yes" : ""} | ${r.comments} | ${r.updated.slice(0, 10)} |`,
										),
									].join("\n");
						return {
							content: [{ type: "text" as const, text }],
							details: { ...base, rows: rows.length },
							structuredContent: { issues: rows },
						};
					}

					case "get": {
						if (!id?.trim())
							return errorResult(base, 'action "get" requires "id", e.g. { action: "get", id: "PROJ-123" }');
						const t = await getIssue(cfg, id, signal);
						const lines = [
							`${t.id} — ${t.summary}`,
							`project: ${t.project} · stage: ${t.stage || "—"} · priority: ${t.priority || "—"} · assignee: ${t.assignee || "—"}${t.tags.length ? ` · tags: ${t.tags.join(", ")}` : ""}`,
							`reporter: ${t.reporter || "—"} · comments: ${t.comments} · created: ${t.created.slice(0, 10)} · updated: ${t.updated.slice(0, 10)}${t.resolved_at ? ` · resolved: ${t.resolved_at.slice(0, 10)}` : ""}`,
						];
						if (t.description) {
							lines.push("", t.description);
							if (t.description_capped)
								lines.push(`… [description capped at ${DESCRIPTION_CAP} chars]`);
						}
						lines.push('Use action "comments" with this id to read the comment thread.');
						return {
							content: [{ type: "text" as const, text: lines.join("\n") }],
							details: base,
							structuredContent: { issue: t },
						};
					}

					case "comments": {
						if (!id?.trim())
							return errorResult(base, 'action "comments" requires "id", e.g. { action: "comments", id: "PROJ-123" }');
						const max = params.maxComments ?? DEFAULT_MAX_COMMENTS;
						const thread = await getComments(cfg, id, max, signal);
						const parts = [
							`${thread.id} — ${thread.summary} — ${thread.total} comment(s), showing ${thread.shown}${thread.omitted ? `, ${thread.omitted} omitted` : ""}${thread.tags.length ? ` · tags: ${thread.tags.join(", ")}` : ""}`,
						];
						for (const c of thread.comments) {
							parts.push(`---\n### ${c.at.replace("T", " ").slice(0, 16)} · ${c.from}\n${c.text}`);
						}
						for (const note of thread.notes) parts.push(`[note: ${note}]`);
						return {
							content: [{ type: "text" as const, text: parts.join("\n") }],
							details: { ...base, shown: thread.shown, omitted: thread.omitted },
							structuredContent: { thread },
						};
					}

					default:
						return errorResult(base, `unknown action "${action}" — use "search", "get", or "comments".`);
				}
			} catch (err: any) {
				return errorResult(base, err.message);
			}
		},
	});
}

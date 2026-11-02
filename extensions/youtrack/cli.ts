/**
 * YouTrack CLI — standalone read-only wrapper around ./api.ts.
 *
 * No pi imports. Run under node's type stripping (no build step):
 *
 *   node --experimental-strip-types extensions/youtrack/cli.ts search "project: PROJ" --limit 5
 *   node --experimental-strip-types extensions/youtrack/cli.ts get PROJ-123 --json
 *
 * or via the repo wrapper: bin/yt <verb> [args] [--json]
 *
 * Text output mirrors the pi extension's rendering in ./index.ts; --json
 * prints the structuredContent shape instead. Credentials resolve via
 * loadConfig() in ./api.ts — the CLI adds no auth logic of its own, and
 * tokens never appear in output. All network access is GET-only.
 */

import {
	loadConfig,
	searchIssues,
	getIssue,
	getComments,
	assertReadableId,
	DESCRIPTION_CAP,
} from "./api.ts";
import type { IssueRow, IssueDetail, ThreadResult } from "./api.ts";

// Mirror DEFAULT_SEARCH_LIMIT / DEFAULT_MAX_COMMENTS in ./index.ts.
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MAX_COMMENTS = 8;

const USAGE = `Usage: yt <verb> [args] [--json]

Verbs:
  search <query> [--limit N]        YouTrack query language search (default --limit ${DEFAULT_SEARCH_LIMIT}).
  get <id>                          One issue's metadata; id is the readable form, e.g. PROJ-123.
  comments <id> [--max-comments N]  Comment thread (default --max-comments ${DEFAULT_MAX_COMMENTS};
                                    long threads keep the first 2 and last N-2).

Options:
  --json   Print the structured result object ({ issues } | { issue } | { thread }) as JSON
           instead of the text rendering.
  --help   Show this text.

Auth: YOUTRACK_TOKEN / YOUTRACK_BASE_URL from the environment or a dotenv file
(default ~/.config/youtrack/.env, override with YOUTRACK_TOKEN_FILE);
YOUTRACK_TOKEN_CMD as token fallback. See extensions/youtrack/README.md.
`;

/** Usage failure: usage text to stderr, exit 2. */
function usageExit(problem?: string): never {
	if (problem) process.stderr.write(`Error: ${problem}\n\n`);
	process.stderr.write(USAGE);
	process.exit(2);
}

function parsePositiveInt(flag: string, raw: string | undefined, fallback: number): number {
	if (raw === undefined) return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) usageExit(`"${flag}" expects a positive integer, got "${raw}".`);
	return n;
}

// --- Text rendering: identical formats to the pi extension in ./index.ts. ---

function renderSearch(query: string, rows: IssueRow[]): string {
	if (rows.length === 0) return `No issues found for query "${query}".`;
	return [
		`## Issue search — "${query}" (${rows.length} shown)`,
		"",
		"| id | summary | project | stage | pri | resolved | comments | updated |",
		"|---|---|---|---|---|---|---|---|",
		...rows.map(
			(r) =>
				`| ${r.id} | ${r.summary} | ${r.project} | ${r.stage} | ${r.priority} | ${r.resolved ? "yes" : ""} | ${r.comments} | ${r.updated.slice(0, 10)} |`,
		),
	].join("\n");
}

function renderIssue(t: IssueDetail): string {
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
	return lines.join("\n");
}

function renderThread(thread: ThreadResult): string {
	const parts = [
		`${thread.id} — ${thread.summary} — ${thread.total} comment(s), showing ${thread.shown}${thread.omitted ? `, ${thread.omitted} omitted` : ""}${thread.tags.length ? ` · tags: ${thread.tags.join(", ")}` : ""}`,
	];
	for (const c of thread.comments) {
		parts.push(`---\n### ${c.at.replace("T", " ").slice(0, 16)} · ${c.from}\n${c.text}`);
	}
	for (const note of thread.notes) parts.push(`[note: ${note}]`);
	return parts.join("\n");
}

// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
	let json = false;
	let limitArg: string | undefined;
	let maxCommentsArg: string | undefined;
	const positionals: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--json") {
			json = true;
		} else if (a === "--help" || a === "-h") {
			process.stdout.write(USAGE);
			return;
		} else if (a === "--limit" || a === "--max-comments") {
			const v = argv[++i];
			if (v === undefined) usageExit(`"${a}" requires a value.`);
			if (a === "--limit") limitArg = v;
			else maxCommentsArg = v;
		} else if (a.startsWith("--")) {
			usageExit(`unknown flag "${a}".`);
		} else {
			positionals.push(a);
		}
	}

	const verb = positionals[0];
	if (!verb) usageExit();

	const emit = (structured: Record<string, unknown>, text: string): void => {
		process.stdout.write(json ? JSON.stringify(structured, null, 2) + "\n" : text + "\n");
	};

	switch (verb) {
		case "search": {
			const query = positionals[1];
			if (!query?.trim())
				usageExit('verb "search" requires a query, e.g. yt search "project: PROJ Stage: Open".');
			const limit = parsePositiveInt("--limit", limitArg, DEFAULT_SEARCH_LIMIT);
			const cfg = loadConfig();
			const rows = await searchIssues(cfg, query, limit);
			emit({ issues: rows }, renderSearch(query, rows));
			return;
		}

		case "get": {
			const id = positionals[1];
			if (!id?.trim()) usageExit('verb "get" requires an id, e.g. yt get PROJ-123.');
			// Validate the id before touching config or the network.
			const clean = assertReadableId(id);
			const cfg = loadConfig();
			const issue = await getIssue(cfg, clean);
			emit({ issue }, renderIssue(issue));
			return;
		}

		case "comments": {
			const id = positionals[1];
			if (!id?.trim()) usageExit('verb "comments" requires an id, e.g. yt comments PROJ-123.');
			const clean = assertReadableId(id);
			const max = parsePositiveInt("--max-comments", maxCommentsArg, DEFAULT_MAX_COMMENTS);
			const cfg = loadConfig();
			const thread = await getComments(cfg, clean, max);
			emit({ thread }, renderThread(thread));
			return;
		}

		default:
			usageExit(`unknown verb "${verb}" — use "search", "get", or "comments".`);
	}
}

main(process.argv.slice(2)).catch((err: any) => {
	process.stderr.write(`Error: ${err?.message ?? String(err)}\n`);
	process.exit(1);
});

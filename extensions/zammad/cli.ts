/**
 * Zammad read-only CLI — standalone wrapper around ./api.ts (no pi imports).
 *
 * Run under node's type stripping (node ≥ 22), or via the bin/zt wrapper:
 *
 *   node --experimental-strip-types extensions/zammad/cli.ts search "state.name:open" [--limit N] [--json]
 *   node --experimental-strip-types extensions/zammad/cli.ts get 206540 [--json]
 *   node --experimental-strip-types extensions/zammad/cli.ts articles 206540 [--max-articles N] [--json]
 *
 * Auth and overrides (ZAMMAD_BASE_URL, ZAMMAD_TOKEN_FILE) come from
 * loadConfig() — see extensions/zammad/README.md. GET-only; the output caps
 * (4000 chars/article, first-2 + last-N windowing) live in api.ts. Text
 * rendering mirrors extensions/zammad/index.ts; exit codes: 0 ok, 1 runtime
 * error, 2 usage error.
 */

import { loadConfig, searchTickets, getTicketByNumber, getArticles } from "./api.ts";

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MAX_ARTICLES = 8;

const USAGE = `Usage: zt <verb> [args] [--json]

Read-only CLI for the ASC Zammad ticket system (support.vsc.ac.at).

Verbs:
  search <query> [--limit N]            full-text ticket search (default limit ${DEFAULT_SEARCH_LIMIT})
  get <number>                          one ticket's metadata by public number
  articles <number> [--max-articles N]  ticket conversation (default ${DEFAULT_MAX_ARTICLES};
                                        long threads keep the first 2 and last N-2 articles)

Options:
  --json    print the structured result object as JSON instead of text
  --help    show this usage

Auth: token at ~/.config/zammad/token (mode 0600); overrides via
ZAMMAD_BASE_URL and ZAMMAD_TOKEN_FILE. See extensions/zammad/README.md.`;

function usageError(msg?: string): never {
	if (msg) process.stderr.write(`Error: ${msg}\n\n`);
	process.stderr.write(`${USAGE}\n`);
	process.exit(2);
}

function positiveInt(flag: string, raw: string | undefined, fallback: number): number {
	if (raw === undefined) return fallback;
	if (!/^\d+$/.test(raw) || Number(raw) < 1) usageError(`${flag} expects a positive integer, got "${raw}".`);
	return Number(raw);
}

function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Argument parsing — verb positionals plus --limit / --max-articles / --json.

const argv = process.argv.slice(2);
let json = false;
const positional: string[] = [];
const opts = new Map<string, string>();

for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === "--json") {
		json = true;
		continue;
	}
	if (a === "--help" || a === "-h") {
		process.stdout.write(`${USAGE}\n`);
		process.exit(0);
	}
	if (a === "--limit" || a === "--max-articles") {
		const v = argv[++i];
		if (v === undefined) usageError(`option ${a} expects a value.`);
		opts.set(a, v);
		continue;
	}
	if (a.startsWith("--")) usageError(`unknown option "${a}".`);
	positional.push(a);
}

const verb = positional[0];

function onlyOpts(...allowed: string[]): void {
	for (const k of opts.keys()) {
		if (!allowed.includes(k)) usageError(`option ${k} does not apply to "${verb}".`);
	}
	if (positional.length > 2) usageError(`unexpected extra argument "${positional[2]}".`);
}

async function main(): Promise<void> {
	const cfg = loadConfig();
	switch (verb) {
		case "search": {
			const query = positional[1];
			if (!query?.trim()) usageError('search requires a <query>, e.g. zt search "state.name:closed AND pytorch".');
			onlyOpts("--limit");
			const limit = positiveInt("--limit", opts.get("--limit"), DEFAULT_SEARCH_LIMIT);
			const { rows, total } = await searchTickets(cfg, query, limit);
			if (json) {
				printJson({ tickets: rows, total });
			} else {
				const text = rows.length === 0
					? `No tickets found for query "${query}".`
					: [
							`## Ticket search — "${query}" (${total} hit(s), showing ${rows.length})`,
							"",
							"| number | title | state | group | requester | updated | arts |",
							"|---|---|---|---|---|---|---|",
							...rows.map((r) => `| ${r.number} | ${r.title} | ${r.state} | ${r.group} | ${r.requester} | ${r.updated_at.slice(0, 10)} | ${r.articles} |`),
						].join("\n");
				process.stdout.write(`${text}\n`);
			}
			break;
		}

		case "get": {
			const number = positional[1];
			if (!number?.trim()) usageError("get requires a <number>, e.g. zt get 206540.");
			onlyOpts();
			const t = await getTicketByNumber(cfg, number);
			if (json) {
				printJson({ ticket: t });
			} else {
				const text = [
					`#${t.number} — ${t.title}`,
					`state: ${t.state} · group: ${t.group} · requester: ${t.requester}${t.tags.length ? ` · tags: ${t.tags.join(", ")}` : ""}`,
					`articles: ${t.articles} · created: ${t.created_at.slice(0, 10)} · updated: ${t.updated_at.slice(0, 10)}`,
					'Use action "articles" with this number to read the conversation.',
				].join("\n");
				process.stdout.write(`${text}\n`);
			}
			break;
		}

		case "articles": {
			const number = positional[1];
			if (!number?.trim()) usageError("articles requires a <number>, e.g. zt articles 206540.");
			onlyOpts("--max-articles");
			const max = positiveInt("--max-articles", opts.get("--max-articles"), DEFAULT_MAX_ARTICLES);
			const thread = await getArticles(cfg, number, max);
			if (json) {
				printJson({ thread });
			} else {
				const parts = [
					`#${thread.number} — ${thread.title} — ${thread.total} article(s), showing ${thread.shown}${thread.omitted ? `, ${thread.omitted} omitted` : ""}${thread.tags.length ? ` · tags: ${thread.tags.join(", ")}` : ""}`,
				];
				for (const a of thread.articles) {
					parts.push(`---\n### ${a.at.replace("T", " ").slice(0, 16)} · ${a.sender} · ${a.from}\n${a.text}`);
				}
				for (const note of thread.notes) parts.push(`[note: ${note}]`);
				process.stdout.write(`${parts.join("\n")}\n`);
			}
			break;
		}

		case undefined:
			usageError();
			break;

		default:
			usageError(`unknown verb "${verb}" — use "search", "get", or "articles".`);
	}
}

main().catch((err: any) => {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`Error: ${message}\n`);
	process.exit(1);
});

/**
 * YouTrack read-only API core.
 *
 * No pi imports — plain fetch, so unit-testable under node's type stripping:
 *
 *   node --experimental-strip-types test-api.ts
 *
 * GET-only by design. Credentials are resolved at call time and never appear
 * in any return value. No host or project names are baked into this repo:
 * YOUTRACK_BASE_URL and YOUTRACK_TOKEN come from the environment or a
 * dotenv-style file (default ~/.config/youtrack/.env); YOUTRACK_TOKEN_CMD
 * (argv form, no shell) can resolve the token via an external secrets tool.
 */

import { homedir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DEFAULT_TOKEN_FILE = path.join(homedir(), ".config", "youtrack", ".env");

export interface YtConfig {
	baseUrl: string;
	token: string;
}

// Accepts dotenv-style KEY=value lines; a bare non-KEY line is tolerated as
// the token itself, so a raw-token file keeps working.
function parseDotenv(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	let bare: string | undefined;
	for (const line of raw.split(/\r?\n/)) {
		const s = line.trim();
		if (!s || s.startsWith("#")) continue;
		const eq = s.indexOf("=");
		if (eq === -1) {
			bare = s;
			continue;
		}
		out[s.slice(0, eq).trim()] = s.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
	}
	if (bare && !out.YOUTRACK_TOKEN) out.YOUTRACK_TOKEN = bare;
	return out;
}

export function loadConfig(): YtConfig {
	const tokenFile = process.env.YOUTRACK_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
	let file: Record<string, string> = {};
	try {
		file = parseDotenv(readFileSync(tokenFile, "utf8"));
	} catch {
		/* file is optional; environment alone may suffice */
	}
	const get = (k: string): string | undefined => process.env[k] || file[k];

	let token = get("YOUTRACK_TOKEN");
	if (!token) {
		const cmd = get("YOUTRACK_TOKEN_CMD");
		if (cmd) {
			const [bin, ...args] = cmd.split(/\s+/);
			try {
				token = execFileSync(bin, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
			} catch {
				throw new Error(`YOUTRACK_TOKEN_CMD "${cmd}" failed or printed nothing.`);
			}
		}
	}
	if (!token)
		throw new Error(`YouTrack token missing — set YOUTRACK_TOKEN (env or ${tokenFile}) or YOUTRACK_TOKEN_CMD.`);

	const baseUrl = get("YOUTRACK_BASE_URL")?.replace(/\/+$/, "");
	if (!baseUrl)
		throw new Error(`YouTrack base URL missing — set YOUTRACK_BASE_URL (env or ${tokenFile}); none is baked in.`);
	return { baseUrl, token };
}

// ---------------------------------------------------------------------------
// Low-level GET — the only network verb in this file.

async function ytGet(cfg: YtConfig, apiPath: string, params?: Record<string, string>, signal?: AbortSignal): Promise<any> {
	const url = new URL(`${cfg.baseUrl}/api${apiPath}`);
	for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
	const res = await fetch(url, {
		method: "GET",
		headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		const body = (await res.text().catch(() => "")).slice(0, 200);
		throw new Error(`YouTrack GET ${apiPath} failed: HTTP ${res.status} ${body}`.trim());
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Field shaping.
// The workflow field is "Stage" on ASC-template projects; the software
// development board uses "State". We surface Stage with State as fallback.

function customValue(issue: any, name: string): string {
	for (const cf of issue.customFields ?? []) {
		if (cf?.name !== name) continue;
		const v = cf.value;
		if (v == null) return "";
		if (Array.isArray(v)) return v.map((x: any) => x?.name ?? "").filter(Boolean).join(", ");
		return v?.name ?? String(v);
	}
	return "";
}

export function stageOf(issue: any): string {
	return customValue(issue, "Stage") || customValue(issue, "State");
}

function isoDate(ms: unknown): string {
	if (typeof ms !== "number") return "";
	try {
		return new Date(ms).toISOString();
	} catch {
		return "";
	}
}

export interface IssueRow {
	id: string;
	summary: string;
	project: string;
	stage: string;
	priority: string;
	resolved: boolean;
	comments: number;
	updated: string;
}

function toRow(t: any): IssueRow {
	return {
		id: t.idReadable ?? t.id ?? "",
		summary: t.summary ?? "",
		project: t.project?.shortName ?? "",
		stage: stageOf(t),
		priority: customValue(t, "Priority"),
		resolved: t.resolved != null,
		comments: t.commentsCount ?? 0,
		updated: isoDate(t.updated),
	};
}

// ---------------------------------------------------------------------------
// Actions

const SEARCH_FIELDS = [
	"idReadable", "summary", "updated", "resolved", "commentsCount",
	"project(shortName)", "customFields(name,value(name))",
].join(",");

export async function searchIssues(cfg: YtConfig, query: string, limit: number, signal?: AbortSignal): Promise<IssueRow[]> {
	const res = await ytGet(cfg, "/issues", { query, $top: String(limit), fields: SEARCH_FIELDS }, signal);
	if (!Array.isArray(res)) throw new Error(`Unexpected search response: ${(res?.error ?? "not an issue list").slice?.(0, 120) ?? "unknown"}`);
	return res.slice(0, limit).map(toRow);
}

const DETAIL_FIELDS = SEARCH_FIELDS.replace(
	"idReadable",
	"idReadable,description,created,reporter(login,fullName)",
);

export const DESCRIPTION_CAP = 2000;
export const PER_COMMENT_CHAR_CAP = 4000;

export interface IssueDetail extends IssueRow {
	description: string;
	description_capped: boolean;
	reporter: string;
	assignee: string;
	created: string;
	resolved_at: string;
	tags: string[];
}

async function issueTags(cfg: YtConfig, idReadable: string, signal?: AbortSignal): Promise<string[]> {
	const res = await ytGet(cfg, `/issues/${encodeURIComponent(idReadable)}/tags`, { fields: "name" }, signal).catch(() => []);
	return Array.isArray(res) ? res.map((t: any) => t?.name).filter(Boolean) : [];
}

export function assertReadableId(id: string): string {
	const clean = id.trim();
	if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(clean))
		throw new Error(`"${id}" is not an issue id — expected the readable form, e.g. "PROJ-123".`);
	return clean;
}

export async function getIssue(cfg: YtConfig, idReadable: string, signal?: AbortSignal): Promise<IssueDetail> {
	const id = assertReadableId(idReadable);
	const t = await ytGet(cfg, `/issues/${encodeURIComponent(id)}`, { fields: DETAIL_FIELDS }, signal);
	const rawDesc: string = t.description ?? "";
	const capped = rawDesc.length > DESCRIPTION_CAP;
	const description = capped ? rawDesc.slice(0, DESCRIPTION_CAP) : rawDesc;
	return {
		...toRow(t),
		description,
		description_capped: capped,
		reporter: t.reporter?.fullName || t.reporter?.login || "",
		assignee: customValue(t, "Assignee"),
		created: isoDate(t.created),
		resolved_at: isoDate(t.resolved),
		tags: await issueTags(cfg, id, signal),
	};
}

// ---------------------------------------------------------------------------
// Comments — windowed like zammad articles: keep the first 2 and last (max-2).

export interface CommentOut {
	at: string;
	from: string;
	text: string;
}

export interface ThreadResult {
	id: string;
	summary: string;
	tags: string[];
	total: number;
	shown: number;
	omitted: number;
	comments: CommentOut[];
	notes: string[];
}

const COMMENT_FIELDS = "id,created,author(login,fullName),text,deleted";

export async function getComments(cfg: YtConfig, idReadable: string, max: number, signal?: AbortSignal): Promise<ThreadResult> {
	const id = assertReadableId(idReadable);
	const raw: any[] = await ytGet(cfg, `/issues/${encodeURIComponent(id)}/comments`, { fields: COMMENT_FIELDS }, signal);
	if (!Array.isArray(raw)) throw new Error("Unexpected comments response.");
	const live = raw.filter((c: any) => !c?.deleted);
	const total = live.length;
	const keepFirst = Math.min(2, max, total);
	const keepLast = max - keepFirst;
	const chosen = total <= max ? live : [...live.slice(0, keepFirst), ...live.slice(total - keepLast)];
	const omitted = total - chosen.length;
	const notes: string[] = [];
	if (omitted > 0) notes.push(`${omitted} middle comment(s) omitted (kept first ${keepFirst} and last ${keepLast}).`);
	const comments: CommentOut[] = [];
	const seen = new Set<string>();
	for (const c of chosen) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		let text: string = c.text ?? "";
		if (text.length > PER_COMMENT_CHAR_CAP) {
			text = text.slice(0, PER_COMMENT_CHAR_CAP) + " … [comment truncated]";
			if (!notes.some((n) => n.includes("capped"))) notes.push(`Long comments capped at ${PER_COMMENT_CHAR_CAP} chars.`);
		}
		comments.push({
			at: isoDate(c.created),
			from: c.author?.fullName || c.author?.login || "unknown",
			text,
		});
	}
	const head = await ytGet(cfg, `/issues/${encodeURIComponent(id)}`, { fields: "summary" }, signal);
	return {
		id,
		summary: head.summary ?? "",
		tags: await issueTags(cfg, id, signal),
		total,
		shown: comments.length,
		omitted,
		comments,
		notes,
	};
}

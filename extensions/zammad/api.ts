/**
 * Zammad read-only API core for support.vsc.ac.at.
 *
 * No pi imports — plain fetch, so unit-testable under node's type stripping:
 *
 *   node --experimental-strip-types test-api.ts
 *
 * GET-only by design. The token is read from ~/.config/zammad/token at call
 * time and never appears in any return value.
 */

import { homedir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

const DEFAULT_BASE_URL = "https://support.vsc.ac.at";
const DEFAULT_TOKEN_FILE = path.join(homedir(), ".config", "zammad", "token");

export interface ZammadConfig {
	baseUrl: string;
	token: string;
}

export function loadConfig(): ZammadConfig {
	const tokenFile = process.env.ZAMMAD_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
	let token: string;
	try {
		token = readFileSync(tokenFile, "utf8").trim();
	} catch {
		throw new Error(`Zammad token not readable at ${tokenFile} — store the token there (chmod 600).`);
	}
	if (!token) throw new Error(`Zammad token file ${tokenFile} is empty.`);
	const baseUrl = (process.env.ZAMMAD_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
	return { baseUrl, token };
}

// ---------------------------------------------------------------------------
// Low-level GET

async function zmGet(cfg: ZammadConfig, apiPath: string, params?: Record<string, string>, signal?: AbortSignal): Promise<any> {
	const url = new URL(`${cfg.baseUrl}/api/v1${apiPath}`);
	for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
	const res = await fetch(url, {
		method: "GET",
		headers: { Authorization: `Token token=${cfg.token}`, Accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		const body = (await res.text().catch(() => "")).slice(0, 200);
		throw new Error(`Zammad GET ${apiPath} failed: HTTP ${res.status} ${body}`.trim());
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Ticket number resolution — the public number (email subject [Ticket#NNN])
// is not the internal id; resolve once, then use ids where the API needs them.

interface TicketRow {
	number: string;
	title: string;
	state: string;
	group: string;
	requester: string;
	updated_at: string;
	articles: number;
}

function assetName(assets: any, kind: string, id: number | undefined | null): string {
	const entry = id != null ? assets?.[kind]?.[String(id)] : undefined;
	return entry?.name ?? (id != null ? `${kind}#${id}` : "");
}

function userName(u: any): string {
	if (!u) return "";
	if (u.name) return u.name;
	const first = (u.firstname ?? "").trim();
	const last = (u.lastname ?? "").trim();
	// LDAP-fed accounts sometimes carry the full name in both fields.
	if (first && first === last) return first;
	return `${first} ${last}`.trim() || u.login || "";
}

// Search assets carry Group/User but not TicketState — fetch the state list once per process.
let stateCache: Record<string, string> | undefined;
async function stateName(cfg: ZammadConfig, id: number | undefined | null, signal?: AbortSignal): Promise<string> {
	if (id == null) return "";
	if (!stateCache) {
		const list: any[] = await zmGet(cfg, "/ticket_states", undefined, signal);
		stateCache = {};
		for (const s of list) stateCache[String(s.id)] = s.name ?? String(s.id);
	}
	return stateCache[String(id)] ?? `state#${id}`;
}

async function ticketToRow(cfg: ZammadConfig, t: any, assets: any, signal?: AbortSignal): Promise<TicketRow> {
	return {
		number: String(t.number),
		title: t.title ?? "",
		state: await stateName(cfg, t.state_id, signal),
		group: assetName(assets, "Group", t.group_id),
		requester: userName(assets?.User?.[String(t.customer_id)]) || `user#${t.customer_id}`,
		updated_at: t.updated_at ?? "",
		articles: t.article_count ?? 0,
	};
}

async function findTicketByNumber(cfg: ZammadConfig, number: string, signal?: AbortSignal): Promise<any> {
	const clean = String(number).replace(/^#/, "").trim();
	const res = await zmGet(cfg, "/tickets/search", { query: `number:${clean}`, limit: "5" }, signal);
	for (const id of res.tickets ?? []) {
		const t = res.assets?.Ticket?.[String(id)];
		if (t && String(t.number) === clean) return { ticket: t, assets: res.assets ?? {} };
	}
	throw new Error(`No ticket with number ${clean}.`);
}

// ---------------------------------------------------------------------------
// Actions

export interface SearchResult {
	rows: TicketRow[];
	total: number;
}

export async function searchTickets(cfg: ZammadConfig, query: string, limit: number, signal?: AbortSignal): Promise<SearchResult> {
	const res = await zmGet(cfg, "/tickets/search", { query, limit: String(limit) }, signal);
	const assets = res.assets ?? {};
	const rows: TicketRow[] = [];
	for (const id of (res.tickets ?? []).slice(0, limit)) {
		const t = assets?.Ticket?.[String(id)];
		if (t) rows.push(await ticketToRow(cfg, t, assets, signal));
	}
	return { rows, total: res.tickets_count ?? rows.length };
}

export interface TicketDetail {
	number: string;
	title: string;
	state: string;
	group: string;
	requester: string;
	articles: number;
	created_at: string;
	updated_at: string;
	first_response_at: string;
	last_contact_at: string;
}

export async function getTicketByNumber(cfg: ZammadConfig, number: string, signal?: AbortSignal): Promise<TicketDetail> {
	const { ticket: t, assets } = await findTicketByNumber(cfg, number, signal);
	const row = await ticketToRow(cfg, t, assets, signal);
	return {
		...row,
		created_at: t.created_at ?? "",
		first_response_at: t.first_response_at ?? "",
		last_contact_at: t.last_contact_at ?? "",
	};
}

// ---------------------------------------------------------------------------
// Articles

const SENDER: Record<number, string> = { 1: "customer", 2: "agent", 3: "system" };

export function htmlToText(html: string): string {
	if (!html) return "";
	let s = html;
	// drop non-content blocks entirely
	s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
	// line structure
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<li[^>]*>/gi, "\n- ");
	s = s.replace(/<\/(p|div|tr|table|h[1-6]|blockquote|ul|ol)>/gi, "\n");
	// everything else: tags out
	s = s.replace(/<[^>]+>/g, "");
	// entities
	s = s.replace(/&nbsp;/gi, " ");
	s = s.replace(/&amp;/gi, "&");
	s = s.replace(/&lt;/gi, "<");
	s = s.replace(/&gt;/gi, ">");
	s = s.replace(/&quot;/gi, '"');
	s = s.replace(/&(apos|#39);/gi, "'");
	s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
	s = s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
	// tidy whitespace
	s = s.split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n");
	s = s.replace(/\n{3,}/g, "\n\n");
	return s.trim();
}

export interface ArticleOut {
	at: string;
	from: string;
	sender: string;
	text: string;
}

export interface ThreadResult {
	number: string;
	title: string;
	total: number;
	shown: number;
	omitted: number;
	articles: ArticleOut[];
	notes: string[];
}

const PER_ARTICLE_CHAR_CAP = 4000;

export async function getArticles(cfg: ZammadConfig, number: string, max: number, signal?: AbortSignal): Promise<ThreadResult> {
	const { ticket } = await findTicketByNumber(cfg, number, signal);
	const raw: any[] = await zmGet(cfg, `/ticket_articles/by_ticket/${ticket.id}`, undefined, signal);
	const total = raw.length;
	const keepFirst = Math.min(2, max, total);
	const keepLast = max - keepFirst;
	const chosen = total <= max ? raw : [...raw.slice(0, keepFirst), ...raw.slice(total - keepLast)];
	const omitted = total - chosen.length;
	const slice = chosen;
	const notes: string[] = [];
	if (omitted > 0) notes.push(`${omitted} middle article(s) omitted (kept first ${keepFirst} and last ${keepLast}).`);
	const articles: ArticleOut[] = [];
	const seen = new Set<number>();
	for (const a of slice) {
		if (seen.has(a.id)) continue;
		seen.add(a.id);
		let text = htmlToText(a.body ?? "");
		if (text.length > PER_ARTICLE_CHAR_CAP) {
			text = text.slice(0, PER_ARTICLE_CHAR_CAP) + " … [article truncated]";
			if (!notes.some((n) => n.includes("capped"))) notes.push(`Long articles capped at ${PER_ARTICLE_CHAR_CAP} chars.`);
		}
		articles.push({
			at: a.created_at ?? "",
			from: a.from ?? "",
			sender: SENDER[a.sender_id] ?? `sender_id ${a.sender_id}`,
			text,
		});
	}
	return {
		number: String(ticket.number),
		title: ticket.title ?? "",
		total,
		shown: articles.length,
		omitted,
		articles,
		notes,
	};
}

// JD-driven live incident crawler ("MCP tool", integrated as a function).
//
// Pipeline:
//   1. Use the LLM to turn a JD into targeted web-search queries + keywords.
//   2. Live web search (DuckDuckGo HTML endpoint, no API key) per query.
//   3. Fetch each result page and normalize into an Incident.
//   4. Fall back to the local crawled corpus if the web is unreachable.
//
// Exposed as a single tool-like function: crawlIncidentsForJD(jd, opts).

import { chatJSON } from "./openai";
import { loadIncidents } from "./incidents";
import type { Incident } from "./types";

const DEFAULT_MAX_RESULTS = 6;
const FETCH_TIMEOUT_MS = 8000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": UA, ...(init?.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

// ---- Step 1: derive queries from the JD ----

interface QueryPlan {
  domain: string;
  keywords: string[];
  queries: string[];
}

const QUERY_SYSTEM = `You turn a job description into web-search queries that will
find REAL, scoped production incidents / public postmortems relevant to the role.

Return STRICT JSON:
{
  "domain": string,         // e.g. "backend / SRE", "data engineering", "mobile"
  "keywords": string[],     // 4-8 technical keywords from the JD
  "queries": string[]       // 3-5 web search queries; each should target real
                            // incidents/postmortems for this role, e.g.
                            // "redis cache outage postmortem", "expired tls certificate incident"
}`;

async function derivePlan(jd: string): Promise<QueryPlan> {
  const plan = await chatJSON<QueryPlan>(
    QUERY_SYSTEM,
    `JOB DESCRIPTION:\n${jd.trim()}\n\nProduce the search plan now.`,
    0.3
  );
  return {
    domain: plan.domain || "",
    keywords: Array.isArray(plan.keywords) ? plan.keywords.slice(0, 8) : [],
    queries: Array.isArray(plan.queries) ? plan.queries.slice(0, 5) : [],
  };
}

// ---- Step 2: live web search (DuckDuckGo HTML, no API key) ----

function decodeDdgHref(href: string): string {
  // DDG wraps results as //duckduckgo.com/l/?uddg=<encoded>&...
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (href.startsWith("//")) return "https:" + href;
  return href;
}

async function webSearch(query: string, limit = 5): Promise<string[]> {
  const res = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  );
  if (!res.ok) return [];
  const html = await res.text();
  const links = Array.from(
    html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)
  )
    .map((m) => decodeDdgHref(m[1]))
    .filter((u) => /^https?:\/\//.test(u));
  return Array.from(new Set(links)).slice(0, limit);
}

// ---- Step 3: fetch + normalize a page into an Incident ----

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  return html.match(re)?.[1]?.trim() || "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchIncident(
  url: string,
  keywords: string[]
): Promise<Incident | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/html")) return null;

  const html = await res.text();
  const title =
    extractMeta(html, "og:title") ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
    url;
  const summary = extractMeta(html, "description") || extractMeta(html, "og:description");
  const body = stripTags(html);
  if (body.length < 200) return null; // not enough signal

  return {
    id: `live_${Buffer.from(url).toString("base64url").slice(0, 16)}`,
    title: title.slice(0, 200),
    source: url,
    company: hostOf(url),
    product: "",
    categories: [],
    keywords,
    summary: (summary || body.slice(0, 280)).slice(0, 500),
    description: body.slice(0, 2000),
  };
}

// ---- Fallback: JD-filtered local corpus (if the web is unreachable) ----

async function fallbackFromCorpus(
  keywords: string[],
  max: number
): Promise<Incident[]> {
  const all = await loadIncidents();
  const kw = keywords.map((k) => k.toLowerCase());
  const scored = all
    .map((inc) => {
      const hay = `${inc.title} ${inc.summary} ${inc.keywords.join(" ")}`.toLowerCase();
      const score = kw.reduce((s, k) => (k && hay.includes(k) ? s + 1 : s), 0);
      return { inc, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, max).map((s) => s.inc);
  return top.length > 0 ? top : all.slice(0, max);
}

// ---- The tool ----

export interface CrawlResult {
  plan: QueryPlan;
  incidents: Incident[];
  usedFallback: boolean;
}

/**
 * JD-driven live incident crawl tool.
 * Returns real incidents relevant to the JD, plus the derived search plan.
 */
export async function crawlIncidentsForJD(
  jd: string,
  opts: { maxResults?: number } = {}
): Promise<CrawlResult> {
  const max = opts.maxResults ?? DEFAULT_MAX_RESULTS;
  const plan = await derivePlan(jd);

  // Live search across the derived queries.
  const urlLists = await Promise.all(
    plan.queries.map((q) => webSearch(q).catch(() => [] as string[]))
  );
  const urls = Array.from(new Set(urlLists.flat())).slice(0, max * 2);

  const fetched = await Promise.all(
    urls.map((u) => fetchIncident(u, plan.keywords).catch(() => null))
  );
  const incidents = fetched.filter((x): x is Incident => x !== null).slice(0, max);

  if (incidents.length > 0) {
    return { plan, incidents, usedFallback: false };
  }

  // Web unreachable / blocked -> graceful fallback to local corpus.
  const fallback = await fallbackFromCorpus(plan.keywords, max);
  return { plan, incidents: fallback, usedFallback: true };
}

// JD-driven live incident crawler ("MCP tool", integrated as a function).
//
// Sources (high-signal technical, no scraping of random web pages):
//   - GitHub Issues search API   -> real open-source bugs
//   - Stack Exchange API (SO)     -> real debugging Q&A
//   - local crawled corpus        -> graceful fallback when both are unreachable
//
// Pipeline:
//   1. LLM turns the JD into technical search queries + keywords.
//   2. Query GitHub + Stack Overflow live for each query.
//   3. Normalize results into Incident.
//   4. Fall back to the local corpus if nothing usable came back.

import { chatJSON } from "./openai";
import { loadIncidents } from "./incidents";
import type { Difficulty, Incident } from "./types";

const DEFAULT_MAX_RESULTS = 8;
const FETCH_TIMEOUT_MS = 9000;
const PER_SOURCE = 5;
const UA = "intervieweragent-crawler";

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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x?[0-9a-f]+;/gi, " ");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Step 1: derive search plan from the JD ----

interface QueryPlan {
  domain: string;
  keywords: string[];
  exclusions: string[];
  queries: string[];
}

const QUERY_SYSTEM = `You turn a job description + required skills + an explicit list
of EXCLUDED topics into search queries that find REAL, scoped technical
bugs/incidents on GitHub Issues and Stack Overflow.

Rules:
- Every query MUST be about the REQUIRED SKILLS.
- NEVER write a query about an EXCLUDED topic. Treat exclusions as hard limits.
- Expand each excluded topic into its closely-related terms so they can be
  filtered later. E.g. "ML" -> ["ML","machine learning","model training",
  "inference","data science","neural network","LLM"].

Each query reads like an engineer debugging: concrete symptoms, error messages,
or component + failure mode. Examples: "redis connection pool timeout",
"postgres deadlock under load", "nginx 502 upstream timeout".

Return STRICT JSON:
{
  "domain": string,        // e.g. "backend / SRE", "data engineering"
  "keywords": string[],    // 4-8 in-scope technical keywords
  "exclusions": string[],  // excluded topics EXPANDED into related terms
  "queries": string[]      // 3-5 concrete, in-scope debugging queries
}`;

function difficultyHint(d: Difficulty): string {
  switch (d) {
    case "junior":
      return "COMPLEXITY TARGET: prefer simple, single-component bugs with a clear cause-effect chain. Avoid multi-system cascades.";
    case "senior":
      return "COMPLEXITY TARGET: prefer complex, multi-component failures with non-obvious root causes. Avoid trivially simple bugs.";
    default:
      return "COMPLEXITY TARGET: prefer moderately complex bugs with some ambiguity but still diagnosable by a mid-level engineer.";
  }
}

async function derivePlan(
  jd: string,
  skills: string,
  exclude: string,
  difficulty: Difficulty = "mid"
): Promise<QueryPlan> {
  const plan = await chatJSON<QueryPlan>(
    QUERY_SYSTEM,
    `JOB DESCRIPTION:\n${jd.trim()}\n\nREQUIRED SKILLS:\n${
      skills.trim() || "(none specified)"
    }\n\nEXCLUDED TOPICS (do NOT crawl anything about these):\n${
      exclude.trim() || "(none)"
    }\n\n${difficultyHint(difficulty)}\n\nProduce the search plan now.`,
    0.3
  );
  // Seed exclusions with the user's raw terms so nothing is lost if the model
  // forgets to echo them.
  const rawExcl = exclude
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const modelExcl = Array.isArray(plan.exclusions) ? plan.exclusions : [];
  const exclusions = Array.from(
    new Set([...rawExcl, ...modelExcl].map((s) => s.trim()).filter(Boolean))
  ).slice(0, 16);

  return {
    domain: plan.domain || "",
    keywords: Array.isArray(plan.keywords) ? plan.keywords.slice(0, 8) : [],
    exclusions,
    queries: Array.isArray(plan.queries) ? plan.queries.slice(0, 5) : [],
  };
}

// ---- Step 2a: GitHub Issues search ----

interface GitHubIssue {
  id: number;
  title: string;
  html_url: string;
  body: string | null;
  labels: Array<{ name: string } | string>;
  reactions?: { total_count?: number };
  pull_request?: unknown;
}

function repoFromIssueUrl(url: string): string {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/issues/);
  return m ? m[1] : "github";
}

async function searchGitHub(query: string): Promise<Incident[]> {
  const q = encodeURIComponent(`${query} in:title,body is:issue`);
  const url = `https://api.github.com/search/issues?q=${q}&sort=reactions&order=desc&per_page=${PER_SOURCE}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: GitHubIssue[] };
  const items = (data.items || []).filter((it) => !it.pull_request);

  return items
    .filter((it) => (it.body || "").length > 120)
    .map((it) => {
      const labels = (it.labels || []).map((l) =>
        typeof l === "string" ? l : l.name
      );
      const body = stripTags(it.body || "");
      return {
        id: `gh_${it.id}`,
        title: decodeEntities(it.title).slice(0, 200),
        source: it.html_url,
        company: repoFromIssueUrl(it.html_url),
        product: "GitHub issue",
        categories: ["github-issue"],
        keywords: labels.slice(0, 8),
        summary: body.slice(0, 400),
        description: body.slice(0, 2000),
      } satisfies Incident;
    });
}

// ---- Step 2b: Stack Overflow search ----

interface SOQuestion {
  question_id: number;
  title: string;
  link: string;
  body?: string;
  tags?: string[];
  is_answered?: boolean;
  score?: number;
}

async function searchStackOverflow(query: string): Promise<Incident[]> {
  const params = new URLSearchParams({
    order: "desc",
    sort: "relevance",
    q: query,
    site: "stackoverflow",
    filter: "withbody",
    pagesize: String(PER_SOURCE),
    answers: "1",
  });
  if (process.env.STACKEXCHANGE_KEY) {
    params.set("key", process.env.STACKEXCHANGE_KEY);
  }
  const url = `https://api.stackexchange.com/2.3/search/advanced?${params}`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: SOQuestion[] };
  const items = data.items || [];

  return items
    .filter((q) => q.is_answered && (q.body || "").length > 120)
    .map((q) => {
      const body = stripTags(q.body || "");
      return {
        id: `so_${q.question_id}`,
        title: decodeEntities(q.title).slice(0, 200),
        source: q.link,
        company: "stackoverflow.com",
        product: "Stack Overflow",
        categories: ["stackoverflow"],
        keywords: (q.tags || []).slice(0, 8),
        summary: body.slice(0, 400),
        description: body.slice(0, 2000),
      } satisfies Incident;
    });
}

// ---- Step 3: QC agent (relevance + scope gate) ----

interface QCVerdict {
  id: string;
  keep: boolean;
  relevance: number;
  reason: string;
}

const MIN_RELEVANCE = 0.5;

const QC_SYSTEM = `You are a STRICT quality-control reviewer that decides whether a
crawled item is a good basis for an ENTRY-LEVEL technical evaluation for a role.

Keep an item only if ALL of these hold:
- It is a CONCRETE technical bug / incident / failure (NOT a feature request,
  documentation, opinion, "how to install", or a vague/broad question).
- It ALIGNS with the role's REQUIRED SKILLS / domain.
- It does NOT touch any EXCLUDED topic. Exclusions are HARD constraints: if the
  spec says "no ML", reject anything about machine learning, models, training,
  inference, data science, LLMs, etc. — even if it otherwise looks relevant.
- It is IN SCOPE: a single, scoped problem an entry-level engineer could
  plausibly diagnose. Reject off-topic, org-specific, or overly broad items.

Be harsh: when unsure, reject (especially on exclusions). Return STRICT JSON:
{
  "verdicts": [
    { "id": string, "keep": boolean, "relevance": number, "reason": string }
  ]
}
where relevance is 0..1 (how well it matches the required skills/scope).`;

function buildQCPrompt(
  jd: string,
  skills: string,
  plan: QueryPlan,
  candidates: Incident[],
  difficulty: Difficulty = "mid"
): string {
  const list = candidates
    .map(
      (c) =>
        `- id: ${c.id}\n  title: ${c.title}\n  source: ${c.company}\n  summary: ${c.summary.slice(0, 300)}`
    )
    .join("\n");

  const complexityNote =
    difficulty === "junior"
      ? "COMPLEXITY: prefer single-component, clearly-scoped bugs. Penalize multi-system cascades or items requiring org-specific context."
      : difficulty === "senior"
        ? "COMPLEXITY: prefer complex, multi-component failures with subtle root causes. Penalize trivially obvious bugs."
        : "COMPLEXITY: prefer moderately complex bugs — some ambiguity but still diagnosable by a mid-level engineer.";

  return `ROLE DOMAIN: ${plan.domain}
REQUIRED SKILLS: ${skills || plan.keywords.join(", ")}
EXCLUDED / OUT-OF-SCOPE TOPICS (reject any item touching these): ${
    plan.exclusions.length ? plan.exclusions.join(", ") : "(none)"
  }
${complexityNote}

JOB DESCRIPTION:
${jd.trim()}

CANDIDATE ITEMS:
${list}

Review every item and return verdicts for each id.`;
}

async function qcFilter(
  jd: string,
  skills: string,
  plan: QueryPlan,
  candidates: Incident[],
  difficulty: Difficulty = "mid"
): Promise<{ kept: Incident[]; rejections: string[] }> {
  if (candidates.length === 0) return { kept: [], rejections: [] };

  const { verdicts } = await chatJSON<{ verdicts: QCVerdict[] }>(
    QC_SYSTEM,
    buildQCPrompt(jd, skills, plan, candidates, difficulty),
    0.2
  );
  const byId = new Map((verdicts || []).map((v) => [v.id, v]));

  const kept: Incident[] = [];
  const rejections: string[] = [];
  for (const c of candidates) {
    const v = byId.get(c.id);
    if (v && v.keep && (v.relevance ?? 0) >= MIN_RELEVANCE) {
      kept.push(c);
    } else {
      rejections.push(`${c.title} — ${v?.reason || "off-scope / low relevance"}`);
    }
  }
  // Best matches first.
  kept.sort((a, b) => (byId.get(b.id)?.relevance ?? 0) - (byId.get(a.id)?.relevance ?? 0));
  return { kept, rejections };
}

// ---- Step 4: query refinement for re-crawl ----

const REFINE_SYSTEM = `You refine technical search queries to find BETTER, more
in-scope, skill-aligned bugs/incidents on GitHub Issues and Stack Overflow.

You are given the role, required skills, EXCLUDED topics, the previous queries,
and reasons the previous results were rejected. Produce DIFFERENT, more targeted
queries that avoid the rejected pitfalls and NEVER touch an excluded topic.

Return STRICT JSON: { "queries": string[] }  // 3-5 concrete debugging queries`;

async function refineQueries(
  jd: string,
  skills: string,
  plan: QueryPlan,
  rejections: string[]
): Promise<string[]> {
  const { queries } = await chatJSON<{ queries: string[] }>(
    REFINE_SYSTEM,
    `ROLE DOMAIN: ${plan.domain}
REQUIRED SKILLS: ${skills || plan.keywords.join(", ")}
EXCLUDED TOPICS (never query these): ${
      plan.exclusions.length ? plan.exclusions.join(", ") : "(none)"
    }

JOB DESCRIPTION:
${jd.trim()}

PREVIOUS QUERIES:
${plan.queries.map((q) => `- ${q}`).join("\n")}

WHY PREVIOUS RESULTS WERE REJECTED:
${rejections.slice(0, 10).map((r) => `- ${r}`).join("\n") || "- (too few / no results)"}

Produce improved queries now.`,
    0.5
  );
  return Array.isArray(queries) ? queries.slice(0, 5) : [];
}

// ---- deterministic exclusion guard ----

function dropExcluded(incidents: Incident[], exclusions: string[]): Incident[] {
  const terms = exclusions
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length >= 2);
  if (terms.length === 0) return incidents;
  return incidents.filter((inc) => {
    const hay =
      `${inc.title} ${inc.summary} ${inc.keywords.join(" ")}`.toLowerCase();
    // Match excluded term as a whole word to avoid false positives.
    return !terms.some((t) =>
      new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}([^a-z0-9]|$)`).test(hay)
    );
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- search across sources, deduped against already-seen URLs ----

async function searchAll(
  queries: string[],
  seen: Set<string>
): Promise<Incident[]> {
  const perQuery = await Promise.all(
    queries.flatMap((q) => [
      searchGitHub(q).catch(() => [] as Incident[]),
      searchStackOverflow(q).catch(() => [] as Incident[]),
    ])
  );
  const out: Incident[] = [];
  for (const inc of perQuery.flat()) {
    if (inc.source && !seen.has(inc.source)) {
      seen.add(inc.source);
      out.push(inc);
    }
  }
  return out;
}

// ---- Fallback: JD-filtered local corpus ----

async function fallbackFromCorpus(
  keywords: string[],
  max: number
): Promise<Incident[]> {
  const all = await loadIncidents();
  const kw = keywords.map((k) => k.toLowerCase());
  const scored = all
    .map((inc) => {
      const hay =
        `${inc.title} ${inc.summary} ${inc.keywords.join(" ")}`.toLowerCase();
      const score = kw.reduce((s, k) => (k && hay.includes(k) ? s + 1 : s), 0);
      return { inc, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored
    .filter((s) => s.score > 0)
    .slice(0, max)
    .map((s) => s.inc);
  return top.length > 0 ? top : all.slice(0, max);
}

// ---- The tool ----

export interface CrawlResult {
  plan: QueryPlan;
  incidents: Incident[];
  usedFallback: boolean;
  /** How many search+QC passes ran. */
  attempts: number;
  /** Candidates seen vs approved by the QC agent. */
  reviewed: number;
  approved: number;
}

/**
 * JD-driven live incident crawl tool with a QC + re-crawl loop.
 *
 * 1. Derive queries from the JD.
 * 2. Search GitHub Issues + Stack Overflow.
 * 3. A QC agent keeps only items that align with the required skills and are
 *    in scope for an entry-level evaluation.
 * 4. If too few pass, refine the queries and crawl again (up to maxAttempts).
 * 5. Fall back to the local corpus if nothing usable is found.
 */
export async function crawlIncidentsForJD(
  jd: string,
  opts: {
    maxResults?: number;
    skills?: string;
    exclude?: string;
    minResults?: number;
    maxAttempts?: number;
    difficulty?: Difficulty;
  } = {}
): Promise<CrawlResult> {
  const max = opts.maxResults ?? DEFAULT_MAX_RESULTS;
  const minResults = opts.minResults ?? 4;
  const maxAttempts = opts.maxAttempts ?? 3;
  const skills = (opts.skills || "").trim();
  const exclude = (opts.exclude || "").trim();
  const difficulty: Difficulty = opts.difficulty ?? "mid";

  const plan = await derivePlan(jd, skills, exclude, difficulty);
  const seen = new Set<string>();
  const approved: Incident[] = [];
  const rejections: string[] = [];
  let queries = plan.queries;
  let attempts = 0;
  let reviewed = 0;

  while (attempts < maxAttempts && approved.length < minResults && queries.length) {
    attempts++;
    const raw = await searchAll(queries, seen);
    // Deterministic guard: drop anything literally mentioning an excluded term
    // before it even reaches the QC agent.
    const found = dropExcluded(raw, plan.exclusions);
    if (found.length > 0) {
      reviewed += found.length;
      const { kept, rejections: rej } = await qcFilter(jd, skills, plan, found, difficulty);
      for (const inc of kept) {
        if (!approved.some((a) => a.source === inc.source)) approved.push(inc);
      }
      rejections.push(...rej);
    }
    if (approved.length >= minResults) break;
    if (attempts < maxAttempts) {
      queries = await refineQueries(jd, skills, plan, rejections).catch(
        () => [] as string[]
      );
    }
  }

  if (approved.length > 0) {
    return {
      plan,
      incidents: approved.slice(0, max),
      usedFallback: false,
      attempts,
      reviewed,
      approved: approved.length,
    };
  }

  const fallback = await fallbackFromCorpus(
    [...plan.keywords, ...skills.split(/[,\s]+/).filter(Boolean)],
    max
  );
  return {
    plan,
    incidents: fallback,
    usedFallback: true,
    attempts,
    reviewed,
    approved: 0,
  };
}

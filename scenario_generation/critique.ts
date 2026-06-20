import { chatJSON } from "./openai";
import {
  MAX_FOLLOWUP_DEPTH,
  type Criterion,
  type CritiqueOutput,
  type Scenario,
} from "./types";

const SYSTEM_PROMPT = `You are an expert hiring rubric designer.

Given an evaluation scenario, produce a scoring rubric that a hiring panel can use
to assess a candidate. Do NOT simulate the interview; only design the rubric.

## Breadth requirement
Generate 6-8 TOP-LEVEL criteria — one per distinct skill dimension the scenario
tests. Do NOT collapse multiple skills into one node. Every todo and focus area
in the scenario must map to at least one criterion.

Dimensions you MUST cover (adapt labels to the specific scenario):
1. Signal reading — how the candidate interprets the observable data
2. Hypothesis formation — how they generate and rank candidate explanations
3. Red herring handling — whether they actively dismiss irrelevant signals
4. Root cause identification — how they trace symptoms back to cause
5. Immediate mitigation — actions to stop the bleeding right now
6. Proper fix — the correct long-term resolution
7. Prevention / process — what they'd add so this class of bug can't ship again
8. Communication — how they explain findings to a non-technical stakeholder

Add further top-level criteria for any additional skills the scenario specifically
probes beyond these eight.

## Permissiveness requirement
Each "evidence" field must describe the PATTERN of a satisfactory response, not
a single correct answer. Where multiple valid approaches exist, list them:

  "Candidate demonstrates X. Acceptable approaches include: [A], [B], or [C].
   Does not require [overly specific detail] — directional correctness is
   sufficient for full credit."

Never write evidence as a single required statement the candidate must hit word-
for-word. Interviewers will use this rubric to score real, varied answers.

## Followups
Use followups to represent partial-credit gradations within a dimension:
- Full credit: candidate [does X completely]
- Partial credit: candidate [shows correct direction but misses Y]
- Minimal credit: candidate [names the right area but cannot explain mechanism]

## Schema
Each node:
- "evidence": permissive description including acceptable alternatives (see above)
- "tags": 1-3 short lowercase tags
- "score": relative weight among siblings; siblings at every level sum to 1.0
- "followups": child criteria (same shape); use [] when no gradation is needed

Return STRICT JSON only:
{
  "criteria": [
    { "evidence": string, "tags": string[], "score": number, "followups": [ ... ] }
  ]
}`;

function buildUserPrompt(scenario: Scenario): string {
  const todos = scenario.todos?.length
    ? scenario.todos.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "(none)";

  const scopeFocus = scenario.scope?.focus?.join(", ") || "(none)";
  const scopeSkip = scenario.scope?.skip?.join(", ") || "(none)";

  return `SCENARIO BRIEF:
${scenario.brief}

CANDIDATE TASKS (what the candidate is explicitly asked to do — every task needs
at least one rubric criterion):
${todos}

SCOPE — FOCUS ON: ${scopeFocus}
SCOPE — SKIP: ${scopeSkip}

INTERNAL FOCUS AREAS (for context):
${scenario.focusAreas.map((f) => `- ${f}`).join("\n") || "- (none)"}

TARGET SKILLSET:
${scenario.derivedFrom.skillset.map((s) => `- ${s}`).join("\n") || "- (none)"}

Design the full rubric now. Ensure every candidate task maps to at least one
top-level criterion, and that all evidence descriptions are permissive (list
acceptable alternative approaches, not a single required answer).`;
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

interface RawCriterion {
  evidence?: unknown;
  tags?: unknown;
  score?: unknown;
  followups?: unknown;
}

/**
 * Normalize a raw criterion list from the model into valid Criterion nodes:
 * - coerce/clean fields and assign ids
 * - enforce MAX_FOLLOWUP_DEPTH (drop children deeper than allowed)
 * - normalize sibling scores so they sum to 1 at every level
 */
function normalizeLevel(raw: unknown, depth: number): Criterion[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const nodes: Criterion[] = raw.map((item) => {
    const c = (item ?? {}) as RawCriterion;

    const evidence = typeof c.evidence === "string" ? c.evidence.trim() : "";

    const tags = Array.isArray(c.tags)
      ? Array.from(
          new Set(
            (c.tags as unknown[])
              .map((t) => String(t).trim().replace(/^#/, "").toLowerCase())
              .filter((t) => t.length > 0)
          )
        )
      : [];

    const rawScore = typeof c.score === "number" ? c.score : Number(c.score);
    const score = Number.isFinite(rawScore) && rawScore > 0 ? rawScore : 0;

    // Enforce max depth: children only allowed while depth < MAX_FOLLOWUP_DEPTH.
    const followups =
      depth < MAX_FOLLOWUP_DEPTH ? normalizeLevel(c.followups, depth + 1) : [];

    return {
      id: makeId("crit"),
      evidence,
      tags,
      score,
      followups,
    };
  });

  // Normalize sibling scores to sum to 1 (equal split if all zero).
  const total = nodes.reduce((sum, n) => sum + n.score, 0);
  if (total > 0) {
    for (const n of nodes) n.score = round(n.score / total);
  } else {
    const even = round(1 / nodes.length);
    for (const n of nodes) n.score = even;
  }
  fixRounding(nodes);

  return nodes;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Nudge the largest sibling so the rounded scores sum to exactly 1. */
function fixRounding(nodes: Criterion[]): void {
  if (nodes.length === 0) return;
  const sum = nodes.reduce((s, n) => s + n.score, 0);
  const drift = round(1 - sum);
  if (drift !== 0) {
    const target = nodes.reduce((a, b) => (b.score >= a.score ? b : a));
    target.score = round(target.score + drift);
  }
}

interface RawCritique {
  criteria?: unknown;
}

/** Stage 2: generate the recursive scoring-rubric tree for a scenario. */
export async function critiqueScenario(
  scenario: Scenario
): Promise<CritiqueOutput> {
  const raw = await chatJSON<RawCritique>(
    SYSTEM_PROMPT,
    buildUserPrompt(scenario)
  );

  const criteria = normalizeLevel(raw.criteria, 1);
  if (criteria.length === 0) {
    throw new Error("Critique returned no criteria.");
  }

  return { scenarioId: scenario.id, criteria };
}

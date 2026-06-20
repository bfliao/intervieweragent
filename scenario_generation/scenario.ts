import { chatJSON } from "./openai";
import type { Difficulty, Incident, PipelineInput, Scenario } from "./types";

// ---- Difficulty-specific prompt fragments ----

function difficultyScope(d: Difficulty): string {
  switch (d) {
    case "junior":
      return `DIFFICULTY — Junior / Entry-level:
- Single failing component. Short, linear diagnostic path (2-3 hops).
- 3-4 observable signals; exactly 1 red herring (obvious but misleading).
- No need to know distributed-system internals deeply.
- A competent junior should diagnose this in ~20 min.`;
    case "senior":
      return `DIFFICULTY — Senior / Staff:
- Multi-component failure chain. Non-obvious root cause requires correlating 3+ data sources.
- 6-8 observable signals; 2-3 believable red herrings that point confidently in the wrong direction.
- Demands expert-level intuition about the specific technology stack.
- Even a strong senior might need 35-50 min.`;
    default: // mid
      return `DIFFICULTY — Mid-level:
- 1-2 interacting components. Moderate ambiguity; cause is not immediately obvious.
- 4-6 observable signals; 1-2 plausible red herrings.
- Requires solid domain knowledge but not deep expertise.
- A solid mid-level engineer should diagnose this in ~30 min.`;
  }
}

// ---- Stage 1: draft generation ----

const DRAFT_SYSTEM = `You are an expert hiring scenario designer.

Given a REAL production incident and job context, produce ONE concrete evaluation
scenario for the stated difficulty level.

Hard requirements:
- GROUND every detail in the real incident's facts — use its actual symptoms,
  components, and timeline. Do NOT invent unrelated systems.
- Present a CONCRETE on-call situation: specific numbers, exact error messages,
  named metrics, and observable signals a candidate can reason about.
- DO NOT reveal the root cause in the brief. The candidate must diagnose it.
- Keep the brief to 1-2 short paragraphs followed by a bullet list of observable
  signals (real + red herrings mixed together — do not label them).

Also produce candidate-facing instructions:
- "todos": 3-5 concrete tasks the candidate must complete, written as direct
  prompts (e.g. "Walk us through your diagnostic process step by step",
  "Identify the most likely root cause and explain your reasoning").
  Tasks should match the difficulty level — junior tasks are simpler and
  more guided; senior tasks require open-ended system reasoning.
- "scope.focus": 2-4 short phrases naming the areas the candidate SHOULD spend
  time on (e.g. "diagnostic reasoning", "signal prioritization").
- "scope.skip": 1-3 short phrases naming what is explicitly OUT OF SCOPE
  (e.g. "writing actual code", "capacity planning", "post-incident review").

"focusAreas" are INTERNAL labels for the hiring panel only — they are NOT
shown to the candidate. Keep them distinct from "scope.focus".

Return STRICT JSON only:
{
  "brief": string,
  "todos": string[],
  "scope": { "focus": string[], "skip": string[] },
  "focusAreas": string[]
}`;

function buildDraftPrompt(
  input: PipelineInput,
  incident: Incident,
  difficulty: Difficulty
): string {
  const team = input.teamInput
    .map((m, i) => `- ${m.memberName || `Member ${i + 1}`}: ${m.description.trim()}`)
    .join("\n");

  return `REAL INCIDENT:
Title: ${incident.title}
Company/Product: ${incident.company} — ${incident.product}
Keywords: ${incident.keywords.join(", ")}
Summary: ${incident.summary}
Details: ${incident.description}

JOB DESCRIPTION:
${input.jd.trim()}

TARGET SKILLSET:
${input.skillset.map((s) => `- ${s}`).join("\n") || "- (none)"}

TEAM MEMBERS' DESIRED COWORKER:
${team || "- (none provided)"}

${difficultyScope(difficulty)}

Produce a concrete scenario grounded in the real incident.`;
}

// ---- Stage 2: self-critique ----

const SELF_CRITIQUE_SYSTEM = `You are a strict scenario quality auditor for a technical hiring assessment.

Review the draft scenario and identify concrete issues in these areas:
1. ROOT CAUSE LEAKAGE — does the brief accidentally name or strongly hint at the answer?
2. SIGNAL SPECIFICITY — are signals vague? (need exact numbers, error codes, metric names)
3. RED HERRING QUALITY — are decoy signals too obvious, too similar to real signals, or mislabeled?
4. DIFFICULTY FIT — is the scope, signal count, and complexity correct for the stated level?
5. GROUNDING — does it read like a real system failure or generic boilerplate?

Set needs_revision to true only if there are 2 or more significant issues.

Return STRICT JSON: { "issues": string[], "needs_revision": boolean }`;

interface SelfCritiqueResult {
  issues: string[];
  needs_revision: boolean;
}

function buildCritiquePrompt(draft: ScenarioDraft, difficulty: Difficulty): string {
  return `DIFFICULTY LEVEL: ${difficulty}

BRIEF:
${draft.brief}

TODOS: ${draft.todos.join(" | ")}
SCOPE FOCUS: ${draft.scope?.focus?.join(", ")}
SCOPE SKIP: ${draft.scope?.skip?.join(", ")}
FOCUS AREAS (internal): ${draft.focusAreas.join(", ")}

Audit this scenario now.`;
}

// ---- Stage 3: revision ----

const REVISE_SYSTEM = `You are an expert scenario editor. Fix every listed issue in the draft while preserving the core incident grounding and difficulty level. Do not introduce new systems not in the original incident.

Return STRICT JSON only — same shape as the original draft:
{
  "brief": string,
  "todos": string[],
  "scope": { "focus": string[], "skip": string[] },
  "focusAreas": string[]
}`;

function buildRevisePrompt(
  draft: ScenarioDraft,
  issues: string[],
  difficulty: Difficulty
): string {
  return `DIFFICULTY LEVEL: ${difficulty}

ORIGINAL DRAFT:
Brief: ${draft.brief}
Todos: ${draft.todos.join(" | ")}
Scope focus: ${draft.scope?.focus?.join(", ")}
Scope skip: ${draft.scope?.skip?.join(", ")}
Focus areas: ${draft.focusAreas.join(", ")}

ISSUES TO FIX:
${issues.map((i) => `- ${i}`).join("\n")}

Produce the revised scenario now.`;
}

// ---- Shared helpers ----

interface ScenarioDraft {
  brief: string;
  todos: string[];
  scope: { focus: string[]; skip: string[] };
  focusAreas: string[];
}

function makeId(): string {
  return `scn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Public API ----

export async function generateScenario(
  input: PipelineInput,
  incident: Incident,
  opts: { difficulty?: Difficulty } = {}
): Promise<Scenario> {
  const difficulty: Difficulty = opts.difficulty ?? input.difficulty ?? "mid";

  // Step 1: generate draft
  let draft = await chatJSON<ScenarioDraft>(
    DRAFT_SYSTEM,
    buildDraftPrompt(input, incident, difficulty)
  );
  if (!draft.brief?.trim()) throw new Error("Scenario generation returned an empty brief.");

  // Step 2: self-critique (low temperature — deterministic auditing)
  let issues: string[] = [];
  try {
    const audit = await chatJSON<SelfCritiqueResult>(
      SELF_CRITIQUE_SYSTEM,
      buildCritiquePrompt(draft, difficulty),
      0.2
    );
    issues = Array.isArray(audit.issues) ? audit.issues : [];
    if (audit.needs_revision && issues.length > 0) {
      // Step 3: revise only when the auditor flagged real problems
      const revised = await chatJSON<ScenarioDraft>(
        REVISE_SYSTEM,
        buildRevisePrompt(draft, issues, difficulty)
      );
      if (revised.brief?.trim()) draft = revised;
    }
  } catch {
    // Self-critique is best-effort — don't fail the whole generation
  }

  return {
    id: makeId(),
    brief: draft.brief.trim(),
    todos: Array.isArray(draft.todos) ? draft.todos.filter(Boolean) : [],
    scope: {
      focus: Array.isArray(draft.scope?.focus) ? draft.scope.focus.filter(Boolean) : [],
      skip: Array.isArray(draft.scope?.skip) ? draft.scope.skip.filter(Boolean) : [],
    },
    focusAreas: Array.isArray(draft.focusAreas) ? draft.focusAreas : [],
    difficulty,
    derivedFrom: { ...input, difficulty },
    groundedOn: {
      incidentId: incident.id,
      title: incident.title,
      source: incident.source,
    },
    createdAt: new Date().toISOString(),
  };
}

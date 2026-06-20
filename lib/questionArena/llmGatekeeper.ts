import { readFileSync } from "fs";
import path from "path";
import OpenAI from "openai";
import type {
  GatekeeperDecision,
  QuestionClassification,
  ScenarioConfig,
} from "./types";
import { gatekeepQuestion } from "./answerer";

const VALID_CLASSIFICATIONS: QuestionClassification[] = [
  "irrelevant",
  "broad",
  "targeted",
  "sharp",
  "scattershot",
];

function loadGatekeeperPrompt(): string {
  return readFileSync(
    path.join(process.cwd(), "prompts", "gatekeeper.md"),
    "utf8"
  );
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const object = trimmed.match(/\{[\s\S]*\}/);
  return object?.[0] ?? trimmed;
}

function validateFactIds(ids: unknown, validIds: string[]): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter(
    (id): id is string => typeof id === "string" && validIds.includes(id)
  );
}

function normalizeDecision(
  raw: Record<string, unknown>,
  scenario: ScenarioConfig,
  alreadyUnlockedFactIds: string[]
): GatekeeperDecision {
  const classification = VALID_CLASSIFICATIONS.includes(
    raw.classification as QuestionClassification
  )
    ? (raw.classification as QuestionClassification)
    : "broad";

  const hiddenFactIds = scenario.hiddenFacts.map((f) => f.id);
  const ambientFactIds = scenario.ambientFacts.map((f) => f.id);

  // Only accept newly unlocked facts (filter out already-unlocked ones)
  const rawUnlocked = validateFactIds(raw.unlockedFactIds, hiddenFactIds);
  const newUnlocked = rawUnlocked.filter(
    (id) => !alreadyUnlockedFactIds.includes(id)
  );
  // Cap at 2 per question
  const unlockedFactIds = newUnlocked.slice(0, 2);

  const validAmbient = validateFactIds(raw.ambientFactIds, ambientFactIds);

  const rationale =
    typeof raw.rationale === "string" && raw.rationale.length > 0
      ? raw.rationale
      : "LLM gatekeeper decision.";

  return {
    classification,
    unlockedFactIds,
    ambientFactIds: validAmbient.slice(0, 3),
    rationale,
  };
}

export interface LlmGatekeeperResult {
  decision: GatekeeperDecision;
  source: "llm" | "deterministic-fallback";
  warning?: string;
}

export async function llmGatekeepQuestion(
  question: string,
  scenario: ScenarioConfig,
  unlockedFactIds: string[],
  options?: {
    baseURL?: string;
    apiKey?: string;
    model?: string;
    gatekeeperPrompt?: string;
  }
): Promise<LlmGatekeeperResult> {
  const baseURL = options?.baseURL || process.env.OPENAI_BASE_URL;
  const apiKey = options?.apiKey || process.env.OPENAI_API_KEY || "dummy";
  const model = options?.model || process.env.OPENAI_MODEL || "qwen2.5-32b";

  // If no LLM endpoint, fall back to deterministic
  if (!baseURL) {
    return {
      decision: gatekeepQuestion(question, scenario, unlockedFactIds),
      source: "deterministic-fallback",
      warning: "OPENAI_BASE_URL not set; used deterministic gatekeeper.",
    };
  }

  const prompt = options?.gatekeeperPrompt || loadGatekeeperPrompt();
  const client = new OpenAI({ apiKey, baseURL });

  // Build critique evidence summary for the LLM if available
  const critiqueEvidence = scenario.critique?.criteria?.length
    ? scenario.critique.criteria.map((c) => ({
        id: c.id,
        evidence: c.evidence,
        tags: c.tags,
        weight: c.score,
      }))
    : undefined;

  const payload: Record<string, unknown> = {
    scenario: {
      title: scenario.title,
      role: scenario.role,
      candidatePrompt: scenario.candidatePrompt,
      todos: scenario.todos,
      scope: scenario.scope,
      persona: {
        name: scenario.persona.name,
        role: scenario.persona.role,
      },
    },
    hiddenFacts: scenario.hiddenFacts.map((f) => ({
      id: f.id,
      title: f.title,
      fact: f.fact,
      category: f.category,
      unlockTriggers: f.unlockTriggers,
      whyItMatters: f.whyItMatters,
    })),
    ambientFacts: scenario.ambientFacts.map((f) => ({
      id: f.id,
      fact: f.fact,
      whenToReveal: f.whenToReveal,
    })),
    alreadyUnlockedFactIds: unlockedFactIds,
    candidateQuestion: question,
  };

  if (critiqueEvidence) {
    payload.critiqueEvidence = critiqueEvidence;
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.1,
      max_tokens: 400,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>;
    const decision = normalizeDecision(parsed, scenario, unlockedFactIds);

    return { decision, source: "llm" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Fall back to deterministic gatekeeper on any failure
    return {
      decision: gatekeepQuestion(question, scenario, unlockedFactIds),
      source: "deterministic-fallback",
      warning: `LLM gatekeeper failed; used deterministic fallback. ${message}`,
    };
  }
}

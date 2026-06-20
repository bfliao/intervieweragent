import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import archetypes from "@/data/manager-personas/archetypes.json";
import type {
  AmbientFact,
  HiddenFact,
  ScenarioConfig,
  TrapAssumption,
} from "@/lib/questionArena/types";

export const runtime = "nodejs";

interface ProcessScenarioRequest {
  rawStoryline: string;
  targetRole?: string;
  processorPrompt?: string;
}

interface ProcessScenarioResponse {
  scenario: ScenarioConfig;
  modelUsed: string;
  source: "model" | "fallback";
  warning?: string;
  rawModelOutput?: string;
}

const PROCESSOR_TIMEOUT_MS = 120000;

function defaultProcessorPrompt() {
  return readFileSync(
    path.join(process.cwd(), "prompts", "scenario-processor.md"),
    "utf8"
  );
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || "generated_scenario";
}

function firstUsefulLine(value: string) {
  return (
    value
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) || "A manager sends an ambiguous work request."
  );
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const object = trimmed.match(/\{[\s\S]*\}/);
  return object?.[0] ?? trimmed;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeKeywordList(value: unknown, fallback: string[]) {
  const items = asStringArray(value);
  return items.length > 0 ? items : fallback;
}

function normalizeAmbientFacts(value: unknown): AmbientFact[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index): AmbientFact | null => {
      if (typeof item === "string") {
        return {
          id: `ambient_${index + 1}`,
          fact: item,
          whenToReveal: ["context", "current", "team", "detail"],
        };
      }

      if (!item || typeof item !== "object") return null;
      const fact = item as Partial<AmbientFact>;
      if (!fact.fact) return null;

      return {
        id: fact.id || `ambient_${index + 1}`,
        fact: fact.fact,
        whenToReveal: normalizeKeywordList(fact.whenToReveal, [
          "context",
          "current",
          "team",
          "detail",
        ]),
      };
    })
    .filter((item): item is AmbientFact => Boolean(item));
}

function normalizeHiddenFacts(value: unknown): HiddenFact[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index): HiddenFact | null => {
      if (!item || typeof item !== "object") return null;
      const fact = item as Partial<HiddenFact>;
      if (!fact.fact) return null;
      const id = fact.id || `hidden_${index + 1}`;
      const title = fact.title || id.replace(/_/g, " ");

      return {
        id,
        title,
        fact: fact.fact,
        category: fact.category || "context",
        weight: Number(fact.weight || 1),
        knowledgeLevel: fact.knowledgeLevel === "hedged" ? "hedged" : "direct",
        unlockTriggers: normalizeKeywordList(fact.unlockTriggers, [
          title,
          fact.category || "context",
        ]),
        requiresSpecificity: fact.requiresSpecificity ?? true,
        sampleResponse: fact.sampleResponse || fact.fact,
        whyItMatters:
          fact.whyItMatters ||
          "This context changes the recommendation and should be earned before answering.",
      };
    })
    .filter((item): item is HiddenFact => Boolean(item));
}

function normalizeTrapAssumptions(value: unknown): TrapAssumption[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index): TrapAssumption | null => {
      if (typeof item === "string") {
        return {
          id: `trap_${index + 1}`,
          assumption: item,
          whyTempting:
            "The vague prompt makes this assumption feel plausible before context is earned.",
          howToDisprove:
            "Ask a targeted question about the user, trigger, constraint, or success condition.",
        };
      }

      if (!item || typeof item !== "object") return null;
      const trap = item as Partial<TrapAssumption>;
      if (!trap.assumption) return null;

      return {
        id: trap.id || `trap_${index + 1}`,
        assumption: trap.assumption,
        whyTempting:
          trap.whyTempting ||
          "The vague prompt makes this assumption feel plausible before context is earned.",
        howToDisprove:
          trap.howToDisprove ||
          "Ask a targeted question about the user, trigger, constraint, or success condition.",
      };
    })
    .filter((item): item is TrapAssumption => Boolean(item));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Scenario processor timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function normalizeScenario(
  value: Partial<ScenarioConfig>,
  rawStoryline: string,
  targetRole: string
): ScenarioConfig {
  const title = value.title || firstUsefulLine(rawStoryline).slice(0, 70);
  const id = slugify(value.id || title);
  const persona = value.persona || {
    name: "Sam",
    role: "Engineering Manager",
    tone: "warm, concise, busy, not adversarial",
    answerStyle:
      "answers exactly what is asked; does not connect all dots; kind but not handholding",
  };

  return {
    id,
    title,
    role: value.role || targetRole,
    candidatePrompt:
      value.candidatePrompt ||
      `Sam, your engineering manager, sends: "${firstUsefulLine(
        rawStoryline
      )}" You have 5 questions before recommending what to do.`,
    persona: {
      name: persona.name || "Sam",
      role: persona.role || "Engineering Manager",
      tone: persona.tone || "warm, concise, busy, not adversarial",
      answerStyle:
        persona.answerStyle ||
        "answers exactly what is asked; does not connect all dots; kind but not handholding",
      expertise: asStringArray(persona.expertise),
      directKnowledge: asStringArray(persona.directKnowledge),
      hedgedKnowledge: asStringArray(persona.hedgedKnowledge),
      blindSpots: asStringArray(persona.blindSpots),
      communicationRules: asStringArray(persona.communicationRules),
    },
    maxQuestions: Number(value.maxQuestions || 5),
    ambientFacts: normalizeAmbientFacts(value.ambientFacts),
    hiddenFacts: normalizeHiddenFacts(value.hiddenFacts),
    trapAssumptions: normalizeTrapAssumptions(value.trapAssumptions),
    idealRecommendation:
      value.idealRecommendation ||
      "Use the earned context to recommend a narrow, evidence-backed next step. This scaffold needs manager review before use.",
  };
}

function fallbackScenario(
  rawStoryline: string,
  targetRole: string,
  warning: string
): ProcessScenarioResponse {
  const title = firstUsefulLine(rawStoryline).slice(0, 70);
  const scenario: ScenarioConfig = {
    id: slugify(title),
    title: title || "Generated Scenario Scaffold",
    role: targetRole,
    candidatePrompt: `Sam, your engineering manager, sends: "${firstUsefulLine(
      rawStoryline
    )}" You have 5 questions before recommending what to do.`,
    persona: {
      name: "Sam",
      role: "Engineering Manager",
      tone: "warm, concise, busy, not adversarial",
      answerStyle:
        "answers exactly what is asked; does not connect all dots; kind but not handholding",
      expertise: ["team priorities", "work scoping", "delivery tradeoffs"],
      directKnowledge: [
        "why the work matters",
        "what scope is acceptable",
        "what decision the candidate needs to make",
      ],
      hedgedKnowledge: [
        "exact implementation details",
        "specialist legal or infrastructure details",
      ],
      blindSpots: ["complete process documentation"],
      communicationRules: ["short answers", "plainspoken", "no proactive synthesis"],
    },
    maxQuestions: 5,
    ambientFacts: [
      {
        id: "team_context",
        fact: "This is a normal team workflow question, not a trick interview prompt.",
        whenToReveal: ["team", "workflow", "context"],
      },
      {
        id: "manager_availability",
        fact: "Sam is available for a few quick clarifying questions but cannot write a full spec right now.",
        whenToReveal: ["available", "time", "question", "ask"],
      },
    ],
    hiddenFacts: [
      {
        id: "needs_real_user",
        title: "Identify the real user",
        fact: "The candidate needs to clarify who is affected or who is asking before proposing a solution.",
        category: "user",
        weight: 1.2,
        knowledgeLevel: "direct",
        unlockTriggers: ["who", "user", "customer", "affected", "asking"],
        requiresSpecificity: true,
        sampleResponse:
          "The first useful split is who actually needs this and what they are trying to accomplish.",
        whyItMatters:
          "Without the user, the candidate may solve the wrong problem.",
      },
      {
        id: "needs_success_criteria",
        title: "Clarify success criteria",
        fact: "The candidate needs to ask what outcome would make the work successful.",
        category: "metric",
        weight: 1,
        knowledgeLevel: "direct",
        unlockTriggers: ["success", "metric", "goal", "outcome", "why"],
        requiresSpecificity: true,
        sampleResponse:
          "I would anchor on the outcome first, then decide the smallest useful implementation.",
        whyItMatters:
          "Success criteria determine scope, tradeoffs, and final recommendation.",
      },
      {
        id: "needs_constraints",
        title: "Surface constraints",
        fact: "The candidate needs to ask about deadline, risk, or constraints before committing to scope.",
        category: "constraint",
        weight: 1,
        knowledgeLevel: "hedged",
        unlockTriggers: ["deadline", "risk", "constraint", "privacy", "blocked"],
        requiresSpecificity: true,
        sampleResponse:
          "There are probably constraints here, so I would not commit to a broad solution without checking those first.",
        whyItMatters:
          "Constraints can flip the right implementation from broad to narrow.",
      },
    ],
    trapAssumptions: [
      {
        id: "literal_ticket",
        assumption:
          "The candidate treats the vague request as a complete specification.",
        whyTempting:
          "The prompt sounds like a normal ticket even though key context is missing.",
        howToDisprove: "Ask who needs it, why now, and what constraints matter.",
      },
    ],
    idealRecommendation:
      "This is a fallback scaffold. The team should replace generic hidden facts with storyline-specific facts before using it in the demo.",
  };

  return {
    scenario,
    modelUsed: "mock",
    source: "fallback",
    warning,
  };
}

export async function POST(req: Request) {
  const { rawStoryline, targetRole, processorPrompt } =
    (await req.json()) as ProcessScenarioRequest;

  const trimmedStoryline = rawStoryline?.trim();
  const role = targetRole?.trim() || "New Grad Software Engineer";

  if (!trimmedStoryline) {
    return NextResponse.json(
      { error: "rawStoryline is required." },
      { status: 400 }
    );
  }

  const baseURL = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL || "qwen2.5-32b";
  const apiKey = process.env.OPENAI_API_KEY || "dummy";
  const prompt = processorPrompt?.trim() || defaultProcessorPrompt();

  if (!baseURL) {
    return NextResponse.json(
      fallbackScenario(
        trimmedStoryline,
        role,
        "OPENAI_BASE_URL is not set; returned a generic scaffold."
      )
    );
  }

  const client = new OpenAI({ apiKey, baseURL });

  try {
    const controller = new AbortController();
    const completionPromise = client.chat.completions.create(
      {
        model,
        temperature: 0.2,
        max_tokens: 2400,
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: JSON.stringify(
              {
                targetRole: role,
                rawStoryline: trimmedStoryline,
                managerArchetypes: archetypes,
                instruction:
                  "Generate one complete ScenarioConfig JSON object for Question Arena. Use the archetypes only as guidance; adapt the manager to the actual storyline.",
              },
              null,
              2
            ),
          },
        ],
      },
      { signal: controller.signal }
    );
    const completion = await withTimeout(
      completionPromise,
      PROCESSOR_TIMEOUT_MS
    ).finally(() => controller.abort());

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const parsed = JSON.parse(extractJson(raw)) as Partial<ScenarioConfig>;
    const scenario = normalizeScenario(parsed, trimmedStoryline, role);

    const response: ProcessScenarioResponse = {
      scenario,
      modelUsed: model,
      source: "model",
      rawModelOutput: raw,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      fallbackScenario(
        trimmedStoryline,
        role,
        `Scenario processor failed; returned a generic scaffold. ${message}`
      )
    );
  }
}

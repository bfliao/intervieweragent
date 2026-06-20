import { NextResponse } from "next/server";
import OpenAI from "openai";
import { scoreInformationGain } from "@/lib/questionArena/answerer";
import type {
  EvaluationReport,
  HiddenFact,
  Message,
  ScenarioConfig,
  SignalDimension,
  ValidatorAssessment,
  ValidatorReport,
} from "@/lib/questionArena/types";

export const runtime = "nodejs";

interface EvaluateRequest {
  scenario: ScenarioConfig;
  messages: Message[];
  unlockedFactIds: string[];
  finalRecommendation: string;
  evaluatorPrompt: string;
}

function factsForIds(scenario: ScenarioConfig, ids: string[]) {
  return scenario.hiddenFacts.filter((fact) => ids.includes(fact.id));
}

function fallbackAssessment(
  deterministic: EvaluationReport,
  unlockedFacts: HiddenFact[],
  messages: Message[],
  finalRecommendation: string
): ValidatorAssessment {
  const askedQuestions = messages
    .filter((message) => message.role === "candidate")
    .map((message) => message.content);
  const firstQuestion = askedQuestions[0] || "No question recorded.";
  const laterQuestion = askedQuestions[1] || firstQuestion;

  return {
    label: deterministic.label,
    summary:
      deterministic.percent >= 75
        ? "The candidate uncovered most of the decision-critical context before recommending a direction."
        : deterministic.percent >= 45
          ? "The candidate found some useful context but missed important constraints that affect the assessment."
          : "The candidate did not earn enough context to support a grounded assessment.",
    signalBreakdown: {
      questionQuality: {
        label:
          unlockedFacts.length > 0 ? "Context-seeking" : "Low signal",
        assessment:
          unlockedFacts.length > 0
            ? "The candidate asked at least one question that reached decision-critical context."
            : "The questions did not expose a clear hypothesis, stakeholder lens, or risk model.",
        evidence: firstQuestion,
      },
      adaptiveFollowUp: {
        label: askedQuestions.length >= 2 ? "Some follow-up signal" : "Limited",
        assessment:
          askedQuestions.length >= 2
            ? "Review whether later questions build on earlier answers or simply continue broad probing."
            : "There was not enough transcript to assess adaptive follow-up.",
        evidence: laterQuestion,
      },
      ownershipPosture: {
        label:
          deterministic.percent >= 75
            ? "Collaborator / owner"
            : deterministic.percent >= 45
              ? "Developing collaborator"
              : "Approval-seeking or narrow executor",
        assessment:
          "Fallback assessment uses information gain as a proxy; use the transcript to confirm whether the candidate is calibrating direction or asking for approval on details.",
        evidence: askedQuestions.slice(0, 2).join(" | ") || "No questions.",
      },
      groundedNextStep: {
        label: "Not scored",
        assessment:
          "Final action text is not required for this flow; use the question path and earned context instead.",
        evidence: finalRecommendation || "No final action text collected.",
      },
    },
    strengths:
      unlockedFacts.length > 0
        ? unlockedFacts.slice(0, 3).map((fact) => `Uncovered: ${fact.title}.`)
        : ["Kept the interaction moving, but did not unlock decision-critical context."],
    concerns:
      deterministic.missedFacts.length > 0
        ? deterministic.missedFacts
            .slice(0, 3)
            .map((fact) => `Missed: ${fact.title}. ${fact.whyItMatters}`)
        : ["No major missed hidden facts in this scenario."],
    evidence:
      askedQuestions.length > 0
        ? askedQuestions.slice(0, 3).map((question) => `Asked: ${question}`)
        : ["No candidate questions were recorded."],
    finalRecommendationAssessment: finalRecommendation
      ? "Review the submitted action text against the earned context and missed facts shown above."
      : "No final action text was collected for this flow.",
    nextInterviewFocus:
      deterministic.missedFacts.length > 0
        ? deterministic.missedFacts
            .slice(0, 2)
            .map((fact) => `Probe ${fact.category}: ${fact.title}.`)
        : ["Probe whether this behavior generalizes to a debugging scenario."],
  };
}

function normalizeSignalDimension(
  value: Partial<SignalDimension> | undefined,
  fallback: SignalDimension
): SignalDimension {
  return {
    label: value?.label || fallback.label,
    assessment: value?.assessment || fallback.assessment,
    evidence: value?.evidence || fallback.evidence,
  };
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? trimmed;
}

function normalizeAssessment(
  value: Partial<ValidatorAssessment>,
  deterministic: EvaluationReport,
  fallback: ValidatorAssessment
) {
  const fallbackBreakdown = fallback.signalBreakdown!;
  const breakdown = value.signalBreakdown;

  return {
    label: deterministic.label,
    summary: normalizeString(value.summary, fallback.summary),
    signalBreakdown: {
      questionQuality: normalizeSignalDimension(
        breakdown?.questionQuality,
        fallbackBreakdown.questionQuality
      ),
      adaptiveFollowUp: normalizeSignalDimension(
        breakdown?.adaptiveFollowUp,
        fallbackBreakdown.adaptiveFollowUp
      ),
      ownershipPosture: normalizeSignalDimension(
        breakdown?.ownershipPosture,
        fallbackBreakdown.ownershipPosture
      ),
      groundedNextStep: normalizeSignalDimension(
        breakdown?.groundedNextStep,
        fallbackBreakdown.groundedNextStep
      ),
    },
    strengths: normalizeStringArray(value.strengths, fallback.strengths),
    concerns: normalizeStringArray(value.concerns, fallback.concerns),
    evidence: normalizeStringArray(value.evidence, fallback.evidence),
    finalRecommendationAssessment:
      normalizeString(
        value.finalRecommendationAssessment,
        fallback.finalRecommendationAssessment
      ),
    nextInterviewFocus: normalizeStringArray(
      value.nextInterviewFocus,
      fallback.nextInterviewFocus
    ),
  };
}

export async function POST(req: Request) {
  const {
    scenario,
    messages,
    unlockedFactIds,
    finalRecommendation,
    evaluatorPrompt,
  } = (await req.json()) as EvaluateRequest;

  if (!scenario) {
    return NextResponse.json({ error: "scenario is required." }, { status: 400 });
  }

  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeUnlockedFactIds = Array.isArray(unlockedFactIds)
    ? unlockedFactIds
    : [];
  const safeFinalRecommendation = finalRecommendation || "";
  const deterministic = scoreInformationGain(scenario, safeUnlockedFactIds);
  const unlockedFacts = factsForIds(scenario, safeUnlockedFactIds);
  const missedFacts = deterministic.missedFacts;
  const fallback = fallbackAssessment(
    deterministic,
    unlockedFacts,
    safeMessages,
    safeFinalRecommendation
  );
  const baseURL = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL || "qwen2.5-32b";
  const apiKey = process.env.OPENAI_API_KEY || "dummy";

  if (!baseURL) {
    const report: ValidatorReport = {
      deterministic,
      assessment: fallback,
      modelUsed: "mock",
      source: "fallback",
      warning: "OPENAI_BASE_URL is not set; used deterministic fallback.",
    };
    return NextResponse.json(report);
  }

  const client = new OpenAI({ apiKey, baseURL });
  const validatorInput = {
    scenario: {
      title: scenario.title,
      role: scenario.role,
      candidatePrompt: scenario.candidatePrompt,
      idealRecommendation: scenario.idealRecommendation,
    },
    transcript: safeMessages,
    finalRecommendation: safeFinalRecommendation,
    deterministicScore: {
      percent: deterministic.percent,
      label: deterministic.label,
      unlockedWeight: deterministic.unlockedWeight,
      totalWeight: deterministic.totalWeight,
    },
    unlockedFacts: unlockedFacts.map((fact) => ({
      id: fact.id,
      title: fact.title,
      fact: fact.fact,
      whyItMatters: fact.whyItMatters,
    })),
    missedFacts: missedFacts.map((fact) => ({
      id: fact.id,
      title: fact.title,
      fact: fact.fact,
      whyItMatters: fact.whyItMatters,
    })),
  };

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        { role: "system", content: evaluatorPrompt },
        {
          role: "user",
          content: JSON.stringify(validatorInput, null, 2),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const parsed = JSON.parse(extractJson(raw)) as Partial<ValidatorAssessment>;
    const report: ValidatorReport = {
      deterministic,
      assessment: normalizeAssessment(parsed, deterministic, fallback),
      modelUsed: model,
      source: "model",
      rawModelOutput: raw,
    };

    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const report: ValidatorReport = {
      deterministic,
      assessment: fallback,
      modelUsed: "mock",
      source: "fallback",
      warning: `Validator model failed; used fallback. ${message}`,
    };
    return NextResponse.json(report);
  }
}

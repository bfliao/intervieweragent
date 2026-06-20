import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  gatekeepQuestion,
  generateManagerAnswer,
} from "@/lib/questionArena/answerer";
import type { ScenarioConfig } from "@/lib/questionArena/types";

export const runtime = "nodejs";

interface AnswerRequest {
  scenario: ScenarioConfig;
  question: string;
  unlockedFactIds: string[];
  answerPrompt: string;
}

function approvedContext(
  scenario: ScenarioConfig,
  unlockedFactIds: string[],
  ambientFactIds: string[]
) {
  const hiddenFacts = unlockedFactIds
    .map((id) => scenario.hiddenFacts.find((fact) => fact.id === id))
    .filter(Boolean)
    .map((fact) => ({
      id: fact?.id,
      title: fact?.title,
      response: fact?.sampleResponse || fact?.fact,
      knowledgeLevel: fact?.knowledgeLevel,
    }));
  const ambientFacts = ambientFactIds
    .map((id) => scenario.ambientFacts.find((fact) => fact.id === id))
    .filter(Boolean)
    .map((fact) => ({
      id: fact?.id,
      response: fact?.fact,
    }));

  return { hiddenFacts, ambientFacts };
}

export async function POST(req: Request) {
  const { scenario, question, unlockedFactIds, answerPrompt } =
    (await req.json()) as AnswerRequest;

  if (!scenario || !question) {
    return NextResponse.json(
      { error: "scenario and question are required." },
      { status: 400 }
    );
  }

  const decision = gatekeepQuestion(question, scenario, unlockedFactIds || []);
  const fallbackAnswer = generateManagerAnswer(scenario, decision);
  const baseURL = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL || "qwen2.5-32b";
  const apiKey = process.env.OPENAI_API_KEY || "dummy";

  if (!baseURL) {
    return NextResponse.json({
      decision,
      answer: fallbackAnswer,
      modelUsed: "mock",
      warning: "OPENAI_BASE_URL is not set; used deterministic fallback.",
    });
  }

  const client = new OpenAI({ apiKey, baseURL });
  const context = approvedContext(
    scenario,
    decision.unlockedFactIds,
    decision.ambientFactIds
  );
  const hasApprovedContext =
    context.hiddenFacts.length > 0 || context.ambientFacts.length > 0;

  if (!hasApprovedContext) {
    return NextResponse.json({
      decision,
      answer: fallbackAnswer,
      modelUsed: model,
      source: "guardrail",
      warning:
        "No approved context was unlocked; skipped model generation to avoid invented details.",
    });
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: answerPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              managerPersona: scenario.persona,
              candidateQuestion: question,
              gatekeeperDecision: decision,
              approvedContextOnly: context,
              fallbackAnswer,
              instruction:
                "Write the manager's answer in 1-3 concise sentences. Use only approvedContextOnly and the fallbackAnswer. If no hidden or ambient facts were approved, do not invent details.",
            },
            null,
            2
          ),
        },
      ],
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() || fallbackAnswer;

    return NextResponse.json({
      decision,
      answer,
      modelUsed: model,
      source: "model",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({
      decision,
      answer: fallbackAnswer,
      modelUsed: "mock",
      source: "fallback",
      warning: `Model call failed; used deterministic fallback. ${message}`,
    });
  }
}

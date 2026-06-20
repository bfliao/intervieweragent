"use client";

import { useMemo, useState } from "react";
import {
  gatekeepQuestion,
  generateManagerAnswer,
  scoreInformationGain,
} from "@/lib/questionArena/answerer";
import type {
  EvaluationReport,
  GatekeeperDecision,
  Message,
  ScenarioConfig,
} from "@/lib/questionArena/types";

interface QuestionArenaPortalProps {
  scenarios: ScenarioConfig[];
  defaultAnswerPrompt: string;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function parseScenario(value: string): ScenarioConfig {
  const parsed = JSON.parse(value) as ScenarioConfig;
  if (!parsed.title || !parsed.candidatePrompt || !parsed.hiddenFacts) {
    throw new Error("Scenario must include title, candidatePrompt, and hiddenFacts.");
  }
  return parsed;
}

export default function QuestionArenaPortal({
  scenarios,
  defaultAnswerPrompt,
}: QuestionArenaPortalProps) {
  const [templateId, setTemplateId] = useState(scenarios[0]?.id ?? "");
  const [scenarioText, setScenarioText] = useState(formatJson(scenarios[0]));
  const [answerPrompt, setAnswerPrompt] = useState(defaultAnswerPrompt);
  const [scenario, setScenario] = useState<ScenarioConfig>(scenarios[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [finalRecommendation, setFinalRecommendation] = useState("");
  const [unlockedFactIds, setUnlockedFactIds] = useState<string[]>([]);
  const [lastDecision, setLastDecision] = useState<GatekeeperDecision | null>(
    null
  );
  const [status, setStatus] = useState("Ready.");
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [answerMode, setAnswerMode] = useState<"model" | "mock">("model");
  const [loadingAnswer, setLoadingAnswer] = useState(false);

  const questionsLeft = Math.max(scenario.maxQuestions - messages.length / 2, 0);
  const unlockedFacts = useMemo(
    () =>
      scenario.hiddenFacts.filter((fact) => unlockedFactIds.includes(fact.id)),
    [scenario.hiddenFacts, unlockedFactIds]
  );

  function resetRun(nextScenario = scenario) {
    setMessages([]);
    setQuestion("");
    setFinalRecommendation("");
    setUnlockedFactIds([]);
    setLastDecision(null);
    setReport(null);
    setStatus(`Run reset for ${nextScenario.title}.`);
  }

  function loadTemplate(id: string) {
    const next = scenarios.find((item) => item.id === id) ?? scenarios[0];
    setTemplateId(next.id);
    setScenarioText(formatJson(next));
    setScenario(next);
    resetRun(next);
  }

  function applyScenario() {
    try {
      const parsed = parseScenario(scenarioText);
      setScenario(parsed);
      setTemplateId(parsed.id);
      resetRun(parsed);
      setStatus("Scenario applied.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invalid scenario JSON.");
    }
  }

  async function askManager(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || questionsLeft <= 0 || loadingAnswer) return;

    setQuestion("");
    setLoadingAnswer(true);

    try {
      let decision: GatekeeperDecision;
      let answer: string;

      if (answerMode === "model") {
        const res = await fetch("/api/question-arena/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario,
            question: text,
            unlockedFactIds,
            answerPrompt,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          decision: GatekeeperDecision;
          answer: string;
          modelUsed?: string;
          warning?: string;
        };
        decision = data.decision;
        answer = data.answer;
        setStatus(
          data.warning
            ? data.warning
            : `Answered with ${data.modelUsed || "model endpoint"}.`
        );
      } else {
        decision = gatekeepQuestion(text, scenario, unlockedFactIds);
        answer = generateManagerAnswer(scenario, decision);
        setStatus("Answered with deterministic mock.");
      }

      const nextUnlocked = Array.from(
        new Set([...unlockedFactIds, ...decision.unlockedFactIds])
      );

      setMessages((current) => [
        ...current,
        { role: "candidate", content: text },
        { role: "manager", content: answer },
      ]);
      setUnlockedFactIds(nextUnlocked);
      setLastDecision(decision);
      setReport(null);
    } catch (error) {
      setQuestion(text);
      setStatus(error instanceof Error ? error.message : "Answer failed.");
    } finally {
      setLoadingAnswer(false);
    }
  }

  function generateReport() {
    setReport(scoreInformationGain(scenario, unlockedFactIds));
  }

  function exportRun() {
    const payload = {
      scenarioId: scenario.id,
      answerPrompt,
      unlockedFactIds,
      messages,
      finalRecommendation,
    };
    void navigator.clipboard.writeText(formatJson(payload));
    setStatus("Run copied to clipboard.");
  }

  return (
    <div className="grid min-h-screen grid-cols-[minmax(360px,0.9fr)_minmax(440px,1.2fr)_minmax(260px,0.7fr)] gap-4 p-4 max-[1180px]:grid-cols-1">
      <section className="rounded-lg border border-slate-800 bg-surface p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
              Testing Portal
            </p>
            <h1 className="text-2xl font-semibold">Question Arena</h1>
          </div>
          <button
            onClick={applyScenario}
            className="rounded-md bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950"
          >
            Apply
          </button>
        </div>

        <label className="mb-4 block text-sm font-semibold text-slate-300">
          Scenario Template
          <select
            value={templateId}
            onChange={(event) => loadTemplate(event.target.value)}
            className="mt-2 w-full rounded-md border border-slate-700 bg-background px-3 py-2 text-sm"
          >
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 block text-sm font-semibold text-slate-300">
          Scenario Config JSON
          <textarea
            value={scenarioText}
            onChange={(event) => setScenarioText(event.target.value)}
            className="mt-2 h-[330px] w-full resize-y rounded-md border border-slate-700 bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-emerald-300"
            spellCheck={false}
          />
        </label>

        <label className="mb-4 block text-sm font-semibold text-slate-300">
          Interview Answer Prompt
          <textarea
            value={answerPrompt}
            onChange={(event) => setAnswerPrompt(event.target.value)}
            className="mt-2 h-44 w-full resize-y rounded-md border border-slate-700 bg-background p-3 text-sm leading-relaxed outline-none focus:border-emerald-300"
            spellCheck={false}
          />
        </label>

        <label className="mb-4 block text-sm font-semibold text-slate-300">
          Answer Backend
          <select
            value={answerMode}
            onChange={(event) =>
              setAnswerMode(event.target.value as "model" | "mock")
            }
            className="mt-2 w-full rounded-md border border-slate-700 bg-background px-3 py-2 text-sm"
          >
            <option value="model">Model endpoint</option>
            <option value="mock">Deterministic mock</option>
          </select>
        </label>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => loadTemplate(templateId)}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold"
          >
            Load
          </button>
          <button
            onClick={() => resetRun()}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold"
          >
            Reset
          </button>
          <button
            onClick={exportRun}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold"
          >
            Export
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">{status}</p>
      </section>

      <section className="flex min-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border border-slate-800 bg-surface">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
              Candidate View
            </p>
            <h2 className="text-xl font-semibold">{scenario.title}</h2>
          </div>
          <div className="min-w-20 rounded-md border border-slate-700 px-3 py-2 text-center">
            <div className="text-3xl font-black">{questionsLeft}</div>
            <div className="text-[11px] font-semibold text-slate-400">
              questions left
            </div>
          </div>
        </header>

        <div className="m-5 rounded-lg border border-slate-800 bg-background p-4">
          <h3 className="mb-2 text-sm font-bold text-slate-300">
            Problem Statement
          </h3>
          <p className="text-sm leading-relaxed text-slate-100">
            {scenario.candidatePrompt}
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-5">
          {messages.length === 0 && (
            <p className="text-sm text-slate-500">
              Ask one focused question to start the assessment.
            </p>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${
                message.role === "candidate" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[86%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  message.role === "candidate"
                    ? "bg-emerald-300 text-slate-950"
                    : "bg-slate-800 text-slate-100"
                }`}
              >
                <p className="mb-1 text-[11px] font-black uppercase tracking-wide opacity-70">
                  {message.role === "candidate"
                    ? "Candidate"
                    : scenario.persona.name}
                </p>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={askManager}
          className="border-t border-slate-800 bg-background p-4"
        >
          <label className="mb-2 block text-sm font-semibold text-slate-300">
            Ask the manager
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={questionsLeft <= 0 || loadingAnswer}
              placeholder="Ask one focused question..."
              className="rounded-md border border-slate-700 bg-surface px-3 py-2 text-sm outline-none focus:border-emerald-300 disabled:opacity-50"
            />
            <button
              disabled={questionsLeft <= 0 || loadingAnswer}
              className="rounded-md bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
            >
              {loadingAnswer ? "Asking..." : "Ask"}
            </button>
          </div>
        </form>

        <div className="border-t border-slate-800 bg-background p-4">
          <label className="mb-2 block text-sm font-semibold text-slate-300">
            Final Recommendation
          </label>
          <textarea
            value={finalRecommendation}
            onChange={(event) => setFinalRecommendation(event.target.value)}
            className="h-24 w-full resize-y rounded-md border border-slate-700 bg-surface p-3 text-sm outline-none focus:border-emerald-300"
            placeholder="Write your diagnosis and recommendation..."
          />
          <button
            onClick={generateReport}
            className="mt-2 w-full rounded-md bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950"
          >
            Generate Report
          </button>
        </div>

        {report && (
          <div className="border-t border-slate-800 bg-slate-950 p-4">
            <h3 className="mb-2 text-sm font-bold text-slate-300">
              Evaluation Report
            </h3>
            <div className="mb-3 inline-flex rounded-full bg-emerald-300 px-3 py-1 text-sm font-black text-slate-950">
              {report.percent}% · {report.label}
            </div>
            <p className="mb-3 text-sm text-slate-300">
              Primary metric: weighted information gain. Unlocked{" "}
              {unlockedFacts.length}/{scenario.hiddenFacts.length} hidden facts.
            </p>
            <h4 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
              Missed Context
            </h4>
            <ul className="space-y-1 text-sm text-slate-300">
              {report.missedFacts.length === 0 ? (
                <li>None.</li>
              ) : (
                report.missedFacts.map((fact) => (
                  <li key={fact.id}>
                    <strong>{fact.title}:</strong> {fact.whyItMatters}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </section>

      <aside className="rounded-lg border border-slate-800 bg-surface p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
          Debug
        </p>
        <h2 className="mb-5 text-xl font-semibold">Answerer State</h2>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold text-slate-300">
            Unlocked Facts
          </h3>
          <ul className="space-y-2 text-sm text-slate-300">
            {unlockedFacts.length === 0 ? (
              <li className="text-slate-500">No hidden facts unlocked yet.</li>
            ) : (
              unlockedFacts.map((fact) => (
                <li key={fact.id}>
                  <strong>{fact.title}</strong>
                  <br />
                  <span className="text-slate-500">{fact.fact}</span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold text-slate-300">
            Last Gatekeeper Decision
          </h3>
          <pre className="overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">
            {formatJson(lastDecision ?? {})}
          </pre>
        </section>
      </aside>
    </div>
  );
}

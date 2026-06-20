"use client";

import { useMemo, useRef, useState } from "react";
import {
  gatekeepQuestion,
  generateManagerAnswer,
} from "@/lib/questionArena/answerer";
import type {
  GatekeeperDecision,
  Message,
  ScenarioConfig,
  ValidatorReport,
} from "@/lib/questionArena/types";

interface QuestionArenaPortalProps {
  scenarios: ScenarioConfig[];
  defaultProcessorPrompt: string;
  defaultAnswerPrompt: string;
  defaultEvaluatorPrompt: string;
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
  defaultProcessorPrompt,
  defaultAnswerPrompt,
  defaultEvaluatorPrompt,
}: QuestionArenaPortalProps) {
  const [templateId, setTemplateId] = useState(scenarios[0]?.id ?? "");
  const [targetRole, setTargetRole] = useState(
    scenarios[0]?.role ?? "New Grad Software Engineer"
  );
  const [rawStoryline, setRawStoryline] = useState(
    `Sam says: "Can you add a way for users to download their order history? Swamped today, thanks."

This is for an NG SWE work-sample assessment. The scenario should test whether the candidate scopes before building and can ask who needs the feature, why it matters, what constraints exist, and what a minimal useful v1 should be.`
  );
  const [processorPrompt, setProcessorPrompt] = useState(defaultProcessorPrompt);
  const [scenarioText, setScenarioText] = useState(formatJson(scenarios[0]));
  const [answerPrompt, setAnswerPrompt] = useState(defaultAnswerPrompt);
  const [evaluatorPrompt, setEvaluatorPrompt] = useState(defaultEvaluatorPrompt);
  const [scenario, setScenario] = useState<ScenarioConfig>(scenarios[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [finalRecommendation, setFinalRecommendation] = useState("");
  const [unlockedFactIds, setUnlockedFactIds] = useState<string[]>([]);
  const [lastDecision, setLastDecision] = useState<GatekeeperDecision | null>(
    null
  );
  const [status, setStatus] = useState("Ready.");
  const [report, setReport] = useState<ValidatorReport | null>(null);
  const [answerMode, setAnswerMode] = useState<"model" | "mock">("model");
  const [processingScenario, setProcessingScenario] = useState(false);
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const [loadingEvaluation, setLoadingEvaluation] = useState(false);
  const [modelStatus, setModelStatus] = useState(
    "Model endpoint not tested in UI."
  );
  const [voiceMode, setVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const audioRef = useRef<AudioBufferSourceNode | null>(null);

  const questionsLeft = Math.max(scenario.maxQuestions - messages.length / 2, 0);
  const unlockedFacts = useMemo(
    () =>
      scenario.hiddenFacts.filter((fact) => unlockedFactIds.includes(fact.id)),
    [scenario.hiddenFacts, unlockedFactIds]
  );
  const currentTemplateExists = scenarios.some((item) => item.id === templateId);

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
    setTargetRole(next.role);
    setScenarioText(formatJson(next));
    setScenario(next);
    resetRun(next);
  }

  function applyScenario() {
    try {
      const parsed = parseScenario(scenarioText);
      setScenario(parsed);
      setTemplateId(parsed.id);
      setTargetRole(parsed.role);
      resetRun(parsed);
      setStatus("Scenario applied.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invalid scenario JSON.");
    }
  }

  async function processStoryline() {
    const text = rawStoryline.trim();
    if (!text || processingScenario) {
      setStatus("Paste a raw storyline before processing.");
      return;
    }

    setProcessingScenario(true);
    setStatus("Processing storyline into ScenarioConfig...");

    try {
      const res = await fetch("/api/question-arena/process-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawStoryline: text,
          targetRole,
          processorPrompt,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        scenario: ScenarioConfig;
        modelUsed: string;
        source: "model" | "fallback";
        warning?: string;
      };
      setScenario(data.scenario);
      setScenarioText(formatJson(data.scenario));
      setTemplateId(data.scenario.id);
      setTargetRole(data.scenario.role);
      resetRun(data.scenario);
      setStatus(
        data.warning ||
          `Processed storyline with ${data.modelUsed} (${data.source}). Review JSON, then run Q&A.`
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Scenario processing failed."
      );
    } finally {
      setProcessingScenario(false);
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
          source?: string;
          warning?: string;
        };
        decision = data.decision;
        answer = data.answer;
        setStatus(
          data.warning
            ? data.warning
            : `Answered with ${data.modelUsed || "model endpoint"} (${data.source || "model"}).`
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
      void speakManagerAnswer(answer);
    } catch (error) {
      setQuestion(text);
      setStatus(error instanceof Error ? error.message : "Answer failed.");
    } finally {
      setLoadingAnswer(false);
    }
  }

  async function generateReport() {
    setLoadingEvaluation(true);
    try {
      const res = await fetch("/api/question-arena/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          messages,
          unlockedFactIds,
          finalRecommendation,
          evaluatorPrompt,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ValidatorReport;
      setReport(data);
      setStatus(
        data.warning
          ? data.warning
          : `Validator report generated with ${data.modelUsed} (${data.source}).`
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Validator report failed."
      );
    } finally {
      setLoadingEvaluation(false);
    }
  }

  async function testModelEndpoint() {
    setModelStatus("Testing model endpoint...");
    try {
      const res = await fetch("/api/question-arena/model-status", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        configuredModel?: string;
        modelIds?: string[];
        configuredModelAvailable?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Model endpoint check failed.");
      }
      const availableText = data.configuredModelAvailable
        ? "available"
        : "not listed";
      setModelStatus(
        `Connected: ${data.configuredModel} (${availableText}). Models: ${
          data.modelIds?.join(", ") || "none"
        }`
      );
    } catch (error) {
      setModelStatus(
        error instanceof Error ? `Not connected: ${error.message}` : "Not connected."
      );
    }
  }

  async function speakManagerAnswer(text: string) {
    try {
      if (audioRef.current) {
        audioRef.current.stop();
        audioRef.current = null;
      }
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const arrayBuffer = await res.arrayBuffer();
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(audioCtx.destination);
      source.start(0);
      audioRef.current = source;
    } catch {
      // TTS errors are non-fatal; silently ignore
    }
  }

  function startRecording() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Win = window as any;
    const SR = Win.SpeechRecognition ?? Win.webkitSpeechRecognition;
    if (!SR) {
      setStatus("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let finalText = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalText + interim);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      setStatus(`Speech recognition error: ${event.error as string}`);
      setIsRecording(false);
    };
    recognition.onend = () => {
      setIsRecording(false);
      const text = finalText.trim();
      if (text) {
        setTranscript("");
        void (async () => {
          const q = text;
          setQuestion("");
          setLoadingAnswer(true);
          try {
            let decision: GatekeeperDecision;
            let answer: string;
            if (answerMode === "model") {
              const res = await fetch("/api/question-arena/answer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scenario, question: q, unlockedFactIds, answerPrompt }),
              });
              if (!res.ok) throw new Error(await res.text());
              const data = (await res.json()) as { decision: GatekeeperDecision; answer: string; modelUsed?: string; source?: string; warning?: string };
              decision = data.decision;
              answer = data.answer;
              setStatus(data.warning ? data.warning : `Answered with ${data.modelUsed || "model endpoint"} (${data.source || "model"}).`);
            } else {
              decision = gatekeepQuestion(q, scenario, unlockedFactIds);
              answer = generateManagerAnswer(scenario, decision);
              setStatus("Answered with deterministic mock.");
            }
            const nextUnlocked = Array.from(new Set([...unlockedFactIds, ...decision.unlockedFactIds]));
            setMessages((current) => [...current, { role: "candidate", content: q }, { role: "manager", content: answer }]);
            setUnlockedFactIds(nextUnlocked);
            setLastDecision(decision);
            setReport(null);
            void speakManagerAnswer(answer);
          } catch (error) {
            setQuestion(q);
            setStatus(error instanceof Error ? error.message : "Answer failed.");
          } finally {
            setLoadingAnswer(false);
          }
        })();
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setTranscript("");
  }

  function stopRecording() {
    recognitionRef.current?.stop();
  }

  function exportRun() {
    const payload = {
      scenarioId: scenario.id,
      rawStoryline,
      targetRole,
      processorPrompt,
      answerPrompt,
      evaluatorPrompt,
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
            {!currentTemplateExists && (
              <option value={templateId}>{scenario.title} (generated)</option>
            )}
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
                Storyline Processor
              </p>
              <p className="text-xs text-slate-400">
                Prep-time scenario markdown → candidate prompt + source persona + hidden-fact config.
              </p>
            </div>
            <button
              type="button"
              onClick={processStoryline}
              disabled={processingScenario}
              className="rounded-md bg-emerald-300 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
            >
              {processingScenario ? "Processing..." : "Process"}
            </button>
          </div>

          <label className="mb-3 block text-sm font-semibold text-slate-300">
            Target Role
            <input
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value)}
              className="mt-2 w-full rounded-md border border-slate-700 bg-background px-3 py-2 text-sm outline-none focus:border-emerald-300"
            />
          </label>

          <label className="mb-3 block text-sm font-semibold text-slate-300">
            Raw Scenario / Markdown Input
            <textarea
              value={rawStoryline}
              onChange={(event) => setRawStoryline(event.target.value)}
              className="mt-2 h-36 w-full resize-y rounded-md border border-slate-700 bg-background p-3 text-xs leading-relaxed outline-none focus:border-emerald-300"
              spellCheck={false}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-300">
            Scenario Processor Prompt
            <textarea
              value={processorPrompt}
              onChange={(event) => setProcessorPrompt(event.target.value)}
              className="mt-2 h-40 w-full resize-y rounded-md border border-slate-700 bg-background p-3 text-xs leading-relaxed outline-none focus:border-emerald-300"
              spellCheck={false}
            />
          </label>
        </div>

        <label className="mb-4 block text-sm font-semibold text-slate-300">
          Scenario Config JSON
          <textarea
            value={scenarioText}
            onChange={(event) => setScenarioText(event.target.value)}
            className="mt-2 h-[300px] w-full resize-y rounded-md border border-slate-700 bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-emerald-300"
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
          Validator Prompt
          <textarea
            value={evaluatorPrompt}
            onChange={(event) => setEvaluatorPrompt(event.target.value)}
            className="mt-2 h-48 w-full resize-y rounded-md border border-slate-700 bg-background p-3 text-sm leading-relaxed outline-none focus:border-emerald-300"
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
          <button
            type="button"
            onClick={testModelEndpoint}
            className="mt-2 w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold"
          >
            Test Model Connection
          </button>
          <span className="mt-2 block rounded-md border border-slate-800 bg-background px-3 py-2 text-xs text-slate-400">
            {modelStatus}
          </span>
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

        <div className="border-t border-slate-800 bg-background px-4 pt-3 pb-0">
          <div className="mb-3 flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-300">
              Ask the manager
            </label>
            <div className="flex items-center gap-1 rounded-full border border-slate-700 p-0.5">
              <button
                type="button"
                onClick={() => { setVoiceMode(false); stopRecording(); }}
                className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  !voiceMode
                    ? "bg-emerald-300 text-slate-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => setVoiceMode(true)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  voiceMode
                    ? "bg-emerald-300 text-slate-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Voice
              </button>
            </div>
          </div>
        </div>

        {!voiceMode ? (
          <form
            onSubmit={askManager}
            className="border-t border-slate-800 bg-background p-4 pt-2"
          >
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
        ) : (
          <div className="border-t border-slate-800 bg-background p-4 pt-2">
            <div className="flex flex-col items-center gap-3">
              {transcript && (
                <p className="w-full rounded-md border border-slate-700 bg-surface px-3 py-2 text-sm leading-relaxed text-slate-200">
                  {transcript}
                </p>
              )}
              {!isRecording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={questionsLeft <= 0 || loadingAnswer}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-300 text-slate-950 shadow-lg transition-transform hover:scale-105 disabled:opacity-50"
                  title="Start recording"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11Z" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="flex h-14 w-14 animate-pulse items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-105"
                  title="Stop recording"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                </button>
              )}
              <p className="text-xs text-slate-500">
                {loadingAnswer
                  ? "Sending..."
                  : isRecording
                  ? "Recording — tap to stop and send"
                  : "Tap the mic to start speaking"}
              </p>
            </div>
          </div>
        )}

        <div className="border-t border-slate-800 bg-background p-4">
          <label className="mb-2 block text-sm font-semibold text-slate-300">
            Next Immediate Step
          </label>
          <textarea
            value={finalRecommendation}
            onChange={(event) => setFinalRecommendation(event.target.value)}
            className="h-24 w-full resize-y rounded-md border border-slate-700 bg-surface p-3 text-sm outline-none focus:border-emerald-300"
            placeholder="Based on what you learned, what would you do next?"
          />
          <button
            onClick={generateReport}
            disabled={loadingEvaluation}
            className="mt-2 w-full rounded-md bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950"
          >
            {loadingEvaluation ? "Generating..." : "Generate Report"}
          </button>
        </div>

        {report && (
          <div className="border-t border-slate-800 bg-slate-950 p-4">
            <h3 className="mb-2 text-sm font-bold text-slate-300">
              Evaluation Report
            </h3>
            <div className="mb-3 inline-flex rounded-full bg-emerald-300 px-3 py-1 text-sm font-black text-slate-950">
              {report.deterministic.percent}% · {report.assessment.label}
            </div>
            <p className="mb-3 text-sm text-slate-300">
              Primary metric: weighted information gain. Unlocked{" "}
              {unlockedFacts.length}/{scenario.hiddenFacts.length} hidden facts.
            </p>
            <p className="mb-3 rounded-md border border-slate-800 bg-background p-3 text-sm leading-relaxed text-slate-200">
              {report.assessment.summary}
            </p>
            {report.assessment.signalBreakdown && (
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                {[
                  ["Question Quality", report.assessment.signalBreakdown.questionQuality],
                  ["Adaptive Follow-up", report.assessment.signalBreakdown.adaptiveFollowUp],
                  ["Ownership Posture", report.assessment.signalBreakdown.ownershipPosture],
                  ["Grounded Next Step", report.assessment.signalBreakdown.groundedNextStep],
                ].map(([title, signal]) => (
                  <div
                    key={title as string}
                    className="rounded-md border border-slate-800 bg-background p-3"
                  >
                    <h4 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
                      {title as string}
                    </h4>
                    <p className="mb-1 text-sm font-semibold text-emerald-300">
                      {(signal as { label: string }).label}
                    </p>
                    <p className="mb-2 text-sm leading-relaxed text-slate-300">
                      {(signal as { assessment: string }).assessment}
                    </p>
                    <p className="text-xs leading-relaxed text-slate-500">
                      {(signal as { evidence: string }).evidence}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
                  Strengths
                </h4>
                <ul className="space-y-1 text-sm text-slate-300">
                  {report.assessment.strengths.map((item, index) => (
                    <li key={`strength-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
                  Concerns
                </h4>
                <ul className="space-y-1 text-sm text-slate-300">
                  {report.assessment.concerns.map((item, index) => (
                    <li key={`concern-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <h4 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
              Evidence
            </h4>
            <ul className="mb-4 space-y-1 text-sm text-slate-300">
              {report.assessment.evidence.map((item, index) => (
                <li key={`evidence-${index}`}>{item}</li>
              ))}
            </ul>
            <h4 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
              Next Immediate Step
            </h4>
            <p className="mb-4 text-sm leading-relaxed text-slate-300">
              {report.assessment.finalRecommendationAssessment}
            </p>
            <h4 className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
              Missed Context
            </h4>
            <ul className="space-y-1 text-sm text-slate-300">
              {report.deterministic.missedFacts.length === 0 ? (
                <li>None.</li>
              ) : (
                report.deterministic.missedFacts.map((fact) => (
                  <li key={fact.id}>
                    <strong>{fact.title}:</strong> {fact.whyItMatters}
                  </li>
                ))
              )}
            </ul>
            <h4 className="mb-1 mt-4 text-xs font-black uppercase tracking-wide text-slate-500">
              Next Interview Focus
            </h4>
            <ul className="space-y-1 text-sm text-slate-300">
              {report.assessment.nextInterviewFocus.map((item, index) => (
                <li key={`next-${index}`}>{item}</li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              Validator source: {report.modelUsed} ({report.source})
            </p>
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

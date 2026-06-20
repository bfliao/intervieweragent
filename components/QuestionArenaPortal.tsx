"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Download,
  Keyboard,
  MessageSquare,
  Mic,
  Send,
} from "lucide-react";
import {
  gatekeepQuestion,
  generateManagerAnswer,
  scoreInformationGain,
} from "@/lib/questionArena/answerer";
import { ConceptCoverageGraph } from "@/components/ConceptCoverageGraph";
import demoRunHistory from "@/data/scenarios/user-api-export-run-history.json";
import type {
  GatekeeperDecision,
  Message,
  QuestionClassification,
  ScenarioConfig,
  ScenarioCritique,
  CriterionNode,
  ValidatorReport,
} from "@/lib/questionArena/types";

interface QuestionArenaPortalProps {
  scenarios: ScenarioConfig[];
  defaultProcessorPrompt: string;
  defaultAnswerPrompt: string;
  defaultEvaluatorPrompt: string;
  initialDevMode?: boolean;
  assessmentId?: string | null;
  autoProcessAssessment?: boolean;
}

interface StoredAssessmentPackage {
  id: string;
  candidateName?: string;
  candidateEmail?: string;
  jobId?: string;
  jobTitle?: string;
  markdown: string;
  targetRole?: string;
  createdAt: string;
  status?: "sent" | "submitted" | "report_ready";
  submittedAt?: string;
  reportGeneratedAt?: string;
  finalRecommendation?: string;
  assessmentScenarios?: StoredAssessmentScenario[];
  scenarios?: StoredRawSavedScenario[];
}

interface StoredAssessmentScenario {
  id: string;
  jobTitle?: string;
  candidatePrompt?: string;
  todos?: string[];
  scope?: { focus?: string[]; skip?: string[] };
  focusAreas?: string[];
  sourceTitle?: string;
  sourceUrl?: string;
  jd?: string;
  derivedFrom?: {
    jd?: string;
    skillset?: string[];
    teamInput?: Array<{
      memberName?: string;
      description?: string;
    }>;
  };
  critique?: {
    scenarioId: string;
    criteria: Array<{
      id: string;
      evidence: string;
      tags: string[];
      score: number;
      followups: unknown[];
    }>;
  };
}

interface StoredRawSavedScenario {
  jobTitle?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  scenario?: {
    id?: string;
    brief?: string;
    focusAreas?: string[];
    derivedFrom?: StoredAssessmentScenario["derivedFrom"];
    groundedOn?: {
      title?: string;
      source?: string;
    };
  };
}

interface DemoHistoryRun {
  id: string;
  candidateName: string;
  submittedLabel: string;
  unlockedFactIds: string[];
  messages: Message[];
  finalRecommendation: string;
  summary: string;
}

interface DemoRunHistoryFixture {
  scenarioId: string;
  runs: DemoHistoryRun[];
}

interface ManagerEvaluationRun extends DemoHistoryRun {
  percent: number;
  label: string;
  questionCount: number;
  isCurrent?: boolean;
}

type InterviewPhase =
  | "task_drop"
  | "brief"
  | "greeting"
  | "signals"
  | "workspace"
  | "next_step"
  | "submitted";

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

function classificationLabel(classification: QuestionClassification) {
  const labels: Record<QuestionClassification, string> = {
    irrelevant: "Irrelevant",
    broad: "Broad",
    targeted: "Targeted",
    sharp: "Sharp",
    scattershot: "Scattershot",
  };
  return labels[classification];
}

function classificationClassName(classification: QuestionClassification) {
  const classes: Record<QuestionClassification, string> = {
    irrelevant: "border-slate-700 bg-slate-900 text-slate-300",
    broad: "border-amber-300/40 bg-amber-300/10 text-amber-200",
    targeted: "border-emerald-300/40 bg-emerald-300/10 text-emerald-200",
    sharp: "border-cyan-300/40 bg-cyan-300/10 text-cyan-200",
    scattershot: "border-red-300/40 bg-red-300/10 text-red-200",
  };
  return classes[classification];
}

function firstAssessmentScenario(stored: StoredAssessmentPackage) {
  const normalized = stored.assessmentScenarios?.[0];
  if (normalized?.candidatePrompt?.trim()) return normalized;

  const raw = stored.scenarios?.[0];
  const rawScenario = raw?.scenario;
  const brief = rawScenario?.brief?.trim();
  if (!rawScenario || !brief) return null;

  return {
    id: rawScenario.id || stored.id,
    jobTitle: raw.jobTitle || stored.jobTitle,
    candidatePrompt: brief,
    focusAreas: rawScenario.focusAreas || [],
    sourceTitle: raw.sourceTitle || rawScenario.groundedOn?.title,
    sourceUrl: raw.sourceUrl || rawScenario.groundedOn?.source,
    jd: rawScenario.derivedFrom?.jd,
    derivedFrom: rawScenario.derivedFrom,
  } satisfies StoredAssessmentScenario;
}

function flattenCriteria(criteria: CriterionNode[], depth = 0): CriterionNode[] {
  const result: CriterionNode[] = [];
  for (const c of criteria) {
    result.push(c);
    if (c.followups?.length) {
      result.push(...flattenCriteria(c.followups, depth + 1));
    }
  }
  return result;
}

function critiqueToHiddenFacts(critique: ScenarioCritique) {
  const flat = flattenCriteria(critique.criteria as CriterionNode[]);
  return flat
    .filter((c) => c.evidence?.trim())
    .map((c, index) => ({
      id: c.id || `critique_${index}`,
      title: c.tags?.slice(0, 3).join(", ") || c.evidence.slice(0, 50),
      fact: c.evidence,
      category: c.tags?.[0] || "evidence",
      weight: c.score || 0.5,
      knowledgeLevel: "direct" as const,
      unlockTriggers: c.tags || [],
      requiresSpecificity: false,
      sampleResponse: c.evidence,
      whyItMatters: `This evidence (weight ${c.score}) is part of the scoring rubric.`,
    }));
}

function scenarioConfigFromAssessment(
  stored: StoredAssessmentPackage,
  fallbackRole: string
): ScenarioConfig | null {
  const item = firstAssessmentScenario(stored);
  const candidatePrompt = item?.candidatePrompt?.trim();
  if (!item || !candidatePrompt) return null;

  const focusAreas = item.focusAreas?.filter(Boolean) || [];
  const role = stored.targetRole || item.jobTitle || stored.jobTitle || fallbackRole;
  const teamInput = item.derivedFrom?.teamInput || [];
  const skillset = item.derivedFrom?.skillset || focusAreas;
  const teamPreferences = teamInput
    .map((member) =>
      [member.memberName, member.description].filter(Boolean).join(": ")
    )
    .filter(Boolean);

  // Build hiddenFacts from critique if available, otherwise use generic fallbacks
  const critique = item.critique as ScenarioCritique | undefined;
  const critiqueHiddenFacts = critique?.criteria?.length
    ? critiqueToHiddenFacts(critique)
    : [];

  const hiddenFacts = critiqueHiddenFacts.length > 0
    ? critiqueHiddenFacts
    : [
        {
          id: "impact_scope",
          title: "Impact and scope",
          fact: "The candidate should ask who or what is affected before proposing a fix.",
          category: "scope",
          weight: 1,
          knowledgeLevel: "direct" as const,
          unlockTriggers: ["who", "affected", "impact", "scope", "users", "customers"],
          requiresSpecificity: false,
          sampleResponse:
            "The first useful thing is to establish impact and scope before jumping to a fix.",
          whyItMatters:
            "Good incident work starts by understanding blast radius.",
        },
        {
          id: "evidence",
          title: "Evidence and reproduction",
          fact: "The candidate should ask for logs, repro path, timing, and concrete evidence.",
          category: "debugging",
          weight: 1,
          knowledgeLevel: "direct" as const,
          unlockTriggers: ["logs", "reproduce", "evidence", "trace", "error", "when"],
          requiresSpecificity: false,
          sampleResponse:
            "I would anchor on the concrete evidence: logs, timing, repro steps, and what changed around the failure.",
          whyItMatters:
            "This rewards evidence-driven debugging rather than guessing.",
        },
        {
          id: "change_or_boundary",
          title: "Change or system boundary",
          fact: "The candidate should inspect recent changes and integration/data-shape boundaries.",
          category: "root-cause",
          weight: 1,
          knowledgeLevel: "hedged" as const,
          unlockTriggers: ["changed", "deploy", "release", "dependency", "payload", "type", "boundary"],
          requiresSpecificity: false,
          sampleResponse:
            "A useful angle is whether a recent change or boundary mismatch changed what the downstream system receives.",
          whyItMatters:
            "Many ambiguous failures come from boundary mismatches, not the visible symptom alone.",
        },
        {
          id: "next_step",
          title: "Action under uncertainty",
          fact: "The candidate should choose a high-signal action under uncertainty.",
          category: "ownership",
          weight: 1,
          knowledgeLevel: "direct" as const,
          unlockTriggers: ["next", "priority", "mitigation", "rollback", "risk", "deadline"],
          requiresSpecificity: false,
          sampleResponse:
            "I care about the next high-signal action you would take, not a perfect final answer immediately.",
          whyItMatters:
            "This tests ownership and practical judgment.",
        },
      ];

  return {
    id: item.id || stored.id,
    title: item.jobTitle || stored.jobTitle || "Assessment",
    role,
    candidatePrompt,
    todos: item.todos,
    scope: item.scope,
    persona: {
      name: "Sam",
      role: "Engineering Manager",
      tone: "kind, busy, concise, and factual",
      answerStyle:
        "Answer only the question asked. Give more useful context for specific, grounded questions. Do not proactively solve the incident for the candidate.",
      expertise: skillset,
      directKnowledge: [
        ...(item.sourceTitle ? [`source incident: ${item.sourceTitle}`] : []),
        ...teamPreferences,
      ],
      hedgedKnowledge: [
        "implementation details not shown in the assessment package",
        "exact production internals outside the supplied scenario",
      ],
      communicationRules: [
        "Keep answers short.",
        "Do not reveal all context at once.",
        "If the candidate asks a broad question, answer broadly.",
      ],
    },
    maxQuestions: 5,
    ambientFacts: [
      {
        id: "source",
        fact: item.sourceUrl
          ? `This scenario is grounded on ${item.sourceTitle || "a source incident"}: ${item.sourceUrl}.`
          : `This scenario is grounded on ${item.sourceTitle || "a source incident"}.`,
        whenToReveal: ["source", "incident", "grounded", "context"],
      },
      {
        id: "focus",
        fact: focusAreas.length
          ? `The assessment is meant to probe ${focusAreas.join(", ")}.`
          : "The assessment is meant to probe how the candidate handles ambiguity.",
        whenToReveal: ["focus", "skill", "evaluate", "looking for"],
      },
    ],
    hiddenFacts,
    trapAssumptions: [
      {
        id: "visible_error_is_full_answer",
        assumption: "The visible error message fully explains what to fix.",
        whyTempting:
          "A concrete error string makes it tempting to jump straight to code.",
        howToDisprove:
          "Ask about impact, evidence, recent changes, and system boundaries.",
      },
    ],
    idealRecommendation:
      "Ask targeted questions to establish impact, evidence, likely boundary/change, and the next immediate action.",
    critique: critique || undefined,
  };
}

function downloadTraceJson(
  scenario: ScenarioConfig,
  messages: Message[],
  unlockedFactIds: string[],
  finalRecommendation: string,
  report: ValidatorReport | null
) {
  const trace = {
    exportedAt: new Date().toISOString(),
    scenario: {
      id: scenario.id,
      title: scenario.title,
      role: scenario.role,
      candidatePrompt: scenario.candidatePrompt,
      todos: scenario.todos,
      scope: scenario.scope,
      maxQuestions: scenario.maxQuestions,
      persona: scenario.persona,
    },
    conversation: messages.map((m, i) => ({
      turn: Math.floor(i / 2) + 1,
      role: m.role,
      content: m.content,
    })),
    unlockedFactIds,
    hiddenFacts: scenario.hiddenFacts.map((f) => ({
      id: f.id,
      title: f.title,
      fact: f.fact,
      unlocked: unlockedFactIds.includes(f.id),
    })),
    finalRecommendation,
    report: report
      ? {
          percent: report.deterministic.percent,
          label: report.assessment.label,
          summary: report.assessment.summary,
          signalBreakdown: report.assessment.signalBreakdown,
          strengths: report.assessment.strengths,
          concerns: report.assessment.concerns,
          evidence: report.assessment.evidence,
          finalRecommendationAssessment:
            report.assessment.finalRecommendationAssessment,
          nextInterviewFocus: report.assessment.nextInterviewFocus,
          modelUsed: report.modelUsed,
          source: report.source,
        }
      : null,
  };

  const blob = new Blob([JSON.stringify(trace, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `interview-trace-${scenario.id}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function managerOpeningMessage() {
  return "I'm here. Ask me what you need to know.";
}

function contextAreas(scenario: ScenarioConfig) {
  const areas = [
    ...(scenario.persona.expertise || []),
    ...scenario.hiddenFacts.map((fact) => fact.category),
  ]
    .map((item) => item?.trim())
    .filter(Boolean);

  return Array.from(new Set(areas)).slice(0, 4);
}

function managerSummary(scenario: ScenarioConfig) {
  const directKnowledge = scenario.persona.directKnowledge?.[0];
  if (directKnowledge) {
    return `${scenario.persona.name} is close to this work and has context from ${directKnowledge}.`;
  }

  return `${scenario.persona.name} is close to this work and can answer focused questions about the situation.`;
}

function candidateBrief(prompt: string) {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .replace(/\s*Review the following signals.*$/i, "")
    .replace(/\s*The logs show the following error:.*$/i, "")
    .trim();
  if (cleaned.length <= 260) return cleaned;

  const boundary = cleaned.slice(0, 260).lastIndexOf(".");
  if (boundary > 140) return cleaned.slice(0, boundary + 1).trim();
  return `${cleaned.slice(0, 240).trim()}...`;
}

function samGreetingLines(scenario: ScenarioConfig) {
  return [
    `I'm ${scenario.persona.name} — I'll be your ${scenario.persona.role.toLowerCase()} for this scenario.`,
    "Ask me focused questions to understand what's going on. I'll tell you what you ask, but I won't hand you the diagnosis.",
    `You have ${scenario.maxQuestions} questions. Submit when you're done asking.`,
    "Take your time. Let me know when you're ready.",
  ];
}

function compactText(text: string, maxLength = 180) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const boundary = cleaned.slice(0, maxLength).lastIndexOf(".");
  if (boundary > maxLength * 0.45) return cleaned.slice(0, boundary + 1).trim();
  return `${cleaned.slice(0, maxLength - 3).trim()}...`;
}

function taskTicketRows(scenario: ScenarioConfig) {
  const prompt = scenario.candidatePrompt;
  const firstFocus = scenario.scope?.focus?.[0] || scenario.persona.expertise?.[0];
  return [
    ["Role", scenario.role || "Candidate"],
    ["Symptom", compactText(prompt, 150)],
    ["Scope", firstFocus || "Use questions to narrow the scope"],
  ];
}

function visibleSignals(scenario: ScenarioConfig) {
  const prompt = scenario.candidatePrompt.replace(/\s+/g, " ").trim();
  const signals: Array<{ label: string; value: string }> = [];
  const errorMatch = prompt.match(
    /(error(?: message)?(?: reported)? is:?|logs? show(?:s)?(?: the following error)?:?)\s*([`"']?[^.]+(?:\.[^A-Z]|$)?)/i
  );
  if (errorMatch?.[2]) {
    signals.push({
      label: "Observable signal",
      value: compactText(errorMatch[2].replace(/^[:\s]+/, ""), 190),
    });
  }

  const scopeText =
    scenario.scope?.focus?.[0] ||
    scenario.todos?.[0] ||
    scenario.persona.expertise?.slice(0, 2).join(", ");
  if (scopeText) {
    signals.push({ label: "Initial focus", value: compactText(scopeText, 160) });
  }

  if (signals.length === 0) {
    signals.push({ label: "Task brief", value: compactText(prompt, 190) });
  }

  if (signals.length === 1) {
    signals.push({
      label: "What is missing",
      value: `Everything beyond this visible signal should be learned by asking ${scenario.persona.name}.`,
    });
  }

  return signals.slice(0, 3);
}

const LOCAL_REPORT_SCENARIO_ID = "user_api_export_connection_leak";

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function buildLocalConnectionLeakReport(
  scenario: ScenarioConfig,
  messages: Message[],
  unlockedFactIds: string[],
  finalRecommendation: string
): ValidatorReport {
  const deterministic = scoreInformationGain(scenario, unlockedFactIds);
  const unlockedFacts = scenario.hiddenFacts.filter((fact) =>
    unlockedFactIds.includes(fact.id)
  );
  const missedFacts = scenario.hiddenFacts.filter(
    (fact) => !unlockedFactIds.includes(fact.id)
  );
  const askedQuestions = messages
    .filter((message) => message.role === "candidate")
    .map((message) => message.content);
  const transcriptText = askedQuestions.join(" ").toLowerCase();
  const nextStepText = finalRecommendation.toLowerCase();
  const identifiedLeak = hasAny(nextStepText, [
    "leak",
    "release",
    "close",
    "finally",
    "cleanup",
    "error path",
    "early return",
  ]);
  const mitigatedIncident = hasAny(nextStepText, [
    "disable",
    "block",
    "feature flag",
    "rollback",
    "stop",
    "restart",
    "recycle",
    "drain",
  ]);
  const preventionPlan = hasAny(nextStepText, [
    "test",
    "finally",
    "helper",
    "lint",
    "review",
    "alert",
    "metric",
    "monitor",
  ]);
  const askedLifecycle = hasAny(transcriptText, [
    "connection",
    "release",
    "close",
    "finally",
    "error path",
    "leak",
  ]);
  const askedMitigation = hasAny(transcriptText, [
    "mitigation",
    "stop bleeding",
    "disable",
    "rollback",
    "stabilize",
  ]);
  const localSignalLabel =
    deterministic.percent >= 75 && identifiedLeak && mitigatedIncident
      ? "Strong incident debugger"
      : deterministic.percent >= 45 || identifiedLeak
        ? "Developing incident debugger"
        : "Needs stronger resource-lifecycle reasoning";

  return {
    deterministic,
    assessment: {
      label: deterministic.label,
      summary:
        deterministic.percent >= 75
          ? `${localSignalLabel}: the candidate connected the production symptoms to a resource-lifecycle failure and built enough context for a grounded assessment.`
          : deterministic.percent >= 45
            ? `${localSignalLabel}: the candidate found part of the connection-leak story, but the report should still check whether they separated mitigation, fix, and prevention.`
            : `${localSignalLabel}: the candidate did not uncover enough of the connection lifecycle to confidently explain the incident or choose the right immediate action.`,
      signalBreakdown: {
        questionQuality: {
          label: askedLifecycle ? "Connection-lifecycle focused" : "Too broad",
          assessment: askedLifecycle
            ? "The questions probed the open/use/close lifecycle and the error path where a connection can be leaked."
            : "The questions did not clearly follow the literal connection-pool error toward resource cleanup.",
          evidence: askedQuestions[0] || "No question recorded.",
        },
        adaptiveFollowUp: {
          label:
            askedQuestions.length >= 3
              ? "Built a triage path"
              : "Limited transcript",
          assessment:
            askedQuestions.length >= 3
              ? "The candidate gathered enough facts to move from symptoms, to suspected code path, to mitigation."
              : "There were too few questions to show a complete incident triage path.",
          evidence:
            askedQuestions.slice(1, 4).join(" | ") ||
            "No follow-up question recorded.",
        },
        ownershipPosture: {
          label:
            askedMitigation || mitigatedIncident
              ? "Stops the bleeding"
              : "Diagnosis-heavy",
          assessment:
            askedMitigation || mitigatedIncident
              ? "The candidate addressed production stability before the durable code fix."
              : "The candidate needs to explicitly separate immediate mitigation from the permanent fix.",
          evidence:
            askedQuestions.find((question) =>
              /mitigation|stop|disable|rollback|stabil/i.test(question)
            ) || finalRecommendation,
        },
        groundedNextStep: {
          label:
            identifiedLeak && mitigatedIncident && preventionPlan
              ? "Grounded and complete"
              : identifiedLeak && mitigatedIncident
                ? "Good incident action"
                : "Incomplete",
          assessment:
            identifiedLeak && mitigatedIncident && preventionPlan
              ? "The candidate covered incident mitigation, the likely cleanup bug, and prevention for future error-path leaks."
              : identifiedLeak && mitigatedIncident
                ? "The candidate handled the incident and likely bug; add explicit follow-up tests/alerts for prevention."
                : "The assessment should name the connection leak, stop new export traffic, and guarantee release in cleanup code.",
          evidence: finalRecommendation,
        },
      },
      strengths:
        unlockedFacts.length > 0
          ? unlockedFacts
              .slice(0, 4)
              .map((fact) => `Uncovered ${fact.title}: ${fact.whyItMatters}`)
          : [
              "Kept the flow moving, but did not unlock decision-critical context.",
            ],
      concerns: [
        ...missedFacts
          .slice(0, 3)
          .map((fact) => `Missed ${fact.title}: ${fact.whyItMatters}`),
        ...(!mitigatedIncident
          ? [
              "The assessment should explicitly show how the candidate would stop new `/export` traffic before the code fix ships.",
            ]
          : []),
        ...(!preventionPlan
          ? [
              "Follow-up should include error-path tests, a cleanup helper or `finally`, and pool usage alerts.",
            ]
          : []),
      ].slice(0, 5),
      evidence:
        askedQuestions.length > 0
          ? askedQuestions.slice(0, 5).map((question) => `Asked: ${question}`)
          : ["No candidate questions were recorded."],
      finalRecommendationAssessment:
        identifiedLeak && mitigatedIncident
          ? "The submission is demo-ready: it stabilizes production first and points to the connection cleanup bug."
          : "The submission needs to explicitly connect the incident to a leaked DB connection and stop `/export` traffic while the fix is prepared.",
      nextInterviewFocus:
        missedFacts.length > 0
          ? missedFacts
              .slice(0, 2)
              .map((fact) => `Probe ${fact.category}: ${fact.title}.`)
          : [
              "Ask the candidate to write the concrete `try/finally` or helper pattern they would use in code review.",
            ],
    },
    modelUsed: "local-demo-rubric",
    source: "fallback",
    warning:
      "Generated locally from the backend connection-leak demo rubric; no evaluator API call was made.",
  };
}

const typedDemoRunHistory = demoRunHistory as DemoRunHistoryFixture;

function historyRunsForScenario(scenario: ScenarioConfig): ManagerEvaluationRun[] {
  if (scenario.id !== typedDemoRunHistory.scenarioId) return [];

  const validFactIds = new Set(scenario.hiddenFacts.map((fact) => fact.id));

  return typedDemoRunHistory.runs.map((run) => {
    const unlockedFactIds = run.unlockedFactIds.filter((id) =>
      validFactIds.has(id)
    );
    const deterministic = scoreInformationGain(scenario, unlockedFactIds);

    return {
      ...run,
      unlockedFactIds,
      percent: deterministic.percent,
      label: deterministic.label,
      questionCount: run.messages.filter((message) => message.role === "candidate")
        .length,
    };
  });
}

function currentEvaluationRun({
  candidateName,
  report,
  messages,
  unlockedFactIds,
  finalRecommendation,
  questionCount,
}: {
  candidateName: string;
  report: ValidatorReport;
  messages: Message[];
  unlockedFactIds: string[];
  finalRecommendation: string;
  questionCount: number;
}): ManagerEvaluationRun {
  return {
    id: "current-candidate-run",
    candidateName,
    submittedLabel: "Current submission",
    unlockedFactIds,
    messages,
    finalRecommendation,
    summary: report.assessment.summary,
    percent: report.deterministic.percent,
    label: report.assessment.label,
    questionCount,
    isCurrent: true,
  };
}

function scoreColorClass(percent: number) {
  if (percent >= 75) return "bg-[#1f7a56] text-white";
  if (percent >= 45) return "bg-[#d8a646] text-[#2b2540]";
  return "bg-[#c85647] text-white";
}

function coverageBarClass(percent: number) {
  if (percent >= 75) return "bg-[#33c989]";
  if (percent >= 45) return "bg-[#d8a646]";
  return "bg-[#c85647]";
}

function ManagerEvaluationView({
  scenario,
  report,
  messages,
  unlockedFactIds,
  candidateQuestionCount,
  candidateName,
}: {
  scenario: ScenarioConfig;
  report: ValidatorReport;
  messages: Message[];
  unlockedFactIds: string[];
  candidateQuestionCount: number;
  candidateName: string;
}) {
  const historicalRuns = useMemo(
    () => historyRunsForScenario(scenario),
    [scenario]
  );
  const currentRun = useMemo(
    () =>
      currentEvaluationRun({
        candidateName,
        report,
        messages,
        unlockedFactIds,
        finalRecommendation: "",
        questionCount: candidateQuestionCount,
      }),
    [
      candidateName,
      candidateQuestionCount,
      messages,
      report,
      unlockedFactIds,
    ]
  );
  const allRuns = useMemo(
    () => [currentRun, ...historicalRuns],
    [currentRun, historicalRuns]
  );
  const [selectedRunId, setSelectedRunId] = useState(currentRun.id);

  useEffect(() => {
    if (allRuns.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(currentRun.id);
  }, [allRuns, currentRun.id, selectedRunId]);

  const selectedRun =
    allRuns.find((run) => run.id === selectedRunId) || currentRun;
  const averagePercent =
    allRuns.length === 0
      ? report.deterministic.percent
      : Math.round(
          allRuns.reduce((sum, run) => sum + run.percent, 0) / allRuns.length
        );
  const currentRank =
    [...allRuns].sort((a, b) => b.percent - a.percent).findIndex(
      (run) => run.id === currentRun.id
    ) + 1;
  const rootCauseReached = unlockedFactIds.includes(
    "missing_release_on_error_path"
  );
  const mitigationReached = unlockedFactIds.includes("disable_export_first");
  const preventionReached = unlockedFactIds.includes(
    "prevention_error_path_tests"
  );
  const signalBreakdown = report.assessment.signalBreakdown;

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-white/75 bg-white/65 p-6 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
              Manager review
            </p>
            <h1 className="mt-2 text-[34px] font-extrabold leading-tight tracking-[-0.035em] text-[#17171c]">
              {candidateName} evaluation
            </h1>
            <p className="mt-2 max-w-3xl text-[15px] font-medium leading-7 text-[#3a3a42]">
              Candidate flow complete. This review uses the deterministic
              local rubric for the backend connection-leak scenario and compares
              the current run against seeded demo history.
            </p>
          </div>
          <div
            className={`rounded-full px-5 py-3 text-lg font-black ${scoreColorClass(
              report.deterministic.percent
            )}`}
          >
            {report.deterministic.percent}%
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Score label", report.assessment.label],
            [
              "Facts unlocked",
              `${unlockedFactIds.length}/${scenario.hiddenFacts.length}`,
            ],
            ["Questions", `${candidateQuestionCount}/${scenario.maxQuestions}`],
            ["History rank", `${currentRank}/${allRuns.length}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-[16px] border border-black/10 bg-white/45 p-4"
            >
              <p className="text-[10.5px] font-black uppercase tracking-[0.13em] text-[#a6a6b0]">
                {label}
              </p>
              <p className="mt-1 text-[15px] font-black text-[#17171c]">
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <section className="rounded-[24px] border border-[#23252E] bg-[#0f1016] p-5 shadow-[0_24px_60px_rgba(38,38,54,.18)]">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8B8F9A]">
                Current candidate graph
              </p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] text-[#E7E8EC]">
                Concept coverage
              </h2>
            </div>
            <div className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[#8B8F9A]">
              Root cause {rootCauseReached ? "reached" : "missed"}
            </div>
          </div>
          <ConceptCoverageGraph
            scenario={scenario}
            unlockedFactIds={unlockedFactIds}
            messages={messages}
            candidateName={candidateName}
          />
        </section>

        <aside className="space-y-5">
          <section className="rounded-[24px] border border-white/75 bg-white/65 p-5 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
                  Run history
                </p>
                <h2 className="mt-1 text-xl font-extrabold tracking-[-0.03em] text-[#17171c]">
                  Same scenario
                </h2>
              </div>
              <span className="rounded-full border border-black/10 bg-white/50 px-3 py-1 text-xs font-black text-[#6e6e78]">
                Avg {averagePercent}%
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {allRuns.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full rounded-[16px] border p-3 text-left transition ${
                    selectedRunId === run.id
                      ? "border-[#17171c] bg-white"
                      : "border-black/10 bg-white/45 hover:bg-white/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-[#17171c]">
                        {run.candidateName}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-[#8a83a6]">
                        {run.submittedLabel}
                        {run.isCurrent ? " - live" : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-black ${scoreColorClass(
                        run.percent
                      )}`}
                    >
                      {run.percent}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
                    <div
                      className={`h-full rounded-full ${coverageBarClass(
                        run.percent
                      )}`}
                      style={{ width: `${Math.max(4, run.percent)}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] border border-[#23252E] bg-[#0f1016] p-4 shadow-[0_24px_60px_rgba(38,38,54,.18)]">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8B8F9A]">
              Selected run graph
            </p>
            <ConceptCoverageGraph
              scenario={scenario}
              unlockedFactIds={selectedRun.unlockedFactIds}
              messages={selectedRun.messages}
              candidateName={selectedRun.candidateName}
              compact
              className="mt-3"
            />
          </section>
        </aside>
      </div>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[24px] border border-white/75 bg-white/65 p-5 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
            Evaluation evidence
          </p>
          <p className="mt-3 rounded-[16px] border border-black/10 bg-white/45 p-4 text-[14px] font-medium leading-6 text-[#3a3a42]">
            {report.assessment.summary}
          </p>

          {signalBreakdown && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                ["Question quality", signalBreakdown.questionQuality],
                ["Adaptive follow-up", signalBreakdown.adaptiveFollowUp],
                ["Ownership posture", signalBreakdown.ownershipPosture],
              ].map(([title, signal]) => (
                <div
                  key={title as string}
                  className="rounded-[16px] border border-black/10 bg-white/45 p-4"
                >
                  <p className="text-[10.5px] font-black uppercase tracking-[0.13em] text-[#a6a6b0]">
                    {title as string}
                  </p>
                  <p className="mt-1 text-sm font-black text-[#17171c]">
                    {(signal as { label: string }).label}
                  </p>
                  <p className="mt-1 text-[13px] font-medium leading-6 text-[#5a5470]">
                    {(signal as { assessment: string }).assessment}
                  </p>
                  <p className="mt-2 text-xs font-medium leading-5 text-[#8a83a6]">
                    {(signal as { evidence: string }).evidence}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <section className="rounded-[24px] border border-white/75 bg-white/65 p-5 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
              Manager readout
            </p>
            <div className="mt-3 space-y-2">
              {[
                ["Root cause", rootCauseReached ? "Reached" : "Missed"],
                ["Mitigation", mitigationReached ? "Reached" : "Missed"],
                ["Prevention", preventionReached ? "Reached" : "Missed"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-[14px] border border-black/10 bg-white/45 px-3 py-2"
                >
                  <span className="text-xs font-black uppercase tracking-[0.1em] text-[#a6a6b0]">
                    {label}
                  </span>
                  <span className="text-sm font-black text-[#17171c]">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export default function QuestionArenaPortal({
  scenarios,
  defaultProcessorPrompt,
  defaultAnswerPrompt,
  defaultEvaluatorPrompt,
  initialDevMode = true,
  assessmentId,
  autoProcessAssessment = false,
}: QuestionArenaPortalProps) {
  const [templateId, setTemplateId] = useState(scenarios[0]?.id ?? "");
  const [targetRole, setTargetRole] = useState(
    scenarios[0]?.role ?? "New Grad Software Engineer"
  );
  const [candidateName, setCandidateName] = useState("Candidate");
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
  const [assessmentLoadError, setAssessmentLoadError] = useState("");
  const [report, setReport] = useState<ValidatorReport | null>(null);
  const [answerMode, setAnswerMode] = useState<"model" | "mock">("model");
  const [processingScenario, setProcessingScenario] = useState(false);
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const [loadingEvaluation, setLoadingEvaluation] = useState(false);
  const [modelStatus, setModelStatus] = useState(
    "Model endpoint not tested in UI."
  );
  const [devMode, setDevMode] = useState(initialDevMode);
  const [interviewPhase, setInterviewPhase] =
    useState<InterviewPhase>("task_drop");
  const [visibleGreetingCount, setVisibleGreetingCount] = useState(0);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const loadedAssessmentRef = useRef<string | null>(null);
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const audioRef = useRef<AudioBufferSourceNode | null>(null);
  const submitPanelRef = useRef<HTMLDivElement | null>(null);

  const candidateQuestionCount = messages.filter(
    (message) => message.role === "candidate"
  ).length;
  const questionsLeft = Math.max(scenario.maxQuestions - candidateQuestionCount, 0);
  const unlockedFacts = useMemo(
    () =>
      scenario.hiddenFacts.filter((fact) => unlockedFactIds.includes(fact.id)),
    [scenario.hiddenFacts, unlockedFactIds]
  );
  const lastUnlockedHiddenFacts = useMemo(() => {
    if (!lastDecision) return [];

    return lastDecision.unlockedFactIds.map((id) => {
      const fact = scenario.hiddenFacts.find((item) => item.id === id);
      return {
        id,
        title: fact?.title || id,
        detail:
          fact?.sampleResponse ||
          fact?.fact ||
          "No matching hidden fact in the current scenario.",
        category: fact?.category,
        knowledgeLevel: fact?.knowledgeLevel,
      };
    });
  }, [lastDecision, scenario.hiddenFacts]);
  const lastAmbientFacts = useMemo(() => {
    if (!lastDecision) return [];

    return lastDecision.ambientFactIds.map((id) => {
      const fact = scenario.ambientFacts.find((item) => item.id === id);
      return {
        id,
        detail: fact?.fact || "No matching ambient fact in the current scenario.",
      };
    });
  }, [lastDecision, scenario.ambientFacts]);
  const currentTemplateExists = scenarios.some((item) => item.id === templateId);
  const layoutClassName = devMode
    ? "grid items-start grid-cols-[minmax(360px,0.9fr)_minmax(440px,1.2fr)_minmax(260px,0.7fr)] gap-4 max-[1180px]:grid-cols-1"
    : "mx-auto grid w-full max-w-7xl grid-cols-1 items-start";
  const assessmentUnavailable = Boolean(assessmentLoadError);
  const managerReviewOpen =
    !devMode && interviewPhase === "submitted" && Boolean(report);
  const showTaskDrop =
    !devMode && interviewPhase === "task_drop" && !assessmentUnavailable;
  const showGreeting =
    !devMode && interviewPhase === "greeting" && !assessmentUnavailable;
  const canAskQuestions =
    interviewPhase === "workspace" && !assessmentUnavailable && questionsLeft > 0;
  const visibleContextAreas = useMemo(() => contextAreas(scenario), [scenario]);
  const visibleBrief = useMemo(
    () => candidateBrief(scenario.candidatePrompt),
    [scenario.candidatePrompt]
  );
  const greetingLines = useMemo(() => samGreetingLines(scenario), [scenario]);
  const ticketRows = useMemo(() => taskTicketRows(scenario), [scenario]);
  const progressIndex =
    interviewPhase === "submitted"
      ? 2
      : interviewPhase === "workspace"
        ? 1
        : 0;
  const pageClassName = devMode
    ? "min-h-screen p-4"
    : "min-h-screen overflow-x-hidden bg-[linear-gradient(155deg,#edecea_0%,#e7e8eb_55%,#e9e7e4_100%)] px-4 py-7 text-[#17171c]";
  const interviewShellClassName = devMode
    ? "relative grid min-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-slate-800 bg-surface shadow-2xl shadow-slate-950/40 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]"
    : managerReviewOpen
      ? "relative mx-auto w-full max-w-6xl"
      : "relative mx-auto w-full max-w-[600px]";

  function resetRun(nextScenario = scenario) {
    setMessages([]);
    setQuestion("");
    setFinalRecommendation("");
    setUnlockedFactIds([]);
    setLastDecision(null);
    setReport(null);
    setInterviewPhase("task_drop");
    setVisibleGreetingCount(0);
    setTranscript("");
    setVoiceMode(false);
    setStatus(`Run reset for ${nextScenario.title}.`);
  }

  function enterWorkspace() {
    setMessages((current) =>
      current.length
        ? current
        : [{ role: "manager", content: "Go ahead — what would you like to know?" }]
    );
    setInterviewPhase("workspace");
    window.scrollTo({ top: 0, behavior: "auto" });
    setStatus(`Workspace opened for ${scenario.title}.`);
  }

  function openGreeting() {
    setVisibleGreetingCount(0);
    setInterviewPhase("greeting");
    window.scrollTo({ top: 0, behavior: "auto" });
    setStatus(`Introduced ${scenario.persona.name}.`);
  }

  function moveToNextStep() {
    setInterviewPhase("submitted");
    setStatus("Submitting assessment.");
  }

  useEffect(() => {
    if (interviewPhase !== "workspace" || voiceMode) return;
    questionInputRef.current?.focus();
  }, [interviewPhase, voiceMode]);

  useEffect(() => {
    if (interviewPhase !== "greeting") return;
    setVisibleGreetingCount(0);
    const timers = greetingLines.map((_, index) =>
      window.setTimeout(() => {
        setVisibleGreetingCount(index + 1);
      }, 360 + index * 680)
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [interviewPhase, greetingLines]);

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

  async function processStorylineInput(text: string, role: string) {
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
          targetRole: role,
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

  async function processStoryline() {
    await processStorylineInput(rawStoryline.trim(), targetRole);
  }

  useEffect(() => {
    if (!assessmentId || loadedAssessmentRef.current === assessmentId) return;
    const id = assessmentId;
    loadedAssessmentRef.current = assessmentId;

    let canceled = false;
    setAssessmentLoadError("");

    async function loadAssessment() {
      try {
        const storageKey = `question_arena_assessment:${id}`;
        const raw = localStorage.getItem(storageKey);
        let stored = raw ? (JSON.parse(raw) as StoredAssessmentPackage) : null;

        if (!stored) {
          const res = await fetch(
            `/api/assessments?id=${encodeURIComponent(id)}`
          );
          if (!res.ok) {
            const message = `Assessment ${id} was not found. Generate a fresh link from the Candidates tab.`;
            setAssessmentLoadError(message);
            setStatus(message);
            return;
          }

          const data = (await res.json()) as {
            assessment: StoredAssessmentPackage;
          };
          stored = data.assessment;
          localStorage.setItem(storageKey, JSON.stringify(stored));
        }

        if (canceled) return;

        const markdown = stored.markdown || "";
        const role = stored.targetRole || stored.jobTitle || targetRole;
        const linkedScenario = scenarioConfigFromAssessment(stored, role);

        setRawStoryline(markdown);
        setTargetRole(role);
        setCandidateName(stored.candidateName || "Candidate");
        setDevMode(false);
        setAssessmentLoadError("");

        if (linkedScenario) {
          setScenario(linkedScenario);
          setScenarioText(formatJson(linkedScenario));
          setTemplateId(linkedScenario.id);
          resetRun(linkedScenario);
          setStatus(
            `Loaded assessment ${id}${
              stored.candidateName ? ` for ${stored.candidateName}` : ""
            } from the generated scenario package.`
          );
          return;
        }

        setStatus(
          `Loaded assessment ${id}${
            stored.candidateName ? ` for ${stored.candidateName}` : ""
          }.`
        );

        if (autoProcessAssessment && markdown.trim()) {
          void processStorylineInput(markdown.trim(), role);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? `Could not load assessment package: ${error.message}`
            : "Could not load assessment package.";
        setAssessmentLoadError(message);
        setStatus(message);
      }
    }

    void loadAssessment();

    return () => {
      canceled = true;
    };
  }, [assessmentId, autoProcessAssessment, targetRole]);

  async function askManager(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || !canAskQuestions || loadingAnswer) return;

    const questionsBeforeAsk = questionsLeft;
    setQuestion("");
    setMessages((current) => [
      ...current,
      { role: "candidate", content: text },
    ]);
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
    const nextStep = "";
    if (assessmentUnavailable) {
      setStatus("Assessment link unavailable.");
      return;
    }

    if (scenario.id === LOCAL_REPORT_SCENARIO_ID) {
      const data = buildLocalConnectionLeakReport(
        scenario,
        messages,
        unlockedFactIds,
        nextStep
      );
      setReport(data);
      const persistenceWarning = await persistManagerReport(data, nextStep);
      setStatus(
        persistenceWarning ||
          "Generated local demo report for the connection-leak scenario."
      );
      setInterviewPhase("submitted");
      return;
    }

    setLoadingEvaluation(true);
    try {
      const res = await fetch("/api/question-arena/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          messages,
          unlockedFactIds,
          finalRecommendation: nextStep,
          evaluatorPrompt,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ValidatorReport;
      setReport(data);
      const persistenceWarning = await persistManagerReport(data, nextStep);
      setStatus(
        persistenceWarning
          ? persistenceWarning
          : data.warning
          ? data.warning
          : `Validator report generated with ${data.modelUsed} (${data.source}).`
      );
      setInterviewPhase("submitted");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Validator report failed."
      );
    } finally {
      setLoadingEvaluation(false);
    }
  }

  async function persistManagerReport(
    validatorReport: ValidatorReport,
    nextStep: string
  ): Promise<string | null> {
    if (!assessmentId) return null;

    try {
      const res = await fetch("/api/assessments/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          scenario,
          candidateName,
          messages,
          unlockedFactIds,
          finalRecommendation: nextStep,
          validatorReport,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }
      return null;
    } catch (error) {
      return error instanceof Error
        ? `Report generated, but manager dashboard save failed: ${error.message}`
        : "Report generated, but manager dashboard save failed.";
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
    if (!canAskQuestions || loadingAnswer) return;
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
      if (text && canAskQuestions) {
        setTranscript("");
        void (async () => {
          const q = text;
          const questionsBeforeAsk = questionsLeft;
          setQuestion("");
          setMessages((current) => [...current, { role: "candidate", content: q }]);
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
            setMessages((current) => [...current, { role: "manager", content: answer }]);
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
    <div className={pageClassName}>
      {devMode ? (
        <div className="mb-3 flex justify-end">
          <div className="flex items-center gap-3 rounded-full border border-slate-800 bg-surface px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-300">
            <span>Dev Mode</span>
            <button
              type="button"
              role="switch"
              aria-checked={devMode}
              aria-label={devMode ? "Disable dev mode" : "Enable dev mode"}
              onClick={() => setDevMode((current) => !current)}
              className={`relative h-6 w-11 rounded-full border transition-colors ${
                devMode
                  ? "border-emerald-300 bg-emerald-300"
                  : "border-slate-700 bg-slate-900"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-slate-950 transition-transform ${
                  devMode ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="min-w-6 text-slate-500">
              {devMode ? "On" : "Off"}
            </span>
          </div>
        </div>
      ) : (
        <div
          className={`mx-auto mb-5 w-full ${
            managerReviewOpen ? "max-w-6xl" : "max-w-[600px]"
          }`}
        >
          <div className="grid grid-cols-3 gap-2 rounded-[28px] border border-white/75 bg-white/55 px-5 py-3 shadow-[0_10px_30px_rgba(38,38,54,.10),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
            {["Brief", "Investigate", "Done"].map((label, index) => (
              <div key={label}>
                <div
                  className={`h-1 rounded-full transition ${
                    index <= progressIndex ? "bg-[#3a3a42]" : "bg-black/10"
                  }`}
                />
                <span
                  className={`mt-2 block text-center text-[10px] font-semibold uppercase tracking-[0.1em] ${
                    index === progressIndex ? "text-[#17171c]" : "text-[#a6a6b0]"
                  }`}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={layoutClassName}>
        {devMode && (
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
        )}

      <section className={interviewShellClassName}>
        {!devMode ? (
          <>
            {assessmentLoadError ? (
              <div className="rounded-[28px] border border-white/75 bg-white/60 p-8 shadow-[0_24px_60px_rgba(38,38,54,.13)] backdrop-blur-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
                  Assessment unavailable
                </p>
                <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.035em] text-[#17171c]">
                  Link could not load
                </h1>
                <p className="mt-4 text-[15px] font-medium leading-7 text-[#3a3a42]">
                  {assessmentLoadError}
                </p>
              </div>
            ) : (
              <>
                {interviewPhase === "task_drop" && (
                  <div className="grid min-h-[60vh] place-items-center">
                    <button
                      type="button"
                      onClick={() => setInterviewPhase("brief")}
                      className="group w-full rounded-[28px] border border-white/75 bg-white/55 p-9 text-center shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl transition hover:-translate-y-1"
                    >
                      <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#6e6e78]">
                        <span className="h-2 w-2 rounded-full bg-[#c9743a]" />
                        New assignment · just now
                      </span>
                      <span className="mx-auto my-6 grid h-[70px] w-[70px] place-items-center rounded-[20px] border border-white/75 bg-white/70 shadow-[0_10px_30px_rgba(38,38,54,.10)]">
                        <MessageSquare className="h-8 w-8 text-[#3a3a42]" />
                      </span>
                      <span className="block text-xl font-bold tracking-[-0.02em] text-[#17171c]">
                        A task has been assigned to you
                      </span>
                      <span className="mt-2 block text-sm font-medium text-[#6e6e78]">
                        From <strong>{scenario.persona.name}</strong> ·{" "}
                        {scenario.persona.role}
                      </span>
                      <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#17171c]">
                        Tap to open{" "}
                        <span className="transition group-hover:translate-x-1">→</span>
                      </span>
                    </button>
                  </div>
                )}

                {interviewPhase === "brief" && (
                  <div className="rounded-[28px] border border-white/75 bg-white/55 p-8 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
                      Assignment
                    </p>
                    <h1 className="mt-3 text-[32px] font-extrabold leading-tight tracking-[-0.035em] text-[#17171c]">
                      {scenario.title}
                    </h1>
                    <div className="mt-5 flex items-center gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-full border border-white/75 bg-white/70 text-base font-bold text-[#3a3a42] shadow-[0_10px_30px_rgba(38,38,54,.10)]">
                        {scenario.persona.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#17171c]">
                          {scenario.persona.name}
                        </p>
                        <p className="text-sm font-medium text-[#6e6e78]">
                          {scenario.persona.role}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 rounded-[18px] border border-black/10 bg-white/40 px-5 py-4">
                      {ticketRows.map(([key, value]) => (
                        <div
                          key={key}
                          className="grid grid-cols-[88px_1fr] gap-3 py-1.5 text-sm leading-6"
                        >
                          <span className="font-semibold text-[#a6a6b0]">
                            {key}
                          </span>
                          <span className="font-medium text-[#3a3a42]">
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={openGreeting}
                      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#17171c] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
                    >
                      Continue →
                    </button>
                  </div>
                )}

                {interviewPhase === "greeting" && (
                  <div className="rounded-[28px] border border-white/75 bg-white/55 p-8 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
                    <div className="flex items-center gap-4">
                      <div className="grid h-16 w-16 place-items-center rounded-full border border-white/75 bg-white/70 text-[22px] font-bold text-[#3a3a42] shadow-[0_10px_30px_rgba(38,38,54,.10)]">
                        {scenario.persona.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-lg font-bold tracking-[-0.01em] text-[#17171c]">
                          {scenario.persona.name}
                        </p>
                        <p className="font-medium text-[#6e6e78]">
                          {scenario.persona.role}
                        </p>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-col gap-3">
                      {greetingLines
                        .slice(0, visibleGreetingCount)
                        .map((line) => (
                          <div key={line} className="flex max-w-[90%] items-end gap-3">
                            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/75 bg-white/70 text-xs font-bold text-[#3a3a42]">
                              {scenario.persona.name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="rounded-2xl rounded-bl-md border border-white/75 bg-white/60 px-4 py-3 text-[14.5px] font-medium leading-6 text-[#3a3a42]">
                              {line}
                            </div>
                          </div>
                        ))}
                      {visibleGreetingCount < greetingLines.length && (
                        <div className="flex max-w-[90%] items-end gap-3">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/75 bg-white/70 text-xs font-bold text-[#3a3a42]">
                            {scenario.persona.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="rounded-2xl rounded-bl-md border border-white/75 bg-white/60 px-4 py-3 text-sm text-[#a6a6b0]">
                            typing...
                          </div>
                        </div>
                      )}
                    </div>
                    {visibleGreetingCount >= greetingLines.length && (
                      <button
                        type="button"
                        onClick={() => setInterviewPhase("signals")}
                        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#17171c] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
                      >
                        I'm ready →
                      </button>
                    )}
                  </div>
                )}

                {interviewPhase === "signals" && (
                  <div className="rounded-[28px] border border-white/75 bg-white/55 p-8 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
                      What you can see
                    </p>
                    <h2 className="mt-3 text-[21px] font-bold tracking-[-0.02em] text-[#17171c]">
                      The starting evidence
                    </h2>
                    <p className="mt-3 text-sm font-medium leading-6 text-[#6e6e78]">
                      This is what's in front of you. Everything else, you'll
                      learn by asking {scenario.persona.name}.
                    </p>
                    <div className="mt-5 rounded-2xl border border-black/10 bg-white/40 px-5 py-4">
                      <div className="mb-3 flex items-center gap-3">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-white/75 bg-white/70">
                          <ClipboardList className="h-4 w-4 text-[#3a3a42]" />
                        </div>
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#a6a6b0]">
                          Full visible prompt
                        </p>
                      </div>
                      <p className="whitespace-pre-wrap text-[13.5px] font-medium leading-7 text-[#3a3a42]">
                        {scenario.candidatePrompt}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={enterWorkspace}
                      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#17171c] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
                    >
                      Talk to {scenario.persona.name} →
                    </button>
                  </div>
                )}

                {interviewPhase === "workspace" && (
                  <div className="rounded-[28px] border border-white/75 bg-white/55 p-8 shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
                          Investigate
                        </p>
                        <h2 className="mt-1 text-[21px] font-bold tracking-[-0.02em] text-[#17171c]">
                          Ask {scenario.persona.name}
                        </h2>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-[#6e6e78]">
                          <strong className="text-[#17171c]">{questionsLeft}</strong>{" "}
                          left
                        </span>
                        <div className="flex gap-1">
                          {Array.from({ length: scenario.maxQuestions }).map(
                            (_, index) => (
                              <span
                                key={index}
                                className={`h-1.5 w-4 rounded-full ${
                                  index < questionsLeft
                                    ? "bg-[#3a3a42]"
                                    : "bg-black/10"
                                }`}
                              />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                    <details className="group mb-4 rounded-[18px] border border-black/10 bg-white/40 px-4 py-3">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#a6a6b0]">
                              Task context
                            </p>
                            <p className="mt-1 text-[13.5px] font-medium leading-6 text-[#3a3a42] group-open:hidden">
                              {compactText(scenario.candidatePrompt, 210)}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full border border-black/10 bg-white/50 px-3 py-1 text-xs font-semibold text-[#6e6e78]">
                            <span className="group-open:hidden">Expand</span>
                            <span className="hidden group-open:inline">Collapse</span>
                          </span>
                        </div>
                      </summary>
                      <p className="mt-3 whitespace-pre-wrap border-t border-black/10 pt-3 text-[13.5px] font-medium leading-7 text-[#3a3a42]">
                        {scenario.candidatePrompt}
                      </p>
                    </details>
                    <div className="mb-4 flex max-h-[300px] min-h-[160px] flex-col gap-3 overflow-y-auto pr-1">
                      {messages.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={`flex max-w-[90%] items-end gap-3 ${
                            message.role === "candidate"
                              ? "ml-auto flex-row-reverse"
                              : ""
                          }`}
                        >
                          {message.role === "manager" && (
                            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/75 bg-white/70 text-xs font-bold text-[#3a3a42]">
                              {scenario.persona.name.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div
                            className={`rounded-2xl px-4 py-3 text-[14.5px] font-medium leading-6 ${
                              message.role === "candidate"
                                ? "rounded-br-md bg-[#17171c] text-white"
                                : "rounded-bl-md border border-white/75 bg-white/60 text-[#3a3a42]"
                            }`}
                          >
                            {message.content}
                          </div>
                        </div>
                      ))}
                      {loadingAnswer && (
                        <div className="flex max-w-[90%] items-end gap-3">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/75 bg-white/70 text-xs font-bold text-[#3a3a42]">
                            {scenario.persona.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="rounded-2xl rounded-bl-md border border-white/75 bg-white/60 px-4 py-3 text-sm text-[#a6a6b0]">
                            typing...
                          </div>
                        </div>
                      )}
                    </div>
                    <form onSubmit={askManager}>
                      <div className="flex items-center gap-2">
                        <input
                          ref={questionInputRef}
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          disabled={!canAskQuestions || loadingAnswer}
                          placeholder={`Ask ${scenario.persona.name} a focused question...`}
                          className="min-w-0 flex-1 rounded-[13px] border border-black/10 bg-white/50 px-4 py-3 text-[14.5px] font-medium text-[#17171c] outline-none transition placeholder:text-[#a6a6b0] focus:border-black/30 focus:bg-white/70 disabled:opacity-50"
                        />
                        <button
                          disabled={!canAskQuestions || loadingAnswer}
                          className="grid h-[46px] w-[46px] place-items-center rounded-[13px] bg-[#17171c] text-white transition hover:-translate-y-0.5 disabled:bg-black/10 disabled:text-black/30"
                          aria-label="Send"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </form>
                    <p className="mt-3 text-xs font-medium text-[#a6a6b0]">
                      {questionsLeft > 0
                        ? `${scenario.persona.name} answers what you ask — keep questions specific.`
                        : "Out of questions — submit your assessment."}
                    </p>
                    {questionsLeft <= 0 && (
                      <button
                        type="button"
                        disabled={loadingEvaluation}
                        onClick={generateReport}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#17171c] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black disabled:bg-black/10 disabled:text-black/30"
                      >
                        {loadingEvaluation ? "Submitting..." : "Submit assessment"}
                      </button>
                    )}
                  </div>
                )}

                {interviewPhase === "submitted" &&
                  (report ? (
                    <ManagerEvaluationView
                      scenario={scenario}
                      report={report}
                      messages={messages}
                      unlockedFactIds={unlockedFactIds}
                      candidateQuestionCount={candidateQuestionCount}
                      candidateName={candidateName}
                    />
                  ) : (
                    <div className="rounded-[24px] border border-white/75 bg-white/65 p-8 text-center shadow-[0_24px_60px_rgba(38,38,54,.13),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-2xl">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6e6e78]">
                        Complete
                      </p>
                      <h1 className="mt-3 text-[32px] font-extrabold leading-tight tracking-[-0.035em] text-[#17171c]">
                        Assessment submitted
                      </h1>
                      <p className="mt-3 text-[15px] font-medium leading-7 text-[#3a3a42]">
                        Generating the manager evaluation view.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          downloadTraceJson(
                            scenario,
                            messages,
                            unlockedFactIds,
                            "",
                            report
                          )
                        }
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#17171c] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
                      >
                        <Send className="h-4 w-4" />
                        Send results to hiring team
                      </button>
                    </div>
                  ))}
              </>
            )}
          </>
        ) : (
          <>
        {showTaskDrop && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b2540]/35 px-4 backdrop-blur-sm">
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-[560px] overflow-y-auto rounded-[22px] bg-white p-6 shadow-[0_18px_45px_rgba(76,55,160,.22)]">
              <div className="text-center">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]">
                  Daily Challenge
                </p>
                <h2 className="mt-1 text-3xl font-black tracking-[-0.03em] text-[#2b2540]">
                  A new task arrived
                </h2>
                <p className="mt-1 text-sm font-semibold text-[#8a83a6]">
                  Read what {scenario.persona.name} sent, then start investigating.
                </p>
              </div>

              <div className="relative my-5 flex justify-center">
                <div className="absolute h-44 w-44 rounded-full bg-[#7c5cfc]/15 blur-2xl" />
                <div className="relative flex h-32 w-44 items-center justify-center rounded-2xl border-2 border-[#eadffb] bg-gradient-to-br from-white to-[#f3efff] shadow-[0_16px_22px_rgba(76,55,160,.22)]">
                  <div className="absolute inset-x-0 bottom-0 h-16 rounded-b-2xl bg-gradient-to-br from-[#f0e9ff] to-[#e7defb]" />
                  <div className="absolute left-0 right-0 top-0 h-20 rounded-t-2xl bg-gradient-to-br from-[#7c5cfc] to-[#6a4af0] [clip-path:polygon(0_0,100%_0,50%_92%)]" />
                  <div className="relative z-10 rounded-full bg-[#ffc93c] px-3 py-2 text-sm font-black text-[#7a4d00] shadow">
                    QA
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#efeafa] bg-[#faf8ff] p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8a6bff] to-[#5b3fe0] text-base font-black text-white">
                    {scenario.persona.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-base font-black text-[#2b2540]">
                      {scenario.persona.name}
                    </p>
                    <p className="text-sm font-semibold text-[#8a83a6]">
                      {scenario.persona.role}
                    </p>
                  </div>
                </div>
                <p className="text-[15px] font-semibold leading-7 text-[#5a5470]">
                  {visibleBrief}
                </p>
              </div>

              <button
                type="button"
                onClick={openGreeting}
                className="mt-5 w-full rounded-2xl bg-[#7c5cfc] px-5 py-4 text-base font-black uppercase tracking-wide text-white shadow-[0_5px_0_#5b3fe0] transition active:translate-y-1 active:shadow-[0_1px_0_#5b3fe0]"
              >
                Meet {scenario.persona.name} →
              </button>
            </div>
          </div>
        )}
        {showGreeting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b2540]/35 px-4 backdrop-blur-sm">
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-[560px] overflow-y-auto rounded-[22px] bg-white p-6 shadow-[0_18px_45px_rgba(76,55,160,.22)]">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]">
                Your Manager
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.03em] text-[#2b2540]">
                Say hi to {scenario.persona.name}
              </h2>
              <div className="mt-5 space-y-3">
                {greetingLines.map((line) => (
                  <div key={line} className="flex items-end gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8a6bff] to-[#5b3fe0] text-base font-black text-white">
                      {scenario.persona.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="rounded-[18px] rounded-bl-md bg-[#f4f1ff] px-4 py-3 text-[15px] font-bold leading-relaxed text-[#2b2540] shadow-sm">
                      {line}
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={enterWorkspace}
                className="mt-6 w-full rounded-2xl bg-[#7c5cfc] px-5 py-4 text-base font-black uppercase tracking-wide text-white shadow-[0_5px_0_#5b3fe0] transition active:translate-y-1 active:shadow-[0_1px_0_#5b3fe0]"
              >
                I'm ready →
              </button>
            </div>
          </div>
        )}
        <aside
          className={
            devMode
              ? "flex max-h-[calc(100vh-2rem)] min-h-0 flex-col border-b border-slate-800 bg-slate-950/50 lg:border-b-0 lg:border-r"
              : "flex max-h-[38%] min-h-0 flex-col border-b border-[#efeafa] bg-white"
          }
        >
          <div
            className={
              devMode
                ? "border-b border-slate-800 px-5 py-5 text-center"
                : "border-b border-[#efeafa] px-6 py-4"
            }
          >
            <p
              className={
                devMode
                  ? "text-xs font-bold uppercase tracking-[0.18em] text-emerald-300"
                  : "text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]"
              }
            >
              Workplace Task
            </p>
            <h2
              className={
                devMode
                  ? "mt-2 text-2xl font-semibold leading-tight text-slate-50"
                  : "mt-1 text-xl font-black leading-tight tracking-[-0.03em] text-[#2b2540]"
              }
            >
              {scenario.title}
            </h2>
            {devMode ? (
              <div className="mx-auto mt-4 w-28 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-3">
              <div className="text-4xl font-black leading-none text-emerald-200">
                {questionsLeft}
              </div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-emerald-100/80">
                questions left
              </div>
            </div>
            ) : (
              <p className="mt-1 text-sm font-semibold leading-relaxed text-[#8a83a6]">
                Read the task, talk to {scenario.persona.name}, then submit
                the assessment.
              </p>
            )}
          </div>

          <div
            className={
              devMode
                ? "min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
                : "min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
            }
          >
          {assessmentLoadError ? (
            <div className="rounded-lg border border-red-300/30 bg-red-300/10 p-4">
              <h3 className="mb-2 text-sm font-bold text-red-200">
                Assessment link unavailable
              </h3>
              <p className="text-sm leading-relaxed text-red-100">
                {assessmentLoadError}
              </p>
            </div>
          ) : (
            <>
              <div className={devMode ? "space-y-3 p-4" : "space-y-4"}>
                {/* Situation */}
                <div
                  className={
                    devMode
                      ? "rounded-lg border border-slate-700/80 bg-background p-4"
                      : "rounded-[18px] border border-[#eadffb] bg-[#faf8ff] p-5"
                  }
                >
                  <p
                    className={
                      devMode
                        ? "mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500"
                        : "mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]"
                    }
                  >
                    {!devMode && <ClipboardList className="h-4 w-4" />}
                    Situation
                  </p>
                  <p
                    className={
                      devMode
                        ? "whitespace-pre-wrap text-sm leading-7 text-slate-100"
                        : "whitespace-pre-wrap text-[15px] font-semibold leading-7 text-[#5a5470]"
                    }
                  >
                    {devMode ? scenario.candidatePrompt : visibleBrief}
                  </p>
                </div>

                {/* Tasks */}
                {scenario.todos && scenario.todos.length > 0 && (
                  <div
                    className={
                      devMode
                        ? "rounded-lg border border-slate-700/80 bg-background p-4"
                        : "rounded-[18px] border border-[#eadffb] bg-white p-5"
                    }
                  >
                    <p
                      className={
                        devMode
                          ? "mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500"
                          : "mb-3 text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]"
                      }
                    >
                      Your Tasks
                    </p>
                    <ol className="space-y-2.5">
                      {scenario.todos.map((todo, i) => (
                        <li
                          key={i}
                          className={
                            devMode
                              ? "flex gap-3 text-sm text-slate-100"
                              : "flex gap-3 text-sm font-semibold leading-6 text-[#5a5470]"
                          }
                        >
                          <span
                            className={
                              devMode
                                ? "mt-0.5 shrink-0 font-mono text-xs font-semibold text-accent"
                                : "mt-0.5 shrink-0 font-mono text-xs font-black text-[#7c5cfc]"
                            }
                          >
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="leading-6">{todo}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Scope */}
                {(scenario.scope?.focus?.length || scenario.scope?.skip?.length) ? (
                  <div
                    className={
                      devMode
                        ? "rounded-lg border border-slate-700/80 bg-background p-4"
                        : "rounded-[18px] border border-[#eadffb] bg-white p-5"
                    }
                  >
                    <p
                      className={
                        devMode
                          ? "mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500"
                          : "mb-3 text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]"
                      }
                    >
                      Scope
                    </p>
                    <div className={devMode ? "grid grid-cols-2 gap-4" : "grid gap-4 sm:grid-cols-2"}>
                      {scenario.scope?.focus && scenario.scope.focus.length > 0 && (
                        <div>
                          <p
                            className={
                              devMode
                                ? "mb-1.5 text-xs font-medium text-slate-400"
                                : "mb-2 text-xs font-black uppercase tracking-wide text-[#8a83a6]"
                            }
                          >
                            Focus on
                          </p>
                          <ul className="space-y-1.5">
                            {scenario.scope.focus.map((f) => (
                              <li
                                key={f}
                                className={
                                  devMode
                                    ? "flex items-start gap-2 text-xs text-slate-300"
                                    : "flex items-start gap-2 text-xs font-semibold leading-5 text-[#5a5470]"
                                }
                              >
                                <span
                                  className={
                                    devMode
                                      ? "mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent"
                                      : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7c5cfc]"
                                  }
                                />
                                {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {scenario.scope?.skip && scenario.scope.skip.length > 0 && (
                        <div>
                          <p
                            className={
                              devMode
                                ? "mb-1.5 text-xs font-medium text-slate-500"
                                : "mb-2 text-xs font-black uppercase tracking-wide text-[#8a83a6]"
                            }
                          >
                            Skip
                          </p>
                          <ul className="space-y-1.5">
                            {scenario.scope.skip.map((s) => (
                              <li
                                key={s}
                                className={
                                  devMode
                                    ? "flex items-start gap-2 text-xs text-slate-500"
                                    : "flex items-start gap-2 text-xs font-semibold leading-5 text-[#8a83a6]"
                                }
                              >
                                <span
                                  className={
                                    devMode
                                      ? "mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600"
                                      : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d8cff5]"
                                  }
                                />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <div
                className={
                  devMode
                    ? "rounded-lg border border-slate-800 bg-background/70 p-4"
                    : "rounded-[18px] border border-[#eadffb] bg-[#faf8ff] p-5"
                }
              >
                <p
                  className={
                    devMode
                      ? "text-xs font-bold uppercase tracking-[0.16em] text-slate-500"
                      : "text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]"
                  }
                >
                  Meet the Manager
                </p>
                <div className="mt-3 flex items-start gap-3">
                  <span
                    className={
                      devMode
                        ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-base font-black text-emerald-200"
                        : "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8a6bff] to-[#5b3fe0] text-base font-black text-white"
                    }
                  >
                    {scenario.persona.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={
                        devMode
                          ? "font-semibold text-slate-100"
                          : "font-black text-[#2b2540]"
                      }
                    >
                      {scenario.persona.name}
                    </p>
                    <p
                      className={
                        devMode ? "text-sm text-slate-400" : "text-sm font-semibold text-[#8a83a6]"
                      }
                    >
                      {scenario.persona.role}
                    </p>
                  </div>
                </div>
                <div
                  className={
                    devMode
                      ? "mt-4 space-y-2 text-sm leading-relaxed text-slate-300"
                      : "mt-4 space-y-2 text-sm font-semibold leading-6 text-[#5a5470]"
                  }
                >
                  <p>
                    I am your manager for this scenario. Ask me what you need to
                    know before submitting the assessment.
                  </p>
                  <p className={devMode ? "text-slate-400" : "text-[#8a83a6]"}>
                    Expect short answers. I will answer the question you ask,
                    not solve the whole task for you.
                  </p>
                </div>
              </div>
            </>
          )}
          </div>
        </aside>

        <div
          className={
            devMode
              ? "flex min-h-[calc(100vh-2rem)] min-w-0 flex-col"
              : "flex min-h-0 flex-1 flex-col bg-white"
          }
        >
          <header
            className={
              devMode
                ? "flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/70 px-5 py-4"
                : "flex items-center justify-between gap-3 border-b border-[#efeafa] bg-white px-6 py-4"
            }
          >
            <div>
              <p
                className={
                  devMode
                    ? "text-xs font-bold uppercase tracking-[0.16em] text-slate-500"
                    : "flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#7c5cfc]"
                }
              >
                {!devMode && <MessageSquare className="h-4 w-4" />}
                Investigate
              </p>
              <h3
                className={
                  devMode
                    ? "text-lg font-semibold text-slate-100"
                    : "text-2xl font-black tracking-[-0.03em] text-[#2b2540]"
                }
              >
                Ask {scenario.persona.name}
              </h3>
            </div>
            <div
              className={
                devMode
                  ? "text-xs font-semibold text-slate-500"
                  : "rounded-full bg-[#f4f1ff] px-4 py-2 text-sm font-black text-[#2b2540]"
              }
            >
              {candidateQuestionCount}/{scenario.maxQuestions} asked
            </div>
          </header>

          <div
            className={
              devMode
                ? "min-h-0 flex-1 overflow-y-auto px-5 py-5"
                : "min-h-0 flex-1 overflow-y-auto bg-[#fbf9ff] px-5 py-5"
            }
          >
            <div className="space-y-4">
            {messages.length === 0 && (
              <div className="flex justify-start">
                <div
                  className={
                    devMode
                      ? "max-w-[760px] rounded-2xl rounded-tl-sm border border-slate-700 bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-100"
                      : "max-w-[82%] rounded-[18px] rounded-tl-md bg-[#f4f1ff] px-5 py-4 text-[15px] font-bold leading-7 text-[#2b2540] shadow-sm"
                  }
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={
                        devMode
                          ? "flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-xs font-black text-slate-200"
                          : "flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#8a6bff] to-[#5b3fe0] text-xs font-black text-white"
                      }
                    >
                      {scenario.persona.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <p
                        className={
                          devMode
                            ? "text-xs font-black uppercase tracking-wide text-slate-300"
                            : "text-xs font-black uppercase tracking-wide text-[#6d6585]"
                        }
                      >
                        {scenario.persona.name}
                      </p>
                      <p className={devMode ? "text-xs text-slate-500" : "text-xs font-semibold text-[#8a83a6]"}>
                        {scenario.persona.role}
                      </p>
                    </div>
                  </div>
                  <p>
                    Ask me a question when you are ready. You have {scenario.maxQuestions} questions before you tell me what you would do next.
                  </p>
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${
                  message.role === "candidate" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    message.role === "candidate"
                      ? devMode
                        ? "rounded-tr-sm bg-emerald-300 text-slate-950"
                        : "rounded-tr-sm bg-[#7c5cfc] font-semibold text-white"
                      : devMode
                        ? "rounded-tl-sm border border-slate-700 bg-slate-800 text-slate-100"
                        : "rounded-tl-sm bg-[#f4f1ff] font-semibold text-[#2b2540]"
                  }`}
                >
                  <p className="mb-1 text-[11px] font-black uppercase tracking-wide opacity-70">
                    {message.role === "candidate"
                      ? "You"
                      : `${scenario.persona.name} · ${scenario.persona.role}`}
                  </p>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))}
            {loadingAnswer && (
              <div className="flex justify-start">
                <div
                  className={
                    devMode
                      ? "rounded-2xl rounded-tl-sm border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-400"
                      : "rounded-2xl rounded-tl-sm bg-[#f4f1ff] px-4 py-3 text-sm font-bold text-[#8a83a6]"
                  }
                >
                  {scenario.persona.name} is replying...
                </div>
              </div>
            )}
            </div>
          </div>

        <div
          className={
            devMode
              ? "border-t border-slate-800 bg-background px-4 pt-3 pb-0"
              : "border-t border-[#efeafa] bg-white px-5 pb-0 pt-4"
          }
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <label
                className={
                  devMode
                    ? "text-sm font-semibold text-slate-200"
                    : "text-base font-black text-[#2b2540]"
                }
              >
                Ask {scenario.persona.name} a question
              </label>
            </div>
            <div
              className={
                devMode
                  ? "flex items-center gap-1 rounded-full border border-slate-700 p-0.5"
                  : "flex items-center gap-1 rounded-full border border-[#eadffb] p-0.5"
              }
            >
              <button
                type="button"
                onClick={() => { setVoiceMode(false); stopRecording(); }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  !voiceMode
                    ? devMode
                      ? "bg-emerald-300 text-slate-950"
                      : "bg-[#33c989] text-white"
                    : devMode
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-[#8a83a6] hover:text-[#2b2540]"
                }`}
              >
                <Keyboard className="h-3.5 w-3.5" />
                Text
              </button>
              <button
                type="button"
                onClick={() => setVoiceMode(true)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  voiceMode
                    ? devMode
                      ? "bg-emerald-300 text-slate-950"
                      : "bg-[#33c989] text-white"
                    : devMode
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-[#8a83a6] hover:text-[#2b2540]"
                }`}
              >
                <Mic className="h-3.5 w-3.5" />
                Voice
              </button>
            </div>
          </div>
        </div>

        {!voiceMode ? (
          <form
            onSubmit={askManager}
            className={
              devMode
                ? "border-t border-slate-800 bg-background p-4 pt-2"
                : "bg-white px-5 pb-5 pt-1"
            }
          >
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                ref={questionInputRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={
                  !canAskQuestions || loadingAnswer
                }
                placeholder="Example: who is affected, and what outcome matters most?"
                className={
                  devMode
                    ? "rounded-md border border-slate-700 bg-surface px-3 py-3 text-sm outline-none focus:border-emerald-300 disabled:opacity-50"
                    : "rounded-2xl border-2 border-[#7c5cfc] bg-white px-4 py-3 text-sm font-semibold text-[#2b2540] outline-none placeholder:text-[#c8c0df] disabled:opacity-50"
                }
              />
              <button
                disabled={
                  !canAskQuestions || loadingAnswer
                }
                className={
                  devMode
                    ? "inline-flex items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-50"
                    : "inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7c5cfc] px-5 py-3 text-sm font-black text-white shadow-[0_4px_0_#5b3fe0] disabled:opacity-50 disabled:shadow-none"
                }
              >
                <Send className="h-4 w-4" />
                {loadingAnswer ? "Asking..." : "Ask"}
              </button>
            </div>
          </form>
        ) : (
          <div
            className={
              devMode
                ? "border-t border-slate-800 bg-background p-4 pt-2"
                : "bg-white px-5 pb-5 pt-1"
            }
          >
            <div className="flex flex-col items-center gap-3">
              {transcript && (
                <p
                  className={
                    devMode
                      ? "w-full rounded-md border border-slate-700 bg-surface px-3 py-2 text-sm leading-relaxed text-slate-200"
                      : "w-full rounded-2xl border border-[#eadffb] bg-[#faf8ff] px-4 py-3 text-sm font-semibold leading-relaxed text-[#2b2540]"
                  }
                >
                  {transcript}
                </p>
              )}
              {!isRecording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={
                    !canAskQuestions || loadingAnswer
                  }
                  className={
                    devMode
                      ? "flex h-14 w-14 items-center justify-center rounded-full bg-emerald-300 text-slate-950 shadow-lg transition-transform hover:scale-105 disabled:opacity-50"
                      : "flex h-14 w-14 items-center justify-center rounded-full bg-[#7c5cfc] text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-50"
                  }
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
              <p className={devMode ? "text-xs text-slate-500" : "text-xs font-semibold text-[#8a83a6]"}>
                {loadingAnswer
                  ? "Sending..."
                  : isRecording
                  ? "Recording — tap to stop and send"
                  : "Tap the mic to start speaking"}
              </p>
            </div>
          </div>
        )}

        <div
          ref={submitPanelRef}
          className={
            devMode
              ? "border-t border-slate-800 bg-slate-950/60 p-4"
              : `border-t border-[#efeafa] bg-white p-5 ${
                  interviewPhase === "submitted" || (interviewPhase === "workspace" && questionsLeft <= 0)
                    ? "block"
                    : "hidden"
                }`
          }
        >
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 className={devMode ? "h-4 w-4 text-emerald-300" : "h-4 w-4 text-[#33c989]"} />
            <label
              className={
                devMode
                  ? "text-sm font-semibold text-slate-200"
                  : "text-base font-black text-[#2b2540]"
              }
            >
              Submit assessment
            </label>
          </div>
          <p className={devMode ? "mb-3 text-xs leading-relaxed text-slate-500" : "mb-3 text-sm font-semibold leading-relaxed text-[#8a83a6]"}>
            Submit once the candidate has finished asking questions.
          </p>
          <button
            onClick={generateReport}
            disabled={loadingEvaluation}
            className={
              devMode
                ? "mt-3 w-full rounded-md bg-emerald-300 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-50"
                : "mt-3 w-full rounded-2xl bg-[#7c5cfc] px-4 py-4 text-sm font-black uppercase tracking-wide text-white shadow-[0_4px_0_#5b3fe0] disabled:opacity-50 disabled:shadow-none"
            }
          >
            {loadingEvaluation ? "Submitting..." : "Submit assessment"}
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
            <button
              type="button"
              onClick={() =>
                downloadTraceJson(
                  scenario,
                  messages,
                  unlockedFactIds,
                  "",
                  report
                )
              }
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 py-3 text-sm font-bold text-slate-950"
            >
              <Download className="h-4 w-4" />
              Download interview trace
            </button>
          </div>
        )}
        </div>
          </>
        )}
      </section>

      {devMode && (
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
          {!lastDecision ? (
            <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-500">
              No question has been classified yet.
            </div>
          ) : (
            <div className="space-y-3 rounded-md border border-slate-800 bg-slate-950 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-black uppercase ${classificationClassName(
                    lastDecision.classification
                  )}`}
                >
                  {classificationLabel(lastDecision.classification)}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {lastUnlockedHiddenFacts.length} hidden unlocked |{" "}
                  {lastAmbientFacts.length} ambient included
                </span>
              </div>

              <div>
                <h4 className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  Rationale
                </h4>
                <p className="text-sm leading-relaxed text-slate-300">
                  {lastDecision.rationale}
                </p>
              </div>

              <div>
                <h4 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  Hidden Context Earned
                </h4>
                {lastUnlockedHiddenFacts.length === 0 ? (
                  <p className="rounded-md border border-slate-800 bg-background px-3 py-2 text-sm text-slate-500">
                    None unlocked on this turn.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {lastUnlockedHiddenFacts.map((fact) => (
                      <li
                        key={fact.id}
                        className="rounded-md border border-slate-800 bg-background p-3"
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <strong className="text-sm text-slate-200">
                            {fact.title}
                          </strong>
                          {fact.category && (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                              {fact.category}
                            </span>
                          )}
                          {fact.knowledgeLevel && (
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                              {fact.knowledgeLevel}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-500">
                          {fact.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  Ambient Context Included
                </h4>
                {lastAmbientFacts.length === 0 ? (
                  <p className="rounded-md border border-slate-800 bg-background px-3 py-2 text-sm text-slate-500">
                    None included on this turn.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {lastAmbientFacts.map((fact) => (
                      <li
                        key={fact.id}
                        className="rounded-md border border-slate-800 bg-background p-3 text-xs leading-relaxed text-slate-500"
                      >
                        <span className="mb-1 block font-semibold text-slate-300">
                          {fact.id}
                        </span>
                        {fact.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </aside>
      )}
      </div>
    </div>
  );
}

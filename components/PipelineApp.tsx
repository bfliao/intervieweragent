"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  FlaskConical,
  ExternalLink,
  Search,
  Pencil,
  RefreshCw,
  X,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Link2,
  Check,
} from "lucide-react";
import type {
  Criterion,
  CritiqueOutput,
  DesiredCoworker,
  Difficulty,
  Incident,
  SavedJob,
  SavedScenario,
  Scenario,
} from "@/scenario_generation/types";
import {
  MOCK_INPUT,
  MOCK_SCENARIO,
  MOCK_CRITIQUE,
} from "@/scenario_generation/mock";

type Member = DesiredCoworker;

interface CrawlPlan {
  domain: string;
  keywords: string[];
  queries: string[];
}

export default function PipelineApp({
  onSave,
  initialJob,
  jobs = [],
}: {
  onSave?: (saved: SavedScenario) => void;
  initialJob?: SavedJob | null;
  jobs?: SavedJob[];
}) {
  // Gate
  const [gateDone, setGateDone] = useState(true);
  const [jdDraft, setJdDraft] = useState(MOCK_INPUT.jd);
  const [jd, setJd] = useState("");
  const [useMock, setUseMock] = useState(false);

  // Job context
  const [skillset, setSkillset] = useState(MOCK_INPUT.skillset.join(", "));
  const [exclude, setExclude] = useState("");
  const [members, setMembers] = useState<Member[]>(MOCK_INPUT.teamInput);

  // Crawl
  const [crawling, setCrawling] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [plan, setPlan] = useState<CrawlPlan | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [qc, setQc] = useState<{ reviewed: number; approved: number; attempts: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [teamOpen, setTeamOpen] = useState(false);
  const [outputTab, setOutputTab] = useState<"scenario" | "rubric">("scenario");
  const [activeJobTitle, setActiveJobTitle] = useState<string>("");

  // Share state
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Generation options
  const [difficulty, setDifficulty] = useState<Difficulty>("mid");
  const [count, setCount] = useState(1);

  // Pipeline output
  const [loading, setLoading] = useState<null | "scenario" | "critique">(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(0);
  const [critique, setCritique] = useState<CritiqueOutput | null>(null);

  // Derived for convenience
  const scenario = scenarios[selectedScenarioIdx] ?? null;

  useEffect(() => {
    if (!initialJob) return;
    setJd(initialJob.jd);
    setJdDraft(initialJob.jd);
    if (initialJob.skills) setSkillset(initialJob.skills);
    setActiveJobTitle(initialJob.title);
    setScenarios([]);
    setSelectedScenarioIdx(0);
    setCritique(null);
    setIncidents([]);
    setPlan(null);
    setGateDone(true);
    if (!useMock) runCrawl(initialJob.jd);
  }, [initialJob]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildInput() {
    return {
      jd,
      skillset: skillset
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      teamInput: members.filter((m) => m.description.trim()),
    };
  }

  async function runCrawl(jdValue: string) {
    setCrawling(true);
    setCrawlError(null);
    setIncidents([]);
    setPlan(null);
    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd: jdValue, skills: skillset, exclude, difficulty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Crawl failed.");
      setPlan(data.plan || null);
      setIncidents(data.incidents || []);
      setUsedFallback(!!data.usedFallback);
      setQc({
        reviewed: data.reviewed ?? 0,
        approved: data.approved ?? 0,
        attempts: data.attempts ?? 0,
      });
      setSelectedId(data.incidents?.[0]?.id || "");
    } catch (e) {
      setCrawlError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCrawling(false);
    }
  }

  function submitGate() {
    const value = jdDraft.trim();
    if (!value) return;
    setJd(value);
    setGateDone(true);
    setScenarios([]);
    setSelectedScenarioIdx(0);
    setCritique(null);
    if (!useMock) runCrawl(value);
  }

  function updateMember(i: number, patch: Partial<Member>) {
    setMembers((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function addMember() {
    setMembers((ms) => [
      ...ms,
      { memberId: `m${ms.length + 1}`, memberName: "", description: "" },
    ]);
  }
  function removeMember(i: number) {
    setMembers((ms) => ms.filter((_, idx) => idx !== i));
  }

  async function generateScenario() {
    setError(null);
    setCritique(null);
    setScenarios([]);
    setSelectedScenarioIdx(0);
    setShareUrl(null);
    if (useMock) {
      setScenarios([MOCK_SCENARIO]);
      return;
    }
    // Pick up to `count` incidents starting from the selected one
    const selectedIdx = incidents.findIndex((i) => i.id === selectedId);
    const start = selectedIdx >= 0 ? selectedIdx : 0;
    const targets = [
      ...incidents.slice(start),
      ...incidents.slice(0, start),
    ].slice(0, count);
    if (targets.length === 0) return;
    setLoading("scenario");
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildInput(),
          difficulty,
          incidents: targets,
          count,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate scenario.");
      setScenarios(data.scenarios ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(null);
    }
  }

  async function runCritique() {
    if (!scenario) return;
    setError(null);
    if (useMock) {
      setCritique({ ...MOCK_CRITIQUE, scenarioId: scenario.id });
      return;
    }
    setLoading("critique");
    try {
      const res = await fetch("/api/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run critique.");
      setCritique(data.critique);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(null);
    }
  }

  function formatCandidatePrompt(s: Scenario): string {
    const parts: string[] = [s.brief.trim()];
    if (s.todos?.length) {
      parts.push("\nYour Tasks:");
      s.todos.forEach((t, i) => parts.push(`${i + 1}. ${t}`));
    }
    if (s.scope?.focus?.length || s.scope?.skip?.length) {
      parts.push("");
      if (s.scope.focus?.length) parts.push(`Focus on: ${s.scope.focus.join(", ")}`);
      if (s.scope.skip?.length) parts.push(`Skip: ${s.scope.skip.join(", ")}`);
    }
    return parts.join("\n");
  }

  async function shareScenario() {
    if (!scenario || sharing) return;
    setSharing(true);
    setShareUrl(null);
    try {
      const pkg = {
        id: scenario.id,
        jobTitle: activeJobTitle || undefined,
        markdown: "",
        scenarios: [{ scenario, jobTitle: activeJobTitle || undefined }],
        assessmentScenarios: [
          {
            id: scenario.id,
            jobTitle: activeJobTitle || undefined,
            candidatePrompt: formatCandidatePrompt(scenario),
            focusAreas: scenario.focusAreas,
            sourceTitle: scenario.groundedOn?.title,
            sourceUrl: scenario.groundedOn?.source,
            derivedFrom: scenario.derivedFrom,
          },
        ],
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem(
        `question_arena_assessment:${scenario.id}`,
        JSON.stringify(pkg)
      );
      await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pkg),
      });
      const url = `${window.location.origin}/assessment?assessment=${scenario.id}`;
      setShareUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate share link.");
    } finally {
      setSharing(false);
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ---- JD gate (shown on launch) ----
  if (!gateDone) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4">
        <div className="w-full max-w-xl space-y-4 rounded-xl border border-slate-800 bg-surface p-6 shadow-2xl">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold">Start with a Job Description</h2>
              <p className="mt-1 text-sm text-slate-400">
                Paste the JD. We&apos;ll crawl the web for real, relevant incidents
                to ground the evaluation scenario.
              </p>
            </div>
            <button
              onClick={() => setGateDone(true)}
              className="ml-4 text-slate-500 hover:text-slate-200"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <textarea
            autoFocus
            value={jdDraft}
            onChange={(e) => setJdDraft(e.target.value)}
            rows={8}
            className="input"
            placeholder="Paste the job description..."
          />
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={useMock}
              onChange={(e) => setUseMock(e.target.checked)}
              className="accent-accent"
            />
            <FlaskConical className="h-3.5 w-3.5" />
            Use mock (no API key, skip crawl)
          </label>
          <div className="flex gap-2">
            <button
              onClick={submitGate}
              disabled={!jdDraft.trim()}
              className="btn-primary flex-1"
            >
              {useMock ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {useMock ? "Start with demo" : "Crawl incidents for this JD"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selected = incidents.find((i) => i.id === selectedId);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- Left: context + incident selection ---- */}
      <section className="space-y-4 rounded-xl border border-slate-800 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Job context</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setJdDraft(jd);
                setGateDone(false);
              }}
              className="btn-ghost"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit JD
            </button>
            {!useMock && (
              <button
                onClick={() => runCrawl(jd)}
                disabled={crawling}
                className="btn-ghost"
              >
                <RefreshCw className={`h-3.5 w-3.5${crawling ? " animate-spin" : ""}`} /> Re-crawl
              </button>
            )}
          </div>
        </div>

        {jobs.length > 0 && (
          <select
            className="input text-xs"
            value={selectedJobId}
            onChange={(e) => {
              const job = jobs.find((j) => j.id === e.target.value);
              if (!job) return;
              setJd(job.jd);
              setJdDraft(job.jd);
              if (job.skills) setSkillset(job.skills);
              setScenarios([]);
              setSelectedScenarioIdx(0);
              setCritique(null);
              setIncidents([]);
              setPlan(null);
              setActiveJobTitle(job.title);
              setSelectedJobId("");
              if (!useMock) runCrawl(job.jd);
            }}
          >
            <option value="">Load from My Jobs…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
        )}

        {jd ? (
          <div className="rounded-lg border border-slate-800 bg-background p-3 text-xs text-slate-400">
            <span className="line-clamp-3 whitespace-pre-wrap">{jd}</span>
          </div>
        ) : (
          <button
            onClick={() => { setJdDraft(""); setGateDone(false); }}
            className="w-full rounded-lg border border-dashed border-slate-700 bg-background p-4 text-center text-xs text-slate-500 hover:border-slate-500 hover:text-slate-300 transition-colors"
          >
            + Paste a job description to get started
          </button>
        )}

        <Field label="Skillset (comma separated)">
          <input
            value={skillset}
            onChange={(e) => setSkillset(e.target.value)}
            className="input"
            placeholder="distributed systems, debugging, ..."
          />
        </Field>

        <Field label="Exclude topics (comma separated)">
          <input
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            className="input"
            placeholder="ML, machine learning, frontend, ..."
          />
          <span className="text-xs text-slate-500">
            Anything matching these is dropped before and during QC.
          </span>
        </Field>

        {/* Crawl results */}
        {!useMock && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">
                Real incidents (crawled)
              </span>
              {crawling && (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> crawling...
                </span>
              )}
            </div>

            {plan && plan.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {plan.keywords.map((k) => (
                  <Tag key={k}>{k}</Tag>
                ))}
              </div>
            )}

            {crawlError && (
              <p className="text-xs text-red-400">{crawlError}</p>
            )}
            {qc && !usedFallback && incidents.length > 0 && (
              <p className="text-xs text-slate-500">
                QC: reviewed {qc.reviewed}, kept {qc.approved} in scope
                {qc.attempts > 1 ? ` · ${qc.attempts} crawl passes` : ""}
              </p>
            )}
            {usedFallback && incidents.length > 0 && (
              <p className="text-xs text-amber-400">
                No in-scope live results — showing closest matches from the local
                corpus.
              </p>
            )}

            {incidents.length > 0 ? (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="input"
              >
                {incidents.map((inc) => (
                  <option key={inc.id} value={inc.id}>
                    {inc.company ? `${inc.company} — ` : ""}
                    {inc.title}
                  </option>
                ))}
              </select>
            ) : (
              !crawling && (
                <p className="text-xs text-slate-500">
                  No incidents yet. Try re-crawling with a more specific JD.
                </p>
              )
            )}

            {selected && (
              <a
                href={selected.source || undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {selected.source}
              </a>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setTeamOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-slate-100"
            >
              {teamOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Team input (each member&apos;s desired coworker)
              {!teamOpen && members.filter(m => m.description.trim()).length > 0 && (
                <span className="ml-1 text-xs text-slate-500">
                  ({members.filter(m => m.description.trim()).length})
                </span>
              )}
            </button>
            {teamOpen && (
              <button onClick={addMember} className="btn-ghost">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            )}
          </div>
          {teamOpen && members.map((m, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-slate-800 bg-background p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  value={m.memberName ?? ""}
                  onChange={(e) =>
                    updateMember(i, { memberName: e.target.value })
                  }
                  className="input flex-1"
                  placeholder="Member name (optional)"
                />
                <button
                  onClick={() => removeMember(i)}
                  className="text-slate-500 hover:text-red-400"
                  aria-label="Remove member"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={m.description}
                onChange={(e) =>
                  updateMember(i, { description: e.target.value })
                }
                rows={2}
                className="input"
                placeholder="Describe your ideal coworker..."
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <Field label="Difficulty">
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className="input"
            >
              <option value="junior">Junior</option>
              <option value="mid">Mid-level</option>
              <option value="senior">Senior</option>
            </select>
          </Field>
          <Field label="Count">
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="input"
            >
              <option value={1}>1 scenario</option>
              <option value={2}>2 scenarios</option>
              <option value={3}>3 scenarios</option>
            </select>
          </Field>
        </div>

        <button
          onClick={generateScenario}
          disabled={loading !== null || crawling || (!useMock && !selected && !jd)}
          className="btn-primary w-full"
        >
          {loading === "scenario" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate scenario
        </button>
      </section>

      {/* ---- Right: outputs ---- */}
      <section className="flex flex-col rounded-xl border border-slate-800 bg-surface overflow-hidden">
        {/* Sub-tab bar */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4">
          <div className="flex gap-0">
            {(["scenario", "rubric"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOutputTab(t)}
                className={`px-4 py-3 text-sm font-medium capitalize transition-colors ${
                  outputTab === t
                    ? "border-b-2 border-accent text-accent"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t === "rubric" ? (
                  <span className="flex items-center gap-1.5">
                    Rubric
                    {loading === "critique" && <Loader2 className="h-3 w-3 animate-spin" />}
                  </span>
                ) : "Scenario"}
              </button>
            ))}
          </div>
          {/* Action buttons always visible */}
          {scenario && (
            <div className="flex items-center gap-2">
              {onSave && (
                <button
                  onClick={() =>
                    onSave({
                      savedAt: new Date().toISOString(),
                      jobTitle: activeJobTitle || undefined,
                      jd,
                      sourceTitle: scenario.groundedOn?.title,
                      sourceUrl: scenario.groundedOn?.source,
                      scenario,
                      critique: critique ?? null,
                    })
                  }
                  className="btn-ghost"
                >
                  <BookmarkPlus className="h-4 w-4" /> Save
                </button>
              )}
              <button
                onClick={shareScenario}
                disabled={sharing}
                className="btn-ghost"
              >
                {sharing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Share
              </button>
              <button
                onClick={() => { runCritique(); setOutputTab("rubric"); }}
                disabled={loading !== null}
                className="btn-primary"
              >
                {loading === "critique" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Run critique
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mt-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Scenario selector when count > 1 */}
        {scenarios.length > 1 && (
          <div className="flex gap-1 border-b border-slate-800 px-4 py-2">
            {scenarios.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedScenarioIdx(i);
                  setCritique(null);
                  setShareUrl(null);
                }}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  i === selectedScenarioIdx
                    ? "bg-accent/20 text-accent"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Scenario {i + 1}
                <span className="ml-1.5 text-slate-600 capitalize">
                  · {s.difficulty}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div className="h-[520px] overflow-y-auto p-5">
          {outputTab === "scenario" ? (
            scenario ? (
              <div className="space-y-4">
                {scenario.groundedOn && (
                  <a
                    href={scenario.groundedOn.source || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Grounded on: {scenario.groundedOn.title}
                  </a>
                )}
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                  {scenario.brief}
                </p>

                {/* Candidate instructions */}
                {(scenario.todos?.length > 0 || scenario.scope?.focus?.length > 0) && (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 space-y-4">
                    {scenario.todos?.length > 0 && (
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Your tasks
                        </h4>
                        <ol className="space-y-1.5 list-none">
                          {scenario.todos.map((t, i) => (
                            <li key={i} className="flex gap-2.5 text-sm text-slate-200">
                              <span className="shrink-0 mt-0.5 font-mono text-xs text-accent">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              {t}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {(scenario.scope?.focus?.length > 0 || scenario.scope?.skip?.length > 0) && (
                      <div className="flex gap-6">
                        {scenario.scope.focus.length > 0 && (
                          <div className="flex-1">
                            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                              Focus on
                            </h4>
                            <ul className="space-y-1">
                              {scenario.scope.focus.map((f) => (
                                <li key={f} className="flex items-center gap-1.5 text-xs text-slate-300">
                                  <span className="h-1 w-1 rounded-full bg-accent shrink-0" />
                                  {f}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {scenario.scope.skip.length > 0 && (
                          <div className="flex-1">
                            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Skip
                            </h4>
                            <ul className="space-y-1">
                              {scenario.scope.skip.map((s) => (
                                <li key={s} className="flex items-center gap-1.5 text-xs text-slate-500">
                                  <span className="h-1 w-1 rounded-full bg-slate-600 shrink-0" />
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-slate-600 bg-background px-2 py-0.5 text-xs font-medium capitalize text-slate-300">
                    {scenario.difficulty}
                  </span>
                  {scenario.focusAreas.map((f) => (
                    <Tag key={f}>{f}</Tag>
                  ))}
                </div>

                {/* Share URL */}
                {shareUrl && (
                  <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-3">
                    <p className="mb-1.5 text-xs font-medium text-emerald-200">
                      Candidate link ready — send this to the candidate.
                    </p>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={shareUrl}
                        className="input flex-1 font-mono text-xs"
                      />
                      <button onClick={copyShareUrl} className="btn-ghost shrink-0">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Pick an incident and generate a scenario to begin.
              </div>
            )
          ) : (
            critique ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Sibling weights sum to 1 at each level. Path product = absolute weight in the tree.
                </p>
                <CriterionTree nodes={critique.criteria} depth={0} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                {loading === "critique" ? "Generating rubric…" : "Run critique to see the scoring rubric."}
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}

function CriterionTree({
  nodes,
  depth,
}: {
  nodes: Criterion[];
  depth: number;
}) {
  return (
    <ul
      className={
        depth > 0
          ? "ml-4 space-y-2 border-l border-slate-800 pl-4"
          : "space-y-2"
      }
    >
      {nodes.map((n) => (
        <li key={n.id} className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent">
              {n.score.toFixed(2)}
            </span>
            <div className="space-y-1">
              <p className="text-sm text-slate-200">{n.evidence}</p>
              <div className="flex flex-wrap gap-1">
                {n.tags.map((t) => (
                  <Tag key={t}>#{t}</Tag>
                ))}
              </div>
            </div>
          </div>
          {n.followups.length > 0 && (
            <CriterionTree nodes={n.followups} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-slate-700 bg-background px-2 py-0.5 text-xs text-slate-400">
      {children}
    </span>
  );
}

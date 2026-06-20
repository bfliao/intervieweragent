"use client";

import { useState } from "react";
import {
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  FlaskConical,
  ExternalLink,
  Search,
  Pencil,
} from "lucide-react";
import type {
  Criterion,
  CritiqueOutput,
  DesiredCoworker,
  Incident,
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

export default function PipelineApp() {
  // Gate
  const [gateDone, setGateDone] = useState(false);
  const [jdDraft, setJdDraft] = useState(MOCK_INPUT.jd);
  const [jd, setJd] = useState("");
  const [useMock, setUseMock] = useState(false);

  // Job context
  const [skillset, setSkillset] = useState(MOCK_INPUT.skillset.join(", "));
  const [members, setMembers] = useState<Member[]>(MOCK_INPUT.teamInput);

  // Crawl
  const [crawling, setCrawling] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [plan, setPlan] = useState<CrawlPlan | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");

  // Pipeline output
  const [loading, setLoading] = useState<null | "scenario" | "critique">(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [critique, setCritique] = useState<CritiqueOutput | null>(null);

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
        body: JSON.stringify({ jd: jdValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Crawl failed.");
      setPlan(data.plan || null);
      setIncidents(data.incidents || []);
      setUsedFallback(!!data.usedFallback);
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
    setScenario(null);
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
    if (useMock) {
      setScenario(MOCK_SCENARIO);
      return;
    }
    const incident = incidents.find((i) => i.id === selectedId);
    setLoading("scenario");
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildInput(), incident }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate scenario.");
      setScenario(data.scenario);
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

  // ---- JD gate (shown on launch) ----
  if (!gateDone) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4">
        <div className="w-full max-w-xl space-y-4 rounded-xl border border-slate-800 bg-surface p-6 shadow-2xl">
          <div>
            <h2 className="text-xl font-semibold">Start with a Job Description</h2>
            <p className="mt-1 text-sm text-slate-400">
              Paste the JD. We&apos;ll crawl the web for real, relevant incidents
              to ground the evaluation scenario.
            </p>
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
          <button
            onClick={submitGate}
            disabled={!jdDraft.trim()}
            className="btn-primary w-full"
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
    );
  }

  const selected = incidents.find((i) => i.id === selectedId);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- Left: context + incident selection ---- */}
      <section className="space-y-4 rounded-xl border border-slate-800 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Job context</h2>
          <button
            onClick={() => {
              setJdDraft(jd);
              setGateDone(false);
            }}
            className="btn-ghost"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit JD / re-crawl
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 bg-background p-3 text-xs text-slate-400">
          <span className="line-clamp-3 whitespace-pre-wrap">{jd}</span>
        </div>

        <Field label="Skillset (comma separated)">
          <input
            value={skillset}
            onChange={(e) => setSkillset(e.target.value)}
            className="input"
            placeholder="distributed systems, debugging, ..."
          />
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
            {usedFallback && incidents.length > 0 && (
              <p className="text-xs text-amber-400">
                Web unreachable — showing closest matches from the local corpus.
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
            <span className="text-sm text-slate-300">
              Team input (each member&apos;s desired coworker)
            </span>
            <button onClick={addMember} className="btn-ghost">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          {members.map((m, i) => (
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

        <button
          onClick={generateScenario}
          disabled={loading !== null || crawling || (!useMock && !selected)}
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
      <section className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {scenario ? (
          <div className="space-y-4 rounded-xl border border-slate-800 bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-medium">Scenario</h2>
              <button
                onClick={runCritique}
                disabled={loading !== null}
                className="btn-primary shrink-0"
              >
                {loading === "critique" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Run critique
              </button>
            </div>
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
            <div className="flex flex-wrap gap-1.5">
              {scenario.focusAreas.map((f) => (
                <Tag key={f}>{f}</Tag>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
            Pick an incident and generate a scenario to begin.
          </div>
        )}

        {critique && (
          <div className="space-y-3 rounded-xl border border-slate-800 bg-surface p-5">
            <h2 className="text-lg font-medium">Scoring rubric</h2>
            <p className="text-xs text-slate-500">
              Sibling weights sum to 1 at each level. Path product = absolute
              weight in the tree.
            </p>
            <CriterionTree nodes={critique.criteria} depth={0} />
          </div>
        )}
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

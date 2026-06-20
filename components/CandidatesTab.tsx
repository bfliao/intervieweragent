"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  X,
  Send,
  Briefcase,
} from "lucide-react";
import type {
  Candidate,
  CandidateApplication,
  SavedScenario,
} from "@/scenario_generation/types";

// ── Markdown renderer ──────────────────────────────────────────────────────

function renderAssessmentMd(
  uuid: string,
  candidate: Candidate,
  app: CandidateApplication,
  scenarios: SavedScenario[]
): string {
  const lines: string[] = [];
  lines.push(`# Assessment: ${app.jobTitle}`);
  lines.push(`**Candidate:** ${candidate.name}  `);
  lines.push(`**Email:** ${candidate.email}  `);
  lines.push(`**Assessment ID:** \`${uuid}\`  `);
  lines.push(`**Sent at:** ${new Date().toISOString()}`);
  lines.push("");

  for (const s of scenarios) {
    lines.push("---");
    lines.push(`## Scenario`);
    if (s.scenario.groundedOn) {
      lines.push(`> Grounded on: [${s.scenario.groundedOn.title}](${s.scenario.groundedOn.source})`);
      lines.push("");
    }
    lines.push(s.scenario.brief);
    lines.push("");
    lines.push(`**Focus areas:** ${s.scenario.focusAreas.join(", ")}`);
    lines.push("");

    if (s.critique) {
      lines.push(`### Scoring Rubric`);
      lines.push("");
      lines.push(`_Sibling weights sum to 1 at each level._`);
      lines.push("");
      renderCriteria(lines, s.critique.criteria, 0);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderCriteria(
  lines: string[],
  criteria: SavedScenario["critique"] extends null ? never : NonNullable<SavedScenario["critique"]>["criteria"],
  depth: number
) {
  for (const c of criteria) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- **[${c.score.toFixed(2)}]** ${c.evidence}`);
    if (c.tags.length) lines.push(`${indent}  _Tags: ${c.tags.map(t => `#${t}`).join(" ")}_`);
    if (c.followups.length) renderCriteria(lines, c.followups, depth + 1);
  }
}

function downloadMd(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildAssessmentUrl(origin: string, uuid: string) {
  return `${origin}/assessment?assessment=${uuid}`;
}

function isScenarioSendable(scenario: SavedScenario) {
  const brief = scenario.scenario.brief.trim();
  return brief.length >= 80;
}

function formatCandidatePrompt(s: SavedScenario["scenario"]): string {
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

function buildAssessmentScenarios(scenarios: SavedScenario[]) {
  return scenarios.map((saved) => ({
    id: saved.scenario.id,
    jobTitle: saved.jobTitle,
    candidatePrompt: formatCandidatePrompt(saved.scenario),
    focusAreas: saved.scenario.focusAreas,
    sourceTitle: saved.sourceTitle || saved.scenario.groundedOn?.title,
    sourceUrl: saved.sourceUrl || saved.scenario.groundedOn?.source,
    groundedOn: saved.scenario.groundedOn,
    jd: saved.jd,
    derivedFrom: saved.scenario.derivedFrom,
    critique: saved.critique,
    rawSavedScenario: saved,
  }));
}

function createAssessmentPackage(
  uuid: string,
  candidate: Candidate,
  app: CandidateApplication,
  markdown: string,
  scenarios: SavedScenario[]
) {
  return {
    id: uuid,
    candidateName: candidate.name,
    candidateEmail: candidate.email,
    jobTitle: app.jobTitle,
    targetRole: app.jobTitle,
    markdown,
    scenarios,
    assessmentScenarios: buildAssessmentScenarios(scenarios),
    createdAt: new Date().toISOString(),
  };
}

async function storeAssessmentPackage(
  payload: ReturnType<typeof createAssessmentPackage>
) {
  localStorage.setItem(
    `question_arena_assessment:${payload.id}`,
    JSON.stringify(payload)
  );
  const res = await fetch("/api/assessments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CandidatesTab({
  candidates,
  savedScenarios,
  jobs,
  onAdd,
  onUpdate,
  onDelete,
}: {
  candidates: Candidate[];
  savedScenarios: SavedScenario[];
  jobs: { title: string }[];
  onAdd: (c: Candidate) => void;
  onUpdate: (c: Candidate) => void;
  onDelete: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Manage candidates and generate assessment links.
        </p>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
          <Plus className="h-4 w-4" /> Add candidate
        </button>
      </div>

      {showForm && (
        <CandidateForm
          initial={editing}
          jobs={jobs}
          onSave={(c) => {
            if (editing) onUpdate(c);
            else onAdd(c);
            setShowForm(false);
            setEditing(null);
          }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {candidates.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center text-sm text-slate-500">
          No candidates yet. Click <span className="text-slate-400">Add candidate</span> to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => (
            <CandidateRow
              key={c.id}
              candidate={c}
              savedScenarios={savedScenarios}
              jobs={jobs}
              onEdit={() => { setEditing(c); setShowForm(true); }}
              onDelete={() => onDelete(c.id)}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Candidate form ─────────────────────────────────────────────────────────

function CandidateForm({
  initial,
  jobs,
  onSave,
  onCancel,
}: {
  initial: Candidate | null;
  jobs: { title: string }[];
  onSave: (c: Candidate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  function handleSubmit() {
    if (!name.trim() || !email.trim()) return;
    onSave({
      id: initial?.id ?? `cand_${Date.now().toString(36)}`,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
      applications: initial?.applications ?? [],
    });
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">{initial ? "Edit candidate" : "New candidate"}</h3>
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-200" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Name *">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Jane Smith" />
        </FormField>
        <FormField label="Email *">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="jane@example.com" />
        </FormField>
        <FormField label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+1 555 000 0000" />
        </FormField>
      </div>
      <FormField label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" placeholder="Referral source, recruiter notes…" />
      </FormField>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
        <button onClick={handleSubmit} disabled={!name.trim() || !email.trim()} className="btn-primary">
          {initial ? "Save changes" : "Add candidate"}
        </button>
      </div>
    </div>
  );
}

// ── Candidate row ──────────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  savedScenarios,
  jobs,
  onEdit,
  onDelete,
  onUpdate,
}: {
  candidate: Candidate;
  savedScenarios: SavedScenario[];
  jobs: { title: string }[];
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (c: Candidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addingJob, setAddingJob] = useState(false);
  const [newJobTitle, setNewJobTitle] = useState("");
  const [sendModal, setSendModal] = useState<CandidateApplication | null>(null);

  function addApplication() {
    if (!newJobTitle.trim()) return;
    const updated: Candidate = {
      ...candidate,
      applications: [
        ...candidate.applications,
        { jobTitle: newJobTitle.trim(), appliedAt: new Date().toISOString(), assessmentsSent: [] },
      ],
    };
    onUpdate(updated);
    setNewJobTitle("");
    setAddingJob(false);
  }

  function removeApplication(idx: number) {
    const updated: Candidate = {
      ...candidate,
      applications: candidate.applications.filter((_, i) => i !== idx),
    };
    onUpdate(updated);
  }

  function recordSent(app: CandidateApplication, uuid: string) {
    const updated: Candidate = {
      ...candidate,
      applications: candidate.applications.map((a) =>
        a === app ? { ...a, assessmentsSent: [...a.assessmentsSent, uuid] } : a
      ),
    };
    onUpdate(updated);
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-surface overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-800/40 transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">{candidate.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{candidate.email}{candidate.phone ? ` · ${candidate.phone}` : ""}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {candidate.applications.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Briefcase className="h-3 w-3" />{candidate.applications.length}
            </span>
          )}
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="btn-ghost py-1 px-2 text-xs">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-slate-600 hover:text-red-400">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </button>

      {/* Expanded */}
      {open && (
        <div className="border-t border-slate-800 px-5 py-4 space-y-4">
          {candidate.notes && (
            <p className="text-xs text-slate-400 italic">{candidate.notes}</p>
          )}

          {/* Applications */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Applied positions</span>
              <button onClick={() => setAddingJob((v) => !v)} className="btn-ghost py-1 px-2 text-xs">
                <Plus className="h-3 w-3" /> Add position
              </button>
            </div>

            {addingJob && (
              <div className="flex gap-2">
                <select
                  className="input flex-1 text-xs"
                  value={newJobTitle}
                  onChange={(e) => setNewJobTitle(e.target.value)}
                >
                  <option value="">Select a job…</option>
                  {jobs.map((j) => (
                    <option key={j.title} value={j.title}>{j.title}</option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {newJobTitle === "__custom__" && (
                  <input
                    className="input flex-1 text-xs"
                    placeholder="Job title"
                    onChange={(e) => setNewJobTitle(e.target.value)}
                    autoFocus
                  />
                )}
                <button onClick={addApplication} disabled={!newJobTitle || newJobTitle === "__custom__"} className="btn-primary text-xs py-1 px-3">
                  Add
                </button>
                <button onClick={() => setAddingJob(false)} className="btn-ghost text-xs py-1 px-2">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {candidate.applications.length === 0 ? (
              <p className="text-xs text-slate-600">No positions added yet.</p>
            ) : (
              <div className="space-y-2">
                {candidate.applications.map((app, idx) => (
                  <ApplicationRow
                    key={idx}
                    app={app}
                    savedScenarios={savedScenarios}
                    onSend={async (scenarios) => {
                      const uuid = generateUUID();
                      const md = renderAssessmentMd(uuid, candidate, app, scenarios);
                      const payload = createAssessmentPackage(
                        uuid,
                        candidate,
                        app,
                        md,
                        scenarios
                      );
                      await storeAssessmentPackage(payload);
                      recordSent(app, uuid);
                      setSendModal(null);
                      return buildAssessmentUrl(window.location.origin, uuid);
                    }}
                    onRemove={() => removeApplication(idx)}
                    sendModal={sendModal}
                    setSendModal={setSendModal}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Application row ────────────────────────────────────────────────────────

function ApplicationRow({
  app,
  savedScenarios,
  onSend,
  onRemove,
  sendModal,
  setSendModal,
}: {
  app: CandidateApplication;
  savedScenarios: SavedScenario[];
  onSend: (scenarios: SavedScenario[]) => Promise<string | undefined>;
  onRemove: () => void;
  sendModal: CandidateApplication | null;
  setSendModal: (a: CandidateApplication | null) => void;
}) {
  const isOpen = sendModal === app;
  const [lastAssessmentUrl, setLastAssessmentUrl] = useState("");

  // Scenarios for this job
  const relevantScenarios = savedScenarios.filter(
    (s) => !s.jobTitle || s.jobTitle === app.jobTitle
  );

  return (
    <div className="rounded-lg border border-slate-800 bg-background p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-slate-200">{app.jobTitle}</span>
          <span className="ml-2 text-xs text-slate-600">
            Applied {new Date(app.appliedAt).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {app.assessmentsSent.length > 0 && (
            <span className="text-xs text-slate-500">{app.assessmentsSent.length} sent</span>
          )}
          <button
            onClick={() => setSendModal(isOpen ? null : app)}
            className="btn-primary text-xs py-1 px-3"
          >
            <Send className="h-3 w-3" /> Generate assessment link
          </button>
          <button onClick={onRemove} className="text-slate-600 hover:text-red-400">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Send assessment modal */}
      {isOpen && (
        <SendAssessmentPanel
          jobTitle={app.jobTitle}
          scenarios={relevantScenarios}
          allScenarios={savedScenarios}
          onSend={async (scenarios) => {
            const url = await onSend(scenarios);
            if (url) setLastAssessmentUrl(url);
            return url;
          }}
          onCancel={() => setSendModal(null)}
        />
      )}

      {/* Historical sent ids. These may predate the shareable-link store. */}
      {app.assessmentsSent.length > 0 && (
        <div className="space-y-0.5">
          {app.assessmentsSent.map((uuid) => (
            <p key={uuid} className="font-mono text-xs text-slate-600">{uuid}</p>
          ))}
        </div>
      )}

      {lastAssessmentUrl && (
        <div className="rounded-md border border-emerald-300/30 bg-emerald-300/10 p-2">
          <p className="mb-1 text-xs font-semibold text-emerald-200">
            Assessment generated. Please send this link to the candidate.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={lastAssessmentUrl}
              className="input flex-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(lastAssessmentUrl)}
              className="btn-ghost shrink-0"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Send assessment panel ──────────────────────────────────────────────────

function SendAssessmentPanel({
  jobTitle,
  scenarios,
  allScenarios,
  onSend,
  onCancel,
}: {
  jobTitle: string;
  scenarios: SavedScenario[];
  allScenarios: SavedScenario[];
  onSend: (scenarios: SavedScenario[]) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scenarios.map((s) => s.scenario.id)));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const chosenScenarios = allScenarios.filter((s) => selected.has(s.scenario.id));

  return (
    <div className="rounded-lg border border-slate-700 bg-surface p-4 space-y-3 mt-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Select scenarios to include
        </span>
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      {allScenarios.length === 0 ? (
        <p className="text-xs text-slate-500">No saved scenarios. Generate some in the Playground first.</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {allScenarios.map((s) => (
            <label key={s.scenario.id} className="flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-slate-800/40">
              <input
                type="checkbox"
                checked={selected.has(s.scenario.id)}
                onChange={() => toggle(s.scenario.id)}
                className="mt-0.5 accent-accent"
              />
              <div className="min-w-0">
                <p className="text-xs text-slate-300 truncate">
                  {s.jobTitle ? <span className="text-slate-500">[{s.jobTitle}] </span> : null}
                  {s.scenario.focusAreas.join(" · ") || "Scenario"}
                </p>
                {s.critique && (
                  <span className="text-xs text-slate-600">+ rubric</span>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-slate-500">
          {chosenScenarios.length} selected → 1 candidate link
        </span>
        <button
          onClick={async () => {
            if (chosenScenarios.length === 0 || generating) return;
            const incomplete = chosenScenarios.find(
              (scenario) => !isScenarioSendable(scenario)
            );
            if (incomplete) {
              setError(
                "Selected scenario looks incomplete. Regenerate or edit it before creating a candidate link."
              );
              return;
            }
            setGenerating(true);
            setError("");
            try {
              await onSend(chosenScenarios);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not generate assessment link."
              );
            } finally {
              setGenerating(false);
            }
          }}
          disabled={chosenScenarios.length === 0 || generating}
          className="btn-primary text-xs py-1.5 px-4"
        >
          <Send className="h-3.5 w-3.5" />
          {generating ? "Generating..." : "Generate link"}
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </label>
  );
}

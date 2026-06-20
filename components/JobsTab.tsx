"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, X, Play } from "lucide-react";
import type { SavedJob } from "@/scenario_generation/types";

export default function JobsTab({
  jobs,
  onSave,
  onDelete,
  onUse,
}: {
  jobs: SavedJob[];
  onSave: (job: SavedJob) => void;
  onDelete: (id: string) => void;
  onUse: (job: SavedJob) => void;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Save tailored job descriptions to reuse in the Playground.
        </p>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> Add job
        </button>
      </div>

      {showForm && (
        <JobForm
          onSave={(job) => {
            onSave(job);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {jobs.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center text-sm text-slate-500">
          No saved jobs yet. Click&nbsp;
          <span className="text-slate-400">Add job</span> to create one.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} onDelete={onDelete} onUse={onUse} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobForm({
  onSave,
  onCancel,
}: {
  onSave: (job: SavedJob) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [skills, setSkills] = useState("");
  const [other, setOther] = useState("");

  function handleSubmit() {
    if (!title.trim() || !jd.trim()) return;
    onSave({
      id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      savedAt: new Date().toISOString(),
      title: title.trim(),
      jd: jd.trim(),
      skills: skills.trim(),
      other: other.trim(),
    });
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">New job</h3>
        <button
          onClick={onCancel}
          className="text-slate-500 hover:text-slate-200"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <FormField label="Title *">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input"
          placeholder="e.g. Senior Backend Engineer – Caching"
        />
      </FormField>

      <FormField label="Job Description *">
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          rows={6}
          className="input"
          placeholder="Paste the full job description..."
        />
      </FormField>

      <FormField label="Skills">
        <input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          className="input"
          placeholder="distributed systems, Redis, incident response, ..."
        />
      </FormField>

      <FormField label="Other notes">
        <textarea
          value={other}
          onChange={(e) => setOther(e.target.value)}
          rows={2}
          className="input"
          placeholder="Team size, seniority bar, culture notes, etc."
        />
      </FormField>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || !jd.trim()}
          className="btn-primary"
        >
          Save job
        </button>
      </div>
    </div>
  );
}

function JobRow({
  job,
  onDelete,
  onUse,
}: {
  job: SavedJob;
  onDelete: (id: string) => void;
  onUse: (job: SavedJob) => void;
}) {
  const [open, setOpen] = useState(false);

  const date = new Date(job.savedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="rounded-xl border border-slate-800 bg-surface overflow-hidden">
      {/* Row header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-800/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">
            {job.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {job.jd.slice(0, 100)}
            {job.jd.length > 100 ? "…" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {job.skills && (
            <span className="hidden text-xs text-slate-500 sm:block">
              {job.skills.split(",").slice(0, 3).join(" · ")}
            </span>
          )}
          <span className="text-xs text-slate-600">{date}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUse(job);
            }}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent/80"
          >
            <Play className="h-3 w-3" /> Use
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(job.id);
            }}
            className="text-slate-600 hover:text-red-400"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-slate-800 px-5 py-4 space-y-5">
          <Section label="Job Description">
            <p className="whitespace-pre-wrap text-xs text-slate-400 leading-relaxed">
              {job.jd}
            </p>
          </Section>

          {job.skills && (
            <Section label="Skills">
              <div className="flex flex-wrap gap-1.5">
                {job.skills.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (
                  <Tag key={s}>{s}</Tag>
                ))}
              </div>
            </Section>
          )}

          {job.other && (
            <Section label="Other notes">
              <p className="whitespace-pre-wrap text-xs text-slate-400 leading-relaxed">
                {job.other}
              </p>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </h3>
      {children}
    </div>
  );
}

function FormField({
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

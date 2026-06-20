"use client";

import { useState, useCallback } from "react";
import PipelineApp from "@/components/PipelineApp";
import ScenariosTab from "@/components/ScenariosTab";
import JobsTab from "@/components/JobsTab";
import CandidatesTab from "@/components/CandidatesTab";
import type { Candidate, SavedJob, SavedScenario } from "@/scenario_generation/types";

const STORAGE_KEY = "saved_scenarios";
const JOBS_STORAGE_KEY = "saved_jobs";
const CANDIDATES_STORAGE_KEY = "saved_candidates";

function loadSaved(): SavedScenario[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function persistSaved(list: SavedScenario[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function loadJobs(): SavedJob[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(JOBS_STORAGE_KEY) || "[]"); } catch { return []; }
}
function persistJobs(list: SavedJob[]) {
  localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(list));
}

function loadCandidates(): Candidate[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(CANDIDATES_STORAGE_KEY) || "[]"); } catch { return []; }
}
function persistCandidates(list: Candidate[]) {
  localStorage.setItem(CANDIDATES_STORAGE_KEY, JSON.stringify(list));
}

type Tab = "playground" | "scenarios" | "jobs" | "candidates";

const TAB_LABELS: Record<Tab, (counts: Record<Tab, number>) => string> = {
  playground: () => "Playground",
  scenarios: (c) => `Scenarios${c.scenarios ? ` (${c.scenarios})` : ""}`,
  jobs: (c) => `My Jobs${c.jobs ? ` (${c.jobs})` : ""}`,
  candidates: (c) => `Candidates${c.candidates ? ` (${c.candidates})` : ""}`,
};

export default function Home() {
  const [tab, setTab] = useState<Tab>("playground");
  const [saved, setSaved] = useState<SavedScenario[]>(loadSaved);
  const [jobs, setJobs] = useState<SavedJob[]>(loadJobs);
  const [candidates, setCandidates] = useState<Candidate[]>(loadCandidates);
  const [activeJob, setActiveJob] = useState<SavedJob | null>(null);

  const counts: Record<Tab, number> = {
    playground: 0,
    scenarios: saved.length,
    jobs: jobs.length,
    candidates: candidates.length,
  };

  const handleSave = useCallback((entry: SavedScenario) => {
    setSaved((prev) => {
      const next = [entry, ...prev.filter((s) => s.scenario.id !== entry.scenario.id)];
      persistSaved(next);
      return next;
    });
    setTab("scenarios");
  }, []);

  const handleDelete = useCallback((scenarioId: string) => {
    setSaved((prev) => {
      const next = prev.filter((s) => s.scenario.id !== scenarioId);
      persistSaved(next);
      return next;
    });
  }, []);

  const handleSaveJob = useCallback((job: SavedJob) => {
    setJobs((prev) => {
      const next = [job, ...prev.filter((j) => j.id !== job.id)];
      persistJobs(next);
      return next;
    });
  }, []);

  const handleDeleteJob = useCallback((id: string) => {
    setJobs((prev) => {
      const next = prev.filter((j) => j.id !== id);
      persistJobs(next);
      return next;
    });
  }, []);

  const handleUseJob = useCallback((job: SavedJob) => {
    setActiveJob(job);
    setTab("playground");
  }, []);

  const handleAddCandidate = useCallback((c: Candidate) => {
    setCandidates((prev) => {
      const next = [c, ...prev];
      persistCandidates(next);
      return next;
    });
  }, []);

  const handleUpdateCandidate = useCallback((c: Candidate) => {
    setCandidates((prev) => {
      const next = prev.map((x) => (x.id === c.id ? c : x));
      persistCandidates(next);
      return next;
    });
  }, []);

  const handleDeleteCandidate = useCallback((id: string) => {
    setCandidates((prev) => {
      const next = prev.filter((x) => x.id !== id);
      persistCandidates(next);
      return next;
    });
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Scenario → Critique → Rubric
        </h1>
        <p className="text-sm text-slate-400">
          Turn a JD, skillset, and team input into an evaluation scenario and a
          recursive scoring rubric.
        </p>
      </header>

      {/* Tab nav */}
      <div className="mb-6 flex gap-1 border-b border-slate-800">
        {(["playground", "scenarios", "jobs", "candidates"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-accent text-accent"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {TAB_LABELS[t](counts)}
          </button>
        ))}
      </div>

      {tab === "playground" ? (
        <PipelineApp onSave={handleSave} initialJob={activeJob} jobs={jobs} />
      ) : tab === "scenarios" ? (
        <ScenariosTab saved={saved} onDelete={handleDelete} />
      ) : tab === "jobs" ? (
        <JobsTab jobs={jobs} onSave={handleSaveJob} onDelete={handleDeleteJob} onUse={handleUseJob} />
      ) : (
        <CandidatesTab
          candidates={candidates}
          savedScenarios={saved}
          jobs={jobs}
          onAdd={handleAddCandidate}
          onUpdate={handleUpdateCandidate}
          onDelete={handleDeleteCandidate}
        />
      )}
    </main>
  );
}

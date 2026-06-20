"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import type { Criterion, SavedScenario } from "@/scenario_generation/types";

const UNGROUPED = "(No job title)";

export default function ScenariosTab({
  saved,
  onDelete,
}: {
  saved: SavedScenario[];
  onDelete: (scenarioId: string) => void;
}) {
  if (saved.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 p-12 text-center text-sm text-slate-500">
        No saved scenarios yet. Generate one in the Playground and click&nbsp;
        <span className="text-slate-400">Save</span>.
      </div>
    );
  }

  // Group by jobTitle
  const groups = new Map<string, SavedScenario[]>();
  for (const s of saved) {
    const key = s.jobTitle || UNGROUPED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  return (
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([title, scenarios]) => (
        <JobGroup
          key={title}
          title={title}
          scenarios={scenarios}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function JobGroup({
  title,
  scenarios,
  onDelete,
}: {
  title: string;
  scenarios: SavedScenario[];
  onDelete: (scenarioId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-slate-800 bg-surface overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-800/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        )}
        <span className="flex-1 text-sm font-semibold text-slate-200">{title}</span>
        <span className="text-xs text-slate-500">{scenarios.length} scenario{scenarios.length !== 1 ? "s" : ""}</span>
      </button>

      {/* Scenario rows nested inside */}
      {open && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/60">
          {scenarios.map((s) => (
            <ScenarioRow key={s.scenario.id} saved={s} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioRow({
  saved,
  onDelete,
}: {
  saved: SavedScenario;
  onDelete: (scenarioId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const date = new Date(saved.savedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div>
      {/* Row header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 pl-10 pr-5 py-3 text-left hover:bg-slate-800/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-slate-300">
            {saved.scenario.focusAreas.join(" · ") || "Scenario"}
          </p>
          {saved.sourceTitle && (
            <p className="mt-0.5 truncate text-xs text-slate-600">
              {saved.sourceTitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-slate-600">{date}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(saved.scenario.id);
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
        <div className="pl-10 pr-5 pb-5 space-y-5">
          {/* Source link */}
          {saved.sourceUrl && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Source incident
              </h3>
              <a
                href={saved.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {saved.sourceTitle || saved.sourceUrl}
              </a>
            </div>
          )}

          {/* Scenario brief */}
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Scenario
            </h3>
            <p className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">
              {saved.scenario.brief}
            </p>

            {/* Candidate instructions */}
            {(saved.scenario.todos?.length > 0 || saved.scenario.scope?.focus?.length > 0) && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4 space-y-4">
                {saved.scenario.todos?.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Candidate tasks
                    </h4>
                    <ol className="space-y-1.5 list-none">
                      {saved.scenario.todos.map((t, i) => (
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
                {(saved.scenario.scope?.focus?.length > 0 || saved.scenario.scope?.skip?.length > 0) && (
                  <div className="flex gap-6">
                    {saved.scenario.scope.focus.length > 0 && (
                      <div className="flex-1">
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Focus on
                        </h4>
                        <ul className="space-y-1">
                          {saved.scenario.scope.focus.map((f) => (
                            <li key={f} className="flex items-center gap-1.5 text-xs text-slate-300">
                              <span className="h-1 w-1 rounded-full bg-accent shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {saved.scenario.scope.skip.length > 0 && (
                      <div className="flex-1">
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Skip
                        </h4>
                        <ul className="space-y-1">
                          {saved.scenario.scope.skip.map((s) => (
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

            <div className="mt-2 flex flex-wrap gap-1.5">
              {saved.scenario.focusAreas.map((f) => (
                <Tag key={f}>{f}</Tag>
              ))}
            </div>
          </div>

          {/* Rubric */}
          {saved.critique && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Scoring rubric
              </h3>
              <CriterionTree nodes={saved.critique.criteria} depth={0} />
            </div>
          )}
        </div>
      )}
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

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-slate-700 bg-background px-2 py-0.5 text-xs text-slate-400">
      {children}
    </span>
  );
}

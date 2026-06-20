"use client";

import { useMemo, useState } from "react";

type NodeCluster = "discovery" | "validation" | "mitigation" | "communication" | "prevention";

export interface ScenarioReportFact {
  id: string;
  title: string;
  fact: string;
  group: "Discovery" | "Validation" | "Mitigation" | "Communication" | "Prevention";
}

export interface ScenarioReportRun {
  id: string;
  candidateName: string;
  profile: string;
  label: string;
  percent: number;
  unlockedFactIds: string[];
  summary: string;
  finalRecommendation: string;
  messages: Array<{ role: "candidate" | "manager"; content: string }>;
}

export interface ScenarioReportData {
  scenario: {
    id: string;
    title: string;
    displayTitle: string;
    role: string;
    source?: string;
    prompt: string;
  };
  facts: ScenarioReportFact[];
  graph: {
    nodes: GraphNode[];
    links: Array<[string, string]>;
  };
  runs: ScenarioReportRun[];
}

interface GraphNode {
  id: string;
  label: string;
  group: ScenarioReportFact["group"];
  cluster: NodeCluster;
  x: number;
  y: number;
  root?: boolean;
  trap?: boolean;
}

const CLUSTER_LABELS: Record<NodeCluster, string> = {
  discovery: "discovery",
  validation: "root cause",
  mitigation: "mitigation",
  communication: "communication",
  prevention: "prevention",
};

const CLUSTER_COLORS: Record<NodeCluster, string> = {
  discovery: "#1fa896",
  validation: "#5a8fcf",
  mitigation: "#7aab57",
  communication: "#9a9aa4",
  prevention: "#c9743a",
};

const CLUSTER_POSITIONS: Record<NodeCluster, [number, number]> = {
  discovery: [185, 84],
  validation: [465, 82],
  mitigation: [200, 278],
  communication: [650, 250],
  prevention: [650, 70],
};

function factById(facts: ScenarioReportFact[], id: string) {
  return facts.find((fact) => fact.id === id);
}

function scoreClass(percent: number) {
  if (percent >= 75) return "bc-good";
  if (percent >= 45) return "bc-mid";
  return "bc-low";
}

function candidateQuestions(run: ScenarioReportRun) {
  return run.messages.filter((message) => message.role === "candidate");
}

export function ScenarioReportView({ data }: { data: ScenarioReportData }) {
  const [selectedId, setSelectedId] = useState("overview");
  const isOverview = selectedId === "overview";
  const selectedRun = data.runs.find((run) => run.id === selectedId);
  const selectedQuestions = selectedRun ? candidateQuestions(selectedRun) : [];
  const selectedFacts = useMemo(
    () =>
      new Set(
        isOverview
          ? data.runs.flatMap((run) => run.unlockedFactIds)
          : selectedRun?.unlockedFactIds || []
      ),
    [data.runs, isOverview, selectedRun]
  );
  const rootReached = data.graph.nodes.some(
    (node) => node.root && selectedFacts.has(node.id)
  );
  const selectedFactTitles = data.graph.nodes.filter((node) =>
    selectedFacts.has(node.id)
  )
    .slice(0, 5)
    .map((node) => node.label);
  const overviewCoverage = Math.round(
    (selectedFacts.size / data.facts.length) * 100
  );

  return (
    <main className="bc-page">
      <style jsx global>{`
        .bc-page {
          min-height: 100vh;
          background: linear-gradient(155deg, #edecea 0%, #e7e8eb 55%, #e9e7e4 100%);
          color: #17171c;
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 26px 18px;
          -webkit-font-smoothing: antialiased;
        }
        .bc-shell {
          position: relative;
          max-width: 980px;
          margin: 0 auto;
          overflow: hidden;
          border-radius: 18px;
          padding: 30px 26px;
        }
        .bc-content {
          position: relative;
          z-index: 1;
        }
        .bc-eyebrow {
          color: #6e6e78;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .bc-title {
          margin: 6px 0 6px;
          font-size: 30px;
          line-height: 1.04;
          letter-spacing: 0;
          font-weight: 800;
        }
        .bc-sub {
          max-width: 690px;
          margin: 0;
          color: #6e6e78;
          font-size: 14px;
          line-height: 1.55;
          font-weight: 500;
        }
        .bc-switch {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 18px 0 16px;
        }
        .bc-pill {
          border: 1px solid rgba(255, 255, 255, 0.75);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.5);
          color: #6e6e78;
          min-width: 116px;
          padding: 10px 14px;
          cursor: pointer;
          transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          backdrop-filter: blur(10px);
          text-align: left;
        }
        .bc-pill:hover {
          color: #17171c;
          background: rgba(255, 255, 255, 0.8);
          transform: translateY(-1px);
        }
        .bc-pill.on {
          color: white;
          background: #17171c;
          border-color: transparent;
        }
        .bc-pill-score {
          display: block;
          font-size: 15px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: 0;
        }
        .bc-pill-name {
          display: block;
          margin-top: 5px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.15;
        }
        .bc-panel {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.75);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.55);
          box-shadow: 0 24px 60px rgba(38, 38, 54, 0.13), inset 0 1px 0 rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(26px) saturate(165%);
        }
        .bc-graph {
          display: block;
          width: 100%;
          height: 440px;
        }
        .bc-clabel {
          fill: #c0c0c8;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .bc-nlabel {
          fill: #a6a6b0;
          font-size: 11px;
          font-weight: 650;
          pointer-events: none;
        }
        .bc-nlabel.lit {
          fill: #17171c;
        }
        .bc-cap {
          min-height: 44px;
          margin-top: 16px;
          color: #3a3a42;
          font-size: 14px;
          font-weight: 500;
          line-height: 1.55;
        }
        .bc-cap b {
          color: #0e9b7d;
        }
        .bc-profile {
          color: #6e6e78;
          font-family: "SF Mono", ui-monospace, Menlo, monospace;
          font-size: 12px;
          font-weight: 500;
        }
        .bc-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 18px;
          margin-top: 16px;
          color: #6e6e78;
          font-size: 12px;
          font-weight: 500;
        }
        .bc-legend span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }
        .bc-dot {
          width: 11px;
          height: 11px;
          border-radius: 50%;
          display: inline-block;
        }
        .bc-performance {
          margin-top: 18px;
          border: 1px solid rgba(255, 255, 255, 0.75);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.5);
          padding: 14px 14px 16px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
        }
        .bc-performance-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }
        .bc-name {
          font-size: 14px;
          font-weight: 800;
        }
        .bc-badge {
          border-radius: 999px;
          padding: 5px 8px;
          font-size: 11px;
          font-weight: 800;
        }
        .bc-good {
          background: #0e9b7d;
          color: white;
        }
        .bc-mid {
          background: #c9743a;
          color: white;
        }
        .bc-low {
          background: #d2d2da;
          color: #17171c;
        }
        .bc-performance p {
          margin: 8px 0 0;
          color: #6e6e78;
          font-size: 12.5px;
          font-weight: 500;
          line-height: 1.45;
        }
        .bc-question-list {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .bc-question {
          border: 1px solid rgba(20, 20, 30, 0.08);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.45);
          padding: 10px 11px;
        }
        .bc-question-top {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 5px;
          color: #6e6e78;
          font-family: "SF Mono", ui-monospace, Menlo, monospace;
          font-size: 11px;
          font-weight: 600;
        }
        .bc-question-text {
          color: #3a3a42;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.45;
        }
        .bc-earned {
          margin-top: 6px;
          color: #6e6e78;
          font-size: 12px;
          font-weight: 500;
        }
        @media (max-width: 720px) {
          .bc-shell {
            padding: 24px 16px;
          }
          .bc-graph {
            height: 360px;
          }
        }
      `}</style>
      <div className="bc-shell">
        <div className="bc-content">
          <section>
            <div className="bc-eyebrow">Scenario report</div>
            <h1 className="bc-title">{data.scenario.displayTitle}</h1>
            <p className="bc-sub">
              Lit = explored · ring = root cause · amber = trap.
            </p>

            <div className="bc-switch">
              <button
                type="button"
                className={`bc-pill ${isOverview ? "on" : ""}`}
                onClick={() => setSelectedId("overview")}
              >
                <span className="bc-pill-score">{overviewCoverage}%</span>
                <span className="bc-pill-name">Overview</span>
              </button>
              {data.runs.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  className={`bc-pill ${run.id === selectedId ? "on" : ""}`}
                  onClick={() => setSelectedId(run.id)}
                >
                  <span className="bc-pill-score">{run.percent}%</span>
                  <span className="bc-pill-name">{run.candidateName}</span>
                </button>
              ))}
            </div>

            <div className="bc-panel">
              <svg
                aria-label="Candidate concept graph"
                className="bc-graph"
                viewBox="0 0 760 440"
              >
                <g>
                  {Object.entries(CLUSTER_LABELS).map(([cluster, label]) => {
                    const [x, y] = CLUSTER_POSITIONS[cluster as NodeCluster];
                    return (
                      <text
                        key={cluster}
                        className="bc-clabel"
                        textAnchor="middle"
                        x={x}
                        y={y}
                      >
                        {label}
                      </text>
                    );
                  })}
                </g>
                <g>
                  {data.graph.links.map(([sourceId, targetId]) => {
                    const source = data.graph.nodes.find((node) => node.id === sourceId);
                    const target = data.graph.nodes.find((node) => node.id === targetId);
                    if (!source || !target) return null;
                    const lit =
                      selectedFacts.has(source.id) && selectedFacts.has(target.id);
                    return (
                      <line
                        key={`${sourceId}-${targetId}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="#3a3a42"
                        strokeOpacity={lit ? 0.3 : 0.06}
                        strokeWidth={lit ? 1.4 : 1}
                      />
                    );
                  })}
                </g>
                <g>
                  {data.graph.nodes.map((node) => {
                    const lit = selectedFacts.has(node.id);
                    const fill = !lit
                      ? "#d2d2da"
                      : node.root
                        ? "#0e9b7d"
                        : node.trap
                          ? "#c9743a"
                          : CLUSTER_COLORS[node.cluster];
                    return (
                      <g key={node.id}>
                        <text
                          x={node.x}
                          y={node.y - 14}
                          textAnchor="middle"
                          className={`bc-nlabel ${lit || node.root ? "lit" : ""}`}
                          opacity={lit || node.root ? 1 : 0.35}
                        >
                          {node.label}
                        </text>
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.root ? (lit ? 10 : 7) : lit ? 7.5 : 5}
                          fill={fill}
                          opacity={lit ? 1 : 0.72}
                          stroke={node.root ? "#0e9b7d" : "none"}
                          strokeWidth={node.root && !lit ? 1.4 : 0}
                          style={{
                            filter:
                              node.root && lit
                                ? "drop-shadow(0 0 8px rgba(14,155,125,.55))"
                                : lit
                                  ? "drop-shadow(0 2px 5px rgba(31,168,150,.28))"
                                  : "none",
                          }}
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>

            <div className="bc-cap">
              {isOverview ? (
                <>
                  <span className="bc-profile">
                    Overview · {data.runs.length} candidates ·{" "}
                    {selectedFacts.size}/{data.facts.length} concepts touched
                  </span>
                  <br />
                  This graph shows the combined coverage across all completed
                  candidates for this scenario.
                </>
              ) : (
                <>
                  <span className="bc-profile">
                    {selectedRun?.candidateName} · {selectedRun?.percent}% ·{" "}
                    {selectedRun?.unlockedFactIds.length}/{data.facts.length} concepts
                  </span>
                  <br />
                  {rootReached ? (
                    <>
                      Reached the <b>root-cause region</b>.{" "}
                    </>
                  ) : (
                    <>
                      Root-cause region stayed partially dark.{" "}
                    </>
                  )}
                  {selectedRun?.summary}
                  {selectedFactTitles.length > 0 && (
                    <span className="bc-profile">
                      {" "}
                      Touched: {selectedFactTitles.join(", ")}.
                    </span>
                  )}
                </>
              )}
            </div>

            {isOverview ? (
              <div className="bc-performance">
                <div className="bc-name">Scenario Description</div>
                <p>{data.scenario.prompt}</p>
              </div>
            ) : (
              <div className="bc-performance">
                <div className="bc-performance-top">
                  <div>
                    <div className="bc-eyebrow">Question performance</div>
                    <div className="bc-name">{selectedRun?.candidateName}</div>
                    <p>{selectedRun?.profile}</p>
                  </div>
                  <span className={`bc-badge ${scoreClass(selectedRun?.percent || 0)}`}>
                    {selectedRun?.label}
                  </span>
                </div>
                <div className="bc-question-list">
                  {selectedQuestions.slice(0, 5).map((message, index) => {
                    const earnedFactId = selectedRun?.unlockedFactIds[index];
                    const earnedFact = earnedFactId ? factById(data.facts, earnedFactId) : null;
                    return (
                      <div className="bc-question" key={`${selectedRun?.id}-${index}`}>
                        <div className="bc-question-top">
                          <span>Q{index + 1}</span>
                          <span>
                            {earnedFact ? "+ context" : "no scored context"}
                          </span>
                        </div>
                        <div className="bc-question-text">{message.content}</div>
                        {earnedFact && (
                          <div className="bc-earned">
                            Earned: {earnedFact.title}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p>Next step: {selectedRun?.finalRecommendation}</p>
              </div>
            )}

            <div className="bc-legend">
              <span>
                <i className="bc-dot" style={{ background: "#1fa896" }} /> explored
              </span>
              <span>
                <i
                  className="bc-dot"
                  style={{
                    background: "#0e9b7d",
                    boxShadow: "0 0 7px rgba(14,155,125,.6)",
                  }}
                />{" "}
                root cause
              </span>
              <span>
                <i className="bc-dot" style={{ background: "#c9743a" }} /> trap concept
              </span>
              <span>
                <i className="bc-dot" style={{ background: "#d2d2da" }} /> not explored
              </span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

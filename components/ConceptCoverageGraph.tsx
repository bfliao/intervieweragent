"use client";

import { useMemo, useState } from "react";
import { Network } from "lucide-react";
import type { Message, ScenarioConfig } from "@/lib/questionArena/types";

type GraphCluster = "discovery" | "network" | "health" | "config" | "noise";
type GraphRole = "root" | "trap" | "concept" | "context";

interface GraphNode {
  id: string;
  label: string;
  detail: string;
  cluster: GraphCluster;
  role: GraphRole;
  lit: boolean;
  x: number;
  y: number;
}

interface GraphLink {
  source: string;
  target: string;
}

interface ConceptCoverageGraphProps {
  scenario: ScenarioConfig;
  unlockedFactIds: string[];
  messages: Message[];
  candidateName?: string;
  compact?: boolean;
  className?: string;
}

const WIDTH = 760;
const HEIGHT = 440;

const CLUSTER_COLORS: Record<GraphCluster, string> = {
  discovery: "#54C6B2",
  network: "#D8A646",
  health: "#6E9BD6",
  config: "#93B97A",
  noise: "#7E8290",
};

const CLUSTER_LABELS: Record<GraphCluster, string> = {
  discovery: "decision path",
  network: "trap region",
  health: "evidence",
  config: "constraints",
  noise: "context",
};

const CLUSTER_CENTERS: Record<GraphCluster, [number, number]> = {
  discovery: [462, 148],
  network: [212, 296],
  health: [548, 294],
  config: [640, 178],
  noise: [190, 136],
};

const CLUSTER_OFFSETS: Record<GraphCluster, Array<[number, number]>> = {
  discovery: [
    [50, -22],
    [-50, 22],
    [0, 28],
    [-10, -56],
    [88, 28],
    [-78, -26],
  ],
  network: [
    [-58, 42],
    [-22, -8],
    [38, -48],
    [48, 48],
  ],
  health: [
    [0, 34],
    [-70, -28],
    [52, 40],
    [74, -42],
  ],
  config: [
    [0, 0],
    [76, 34],
    [-42, -32],
    [54, -42],
  ],
  noise: [
    [-54, -26],
    [20, 40],
    [54, -22],
    [-18, 72],
  ],
};

function clusterForCategory(category: string): GraphCluster {
  const normalized = category.toLowerCase();
  if (
    normalized.includes("format") ||
    normalized.includes("constraint") ||
    normalized.includes("risk") ||
    normalized.includes("legal")
  ) {
    return "config";
  }
  if (
    normalized.includes("debug") ||
    normalized.includes("evidence") ||
    normalized.includes("health") ||
    normalized.includes("root")
  ) {
    return "health";
  }
  if (
    normalized.includes("scope") ||
    normalized.includes("user") ||
    normalized.includes("use")
  ) {
    return "discovery";
  }
  if (
    normalized.includes("deadline") ||
    normalized.includes("ownership") ||
    normalized.includes("priority")
  ) {
    return "noise";
  }
  return "discovery";
}

function keywordHit(text: string, source: string) {
  const words = source
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4);

  return words.some((word) => text.includes(word));
}

function buildGraph(
  scenario: ScenarioConfig,
  unlockedFactIds: string[],
  messages: Message[]
) {
  const unlocked = new Set(unlockedFactIds);
  const candidateText = messages
    .filter((message) => message.role === "candidate")
    .map((message) => message.content.toLowerCase())
    .join(" ");
  const highestWeight = Math.max(
    ...scenario.hiddenFacts.map((fact) => fact.weight),
    0
  );
  const rootFact =
    scenario.hiddenFacts.find((fact) => fact.weight === highestWeight) ||
    scenario.hiddenFacts[0];
  const clusterCounts: Record<GraphCluster, number> = {
    discovery: 0,
    network: 0,
    health: 0,
    config: 0,
    noise: 0,
  };

  const placeNode = (cluster: GraphCluster) => {
    const index = clusterCounts[cluster];
    clusterCounts[cluster] += 1;
    const [cx, cy] = CLUSTER_CENTERS[cluster];
    const [dx, dy] =
      CLUSTER_OFFSETS[cluster][index % CLUSTER_OFFSETS[cluster].length];
    const lap = Math.floor(index / CLUSTER_OFFSETS[cluster].length);
    return {
      x: Math.max(30, Math.min(WIDTH - 30, cx + dx + lap * 22)),
      y: Math.max(42, Math.min(HEIGHT - 28, cy + dy + lap * 18)),
    };
  };

  const nodes: GraphNode[] = scenario.hiddenFacts.map((fact) => {
    const isRoot = fact.id === rootFact?.id;
    const cluster = isRoot ? "discovery" : clusterForCategory(fact.category);
    const position = placeNode(cluster);

    return {
      id: fact.id,
      label: fact.title,
      detail: fact.whyItMatters || fact.fact,
      cluster,
      role: isRoot ? "root" : "concept",
      lit: unlocked.has(fact.id),
      ...position,
    };
  });

  const trapNodes: GraphNode[] = scenario.trapAssumptions.map((trap) => {
    const source = `${trap.assumption} ${trap.whyTempting}`;
    const position = placeNode("network");

    return {
      id: `trap:${trap.id}`,
      label: trap.assumption,
      detail: trap.howToDisprove,
      cluster: "network",
      role: "trap",
      lit: keywordHit(candidateText, source),
      ...position,
    };
  });

  const contextNodes: GraphNode[] = scenario.ambientFacts.slice(0, 2).map((fact) => {
    const position = placeNode("noise");

    return {
      id: `ambient:${fact.id}`,
      label: fact.id.replace(/_/g, " "),
      detail: fact.fact,
      cluster: "noise",
      role: "context",
      lit: fact.whenToReveal.some((trigger) =>
        candidateText.includes(trigger.toLowerCase())
      ),
      ...position,
    };
  });

  const allNodes = [...nodes, ...trapNodes, ...contextNodes];
  const links: GraphLink[] = [];
  const rootId = rootFact?.id || nodes[0]?.id;

  nodes.forEach((node) => {
    if (rootId && node.id !== rootId) {
      links.push({ source: rootId, target: node.id });
    }
  });

  trapNodes.forEach((node, index) => {
    if (index > 0) links.push({ source: trapNodes[index - 1].id, target: node.id });
    const firstConcept = nodes[index % Math.max(nodes.length, 1)];
    if (firstConcept) links.push({ source: node.id, target: firstConcept.id });
  });

  contextNodes.forEach((node, index) => {
    const target = nodes[index % Math.max(nodes.length, 1)];
    if (target) links.push({ source: node.id, target: target.id });
  });

  return { nodes: allNodes, links, rootFact };
}

function nodeColor(node: GraphNode) {
  if (!node.lit) return "#34373F";
  if (node.role === "root") return "#7BE8C8";
  if (node.role === "trap") return "#D8A646";
  return CLUSTER_COLORS[node.cluster];
}

export function ConceptCoverageGraph({
  scenario,
  unlockedFactIds,
  messages,
  candidateName = "Current run",
  compact = false,
  className = "",
}: ConceptCoverageGraphProps) {
  const graph = useMemo(
    () => buildGraph(scenario, unlockedFactIds, messages),
    [scenario, unlockedFactIds, messages]
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ||
    graph.nodes.find((node) => node.role === "root") ||
    graph.nodes[0];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const litConceptCount = graph.nodes.filter((node) => node.lit).length;
  const unlockedCriticalCount = scenario.hiddenFacts.filter((fact) =>
    unlockedFactIds.includes(fact.id)
  ).length;
  const rootLit = graph.rootFact
    ? unlockedFactIds.includes(graph.rootFact.id)
    : false;
  const trapLit = graph.nodes.some((node) => node.role === "trap" && node.lit);
  const nodeScale = compact ? 1.85 : 1;
  const labelSize = compact ? 20 : 11;
  const clusterLabelSize = compact ? 17 : 11;

  return (
    <section className={className}>
      <div className="mb-3">
        <h3 className="text-lg font-bold tracking-tight text-[#E7E8EC]">
          Graph View
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-[#8B8F9A]">
          Concepts touched across the candidate&apos;s questions. Lit = explored ·
          ring = root cause · amber = trap.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-[14px] border border-[#23252E] bg-[#121319]">
        <Network
          aria-hidden="true"
          className="absolute right-4 top-4 h-5 w-5 text-[#6A6E78] opacity-50"
        />
        <svg
          role="img"
          aria-labelledby="concept-coverage-title concept-coverage-desc"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className={`block w-full ${compact ? "h-[300px]" : "h-[440px]"}`}
        >
          <title id="concept-coverage-title">Concept coverage graph</title>
          <desc id="concept-coverage-desc">
            Dark inset graph showing explored concepts, root cause, and trap
            assumptions for the current candidate run.
          </desc>

          {Object.entries(CLUSTER_LABELS).map(([cluster, label]) => {
            const [x, y] = CLUSTER_CENTERS[cluster as GraphCluster];
            return (
              <text
                key={cluster}
                x={x}
                y={y - 66}
                textAnchor="middle"
                fontSize={clusterLabelSize}
                className="fill-[#3C3F49] font-bold uppercase tracking-[0.04em]"
              >
                {label}
              </text>
            );
          })}

          <g>
            {graph.links.map((link, index) => {
              const source = nodeById.get(link.source);
              const target = nodeById.get(link.target);
              if (!source || !target) return null;
              const lit = source.lit && target.lit;

              return (
                <line
                  key={`${link.source}-${link.target}-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="#FFFFFF"
                  strokeWidth={lit ? 1.3 : 1}
                  strokeOpacity={lit ? 0.34 : 0.05}
                  className="transition-all duration-300 motion-reduce:transition-none"
                />
              );
            })}
          </g>

          <g>
            {graph.nodes.map((node) => {
              const baseRadius =
                node.role === "root" ? (node.lit ? 14 : 9) : node.lit ? 10 : 7;
              const radius = baseRadius * nodeScale;
              const showLabel = node.lit || node.role === "root";

              return (
                <g key={node.id}>
                  <text
                    x={node.x}
                    y={node.y - radius - (compact ? 14 : 8)}
                    textAnchor="middle"
                    fontSize={labelSize}
                    className={`pointer-events-none font-medium transition-opacity duration-300 motion-reduce:transition-none ${
                      showLabel ? "fill-[#E7E8EC] opacity-100" : "fill-[#8B8F9A] opacity-0"
                    }`}
                  >
                    {node.label}
                  </text>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius}
                    fill={nodeColor(node)}
                    opacity={node.lit ? 1 : 0.45}
                    stroke={node.role === "root" ? "#7BE8C8" : "transparent"}
                    strokeWidth={node.role === "root" && !node.lit ? 1.4 : 0}
                    className="cursor-pointer transition-all duration-300 motion-reduce:transition-none"
                    style={{
                      filter:
                        node.role === "root" && node.lit
                          ? "drop-shadow(0 0 7px #7BE8C8)"
                          : node.lit && node.role === "trap"
                            ? "drop-shadow(0 0 4px #D8A64666)"
                            : node.lit && node.cluster !== "noise"
                              ? `drop-shadow(0 0 4px ${CLUSTER_COLORS[node.cluster]}66)`
                              : "none",
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.label}: ${
                      node.lit ? "explored" : "not explored"
                    }`}
                    onClick={() => setSelectedNodeId(node.id)}
                    onFocus={() => setSelectedNodeId(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedNodeId(node.id);
                      }
                    }}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="mt-3 min-h-10 text-sm leading-relaxed text-[#E7E8EC]">
        <span className="font-mono text-xs text-[#8B8F9A]">
          {candidateName} · {litConceptCount} concepts · {unlockedCriticalCount}/
          {scenario.hiddenFacts.length} decision-critical
        </span>
        <br />
        {selectedNode ? (
          <>
            <span
              className={
                selectedNode.role === "trap"
                  ? "font-bold text-[#D8A646]"
                  : selectedNode.role === "root"
                    ? "font-bold text-[#7BE8C8]"
                    : "font-bold text-[#54C6B2]"
              }
            >
              {selectedNode.label}
            </span>
            {": "}
            {selectedNode.detail}
          </>
        ) : rootLit ? (
          <>
            Reached the{" "}
            <span className="font-bold text-[#7BE8C8]">root cause</span> and
            connected enough context for a grounded assessment.
          </>
        ) : trapLit ? (
          <>
            Detoured into the{" "}
            <span className="font-bold text-[#D8A646]">trap region</span>; the
            root-cause concept is still dark.
          </>
        ) : (
          <>
            The root-cause concept is still dark. The next useful question should
            move toward the decision path.
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#8B8F9A]">
        <span className="inline-flex items-center gap-2">
          <i className="h-2.5 w-2.5 rounded-full bg-[#54C6B2]" />
          explored
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-2.5 w-2.5 rounded-full bg-[#7BE8C8] shadow-[0_0_6px_#7BE8C8]" />
          root cause
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-2.5 w-2.5 rounded-full bg-[#D8A646]" />
          trap concept
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-2.5 w-2.5 rounded-full bg-[#34373F]" />
          not explored
        </span>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
  EdgeLabelRenderer,
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Layout,
  GitBranch,
  Terminal as TerminalIcon,
  FileCode,
  Maximize2,
  Minimize2,
  Sliders,
  CheckCircle2,
  Clock,
  Send,
  MessageSquare,
  ShieldCheck,
  UserCheck,
  FileText,
  Activity,
  Play,
  ArrowRight,
  Sparkles,
} from "lucide-react";

import AgentNodeComponent from "./AgentNode";
import { deriveEdgeLabel } from "./iconResolver";
import type {
  ExecutionStep,
  CatalogTool,
  AgentNodeData,
  PlanStep,
  WorkspaceViewMode,
} from "./types";
import dagre from "dagre";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 150;

function getLayoutedElements(nodes: Node[], edges: Edge[], direction: "TB" | "LR" = "TB") {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 70, nodesep: 50 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/* ── Custom Animated Edge ── */
function AnimatedEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, id } = props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 14,
  });

  const edgeData = data as { label?: string; isActive?: boolean; isCompleted?: boolean } | undefined;
  const isActive = edgeData?.isActive;
  const isCompleted = edgeData?.isCompleted;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive ? "#f4f4f5" : isCompleted ? "#10b981" : "rgba(255,255,255,0.12)",
          strokeWidth: isActive ? 2 : 1.5,
          strokeDasharray: isActive ? "5 3" : "none",
        }}
        markerEnd={MarkerType.ArrowClosed}
      />
      {edgeData?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="cc-edge-pill nodrag nopan"
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes: NodeTypes = {
  agentNode: AgentNodeComponent,
};

const edgeTypes = {
  animated: AnimatedEdge,
};

interface Props {
  executionSteps: ExecutionStep[];
  planSteps: PlanStep[];
  selectedNodeId: string | null;
  activeStepIndex: number | null;
  onNodeClick: (stepIndex: number) => void;
  onCanvasClick: () => void;
  catalogTools: CatalogTool[];
  phase: string;
  viewMode: WorkspaceViewMode;
  onViewModeChange: (mode: WorkspaceViewMode) => void;
  executionMode?: "auto" | "manual";
  onToggleExecutionMode?: () => void;
  onExecuteStep?: (stepIndex: number) => void;
  onExecuteNextStep?: () => void;
}

function RightCanvasInner({
  executionSteps,
  planSteps,
  selectedNodeId,
  activeStepIndex,
  onNodeClick,
  onCanvasClick,
  catalogTools,
  phase,
  viewMode,
  onViewModeChange,
  executionMode = "auto",
  onToggleExecutionMode,
  onExecuteStep,
  onExecuteNextStep,
}: Props) {
  const { fitView } = useReactFlow();
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Build nodes
  const rawNodes: Node[] = useMemo(() => {
    return executionSteps.map((step) => {
      const catalogTool = catalogTools.find(
        (t) => t.connector === step.connector && t.tool === step.tool
      );
      const nodeData: AgentNodeData = {
        stepIndex: step.index,
        connector: step.connector,
        connectorDisplayName: catalogTool?.connector_display_name || step.connector,
        tool: step.tool,
        toolDescription: catalogTool?.description || "",
        status: step.status,
        result: step.result,
        error: step.error,
        durationMs: step.durationMs,
        params: step.resolvedParams || step.params,
        isSelected: selectedNodeId === `step-${step.index}`,
        catalogTool,
        onExecuteStep,
      };
      return {
        id: `step-${step.index}`,
        type: "agentNode",
        position: { x: 0, y: 0 },
        data: nodeData,
      };
    });
  }, [executionSteps, selectedNodeId, catalogTools, onExecuteStep]);

  // Build edges
  const rawEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    for (let i = 1; i < executionSteps.length; i++) {
      const sourceStep = executionSteps[i - 1];
      const targetStep = executionSteps[i];
      const targetPlanStep = planSteps[i];

      const label = targetPlanStep
        ? deriveEdgeLabel(
            { connector: sourceStep.connector, tool: sourceStep.tool },
            { connector: targetStep.connector, tool: targetStep.tool, params: targetPlanStep.params }
          )
        : undefined;

      const isActive = activeStepIndex === targetStep.index;
      const isCompleted = sourceStep.status === "completed" && targetStep.status === "completed";

      edges.push({
        id: `e-${sourceStep.index}-${targetStep.index}`,
        source: `step-${sourceStep.index}`,
        target: `step-${targetStep.index}`,
        type: "animated",
        data: { label, isActive, isCompleted },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isActive ? "#ffffff" : isCompleted ? "#10b981" : "rgba(255,255,255,0.2)",
          width: 12,
          height: 12,
        },
      });
    }
    return edges;
  }, [executionSteps, planSteps, activeStepIndex]);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(rawNodes, rawEdges),
    [rawNodes, rawEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 80);
    }
  }, [nodes.length, fitView]);

  useEffect(() => {
    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId);
      if (node) {
        fitView({
          nodes: [node],
          padding: 1.4,
          duration: 350,
        });
      }
    }
  }, [selectedNodeId, nodes, fitView]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as unknown as AgentNodeData;
      onNodeClick(data.stepIndex);
    },
    [onNodeClick]
  );

  return (
    <div
      className="cc-canvas-bg"
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Top Floating Action / Workspace Switcher ── */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 20,
          right: 20,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pointerEvents: "none",
        }}
      >
        {/* Workspace Mode Tabs */}
        <div className="cc-floating-bar" style={{ pointerEvents: "auto" }}>
          <button
            onClick={() => onViewModeChange("graph")}
            className={`cc-tab-btn ${viewMode === "graph" ? "active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <GitBranch size={13} />
            <span>Agent Graph</span>
          </button>

          <button
            onClick={() => onViewModeChange("desktop")}
            className={`cc-tab-btn ${viewMode === "desktop" ? "active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Layout size={13} />
            <span>AI Desktop</span>
          </button>

          <button
            onClick={() => onViewModeChange("terminal")}
            className={`cc-tab-btn ${viewMode === "terminal" ? "active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <TerminalIcon size={13} />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => onViewModeChange("artifacts")}
            className={`cc-tab-btn ${viewMode === "artifacts" ? "active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <FileCode size={13} />
            <span>Artifacts</span>
          </button>
        </div>

        {/* Right Status Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
          {/* Manual Run Step Button */}
          {executionMode === "manual" && executionSteps.some((s) => s.status === "pending") && (
            <button
              onClick={onExecuteNextStep}
              className="cc-btn-primary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 600,
                background: "#2563eb",
                color: "#ffffff",
                borderRadius: 8,
                boxShadow: "0 0 14px rgba(37, 99, 235, 0.4)",
              }}
            >
              <Play size={12} fill="currentColor" />
              <span>
                Run Step {executionSteps.find((s) => s.status === "pending")?.index}:{" "}
                {executionSteps.find((s) => s.status === "pending")?.tool}
              </span>
            </button>
          )}

          <button
            onClick={onToggleExecutionMode}
            className="cc-floating-bar"
            style={{
              padding: "4px 12px",
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              color: executionMode === "manual" ? "#38bdf8" : "#a1a1aa",
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
            title="Click to toggle between Autonomous and Step-by-Step execution"
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background:
                  phase === "executing"
                    ? "#f4f4f5"
                    : executionMode === "manual"
                    ? "#38bdf8"
                    : "#10b981",
              }}
            />
            <span>MODE: {executionMode === "manual" ? "MANUAL STEP" : "AUTONOMOUS"}</span>
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="cc-btn-secondary"
            style={{ padding: "6px 10px" }}
            title="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT AREA ── */}
      <div style={{ flex: 1, position: "relative", width: "100%", height: "100%" }}>
        {/* Dynamic Moving Planning Neural Visualizer */}
        {phase === "planning" && <PlanningNeuralVisualizer />}

        {/* VIEW 1: AGENT GRAPH */}
        {viewMode === "graph" && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onPaneClick={onCanvasClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "animated" }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.3}
            maxZoom={2}
            className="cc-flow"
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(255,255,255,0.04)" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => {
                const data = node.data as unknown as AgentNodeData;
                if (data.status === "completed") return "#10b981";
                if (data.status === "running") return "#f4f4f5";
                if (data.status === "failed") return "#ef4444";
                return "rgba(255,255,255,0.2)";
              }}
              maskColor="rgba(0,0,0,0.8)"
            />
          </ReactFlow>
        )}

        {/* VIEW 2: AI DESKTOP (Inspired by reference UI) */}
        {viewMode === "desktop" && (
          <div
            style={{
              padding: "80px 30px 30px",
              height: "100%",
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 20,
              alignContent: "start",
            }}
          >
            {/* Desktop Card 1: Live Terminal */}
            <div className="cc-card" style={{ padding: "16px", background: "#0a0a0c" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <TerminalIcon size={14} className="text-zinc-400" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f4f4f5" }}>
                  Autonomous Agent Shell
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "#a1a1aa",
                  lineHeight: 1.7,
                }}
              >
                <div style={{ color: "#71717a" }}>$ agentic-flow execute --mission &quot;Hiring Pipeline&quot;</div>
                <div style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle2 size={11} className="text-emerald-400" /> PyMuPDF parsed 473KB resume PDF
                </div>
                <div style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle2 size={11} className="text-emerald-400" /> Extracted 10 key technical skills
                </div>
                <div style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle2 size={11} className="text-emerald-400" /> Calculated ATS alignment: 88/100
                </div>
                <div style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle2 size={11} className="text-emerald-400" /> Forensics checks passed (Risk: 8%)
                </div>
                <div style={{ color: "#38bdf8", display: "flex", alignItems: "center", gap: 4 }}>
                  <ArrowRight size={11} className="text-sky-400" /> Communication dispatch ready
                </div>
              </div>
            </div>

            {/* Desktop Card 2: Candidate Scorecard */}
            <div className="cc-card" style={{ padding: "16px", background: "#101014" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <UserCheck size={14} className="text-emerald-400" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#f4f4f5" }}>
                    Candidate Profile Summary
                  </span>
                </div>
                <span className="cc-tag success">89 / 100</span>
              </div>

              <div style={{ fontSize: 12, color: "#a1a1aa", lineHeight: 1.6 }}>
                <div>
                  <strong style={{ color: "#f4f4f5" }}>Name:</strong> Ayush Singh
                </div>
                <div>
                  <strong style={{ color: "#f4f4f5" }}>Role:</strong> Senior AI Systems Engineer
                </div>
                <div>
                  <strong style={{ color: "#f4f4f5" }}>Status:</strong> Qualified • PROCEED
                </div>
                <div>
                  <strong style={{ color: "#f4f4f5" }}>Contact:</strong> +91 98765 43210
                </div>
              </div>
            </div>

            {/* Desktop Card 3: WhatsApp Outreach Preview */}
            <div className="cc-card" style={{ padding: "16px", background: "#0a0a0c" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <MessageSquare size={14} className="text-emerald-400" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f4f4f5" }}>
                  Outreach Dispatch Channel
                </span>
              </div>

              <div
                style={{
                  background: "#121216",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 12,
                  color: "#d4d4d8",
                  lineHeight: 1.5,
                }}
              >
                Hi Ayush! Your profile has been shortlisted for the Senior AI Systems Engineer role (Score: 89/100).
                We would love to coordinate a follow-up interview.
              </div>
              <div style={{ fontSize: 10, color: "#71717a", marginTop: 8, textAlign: "right" }}>
                Delivered via Meta Cloud API
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: TERMINAL LOG STREAM */}
        {viewMode === "terminal" && (
          <div style={{ padding: "80px 24px 24px", height: "100%", overflowY: "auto" }}>
            <div className="cc-terminal" style={{ padding: "20px", minHeight: "100%" }}>
              <div style={{ color: "#71717a", marginBottom: 12 }}>
                [AGENT COMMAND CENTER — EXECUTION LOG STREAM]
              </div>
              {executionSteps.map((s) => (
                <div key={s.index} style={{ marginBottom: 10 }}>
                  <span style={{ color: "#71717a" }}>[{new Date().toLocaleTimeString()}]</span>{" "}
                  <span style={{ color: "#38bdf8" }}>[{s.connector}::{s.tool}]</span>{" "}
                  <span style={{ color: s.status === "completed" ? "#10b981" : "#f4f4f5" }}>
                    STATUS: {s.status.toUpperCase()}
                  </span>
                  {s.durationMs && (
                    <span style={{ color: "#71717a" }}> ({s.durationMs}ms)</span>
                  )}
                  {s.result && (
                    <div style={{ color: "#a1a1aa", marginLeft: 20, marginTop: 2 }}>
                      ➔ {JSON.stringify(s.result)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 4: ARTIFACTS VIEW */}
        {viewMode === "artifacts" && (
          <div style={{ padding: "80px 24px 24px", height: "100%", overflowY: "auto" }}>
            <div className="cc-card" style={{ padding: "20px" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#f4f4f5", marginBottom: 12 }}>
                Generated Mission Artifacts
              </div>
              <pre
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "#a1a1aa",
                  background: "#09090b",
                  padding: "16px",
                  borderRadius: 8,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(
                  {
                    mission: "Candidate Evaluation & Outreach",
                    candidate: "Ayush Singh",
                    overall_score: 89,
                    recommendation: "PROCEED",
                    steps_executed: executionSteps.map((s) => ({
                      tool: s.tool,
                      status: s.status,
                      duration_ms: s.durationMs,
                    })),
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanningNeuralVisualizer() {
  const [createdCount, setCreatedCount] = useState(1);

  useEffect(() => {
    const iv = setInterval(() => {
      setCreatedCount((prev) => (prev >= 4 ? 1 : prev + 1));
    }, 450);
    return () => clearInterval(iv);
  }, []);

  const sampleNodes = [
    { name: "Document Parser", type: "Input Source", icon: FileText, color: "text-blue-400", border: "border-blue-500/30" },
    { name: "Policy Evaluation", type: "Logic Gate", icon: ShieldCheck, color: "text-purple-400", border: "border-purple-500/30" },
    { name: "Decision Aggregator", type: "Analytics", icon: GitBranch, color: "text-sky-400", border: "border-sky-500/30" },
    { name: "Outreach Dispatch", type: "Action Channel", icon: MessageSquare, color: "text-emerald-400", border: "border-emerald-500/30" },
  ];

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 overflow-hidden bg-zinc-950/85 backdrop-blur-xs">
      {/* Moving scanline laser */}
      <div className="cc-scanline-bar" />

      {/* Subtle pulse ring */}
      <div className="absolute w-[360px] h-[360px] rounded-full border border-blue-500/15 animate-ping opacity-25 pointer-events-none" />

      {/* Clean status badge */}
      <div className="relative z-10 mb-6 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-300 text-xs font-mono shadow-md">
        <Activity className="w-3.5 h-3.5 animate-pulse text-blue-400" />
        <span>Creating execution nodes ({createdCount}/4)...</span>
      </div>

      {/* Dynamic assembling nodes */}
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-3 max-w-md w-full">
        {sampleNodes.slice(0, createdCount).map((node, idx) => {
          const Icon = node.icon;
          return (
            <div
              key={node.name}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-zinc-900/90 border ${node.border} shadow-lg shadow-black/40 transition-all duration-200`}
            >
              <div className="p-1.5 rounded-md bg-white/5">
                <Icon className={`w-4 h-4 ${node.color}`} />
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-200">{node.name}</div>
                <div className="text-[10px] text-zinc-500 font-mono">{node.type}</div>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping ml-1" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RightCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <RightCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

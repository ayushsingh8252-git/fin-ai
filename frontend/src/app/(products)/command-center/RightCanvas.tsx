"use client";

import { useCallback, useEffect, useMemo } from "react";
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

import AgentNodeComponent from "./AgentNode";
import NodeInspector from "./NodeInspector";
import { deriveEdgeLabel } from "./iconResolver";
import type { ExecutionStep, CatalogTool, AgentNodeData, PlanStep } from "./types";

/* ── Dagre layout ── */
import dagre from "dagre";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 160;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 60 });

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

/* ── Custom animated edge ── */
function AnimatedEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, id } = props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
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
          stroke: isActive ? "rgba(99,102,241,0.6)" : isCompleted ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)",
          strokeWidth: isActive ? 2.5 : 2,
          strokeDasharray: isActive ? "6 4" : "none",
          animation: isActive ? "cc-edge-flow 0.8s linear infinite" : "none",
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
            className="cc-edge-label nodrag nopan"
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/* ── Node types ── */
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
  inspectedStep: ExecutionStep | null;
  catalogTools: CatalogTool[];
  onInspectorClose: () => void;
  phase: string;
}

function RightCanvasInner({
  executionSteps,
  planSteps,
  selectedNodeId,
  activeStepIndex,
  onNodeClick,
  onCanvasClick,
  inspectedStep,
  catalogTools,
  onInspectorClose,
  phase,
}: Props) {
  const { fitView } = useReactFlow();

  // Build nodes from execution steps
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
      };
      return {
        id: `step-${step.index}`,
        type: "agentNode",
        position: { x: 0, y: 0 },
        data: nodeData,
      };
    });
  }, [executionSteps, selectedNodeId, catalogTools]);

  // Build edges from step dependencies
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
        markerEnd: { type: MarkerType.ArrowClosed, color: isActive ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.15)", width: 14, height: 14 },
      });
    }
    return edges;
  }, [executionSteps, planSteps, activeStepIndex]);

  // Layout
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(rawNodes, rawEdges),
    [rawNodes, rawEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Update nodes/edges when layout changes
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Fit view when nodes appear or change
  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.3, duration: 500 }), 100);
    }
  }, [nodes.length, fitView]);

  // Pan to active node
  useEffect(() => {
    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId);
      if (node) {
        fitView({
          nodes: [node],
          padding: 1.5,
          duration: 400,
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

  // Find catalog tool for inspected step
  const inspectedCatalogTool = inspectedStep
    ? catalogTools.find((t) => t.connector === inspectedStep.connector && t.tool === inspectedStep.tool)
    : undefined;

  const completedCount = executionSteps.filter((s) => s.status === "completed").length;
  const uniqueConnectors = new Set(executionSteps.map((s) => s.connector)).size;

  return (
    <div className="cc-canvas-bg" style={{ position: "relative", width: "100%", height: "100vh" }}>
      {/* Canvas header */}
      {executionSteps.length > 0 && (
        <div className="cc-canvas-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {phase === "executing" && (
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", animation: "cc-pulse 1.5s ease-in-out infinite" }} />
            )}
            {phase === "completed" && (
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
            )}
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
              {phase === "executing" ? "Executing Mission" : phase === "completed" ? "Mission Complete" : phase === "planned" ? "Ready to Execute" : "Agent Canvas"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="cc-metric">
              <span style={{ color: "#818cf8" }}>{uniqueConnectors}</span> agents
            </div>
            <div className="cc-metric">
              <span style={{ color: "#818cf8" }}>{executionSteps.length}</span> tools
            </div>
            <div className="cc-metric">
              <span style={{ color: "#22c55e" }}>{completedCount}</span> done
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {executionSteps.length === 0 && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(129,140,248,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>
              Agent Canvas
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", maxWidth: 260 }}>
              Enter a mission on the left to see agents, tools, and data flow visualized here
            </div>
          </div>
        </div>
      )}

      {/* React Flow */}
      {executionSteps.length > 0 && (
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
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
          className="cc-flow"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.03)" />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as unknown as AgentNodeData;
              if (data.status === "completed") return "rgba(34,197,94,0.5)";
              if (data.status === "running") return "rgba(99,102,241,0.5)";
              if (data.status === "failed") return "rgba(239,68,68,0.5)";
              return "rgba(255,255,255,0.1)";
            }}
            maskColor="rgba(0,0,0,0.7)"
            style={{ background: "rgba(15,15,23,0.9)" }}
          />
        </ReactFlow>
      )}

      {/* Node Inspector */}
      <NodeInspector
        step={inspectedStep}
        catalogTool={inspectedCatalogTool}
        onClose={onInspectorClose}
      />
    </div>
  );
}

/** Wraps in ReactFlowProvider so useReactFlow() works */
export default function RightCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <RightCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import LeftPanel from "./LeftPanel";
import RightCanvas from "./RightCanvas";
import type {
  MissionState,
  ExecutionStep,
  CatalogTool,
  Plan,
  PlanStep,
  DEMO_PLAN,
  DEMO_RESULTS,
} from "./types";
import {
  DEMO_PLAN as DemoPlan,
  DEMO_RESULTS as DemoResults,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Resolve $stepN.path.to.field placeholders against previous results */
function resolvePlaceholders(
  value: unknown,
  results: Record<number, Record<string, unknown>>
): unknown {
  if (typeof value === "string") {
    const match = value.trim().match(/^\$step(\d+)((?:\.[A-Za-z0-9_]+)*)$/);
    if (!match) return value;
    const stepIndex = parseInt(match[1], 10);
    const pathParts = match[2].split(".").filter(Boolean);
    let resolved: unknown = results[stepIndex];
    for (const key of pathParts) {
      if (resolved && typeof resolved === "object" && key in (resolved as Record<string, unknown>)) {
        resolved = (resolved as Record<string, unknown>)[key];
      } else {
        return value; // can't resolve — leave as-is
      }
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolvePlaceholders(v, results));
  }
  if (typeof value === "object" && value !== null) {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolvePlaceholders(v, results);
    }
    return resolved;
  }
  return value;
}

export default function CommandCenter() {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<MissionState>({
    phase: "idle",
    prompt: "",
    plan: null,
    executionSteps: [],
    selectedNodeId: null,
    activeStepIndex: null,
  });
  const [catalogTools, setCatalogTools] = useState<CatalogTool[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Load tool catalog on mount
  useEffect(() => {
    fetchCatalog();
  }, []);

  async function fetchCatalog() {
    try {
      const res = await fetch(`${API_URL}/api/v1/agent/tools`);
      if (res.ok) {
        const data = await res.json();
        setCatalogTools(data.tools || []);
      }
    } catch {
      // Catalog fetch failed — not critical for the POC
      console.warn("[CommandCenter] Could not fetch tool catalog");
    }
  }

  /** Main submission handler */
  const handleSubmit = useCallback(async (missionPrompt: string) => {
    if (!missionPrompt.trim()) return;

    // Reset state
    setState({
      phase: "planning",
      prompt: missionPrompt,
      plan: null,
      executionSteps: [],
      selectedNodeId: null,
      activeStepIndex: null,
      startedAt: Date.now(),
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // ── Step 1: Get the plan ──
      let plan: Plan;
      let useDemoMode = false;

      try {
        const planRes = await fetch(`${API_URL}/api/v1/agent/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: missionPrompt }),
          signal: controller.signal,
        });

        if (planRes.ok) {
          plan = await planRes.json();
          if (!plan.steps || plan.steps.length === 0) {
            // Empty plan — fall back to demo
            useDemoMode = true;
            plan = DemoPlan;
          }
        } else {
          useDemoMode = true;
          plan = DemoPlan;
        }
      } catch {
        useDemoMode = true;
        plan = DemoPlan;
      }

      if (controller.signal.aborted) return;

      // ── Step 2: Initialize execution steps ──
      const execSteps: ExecutionStep[] = plan.steps.map((step, i) => ({
        index: i + 1,
        connector: step.connector,
        tool: step.tool,
        params: step.params,
        status: "pending" as const,
      }));

      setState((prev) => ({
        ...prev,
        phase: "planned",
        plan,
        executionSteps: execSteps,
      }));

      // Brief pause to show the plan
      await sleep(600);
      if (controller.signal.aborted) return;

      // ── Step 3: Execute steps sequentially ──
      setState((prev) => ({ ...prev, phase: "executing" }));

      const results: Record<number, Record<string, unknown>> = {};

      for (let i = 0; i < plan.steps.length; i++) {
        if (controller.signal.aborted) return;

        const stepIndex = i + 1;
        const planStep = plan.steps[i];

        // Mark as running
        setState((prev) => ({
          ...prev,
          activeStepIndex: stepIndex,
          selectedNodeId: `step-${stepIndex}`,
          executionSteps: prev.executionSteps.map((s) =>
            s.index === stepIndex
              ? { ...s, status: "running" as const, startedAt: Date.now() }
              : s
          ),
        }));

        // Resolve placeholders
        const resolvedParams = resolvePlaceholders(planStep.params, results) as Record<string, unknown>;

        // Execute
        const startTime = Date.now();

        if (useDemoMode) {
          // Demo mode — simulate execution with realistic delays
          await sleep(800 + Math.random() * 1500);

          if (controller.signal.aborted) return;

          const demoResult = DemoResults[stepIndex] || { status: "completed" };
          const elapsed = Date.now() - startTime;

          results[stepIndex] = demoResult;

          setState((prev) => ({
            ...prev,
            executionSteps: prev.executionSteps.map((s) =>
              s.index === stepIndex
                ? {
                    ...s,
                    status: "completed" as const,
                    result: demoResult,
                    resolvedParams,
                    completedAt: Date.now(),
                    durationMs: elapsed,
                  }
                : s
            ),
          }));
        } else {
          // Real mode — call the actual backend
          try {
            const toolRes = await fetch(
              `${API_URL}/api/v1/agent/tools/${planStep.connector}/${planStep.tool}/call`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(resolvedParams),
                signal: controller.signal,
              }
            );

            const elapsed = Date.now() - startTime;

            if (toolRes.ok) {
              const result = await toolRes.json();
              results[stepIndex] = result;

              setState((prev) => ({
                ...prev,
                executionSteps: prev.executionSteps.map((s) =>
                  s.index === stepIndex
                    ? {
                        ...s,
                        status: "completed" as const,
                        result,
                        resolvedParams,
                        completedAt: Date.now(),
                        durationMs: elapsed,
                      }
                    : s
                ),
              }));
            } else {
              const error = await toolRes.json().catch(() => ({ message: `HTTP ${toolRes.status}` }));
              const elapsed2 = Date.now() - startTime;

              setState((prev) => ({
                ...prev,
                phase: "failed",
                executionSteps: prev.executionSteps.map((s) => {
                  if (s.index === stepIndex) {
                    return {
                      ...s,
                      status: "failed" as const,
                      error: error.message || error.detail?.message || `Step failed with HTTP ${toolRes.status}`,
                      errorCode: error.code || error.detail?.code,
                      resolvedParams,
                      completedAt: Date.now(),
                      durationMs: elapsed2,
                    };
                  }
                  if (s.index > stepIndex) return { ...s, status: "skipped" as const };
                  return s;
                }),
              }));
              break;
            }
          } catch (err) {
            if (controller.signal.aborted) return;
            const elapsed = Date.now() - startTime;

            setState((prev) => ({
              ...prev,
              phase: "failed",
              executionSteps: prev.executionSteps.map((s) => {
                if (s.index === stepIndex) {
                  return {
                    ...s,
                    status: "failed" as const,
                    error: err instanceof Error ? err.message : "Unknown error",
                    errorCode: "network_error",
                    resolvedParams,
                    completedAt: Date.now(),
                    durationMs: elapsed,
                  };
                }
                if (s.index > stepIndex) return { ...s, status: "skipped" as const };
                return s;
              }),
            }));
            break;
          }
        }

        // Small pause between steps for visual effect
        if (i < plan.steps.length - 1) {
          await sleep(300);
        }
      }

      // ── Step 4: Finalize ──
      if (!controller.signal.aborted) {
        setState((prev) => {
          const allCompleted = prev.executionSteps.every((s) => s.status === "completed");
          return {
            ...prev,
            phase: allCompleted ? "completed" : prev.phase === "failed" ? "failed" : "completed",
            activeStepIndex: null,
            completedAt: Date.now(),
            totalDurationMs: Date.now() - (prev.startedAt || Date.now()),
          };
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setState((prev) => ({
          ...prev,
          phase: "failed",
        }));
      }
    }
  }, []);

  /** Handle step click in left panel */
  const handleStepClick = useCallback((stepIndex: number) => {
    setState((prev) => ({
      ...prev,
      selectedNodeId: `step-${stepIndex}`,
    }));
  }, []);

  /** Handle node click on canvas */
  const handleNodeClick = useCallback((stepIndex: number) => {
    setState((prev) => ({
      ...prev,
      selectedNodeId: `step-${stepIndex}`,
    }));
  }, []);

  /** Handle canvas background click */
  const handleCanvasClick = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedNodeId: null,
    }));
  }, []);

  /** Close inspector */
  const handleInspectorClose = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedNodeId: null,
    }));
  }, []);

  // Derive inspected step from selectedNodeId
  const inspectedStep = state.selectedNodeId
    ? state.executionSteps.find((s) => `step-${s.index}` === state.selectedNodeId) || null
    : null;

  return (
    <div className="cc-root" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Left Panel — 38% */}
      <div style={{ width: "38%", minWidth: 340, maxWidth: 480, flexShrink: 0 }}>
        <LeftPanel
          state={state}
          onSubmit={handleSubmit}
          onStepClick={handleStepClick}
          prompt={prompt}
          setPrompt={setPrompt}
        />
      </div>

      {/* Right Canvas — 62% */}
      <div style={{ flex: 1, position: "relative" }}>
        <RightCanvas
          executionSteps={state.executionSteps}
          planSteps={state.plan?.steps || []}
          selectedNodeId={state.selectedNodeId}
          activeStepIndex={state.activeStepIndex}
          onNodeClick={handleNodeClick}
          onCanvasClick={handleCanvasClick}
          inspectedStep={inspectedStep}
          catalogTools={catalogTools}
          onInspectorClose={handleInspectorClose}
          phase={state.phase}
        />
      </div>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

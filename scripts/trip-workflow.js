/**
 * Trip skill workflow: outbound → return → plan → hotels (strict priority).
 */
const WORKFLOW_ORDER = ["outbound", "return", "plan", "hotels"];

const PHASE_LABELS = {
  outbound: "1. 确认去程航班",
  return: "2. 确认返程航班",
  plan: "3. 确认旅行计划（Plan A / Plan B …）",
  hotels: "4. 确认酒店",
};

function normalizeWorkflow(raw) {
  const w = raw?.workflow || {};
  const confirmed = w.confirmed || {};
  return {
    priorityOrder: Array.isArray(w.priorityOrder) ? w.priorityOrder : WORKFLOW_ORDER,
    confirmed: {
      outbound: confirmed.outbound === true,
      return: confirmed.return === true,
      plan: confirmed.plan || null,
      hotels: confirmed.hotels === true,
    },
  };
}

function inferOutboundConfirmed(trip) {
  if (trip?.workflow?.confirmed?.outbound === true) return true;
  return !!trip?.bookedOutbound;
}

function inferPlanConfirmed(trip) {
  const explicit = trip?.workflow?.confirmed?.plan;
  if (typeof explicit === "string" && explicit) return explicit;
  return null;
}

function resolveWorkflowState(trip) {
  const workflow = normalizeWorkflow(trip);
  const state = {
    outbound: inferOutboundConfirmed(trip) || workflow.confirmed.outbound,
    return: workflow.confirmed.return || !!trip?.bookedReturn,
    plan: inferPlanConfirmed(trip),
    hotels: workflow.confirmed.hotels,
  };

  let currentPhase = "outbound";
  if (state.outbound) currentPhase = "return";
  if (state.outbound && state.return) currentPhase = "plan";
  if (state.outbound && state.return && state.plan) currentPhase = "hotels";
  if (state.outbound && state.return && state.plan && state.hotels) {
    currentPhase = "done";
  }

  return { workflow, state, currentPhase };
}

function phaseIndex(name) {
  return WORKFLOW_ORDER.indexOf(name);
}

function assertPhaseGate(trip, requiredPhase) {
  const { state, currentPhase } = resolveWorkflowState(trip);
  const requiredIdx = phaseIndex(requiredPhase);
  const currentIdx = currentPhase === "done" ? WORKFLOW_ORDER.length : phaseIndex(currentPhase);

  if (requiredIdx > currentIdx) {
    const need = PHASE_LABELS[currentPhase] || currentPhase;
    const ask = PHASE_LABELS[requiredPhase] || requiredPhase;
    throw new Error(
      `Workflow gate: 当前应完成「${need}」，不能执行「${ask}」。请在 config/trip-profile.json → workflow.confirmed 中确认上一阶段。`
    );
  }
  return { state, currentPhase };
}

function renderWorkflowStatus(trip) {
  const { state, currentPhase } = resolveWorkflowState(trip);
  const lines = ["## 决策优先级（Skill 执行顺序）", ""];
  const scopes = {
    outbound: "查去程 TOP3 → 写入 bookedOutbound",
    return: "查返程 TOP3 · **纯机票评分**（多机场比价，不看 D8 行程）",
    plan: "Plan A/B 卡片 + itineraryConstraints 衔接提示",
    hotels: "按 activeVariant 查酒店",
  };
  for (const key of WORKFLOW_ORDER) {
    const done =
      key === "outbound"
        ? state.outbound
        : key === "return"
          ? state.return
          : key === "plan"
            ? !!state.plan
            : state.hotels;
    const mark = done ? "✅" : currentPhase === key ? "👉" : "⬜";
    let extra = "";
    if (key === "plan" && state.plan) extra = `（${state.plan}）`;
    lines.push(`${mark} ${PHASE_LABELS[key]}${extra}`);
  }
  if (currentPhase === "done") {
    lines.push("", "> 全部阶段已确认，可按需刷新酒店/航班。");
  } else {
    lines.push("", `> **当前阶段：** ${PHASE_LABELS[currentPhase] || currentPhase}`);
    if (scopes[currentPhase]) lines.push(`> **本阶段范围：** ${scopes[currentPhase]}`);
  }
  return lines.join("\n") + "\n";
}

module.exports = {
  WORKFLOW_ORDER,
  PHASE_LABELS,
  normalizeWorkflow,
  resolveWorkflowState,
  assertPhaseGate,
  renderWorkflowStatus,
};

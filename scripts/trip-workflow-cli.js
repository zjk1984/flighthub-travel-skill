#!/usr/bin/env node
/**
 * CLI: trip workflow status / gates
 *   node trip-workflow.js status
 *   node trip-workflow.js current
 *   node trip-workflow.js gate <outbound|return|plan|hotels>
 */
const { loadConfig } = require("./load-monitor-config");
const {
  resolveWorkflowState,
  assertPhaseGate,
  renderWorkflowStatus,
  PHASE_LABELS,
} = require("./trip-workflow");

const cmd = process.argv[2] || "status";
const arg = process.argv[3];
const trip = loadConfig().trip || {};

try {
  if (cmd === "status") {
    process.stdout.write(renderWorkflowStatus(trip));
    process.exit(0);
  }
  if (cmd === "current") {
    const { currentPhase } = resolveWorkflowState(trip);
    process.stdout.write(String(currentPhase));
    process.exit(0);
  }
  if (cmd === "gate") {
    if (!arg) throw new Error("Usage: node trip-workflow.js gate <phase>");
    assertPhaseGate(trip, arg);
    process.stderr.write(`Workflow OK: ${PHASE_LABELS[arg] || arg}\n`);
    process.exit(0);
  }
  throw new Error(`Unknown command: ${cmd}`);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(cmd === "gate" ? 0 : 1);
}

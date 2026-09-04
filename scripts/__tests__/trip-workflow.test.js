const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveWorkflowState,
  assertPhaseGate,
  renderWorkflowStatus,
} = require("../trip-workflow");

describe("trip-workflow", () => {
  it("outbound booked → current phase is return", () => {
    const trip = {
      bookedOutbound: { route: "广州→伊宁" },
      workflow: { confirmed: { outbound: true, return: false, plan: null, hotels: false } },
    };
    const { currentPhase, state } = resolveWorkflowState(trip);
    assert.equal(state.outbound, true);
    assert.equal(currentPhase, "return");
  });

  it("blocks hotels before plan confirmed", () => {
    const trip = {
      bookedOutbound: {},
      workflow: { confirmed: { outbound: true, return: true, plan: null, hotels: false } },
    };
    assert.throws(() => assertPhaseGate(trip, "hotels"), /Plan A/);
  });

  it("renderWorkflowStatus lists four priorities", () => {
    const md = renderWorkflowStatus({ bookedOutbound: {} });
    assert.match(md, /确认去程航班/);
    assert.match(md, /确认返程航班/);
    assert.match(md, /Plan A/);
    assert.match(md, /确认酒店/);
  });
});

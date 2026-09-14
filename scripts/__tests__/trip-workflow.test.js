const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveWorkflowState,
  assertPhaseGate,
  renderWorkflowStatus,
} = require("../trip-workflow");
const { loadTripProfile } = require("../load-trip-profile");

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
    assert.throws(() => assertPhaseGate(trip, "hotels"), /确认旅行计划/);
  });

  it("renderWorkflowStatus lists four priorities", () => {
    const md = renderWorkflowStatus({ bookedOutbound: {} });
    assert.match(md, /确认去程航班/);
    assert.match(md, /确认返程航班/);
    assert.match(md, /确认旅行计划/);
    assert.match(md, /确认酒店/);
  });

  it("done + feishuTodosOnly points at phase 5 todos, not hotel refresh", () => {
    const trip = loadTripProfile({ tripProfilePath: "config/trip-profile.json" });
    const { currentPhase } = resolveWorkflowState(trip);
    assert.equal(currentPhase, "done");
    const md = renderWorkflowStatus(trip);
    assert.match(md, /阶段 5 待办运维/);
    assert.match(md, /remind:bookings/);
    assert.doesNotMatch(md, /可按需刷新酒店/);
  });
});

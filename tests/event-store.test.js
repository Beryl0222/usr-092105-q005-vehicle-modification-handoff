import assert from "node:assert/strict";
import test from "node:test";

import { EventStore } from "../src/event-store.js";
import { loadHistory, storeWithHistory } from "./helpers.js";

test("多方重报按 event_id 幂等去重", async () => {
  const [event] = await loadHistory();
  const store = new EventStore();
  assert.equal(store.append(event).status, "accepted");
  assert.equal(store.append(event).status, "duplicate");
  assert.equal(store.append({ ...event }).status, "duplicate"); // 键序不同的同一事实
  assert.equal(store.size, 1);
});

test("同一 event_id 内容不同视为标识冲突，保留原记录", async () => {
  const [event] = await loadHistory();
  const store = new EventStore();
  store.append(event);
  const tampered = structuredClone(event);
  tampered.summary = "被篡改的摘要";
  const result = store.append(tampered);
  assert.equal(result.status, "conflict");
  assert.match(result.errors[0], /事件标识冲突/);
  assert.equal(store.size, 1);
});

test("乱序到达的事件按 version 重排", async () => {
  const { store } = await storeWithHistory((events) => [...events].reverse());
  const versions = store.eventsFor("vehicle_configuration", "vehicle-rv-002").map((e) => e.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
});

test("里程节点不可变更", async () => {
  const { store } = await storeWithHistory();
  const result = store.append({
    event_id: "evt-rv002-odo-tamper",
    event_type: "ODOMETER_RECORDED",
    aggregate_type: "vehicle_configuration",
    aggregate_id: "vehicle-rv-002",
    occurred_at: "2026-05-01T09:00:00+08:00",
    version: 11,
    summary: "试图改写里程节点",
    payload: { checkpoint_id: "odo-2026-0430", mileage: 30000, unit: "km" },
  });
  assert.equal(result.status, "rejected");
  assert.match(result.errors[0], /里程节点不可变更/);
});

test("同一聚合同一版本号的不同事件记入冲突清单", async () => {
  const { store } = await storeWithHistory();
  const rival = {
    event_id: "evt-rv002-rival-v10",
    event_type: "ACCIDENT_REPAIRED",
    aggregate_type: "vehicle_configuration",
    aggregate_id: "vehicle-rv-002",
    occurred_at: "2026-06-21T10:00:00+08:00",
    version: 10,
    summary: "另一来源重报的维修记录",
    payload: { repair_id: "rep-rival", affects: ["inst-sus-01"], description: "悬架复检" },
  };
  assert.equal(store.append(rival).status, "accepted");
  const conflicts = store.conflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "version_conflict");
  assert.deepEqual(conflicts[0].event_ids.sort(), ["evt-rv002-0015", "evt-rv002-rival-v10"].sort());
});

test("缺少负载必备字段的事件被拒绝", async () => {
  const store = new EventStore();
  const result = store.append({
    event_id: "evt-bad-0001",
    event_type: "PART_INSTALLED",
    aggregate_type: "vehicle_configuration",
    aggregate_id: "vehicle-x",
    occurred_at: "2026-05-01T09:00:00+08:00",
    version: 1,
    summary: "缺少技师信息",
    payload: { installation_id: "inst-x", part_id: "part-x", cert_id: "cert-x" },
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.errors.some((e) => e.includes("technician.tech_id")));
});

import assert from "node:assert/strict";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

const base = {
  event_id: "evt-00000001",
  event_type: "PART_INSTALLED",
  aggregate_type: "vehicle_configuration",
  aggregate_id: "vehicle-x",
  occurred_at: "2026-05-01T09:00:00+08:00",
  version: 1,
  summary: "合法样例",
};

test("合法事件通过信封校验", () => {
  assert.deepEqual(validateEvent(base), []);
});

test("未知事件类型与聚合类型被拒绝", () => {
  assert.ok(validateEvent({ ...base, event_type: "MADE_UP" }).some((e) => e.includes("未知事件类型")));
  assert.ok(validateEvent({ ...base, aggregate_type: "made_up" }).some((e) => e.includes("未知聚合类型")));
});

test("非法时间与过短标识被拒绝", () => {
  assert.ok(validateEvent({ ...base, occurred_at: "不是时间" }).some((e) => e.includes("occurred_at")));
  assert.ok(validateEvent({ ...base, event_id: "short" }).some((e) => e.includes("event_id")));
});

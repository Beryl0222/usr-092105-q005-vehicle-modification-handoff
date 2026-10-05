import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

test("中文样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

const base = {
  event_id: "evt-test-0001",
  event_type: "PART_INSTALLED",
  aggregate_type: "vehicle_configuration",
  aggregate_id: "vehicle-x",
  occurred_at: "2026-05-01T10:00:00+08:00",
  version: 1,
  summary: "测试事件",
};

test("校验器拒绝未知事件类型与未知聚合类型", () => {
  assert.ok(validateEvent({ ...base, event_type: "FLY_TO_MOON" }).some((e) => e.includes("未知事件类型")));
  assert.ok(validateEvent({ ...base, aggregate_type: "mars_rover" }).some((e) => e.includes("未知聚合类型")));
});

test("校验器强制事件类型与聚合绑定", () => {
  const errors = validateEvent({ ...base, aggregate_type: "certified_part" });
  assert.ok(errors.some((e) => e.includes("应挂在 vehicle_configuration 聚合上")));
});

test("校验器检查时间、版本与摘要", () => {
  assert.ok(validateEvent({ ...base, occurred_at: "不是时间" }).some((e) => e.includes("occurred_at")));
  assert.ok(validateEvent({ ...base, version: 0 }).some((e) => e.includes("version")));
  assert.ok(validateEvent({ ...base, summary: " " }).some((e) => e.includes("summary")));
  assert.ok(validateEvent(null).some((e) => e.includes("必须是对象")));
});

test("fact_key 与 payload 若提供则须形态正确", () => {
  assert.ok(validateEvent({ ...base, fact_key: "" }).some((e) => e.includes("fact_key")));
  assert.ok(validateEvent({ ...base, payload: [] }).some((e) => e.includes("payload")));
  assert.deepEqual(validateEvent({ ...base, fact_key: "f:1", payload: {} }), []);
});

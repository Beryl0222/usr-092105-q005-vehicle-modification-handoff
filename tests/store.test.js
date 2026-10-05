import assert from "node:assert/strict";
import test from "node:test";

import { EventStore } from "../src/store.js";
import { loadScenario, VEHICLE } from "./helpers.js";

const base = {
  event_id: "evt-store-0001",
  event_type: "PART_INSTALLED",
  aggregate_type: "vehicle_configuration",
  aggregate_id: "vehicle-s",
  occurred_at: "2026-05-01T10:00:00+08:00",
  version: 1,
  summary: "安装测试部件",
};

test("同一 event_id 重试去重，内容不一致报冲突", () => {
  const store = new EventStore();
  assert.equal(store.ingest(base).status, "accepted");
  assert.equal(store.ingest(base).status, "duplicate");
  const tampered = store.ingest({ ...base, summary: "被篡改的摘要" });
  assert.equal(tampered.status, "conflict");
  assert.equal(store.size, 1);
});

test("缺字段事件被拒绝并给出中文原因", () => {
  const store = new EventStore();
  const result = store.ingest({ event_id: "evt-store-0002" });
  assert.equal(result.status, "rejected");
  assert.ok(result.errors.some((e) => e.includes("缺少字段：summary")));
});

test("多方按 fact_key 重报同一事实被去重并记录来源", () => {
  const store = new EventStore();
  const first = { ...base, event_id: "evt-store-a", fact_key: "insp:1", source: "检测站甲", payload: { n: 1 } };
  const second = { ...base, event_id: "evt-store-b", fact_key: "insp:1", source: "检测站乙", payload: { n: 1 } };
  assert.equal(store.ingest(first).status, "accepted");
  const re = store.ingest(second);
  assert.equal(re.status, "duplicate");
  assert.equal(re.alias_of, "evt-store-a");
  assert.equal(store.size, 1);
  assert.deepEqual([...store.reportersOf("evt-store-a")].sort(), ["检测站甲", "检测站乙"].sort());
});

test("fact_key 相同但负载不一致报冲突", () => {
  const store = new EventStore();
  store.ingest({ ...base, event_id: "evt-store-c", fact_key: "insp:2", payload: { n: 1 } });
  const result = store.ingest({ ...base, event_id: "evt-store-d", fact_key: "insp:2", payload: { n: 2 } });
  assert.equal(result.status, "conflict");
});

test("乱序写入后按车辆回放顺序确定", () => {
  const store = new EventStore();
  const mk = (id, at, version) => ({ ...base, event_id: id, occurred_at: at, version });
  store.ingest(mk("evt-store-late", "2026-05-03T10:00:00+08:00", 3));
  store.ingest(mk("evt-store-early", "2026-05-01T10:00:00+08:00", 1));
  store.ingest(mk("evt-store-mid", "2026-05-02T10:00:00+08:00", 2));
  assert.deepEqual(
    store.forVehicle("vehicle-s").map((e) => e.event_id),
    ["evt-store-early", "evt-store-mid", "evt-store-late"],
  );
});

test("场景数据：乱序重报与重试被正确去重", async () => {
  const scenario = await loadScenario();
  const store = new EventStore();
  const counts = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 };
  for (const event of scenario.events) counts[store.ingest(event).status] += 1;
  assert.equal(counts.accepted, 14);
  assert.equal(counts.duplicate, 2); // 一次同 event_id 重试，一次跨来源 fact_key 重报
  assert.equal(counts.conflict, 0);
  assert.equal(counts.rejected, 0);
  assert.equal(store.size, 14);
  assert.deepEqual(store.reportersOf("evt-rv-001-insp").sort(), ["检测站甲", "检测站甲-备份系统"]);
  assert.ok(store.forVehicle(VEHICLE).length > 0);
});

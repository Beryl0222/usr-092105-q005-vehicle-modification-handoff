import assert from "node:assert/strict";
import test from "node:test";

import { configurationAtCheckpoint, projectConfiguration } from "../src/configuration.js";
import { EventStore } from "../src/event-store.js";
import { storeWithHistory, VEHICLE } from "./helpers.js";

test("乱序重放后当前配置与里程节点快照一致", async () => {
  const { store } = await storeWithHistory((events) => [...events].reverse());
  const state = projectConfiguration(store, VEHICLE);
  const active = [...state.installations.values()].filter((i) => i.status === "active");
  assert.deepEqual(
    active.map((i) => i.installation_id).sort(),
    ["inst-ele-01", "inst-kit-01", "inst-sus-01"],
  );
  assert.equal(state.checkpoints.length, 1);
  assert.equal(state.checkpoints[0].mileage, 45230);
  assert.deepEqual(state.checkpoints[0].active_installation_ids.sort(), ["inst-ele-01", "inst-kit-01", "inst-sus-01"]);
  assert.equal(state.transfers.length, 2);
  assert.equal(state.repairs.length, 2);

  const snapshot = configurationAtCheckpoint(store, VEHICLE, "odo-2026-0430");
  assert.equal(snapshot.installations.length, 3);
  assert.equal(configurationAtCheckpoint(store, VEHICLE, "odo-unknown"), null);
});

test("替换、拆除与复原沿演化链正确闭合安装组合", () => {
  const store = new EventStore();
  const base = { aggregate_type: "vehicle_configuration", aggregate_id: "vehicle-x" };
  const install = (event_id, version, installation_id, part_id) => ({
    ...base,
    event_id,
    version,
    event_type: "PART_INSTALLED",
    occurred_at: `2026-05-0${version}T09:00:00+08:00`,
    summary: `安装 ${installation_id}`,
    payload: {
      installation_id,
      part_id,
      cert_id: `cert-${part_id}`,
      technician: { tech_id: "tech-1", qualification: "资质" },
      work: { shop: "工坊", description: "安装" },
    },
  });
  store.append(install("evt-x-0001", 1, "inst-1", "part-1"));
  store.append(install("evt-x-0002", 2, "inst-2", "part-2"));
  store.append({
    ...base,
    event_id: "evt-x-0003",
    version: 3,
    event_type: "PART_REPLACED",
    occurred_at: "2026-05-03T09:00:00+08:00",
    summary: "inst-1 被 inst-3 替换",
    payload: {
      replaces_installation_id: "inst-1",
      installation_id: "inst-3",
      part_id: "part-3",
      cert_id: "cert-part-3",
      technician: { tech_id: "tech-1", qualification: "资质" },
      work: { shop: "工坊", description: "换装" },
    },
  });
  store.append({
    ...base,
    event_id: "evt-x-0004",
    version: 4,
    event_type: "PART_REMOVED",
    occurred_at: "2026-05-04T09:00:00+08:00",
    summary: "拆除 inst-2",
    payload: { installation_id: "inst-2", reason: "车主自主要求" },
  });
  store.append({
    ...base,
    event_id: "evt-x-0005",
    version: 5,
    event_type: "CONFIGURATION_RESTORED",
    occurred_at: "2026-05-05T09:00:00+08:00",
    summary: "复原 inst-3",
    payload: { installation_ids: ["inst-3"], reason: "出售前复原" },
  });

  const state = projectConfiguration(store, "vehicle-x");
  assert.equal(state.installations.get("inst-1").status, "replaced");
  assert.equal(state.installations.get("inst-2").status, "removed");
  assert.equal(state.installations.get("inst-3").status, "restored");
  assert.equal([...state.installations.values()].filter((i) => i.status === "active").length, 0);
});

test("里程回退被记为事实异常而非静默接受", () => {
  const store = new EventStore();
  const base = { aggregate_type: "vehicle_configuration", aggregate_id: "vehicle-y", event_type: "ODOMETER_RECORDED" };
  store.append({
    ...base,
    event_id: "evt-y-0001",
    version: 1,
    occurred_at: "2026-05-01T09:00:00+08:00",
    summary: "里程节点一",
    payload: { checkpoint_id: "cp-1", mileage: 50000 },
  });
  store.append({
    ...base,
    event_id: "evt-y-0002",
    version: 2,
    occurred_at: "2026-06-01T09:00:00+08:00",
    summary: "里程节点二（回退）",
    payload: { checkpoint_id: "cp-2", mileage: 40000 },
  });
  const state = projectConfiguration(store, "vehicle-y");
  assert.equal(state.anomalies.length, 1);
  assert.equal(state.anomalies[0].type, "odometer_regression");
});

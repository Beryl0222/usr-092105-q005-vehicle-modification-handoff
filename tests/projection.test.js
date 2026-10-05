import assert from "node:assert/strict";
import test from "node:test";

import { buildPartRegistry, buildVehicleTimeline, configurationAt, snapshotOf } from "../src/projection.js";
import { loadScenario, VEHICLE, AS_OF } from "./helpers.js";

test("围绕不可变里程节点重建当前配置", async () => {
  const scenario = await loadScenario();
  const timeline = buildVehicleTimeline(scenario.events, VEHICLE);

  assert.deepEqual(
    timeline.nodes.map((n) => n.odometer_km),
    [42000, 42500, 43000, 45000, 45200, 45800, 45900, 46500],
  );
  assert.deepEqual([...timeline.current_parts.keys()].sort(), ["part-body-01", "part-elec-01", "part-susp-01"]);

  // 复原拆除后、新改装前的节点：在装部件为空
  assert.deepEqual(configurationAt(timeline, 43000).parts, []);
  // 电气安装完成、外观套件未装时的配置
  assert.deepEqual(
    configurationAt(timeline, 45200).parts.map((p) => p.part_id).sort(),
    ["part-elec-01", "part-susp-01"],
  );
  // 首个节点之前没有配置记录
  assert.equal(configurationAt(timeline, 41000), null);

  const removal = timeline.removals.find((r) => r.part_id === "part-exold-01");
  assert.equal(removal.reason, "复原");
});

test("乱序重报不影响重建结果", async () => {
  const scenario = await loadScenario();
  const forward = buildVehicleTimeline(scenario.events, VEHICLE);
  const reversed = buildVehicleTimeline([...scenario.events].reverse(), VEHICLE);
  assert.deepEqual(snapshotOf(reversed), snapshotOf(forward));
});

test("零部件注册表还原认证与证书状态", async () => {
  const scenario = await loadScenario();
  const registry = buildPartRegistry(scenario.events);
  assert.equal(registry.statusOf("cert-susp-01", AS_OF), "有效");
  assert.equal(registry.statusOf("cert-unknown", AS_OF), "未知");
  assert.equal(registry.partOf("part-elec-01").category, "电气");

  const revoked = [
    ...scenario.events,
    {
      event_id: "evt-rv-001-rev-body",
      event_type: "CERTIFICATE_REVOKED",
      aggregate_type: "certified_part",
      aggregate_id: "part-body-01",
      occurred_at: "2026-05-10T09:00:00+08:00",
      version: 2,
      summary: "外观套件证书被认证机构撤销",
      payload: { certificate_id: "cert-body-01", reason: "抽检不合格", revoked_at: "2026-05-09" },
    },
  ];
  const after = buildPartRegistry(revoked);
  assert.equal(after.statusOf("cert-body-01", AS_OF), "已撤销");
  assert.equal(after.certificateOf("cert-body-01").revoked.event_id, "evt-rv-001-rev-body");
});

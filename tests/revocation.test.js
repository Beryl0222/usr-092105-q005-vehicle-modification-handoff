import assert from "node:assert/strict";
import test from "node:test";

import { createPlatform } from "../src/platform.js";
import { loadScenario, VEHICLE, AS_OF } from "./helpers.js";

const REVOCATION = {
  event_id: "evt-rv-001-rev-body",
  event_type: "CERTIFICATE_REVOKED",
  aggregate_type: "certified_part",
  aggregate_id: "part-body-01",
  occurred_at: "2026-05-10T09:00:00+08:00",
  version: 2,
  summary: "外观套件证书被认证机构撤销",
  payload: { certificate_id: "cert-body-01", reason: "抽检不合格", revoked_at: "2026-05-09" },
};

test("证书撤销命中具体安装组合", async () => {
  const scenario = await loadScenario();
  const platform = createPlatform();
  platform.ingestAll(scenario.events);
  platform.ingest(REVOCATION);

  const impact = platform.revocationImpact("cert-body-01");
  assert.equal(impact.affected.length, 1);
  const hit = impact.affected[0];
  assert.equal(hit.vehicle_id, VEHICLE);
  assert.equal(hit.status, "待核验");
  // 命中与外观套件同时在装的悬架、电气组合；已复原拆除的旧排气不被牵连
  assert.deepEqual(hit.combination, ["part-body-01", "part-elec-01", "part-susp-01"]);
  assert.ok(!hit.combination.includes("part-exold-01"));
  assert.ok(hit.evidence.includes("evt-rv-001-inst-body"));

  // 撤销后该部件进入待核验范围
  const items = platform.assess(VEHICLE, { asOf: "2026-05-11T00:00:00+08:00" });
  assert.ok(items.some((i) => i.code === "CERTIFICATE_NOT_VALID" && i.parts.includes("part-body-01")));
});

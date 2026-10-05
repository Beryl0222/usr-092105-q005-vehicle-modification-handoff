import assert from "node:assert/strict";
import test from "node:test";

import { ALL_LINKS, assessPendingScope, DISCLAIMER, findRevocationImpacts, revocationReport } from "../src/compliance.js";
import { AS_OF, storeWithHistory, VEHICLE } from "./helpers.js";

test("评估只给出待核验范围，并逐项标注证据状态", async () => {
  const { store } = await storeWithHistory();
  const scope = assessPendingScope(store, VEHICLE, { asOf: AS_OF });

  assert.equal(scope.nature, "待核验范围");
  assert.equal(scope.disclaimer, DISCLAIMER);
  assert.equal(scope.items.length, 3);

  const byInstallation = new Map(scope.items.map((item) => [item.installation_id, item]));

  const suspension = byInstallation.get("inst-sus-01");
  assert.equal(suspension.status, "待核验");
  assert.deepEqual(suspension.pending, ["施工和标定：缺少施工后的标定记录"]);
  assert.equal(suspension.links.inspection.status, "已收录");
  assert.equal(suspension.links.registration_notice.status, "已收录");

  const electrical = byInstallation.get("inst-ele-01");
  assert.equal(electrical.status, "证据已收录");
  assert.deepEqual(electrical.pending, []);
  for (const key of ALL_LINKS) assert.equal(electrical.links[key].status, "已收录", key);

  const bodykit = byInstallation.get("inst-kit-01");
  assert.equal(bodykit.status, "待核验");
  assert.equal(bodykit.pending.length, 3);
  assert.ok(bodykit.pending.some((p) => p.includes("证书 cert-kit-003 已被撤销")));
  assert.ok(bodykit.pending.some((p) => p.includes("检测报告")));
  assert.ok(bodykit.pending.some((p) => p.includes("保险告知")));
  assert.deepEqual(bodykit.alerts, [
    { type: "certificate_revoked", cert_id: "cert-kit-003", revoked_event_id: "evt-rv002-0016" },
  ]);
});

test("证书撤销命中具体安装组合而非整车或零件抽象", async () => {
  const { store } = await storeWithHistory();
  // 撤销事件驱动：cert-kit-003 的撤销只命中 inst-kit-01 这一个安装组合
  const report = revocationReport(store);
  assert.equal(report.length, 1);
  assert.equal(report[0].cert_id, "cert-kit-003");
  assert.equal(report[0].revoked_event_id, "evt-rv002-0016");
  assert.deepEqual(report[0].impacts, [{ vehicle_id: VEHICLE, installation_id: "inst-kit-01", part_id: "part-bodykit-c3" }]);
  // 按证书查询在装组合：未撤销的证书同样能定位到其组合（供未来撤销时命中）
  assert.deepEqual(findRevocationImpacts(store, "cert-sus-001"), [
    { vehicle_id: VEHICLE, installation_id: "inst-sus-01", part_id: "part-suspension-a1" },
  ]);
});

test("评估时点决定证书有效期是否进入待核验", async () => {
  const { store } = await storeWithHistory();
  const future = assessPendingScope(store, VEHICLE, { asOf: "2029-01-01T00:00:00+08:00" });
  const suspension = future.items.find((item) => item.installation_id === "inst-sus-01");
  assert.ok(suspension.pending.some((p) => p.includes("有效期")));
});

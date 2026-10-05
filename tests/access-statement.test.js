import assert from "node:assert/strict";
import test from "node:test";

import { AccessRegistry } from "../src/access.js";
import { EventStore } from "../src/event-store.js";
import { generateHandoffStatement, STATEMENT_DISCLAIMER } from "../src/statement.js";
import { AS_OF, loadHistory, VEHICLE } from "./helpers.js";

async function buildUpToSecondTransfer() {
  const events = await loadHistory();
  const store = new EventStore();
  const access = new AccessRegistry(store);

  // 王某持有期间：灌入到第二次转移之前的全部事件
  for (const event of events.filter((e) => e.event_id !== "evt-rv002-0017")) store.append(event);
  const grantWang = access.grantRemoteAccess("王某", VEHICLE);
  assert.equal(grantWang.granted, true);
  assert.equal(access.canAccess("王某", VEHICLE), true);
  assert.equal(access.grantRemoteAccess("李某", VEHICLE).granted, false);

  // 所有权转移事件到达：权限随即切换
  store.append(events.find((e) => e.event_id === "evt-rv002-0017"));
  return { store, access };
}

test("所有权转移是权限切换点：旧车主随即失去远程访问", async () => {
  const { access } = await buildUpToSecondTransfer();
  assert.equal(access.currentOwner(VEHICLE), "李某");
  assert.equal(access.canAccess("王某", VEHICLE), false);
  assert.equal(access.grantRemoteAccess("王某", VEHICLE).granted, false);
  assert.equal(access.grantRemoteAccess("李某", VEHICLE).granted, true);
  assert.equal(access.canAccess("李某", VEHICLE), true);
});

test("新车主取得可追溯的当前配置说明", async () => {
  const { store, access } = await buildUpToSecondTransfer();
  access.grantRemoteAccess("李某", VEHICLE);
  const statement = generateHandoffStatement(store, access, VEHICLE, "李某", { asOf: AS_OF });

  assert.equal(statement.nature, "当前配置说明");
  assert.equal(statement.disclaimer, STATEMENT_DISCLAIMER);
  assert.equal(statement.owner, "李某");
  assert.equal(statement.items.length, 3);

  const byInstallation = new Map(statement.items.map((item) => [item.installation_id, item]));
  const electrical = byInstallation.get("inst-ele-01");
  // 每项结论都能回到安装、复检和登记依据
  assert.equal(electrical.basis.installation, "evt-rv002-0006");
  assert.equal(electrical.basis.calibration, "evt-rv002-0008");
  assert.equal(electrical.basis.inspection, "evt-rv002-0011");
  assert.equal(electrical.basis.registration, "evt-rv002-0012");
  assert.equal(electrical.basis.insurance, "evt-rv002-0013");

  const bodykit = byInstallation.get("inst-kit-01");
  assert.equal(bodykit.certificate.revoked, true);
  assert.ok(bodykit.pending.length > 0);

  // 最小披露：只含与当前在装组合相关的维修，无关维修不出现
  assert.deepEqual(
    statement.related_repairs.map((r) => r.repair_id),
    ["rep-2026-0601"],
  );
  assert.ok(!JSON.stringify(statement).includes("保险杠"));

  // 所有权链与历史摘要可核对，但不展开无关细节
  assert.equal(statement.latest_transfer.event_id, "evt-rv002-0017");
  assert.equal(statement.latest_transfer.to_owner, "李某");
  assert.equal(statement.history_digest.checkpoint_count, 1);
  assert.equal(statement.history_digest.head_event_id, "evt-rv002-0017");
});

test("旧车主与他人无法获取配置说明", async () => {
  const { store, access } = await buildUpToSecondTransfer();
  assert.ok(generateHandoffStatement(store, access, VEHICLE, "王某").error);
  assert.ok(generateHandoffStatement(store, access, VEHICLE, "无关人员").error);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createPlatform } from "../src/platform.js";
import { loadScenario, VEHICLE, AS_OF } from "./helpers.js";

async function platformAfterTransfer() {
  const scenario = await loadScenario();
  const platform = createPlatform();
  platform.access.grant(VEHICLE, "owner-1", "remote_view", "evt-seed-purchase");
  platform.ingestAll(scenario.events);
  return platform;
}

test("新车主取得可回溯的当前配置说明，且不泄露无关维修信息", async () => {
  const platform = await platformAfterTransfer();

  const denied = platform.issueHandoffStatement(VEHICLE, "owner-1", { asOf: AS_OF });
  assert.ok(denied.error.includes("无权"), "旧车主不应再能获取交接说明");

  const statement = platform.issueHandoffStatement(VEHICLE, "owner-2", { asOf: AS_OF });
  assert.equal(statement.statement_type, "当前配置说明");
  assert.equal(statement.mileage_node, 46500);
  assert.equal(statement.items.length, 3);

  // 每项结论都能回到安装、复检和登记依据
  const susp = statement.items.find((i) => i.part_id === "part-susp-01");
  assert.equal(susp.installation.event_id, "evt-rv-001-inst-susp");
  assert.equal(susp.installation.technician.name, "甲某");
  assert.ok(susp.inspections.some((i) => i.event_id === "evt-rv-001-insp"));
  assert.ok(susp.registration_refs.includes("evt-rv-001-reg"));
  assert.ok(susp.insurance_refs.includes("evt-rv-001-ins"));
  assert.equal(susp.certificate.status, "有效");
  assert.ok(susp.repair_refs.includes("evt-rv-001-rep-susp"), "与当前悬架相关的事故维修应可追溯");

  for (const item of statement.items) {
    assert.ok(statement.provenance.event_ids.includes(item.installation.event_id));
  }
  // 待核验范围随说明一并交付
  assert.ok(statement.pending_verification.some((i) => i.code === "COMBINATION_UNVERIFIED"));

  // 最小披露：已复原拆除的旧部件及其维修信息不出现在说明中
  const text = JSON.stringify(statement);
  assert.ok(!text.includes("part-exold-01"));
  assert.ok(!text.includes("evt-rv-001-rep-old"));
  assert.ok(!text.includes("旧排气"));
  assert.ok(statement.privacy_note.includes("无关维修信息"));
  assert.ok(statement.disclaimer.includes("不构成检测或登记机关的结论"));
});

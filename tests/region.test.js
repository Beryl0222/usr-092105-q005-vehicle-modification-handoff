import assert from "node:assert/strict";
import test from "node:test";

import { createPlatform } from "../src/platform.js";
import { stableStringify } from "../src/util.js";
import { loadScenario, VEHICLE, AS_OF } from "./helpers.js";

const RULES = {
  region: "某市",
  rule_version: "2026-07",
  requirements: [
    { rule_id: "R-SUSP-CERT", description: "悬架部件须持有效认证", applies_to_category: "悬架", evidence_required: "valid_certificate" },
    { rule_id: "R-COMBO-INSP", description: "多部件组合须整体检测", evidence_required: "joint_inspection" },
    { rule_id: "R-BODY-REG", description: "外观套件须登记告知", applies_to_category: "外观套件", evidence_required: "registration_notice" },
  ],
};

test("跨地区按当地现行规则评估未来状态，历史不被抹掉", async () => {
  const scenario = await loadScenario();
  const platform = createPlatform();
  platform.ingestAll(scenario.events);

  const historyBefore = stableStringify(platform.store.all());
  const sizeBefore = platform.store.size;

  const view = platform.evaluateRegion(VEHICLE, RULES, { asOf: AS_OF });
  const byRule = Object.fromEntries(view.results.map((r) => [r.rule_id, r]));

  assert.equal(byRule["R-SUSP-CERT"].evidence_status, "已有证据");
  assert.equal(byRule["R-COMBO-INSP"].evidence_status, "待补充核验");
  assert.equal(byRule["R-BODY-REG"].evidence_status, "待补充核验");
  assert.ok(view.evaluates.includes("未来"));
  assert.ok(view.disclaimer.includes("不构成检测或登记机关的结论"));

  // 评估是只读视图：历史事件一条不少、一字不改
  assert.equal(platform.store.size, sizeBefore);
  assert.equal(stableStringify(platform.store.all()), historyBefore);
});

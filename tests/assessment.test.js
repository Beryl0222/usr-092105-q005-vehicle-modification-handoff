import assert from "node:assert/strict";
import test from "node:test";

import { createPlatform } from "../src/platform.js";
import { loadScenario, VEHICLE, AS_OF } from "./helpers.js";

async function platformWithScenario() {
  const scenario = await loadScenario();
  const platform = createPlatform();
  platform.ingestAll(scenario.events);
  return platform;
}

test("三家工坊部件组合无整体检测时圈出待核验范围", async () => {
  const platform = await platformWithScenario();
  const items = platform.assess(VEHICLE, { asOf: AS_OF });

  const combination = items.find((i) => i.code === "COMBINATION_UNVERIFIED");
  assert.ok(combination, "应圈出组合待核验范围");
  assert.deepEqual(combination.parts, ["part-body-01", "part-elec-01", "part-susp-01"]);
  assert.ok(combination.evidence.includes("evt-rv-001-inst-susp"));

  // 外观套件未见登记告知；电气与外观套件安装后无检测覆盖
  assert.ok(items.some((i) => i.code === "REGISTRATION_NOTICE_MISSING" && i.parts.includes("part-body-01")));
  assert.ok(items.some((i) => i.code === "INSPECTION_COVERAGE_MISSING" && i.parts.includes("part-elec-01")));
  assert.ok(items.some((i) => i.code === "INSPECTION_COVERAGE_MISSING" && i.parts.includes("part-body-01")));

  // 证书各自有效、标定齐全、保险告知完整：不应误报
  assert.ok(!items.some((i) => i.code === "CERTIFICATE_NOT_VALID"));
  assert.ok(!items.some((i) => i.code === "CALIBRATION_MISSING"));
  assert.ok(!items.some((i) => i.code === "INSURANCE_NOTICE_MISSING"));

  // 平台只提示待核验，不冒充检测或登记机关下结论
  for (const item of items) {
    assert.ok(item.note.includes("不构成检测或登记机关的结论"));
    assert.ok(!JSON.stringify(item).includes("合格"));
  }
});

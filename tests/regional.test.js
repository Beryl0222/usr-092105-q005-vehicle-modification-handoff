import assert from "node:assert/strict";
import test from "node:test";

import { ALL_LINKS } from "../src/compliance.js";
import { assessForRegion } from "../src/regional.js";
import { AS_OF, storeWithHistory, VEHICLE } from "./helpers.js";

const STRICT = {
  region: "甲省",
  rule_version: "2026-07",
  effective_from: "2026-07-01",
  required_links: ALL_LINKS,
};

const LENIENT = {
  region: "乙区",
  rule_version: "2026-01",
  effective_from: "2026-01-01",
  required_links: ["identity_certification", "technician", "work_calibration"],
};

test("同一车辆按不同地区现行规则得到不同待核验范围", async () => {
  const { store } = await storeWithHistory();

  const strict = assessForRegion(store, VEHICLE, STRICT, { asOf: AS_OF });
  assert.equal(strict.region, "甲省");
  assert.equal(strict.rule_version, "2026-07");
  const strictKit = strict.items.find((item) => item.installation_id === "inst-kit-01");
  assert.equal(strictKit.pending.length, 3); // 撤销 + 检测 + 保险

  const lenient = assessForRegion(store, VEHICLE, LENIENT, { asOf: AS_OF });
  const lenientKit = lenient.items.find((item) => item.installation_id === "inst-kit-01");
  assert.equal(lenientKit.pending.length, 1); // 仅证书撤销
  assert.equal(lenientKit.links.inspection, undefined);
  assert.equal(lenientKit.links.insurance_notice, undefined);
});

test("跨地区评估不抹掉历史：事件与既有事实保持不变", async () => {
  const { store } = await storeWithHistory();
  const before = store.allEvents();
  assessForRegion(store, VEHICLE, STRICT, { asOf: AS_OF });
  assessForRegion(store, VEHICLE, LENIENT, { asOf: "2030-01-01T00:00:00+08:00" });
  assert.deepEqual(store.allEvents(), before);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createPlatform } from "../src/platform.js";
import { loadScenario, VEHICLE } from "./helpers.js";

test("所有权转移是权限切换点：旧主远程访问随即失效，新主获得交接权限", async () => {
  const scenario = await loadScenario();
  const platform = createPlatform();
  platform.access.grant(VEHICLE, "owner-1", "remote_view", "evt-seed-purchase");

  const beforeTransfer = scenario.events.filter((e) => e.event_id !== "evt-rv-001-transfer");
  const transfer = scenario.events.find((e) => e.event_id === "evt-rv-001-transfer");
  platform.ingestAll(beforeTransfer);

  assert.ok(platform.access.can("owner-1", VEHICLE, "remote_view"));
  assert.ok(!platform.access.can("owner-2", VEHICLE, "remote_view"));

  platform.ingest(transfer);

  assert.ok(!platform.access.can("owner-1", VEHICLE, "remote_view"), "旧车主应随即失去远程访问");
  assert.ok(platform.access.can("owner-2", VEHICLE, "remote_view"));
  assert.ok(platform.access.can("owner-2", VEHICLE, "view_handoff"));

  const revokeEntry = platform.access
    .auditLog()
    .find((e) => e.action === "revoke" && e.principal === "owner-1" && e.capability === "remote_view");
  assert.equal(revokeEntry.basis_event, "evt-rv-001-transfer");
  assert.ok(revokeEntry.reason.includes("所有权转移"));
});

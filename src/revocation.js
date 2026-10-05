import { buildVehicleTimeline } from "./projection.js";
import { compareEvents } from "./util.js";

/**
 * 证书撤销影响分析：撤销不只命中单个部件，而是命中
 * “该部件在装期间与其同车共存的具体安装组合”。
 * 已先行拆除、与受影响部件没有共存窗口的部件不被牵连。
 */
export function analyzeCertificateRevocation(events, certificateId) {
  const sorted = [...events].sort(compareEvents);
  const installs = sorted.filter((e) => e.event_type === "PART_INSTALLED" && e.payload?.certificate_id === certificateId);

  const affected = [];
  for (const install of installs) {
    const vehicleId = install.aggregate_id;
    const timeline = buildVehicleTimeline(sorted, vehicleId);
    const target = timeline.install_log.find((r) => r.event_id === install.event_id) ?? {
      part_id: install.payload.part_id,
      installed_at: install.occurred_at,
      removed: null,
    };
    const windowFrom = Date.parse(target.installed_at);
    const windowTo = target.removed ? Date.parse(target.removed.at) : null;

    const combination = new Set([target.part_id]);
    for (const record of timeline.install_log) {
      if (record.part_id === target.part_id) continue;
      const recordFrom = Date.parse(record.installed_at);
      const recordTo = record.removed ? Date.parse(record.removed.at) : null;
      const overlaps = (windowTo === null || recordFrom <= windowTo) && (recordTo === null || recordTo >= windowFrom);
      if (overlaps) combination.add(record.part_id);
    }

    const evidence = new Set([install.event_id]);
    for (const record of timeline.install_log) {
      if (combination.has(record.part_id)) evidence.add(record.event_id);
    }

    affected.push({
      vehicle_id: vehicleId,
      part_id: target.part_id,
      installation_id: install.payload?.installation_id ?? null,
      combination: [...combination].sort(),
      status: "待核验",
      reason: `证书 ${certificateId} 被撤销，命中上述同时期在装的安装组合`,
      evidence: [...evidence].sort(),
    });
  }

  return {
    certificate_id: certificateId,
    affected,
    note: "撤销影响仅按证据圈定待核验范围，不构成检测或登记机关的结论。",
  };
}

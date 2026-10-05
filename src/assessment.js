import { coversPart } from "./util.js";

/** 平台立场：只依据证据圈定待核验范围，不下检测或登记结论。 */
export const EVIDENCE_ONLY_NOTE = "本项仅依据平台已存证据提示待核验范围，不构成检测或登记机关的结论。";

/** 这些类别的部件安装后应有标定记录。 */
const CALIBRATION_CATEGORIES = new Set(["悬架", "电气", "动力"]);

function categoryOf(part, registry) {
  return part.category ?? registry.partOf(part.part_id)?.category ?? null;
}

/**
 * 依据已存证据评估车辆的待核验范围。
 * 输出永远是“需要核验什么、依据哪些事件”，永不输出合格/不合格结论。
 */
export function assessPendingVerification(timeline, registry, { asOf } = {}) {
  const items = [];
  const parts = [...timeline.current_parts.values()];

  // 组合核验：多个部件分别施工，需要一次覆盖当前组合的整体检测。
  if (parts.length >= 2) {
    const latestInstallAt = parts.map((p) => p.installed_at).sort().at(-1);
    const joint = timeline.inspections.find(
      (i) => Date.parse(i.occurred_at) >= Date.parse(latestInstallAt) && parts.every((p) => coversPart(i, p.part_id)),
    );
    if (!joint) {
      items.push({
        code: "COMBINATION_UNVERIFIED",
        scope: "当前组合配置",
        parts: parts.map((p) => p.part_id).sort(),
        reason: "改装部件来自不同施工来源，未见覆盖当前组合的整体检测记录",
        evidence: parts.map((p) => p.event_id).sort(),
        note: EVIDENCE_ONLY_NOTE,
      });
    }
  }

  for (const part of parts) {
    const certStatus = registry.statusOf(part.certificate_id, asOf);
    if (certStatus !== "有效") {
      items.push({
        code: "CERTIFICATE_NOT_VALID",
        scope: `零部件 ${part.part_id}`,
        parts: [part.part_id],
        reason: `证书 ${part.certificate_id ?? "（缺失）"} 当前状态：${certStatus}`,
        evidence: [part.event_id],
        note: EVIDENCE_ONLY_NOTE,
      });
    }

    if (CALIBRATION_CATEGORIES.has(categoryOf(part, registry)) && !part.calibration) {
      items.push({
        code: "CALIBRATION_MISSING",
        scope: `零部件 ${part.part_id}`,
        parts: [part.part_id],
        reason: `类别「${categoryOf(part, registry)}」应有标定记录，当前未见`,
        evidence: [part.event_id],
        note: EVIDENCE_ONLY_NOTE,
      });
    }

    const afterInstall = (e) => Date.parse(e.occurred_at) >= Date.parse(part.installed_at);
    if (!timeline.registrations.some((r) => afterInstall(r) && coversPart(r, part.part_id))) {
      items.push({
        code: "REGISTRATION_NOTICE_MISSING",
        scope: `零部件 ${part.part_id}`,
        parts: [part.part_id],
        reason: "未见覆盖该部件的登记告知记录",
        evidence: [part.event_id],
        note: EVIDENCE_ONLY_NOTE,
      });
    }
    if (!timeline.insurance_notices.some((r) => afterInstall(r) && coversPart(r, part.part_id))) {
      items.push({
        code: "INSURANCE_NOTICE_MISSING",
        scope: `零部件 ${part.part_id}`,
        parts: [part.part_id],
        reason: "未见覆盖该部件的保险告知记录",
        evidence: [part.event_id],
        note: EVIDENCE_ONLY_NOTE,
      });
    }
    if (!timeline.inspections.some((r) => afterInstall(r) && coversPart(r, part.part_id))) {
      items.push({
        code: "INSPECTION_COVERAGE_MISSING",
        scope: `零部件 ${part.part_id}`,
        parts: [part.part_id],
        reason: "安装后未见覆盖该部件的检测记录",
        evidence: [part.event_id],
        note: EVIDENCE_ONLY_NOTE,
      });
    }
  }

  return items;
}

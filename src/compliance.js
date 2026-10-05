import { projectConfiguration } from "./configuration.js";

/**
 * 证据链评估：系统只依据已收录证据给出“待核验范围”，
 * 不冒充检测或登记机关下任何合规结论。
 */

export const EVIDENCE_LINKS = Object.freeze([
  ["identity_certification", "零部件身份与认证"],
  ["technician", "安装技师"],
  ["work_calibration", "施工和标定"],
  ["inspection", "检测报告"],
  ["registration_notice", "登记告知"],
  ["insurance_notice", "保险告知"],
]);

export const ALL_LINKS = Object.freeze(EVIDENCE_LINKS.map(([key]) => key));

export const DISCLAIMER = "本结果仅依据已收录证据给出待核验范围，不构成检测或登记机关的结论。";

export function linkLabel(key) {
  return EVIDENCE_LINKS.find(([k]) => k === key)?.[1] ?? key;
}

function link(status, evidence = [], notes = []) {
  return { status, evidence, notes };
}

function assessIdentity(store, inst, asOf) {
  const partEvents = store.eventsFor("certified_part", inst.part_id);
  const certified = partEvents.find(
    (event) => event.event_type === "PART_CERTIFIED" && event.payload.certificate.cert_id === inst.cert_id,
  );
  const revoked = partEvents.find(
    (event) => event.event_type === "CERTIFICATE_REVOKED" && event.payload.cert_id === inst.cert_id,
  );
  const evidence = [];
  const notes = [];
  const alerts = [];
  if (!certified) {
    notes.push("缺少零部件身份与认证记录");
  } else {
    evidence.push(certified.event_id);
    const validUntil = certified.payload.certificate.valid_until;
    if (validUntil && validUntil < asOf.slice(0, 10)) {
      notes.push(`证书已超过载明有效期 ${validUntil}，有效性需核验`);
    }
  }
  if (revoked) {
    evidence.push(revoked.event_id);
    notes.push(`证书 ${inst.cert_id} 已被撤销，该安装组合需重新核验`);
    alerts.push({ type: "certificate_revoked", cert_id: inst.cert_id, revoked_event_id: revoked.event_id });
  }
  return { result: link(notes.length ? "待核验" : "已收录", evidence, notes), alerts, category: certified?.payload.category ?? null };
}

function assessTechnician(inst) {
  const tech = inst.technician ?? {};
  return tech.tech_id && tech.qualification
    ? link("已收录", [inst.installed_event_id])
    : link("待核验", [], ["缺少安装技师身份或资质信息"]);
}

function assessWorkCalibration(inst) {
  const notes = [];
  if (!inst.work?.description) notes.push("缺少施工记录");
  if (!inst.calibration) notes.push("缺少施工后的标定记录");
  const evidence = [inst.installed_event_id, inst.calibration_event_id].filter(Boolean);
  return link(notes.length ? "待核验" : "已收录", evidence, notes);
}

function latestCovering(events, installationId, installedAt) {
  const installedMs = Date.parse(installedAt);
  const covering = events
    .filter((event) => event.payload?.covers?.includes(installationId) && Date.parse(event.occurred_at) >= installedMs)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  return covering[covering.length - 1] ?? null;
}

function assessInstallation(store, state, inst, asOf, requiredLinks) {
  const links = {};
  const alerts = [];
  let category = null;

  if (requiredLinks.includes("identity_certification")) {
    const identity = assessIdentity(store, inst, asOf);
    links.identity_certification = identity.result;
    alerts.push(...identity.alerts);
    category = identity.category;
  }
  if (requiredLinks.includes("technician")) links.technician = assessTechnician(inst);
  if (requiredLinks.includes("work_calibration")) links.work_calibration = assessWorkCalibration(inst);
  if (requiredLinks.includes("inspection")) {
    const covering = latestCovering(state.inspections, inst.installation_id, inst.installed_at);
    links.inspection = covering
      ? link("已收录", [covering.event_id])
      : link("待核验", [], ["缺少覆盖该安装组合的检测报告"]);
  }
  if (requiredLinks.includes("registration_notice")) {
    const covering = latestCovering(state.notifications.registration, inst.installation_id, inst.installed_at);
    links.registration_notice = covering
      ? link("已收录", [covering.event_id])
      : link("待核验", [], ["缺少覆盖该安装组合的登记告知"]);
  }
  if (requiredLinks.includes("insurance_notice")) {
    const covering = latestCovering(state.notifications.insurance, inst.installation_id, inst.installed_at);
    links.insurance_notice = covering
      ? link("已收录", [covering.event_id])
      : link("待核验", [], ["缺少覆盖该安装组合的保险告知"]);
  }

  const pending = Object.entries(links).flatMap(([key, value]) =>
    value.notes.map((note) => `${linkLabel(key)}：${note}`),
  );
  return {
    installation_id: inst.installation_id,
    part_id: inst.part_id,
    cert_id: inst.cert_id,
    category,
    status: pending.length ? "待核验" : "证据已收录",
    links,
    pending,
    alerts,
  };
}

/**
 * 给出车辆当前配置的待核验范围。
 * options.requiredLinks 用于按地区规则裁剪评估口径；options.asOf 为评估时点。
 */
export function assessPendingScope(store, vehicleId, options = {}) {
  const asOf = options.asOf ?? new Date().toISOString();
  const requiredLinks = options.requiredLinks ?? ALL_LINKS;
  const state = projectConfiguration(store, vehicleId);
  const items = [...state.installations.values()]
    .filter((inst) => inst.status === "active")
    .map((inst) => assessInstallation(store, state, inst, asOf, requiredLinks));
  const conflicts = store
    .conflicts()
    .filter((entry) => entry.aggregate_id === vehicleId || entry.aggregate_id === `inspection:${vehicleId}`);
  return {
    vehicle_id: vehicleId,
    evaluated_at: asOf,
    nature: "待核验范围",
    disclaimer: DISCLAIMER,
    items,
    anomalies: state.anomalies,
    conflicts,
  };
}

/**
 * 证书撤销命中具体安装组合：扫描全部车辆配置，
 * 找出当前仍在装、且使用该证书的安装组合。
 */
export function findRevocationImpacts(store, certId) {
  const impacts = [];
  for (const vehicleId of store.aggregateIds("vehicle_configuration")) {
    const state = projectConfiguration(store, vehicleId);
    for (const inst of state.installations.values()) {
      if (inst.status === "active" && inst.cert_id === certId) {
        impacts.push({ vehicle_id: vehicleId, installation_id: inst.installation_id, part_id: inst.part_id });
      }
    }
  }
  return impacts;
}

/** 汇总每条撤销事件命中的安装组合。 */
export function revocationReport(store) {
  return store
    .allEvents()
    .filter((event) => event.event_type === "CERTIFICATE_REVOKED")
    .map((event) => ({
      cert_id: event.payload.cert_id,
      revoked_event_id: event.event_id,
      impacts: findRevocationImpacts(store, event.payload.cert_id),
    }));
}

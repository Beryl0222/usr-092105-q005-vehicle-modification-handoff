import { compareEvents } from "./util.js";

/** 投影前的归一化：同一 event_id 只保留首次出现，与存储层去重语义一致。 */
function dedupeByEventId(events) {
  const seen = new Set();
  return events.filter((e) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true)));
}

/**
 * 零部件注册表：从 PART_CERTIFIED / CERTIFICATE_REVOKED 事件还原
 * 每个部件的身份、认证与证书状态。证书状态只依据已存证据判定。
 */
export function buildPartRegistry(events) {
  const parts = new Map(); // part_id -> { ..., certificates: Map }
  const byCertificate = new Map(); // certificate_id -> part_id

  for (const event of dedupeByEventId([...events]).sort(compareEvents)) {
    const p = event.payload ?? {};
    if (event.event_type === "PART_CERTIFIED") {
      if (!parts.has(p.part_id)) {
        parts.set(p.part_id, {
          part_id: p.part_id,
          part_name: p.part_name ?? null,
          category: p.category ?? null,
          workshop_id: p.workshop_id ?? null,
          certificates: new Map(),
        });
      }
      parts.get(p.part_id).certificates.set(p.certificate_id, {
        certificate_id: p.certificate_id,
        certifier: p.certifier ?? null,
        valid_from: p.valid_from ?? null,
        valid_until: p.valid_until ?? null,
        conditions: p.conditions ?? [],
        certified_event_id: event.event_id,
        revoked: null,
      });
      byCertificate.set(p.certificate_id, p.part_id);
    } else if (event.event_type === "CERTIFICATE_REVOKED") {
      const partId = byCertificate.get(p.certificate_id) ?? (parts.has(event.aggregate_id) ? event.aggregate_id : null);
      const cert = partId ? parts.get(partId).certificates.get(p.certificate_id) : null;
      if (cert) {
        cert.revoked = { event_id: event.event_id, revoked_at: p.revoked_at ?? event.occurred_at, reason: p.reason ?? "" };
      }
    }
  }

  const registry = {
    parts,
    byCertificate,
    partOf: (partId) => parts.get(partId) ?? null,
    certificateOf(certificateId) {
      const partId = byCertificate.get(certificateId);
      return partId ? parts.get(partId)?.certificates.get(certificateId) ?? null : null;
    },
    /** 证书状态：有效 / 已撤销 / 已过期 / 未知（平台无此证书记录）。 */
    statusOf(certificateId, asOf) {
      const cert = registry.certificateOf(certificateId);
      if (!cert) return "未知";
      if (cert.revoked) return "已撤销";
      if (asOf && cert.valid_until && Date.parse(cert.valid_until) < Date.parse(asOf)) return "已过期";
      return "有效";
    },
  };
  return registry;
}

/**
 * 围绕不可变里程节点重建车辆配置演化链。
 * 每个携带 odometer_km 的车辆事件落成一个节点，节点记录落点时刻的
 * 在装部件集合；节点只增不改，历史不会被抹掉。
 */
export function buildVehicleTimeline(events, vehicleId) {
  const sorted = dedupeByEventId([...events])
    .filter((e) => e.aggregate_id === vehicleId || e.payload?.vehicle_id === vehicleId)
    .sort(compareEvents);

  const current = new Map(); // part_id -> 安装记录
  const installLog = []; // 全部安装记录（含已拆除）
  const nodes = [];
  const timeline = {
    vehicle_id: vehicleId,
    nodes,
    install_log: installLog,
    current_parts: current,
    removals: [],
    repairs: [],
    inspections: [],
    registrations: [],
    insurance_notices: [],
    ownership_transfers: [],
  };

  const recordNode = (event) => {
    if (typeof event.payload?.odometer_km !== "number") return;
    nodes.push(
      Object.freeze({
        odometer_km: event.payload.odometer_km,
        at: event.occurred_at,
        event_id: event.event_id,
        event_type: event.event_type,
        installed_part_ids: [...current.keys()],
      }),
    );
  };

  for (const event of sorted) {
    const p = event.payload ?? {};
    switch (event.event_type) {
      case "PART_INSTALLED": {
        const record = {
          installation_id: p.installation_id ?? null,
          part_id: p.part_id,
          part_name: p.part_name ?? null,
          category: p.category ?? null,
          certificate_id: p.certificate_id ?? null,
          workshop_id: p.workshop_id ?? null,
          technician: p.technician ?? null,
          calibration: p.calibration ?? null,
          odometer_km: p.odometer_km ?? null,
          installed_at: event.occurred_at,
          event_id: event.event_id,
          removed: null,
        };
        current.set(p.part_id, record);
        installLog.push(record);
        recordNode(event);
        break;
      }
      case "PART_REMOVED": {
        const record = current.get(p.part_id) ?? installLog.find((r) => r.part_id === p.part_id && !r.removed) ?? null;
        const removal = {
          event_id: event.event_id,
          part_id: p.part_id,
          reason: p.reason ?? null, // 替换 / 拆除 / 复原
          at: event.occurred_at,
          odometer_km: p.odometer_km ?? null,
        };
        if (record) record.removed = removal;
        current.delete(p.part_id);
        timeline.removals.push(removal);
        recordNode(event);
        break;
      }
      case "ACCIDENT_REPAIR_RECORDED":
        timeline.repairs.push(event);
        recordNode(event);
        break;
      case "CONFIGURATION_INSPECTED":
        timeline.inspections.push(event);
        break;
      case "REGISTRATION_UPDATED":
        timeline.registrations.push(event);
        recordNode(event);
        break;
      case "INSURANCE_NOTIFIED":
        timeline.insurance_notices.push(event);
        break;
      case "OWNERSHIP_TRANSFERRED":
        timeline.ownership_transfers.push(event);
        break;
      default:
        break;
    }
  }
  timeline.nodes = Object.freeze(nodes);
  return timeline;
}

/** 查询某一里程节点的在装配置：节点快照 + 可回溯的安装记录。 */
export function configurationAt(timeline, odometerKm) {
  const candidates = timeline.nodes.filter((n) => n.odometer_km <= odometerKm);
  if (candidates.length === 0) return null;
  const node = candidates.reduce((a, b) => (b.odometer_km > a.odometer_km || (b.odometer_km === a.odometer_km && b.at > a.at) ? b : a));
  const parts = node.installed_part_ids
    .map((partId) =>
      timeline.install_log.find(
        (r) => r.part_id === partId && r.installed_at <= node.at && (!r.removed || r.removed.at > node.at),
      ),
    )
    .filter(Boolean);
  return { node, parts };
}

/** 可序列化的确定性快照，用于乱序回放一致性比对。 */
export function snapshotOf(timeline) {
  return {
    vehicle_id: timeline.vehicle_id,
    nodes: timeline.nodes,
    install_log: timeline.install_log,
    current_part_ids: [...timeline.current_parts.keys()].sort(),
    removals: timeline.removals,
    repair_event_ids: timeline.repairs.map((e) => e.event_id),
    inspection_event_ids: timeline.inspections.map((e) => e.event_id),
    registration_event_ids: timeline.registrations.map((e) => e.event_id),
    insurance_event_ids: timeline.insurance_notices.map((e) => e.event_id),
    ownership_transfer_event_ids: timeline.ownership_transfers.map((e) => e.event_id),
  };
}

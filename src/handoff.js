import { assessPendingVerification } from "./assessment.js";
import { coversPart } from "./util.js";

/**
 * 生成新车主可带去检测或投保的《当前配置说明》。
 *
 * - 每项结论都回指安装、复检、登记等依据事件（provenance）；
 * - 最小披露：只纳入与当前在装部件相关的记录，无关维修信息不出现；
 * - 说明本身不下结论，只汇总证据并列出待核验范围。
 */
export function buildHandoffStatement({ timeline, registry, asOf }) {
  const parts = [...timeline.current_parts.values()];
  const provenance = new Set();

  const items = parts.map((part) => {
    const info = registry.partOf(part.part_id);
    const cert = part.certificate_id ? registry.certificateOf(part.certificate_id) : null;
    provenance.add(part.event_id);

    const certificate = cert
      ? {
          certificate_id: cert.certificate_id,
          certifier: cert.certifier,
          valid_until: cert.valid_until,
          conditions: cert.conditions,
          status: registry.statusOf(cert.certificate_id, asOf),
          evidence: [cert.certified_event_id, ...(cert.revoked ? [cert.revoked.event_id] : [])],
        }
      : { certificate_id: part.certificate_id ?? null, status: "未知", evidence: [] };
    certificate.evidence.forEach((id) => provenance.add(id));

    const inspections = timeline.inspections
      .filter((i) => Date.parse(i.occurred_at) >= Date.parse(part.installed_at) && coversPart(i, part.part_id))
      .map((i) => ({ event_id: i.event_id, at: i.occurred_at }));
    const registrationRefs = timeline.registrations.filter((r) => coversPart(r, part.part_id)).map((r) => r.event_id);
    const insuranceRefs = timeline.insurance_notices.filter((r) => coversPart(r, part.part_id)).map((r) => r.event_id);
    // 最小披露：仅纳入影响当前在装部件的维修记录。
    const repairRefs = timeline.repairs
      .filter((r) => Array.isArray(r.payload?.affects_part_ids) && r.payload.affects_part_ids.includes(part.part_id))
      .map((r) => r.event_id);

    [...inspections.map((i) => i.event_id), ...registrationRefs, ...insuranceRefs, ...repairRefs].forEach((id) => provenance.add(id));

    return {
      part_id: part.part_id,
      part_name: info?.part_name ?? part.part_name ?? null,
      category: part.category ?? info?.category ?? null,
      certificate,
      installation: {
        event_id: part.event_id,
        workshop_id: part.workshop_id,
        technician: part.technician,
        odometer_km: part.odometer_km,
        installed_at: part.installed_at,
      },
      calibration: part.calibration ?? null,
      inspections,
      registration_refs: registrationRefs,
      insurance_refs: insuranceRefs,
      repair_refs: repairRefs,
    };
  });

  const pending = assessPendingVerification(timeline, registry, { asOf });
  pending.forEach((item) => item.evidence.forEach((id) => provenance.add(id)));

  return {
    statement_type: "当前配置说明",
    vehicle_id: timeline.vehicle_id,
    generated_at: asOf ?? null,
    mileage_node: timeline.nodes.length > 0 ? timeline.nodes.at(-1).odometer_km : null,
    items,
    pending_verification: pending,
    provenance: { event_ids: [...provenance].sort() },
    disclaimer: "本说明汇总平台已存证据，每项结论均可回到安装、复检与登记依据；不构成检测或登记机关的结论。",
    privacy_note: "仅纳入与当前配置相关的记录，无关维修信息不在本说明内。",
  };
}

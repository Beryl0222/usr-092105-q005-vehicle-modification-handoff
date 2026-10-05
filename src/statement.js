import { assessPendingScope } from "./compliance.js";
import { projectConfiguration } from "./configuration.js";

export const STATEMENT_DISCLAIMER = "本说明汇总已收录证据及其出处，供检测或投保时核验，不构成检测或登记机关的结论。";

function certificateSummary(store, inst) {
  const partEvents = store.eventsFor("certified_part", inst.part_id);
  const certified = partEvents.find(
    (event) => event.event_type === "PART_CERTIFIED" && event.payload.certificate.cert_id === inst.cert_id,
  );
  const revoked = partEvents.some(
    (event) => event.event_type === "CERTIFICATE_REVOKED" && event.payload.cert_id === inst.cert_id,
  );
  if (!certified) return { cert_id: inst.cert_id, revoked };
  const cert = certified.payload.certificate;
  return {
    cert_id: cert.cert_id,
    issuer: cert.issuer,
    standard: cert.standard,
    scope: cert.scope ?? null,
    valid_until: cert.valid_until,
    revoked,
  };
}

/**
 * 生成“当前配置说明”：新车主可带去检测或投保。
 * - 每项结论都回到安装、复检（检测）与登记依据（事件标识）；
 * - 最小披露：只收录与当前在装组合相关的事故维修，无关维修信息不出现；
 * - 历史细节以摘要形式给出（事件计数与链头），便于核对完整性而不泄露内容。
 */
export function generateHandoffStatement(store, access, vehicleId, requester, options = {}) {
  const owner = access.currentOwner(vehicleId);
  if (!owner || requester !== owner) return { error: "无权获取该车辆当前配置说明" };

  const asOf = options.asOf ?? new Date().toISOString();
  const scope = assessPendingScope(store, vehicleId, { asOf });
  const state = projectConfiguration(store, vehicleId);
  const installations = new Map([...state.installations.values()].map((inst) => [inst.installation_id, inst]));

  const items = scope.items.map((item) => {
    const inst = installations.get(item.installation_id);
    return {
      installation_id: item.installation_id,
      part_id: item.part_id,
      category: item.category,
      certificate: certificateSummary(store, inst),
      status: item.status,
      pending: item.pending,
      basis: {
        installation: inst.installed_event_id,
        calibration: inst.calibration_event_id,
        inspection: item.links.inspection?.evidence.at(-1) ?? null,
        registration: item.links.registration_notice?.evidence.at(-1) ?? null,
        insurance: item.links.insurance_notice?.evidence.at(-1) ?? null,
      },
    };
  });

  const activeIds = new Set(items.map((item) => item.installation_id));
  const activeParts = new Set(items.map((item) => item.part_id));
  const relatedRepairs = state.repairs
    .filter((event) => (event.payload.affects ?? []).some((ref) => activeIds.has(ref) || activeParts.has(ref)))
    .map((event) => ({
      event_id: event.event_id,
      repair_id: event.payload.repair_id,
      occurred_at: event.occurred_at,
      affects: event.payload.affects,
      description: event.payload.description,
    }));

  const involved = [
    ...store.eventsFor("vehicle_configuration", vehicleId),
    ...store.eventsFor("ownership_transfer", vehicleId),
    ...state.inspections,
  ];
  const head = involved.reduce((a, b) => (Date.parse(b.occurred_at) > Date.parse(a.occurred_at) ? b : a));
  const latestTransfer = state.transfers[state.transfers.length - 1] ?? null;

  return {
    statement_id: `stmt-${vehicleId}-${asOf.slice(0, 10)}`,
    vehicle_id: vehicleId,
    generated_at: asOf,
    owner,
    nature: "当前配置说明",
    disclaimer: STATEMENT_DISCLAIMER,
    items,
    related_repairs: relatedRepairs,
    latest_transfer: latestTransfer
      ? {
          event_id: latestTransfer.event_id,
          occurred_at: latestTransfer.occurred_at,
          from_owner: latestTransfer.payload.from_owner,
          to_owner: latestTransfer.payload.to_owner,
        }
      : null,
    history_digest: {
      event_count: involved.length,
      checkpoint_count: state.checkpoints.length,
      head_event_id: head?.event_id ?? null,
    },
  };
}

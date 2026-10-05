/**
 * 配置投影：沿演化链重放某车辆的全部事件，重建当前配置与每个里程节点上的配置快照。
 * 投影只还原事实（谁装了什么、何时拆除复原、何时易主），不作任何合规判断。
 */

function emptyState(vehicleId) {
  return {
    vehicle_id: vehicleId,
    installations: new Map(), // installation_id -> 安装组合记录
    checkpoints: [], // 不可变里程节点，按链上顺序排列
    notifications: { registration: [], insurance: [] },
    repairs: [],
    inspections: [],
    transfers: [],
    anomalies: [], // 事实层面的异常（如里程回退、引用未知安装组合）
  };
}

function activeInstallationIds(state) {
  return [...state.installations.values()].filter((inst) => inst.status === "active").map((inst) => inst.installation_id);
}

function installFromPayload(event) {
  const p = event.payload;
  return {
    installation_id: p.installation_id,
    part_id: p.part_id,
    cert_id: p.cert_id,
    technician: p.technician ?? null,
    work: p.work ?? null,
    installed_at: event.occurred_at,
    installed_event_id: event.event_id,
    calibration: null,
    calibration_event_id: null,
    status: "active",
    closed_at: null,
    closed_by: null,
  };
}

function closeInstallation(state, event, installationId, status) {
  const inst = state.installations.get(installationId);
  if (!inst) {
    state.anomalies.push({ type: "unknown_installation", event_id: event.event_id, installation_id: installationId });
    return;
  }
  if (inst.status !== "active") return; // 已关闭的组合不因重报再次变更
  inst.status = status;
  inst.closed_at = event.occurred_at;
  inst.closed_by = event.event_id;
}

function applyConfigEvent(state, event) {
  const p = event.payload ?? {};
  switch (event.event_type) {
    case "PART_INSTALLED":
      state.installations.set(p.installation_id, installFromPayload(event));
      break;
    case "PART_REPLACED":
      closeInstallation(state, event, p.replaces_installation_id, "replaced");
      state.installations.set(p.installation_id, installFromPayload(event));
      break;
    case "INSTALLATION_CALIBRATED": {
      const inst = state.installations.get(p.installation_id);
      if (!inst) {
        state.anomalies.push({ type: "unknown_installation", event_id: event.event_id, installation_id: p.installation_id });
      } else {
        inst.calibration = p.calibration;
        inst.calibration_event_id = event.event_id;
      }
      break;
    }
    case "ODOMETER_RECORDED": {
      // 同一节点重报以首条为准；内容冲突的变更在存储层已被拒绝
      if (state.checkpoints.some((cp) => cp.checkpoint_id === p.checkpoint_id)) break;
      const last = state.checkpoints[state.checkpoints.length - 1];
      if (last && p.mileage < last.mileage) {
        state.anomalies.push({
          type: "odometer_regression",
          event_id: event.event_id,
          checkpoint_id: p.checkpoint_id,
          mileage: p.mileage,
          previous_mileage: last.mileage,
        });
      }
      state.checkpoints.push({
        checkpoint_id: p.checkpoint_id,
        mileage: p.mileage,
        unit: p.unit ?? "km",
        occurred_at: event.occurred_at,
        event_id: event.event_id,
        version: event.version,
        active_installation_ids: activeInstallationIds(state),
      });
      break;
    }
    case "REGISTRATION_UPDATED":
      state.notifications.registration.push(event);
      break;
    case "INSURANCE_NOTIFIED":
      state.notifications.insurance.push(event);
      break;
    case "ACCIDENT_REPAIRED":
      state.repairs.push(event);
      break;
    case "PART_REMOVED":
      closeInstallation(state, event, p.installation_id, "removed");
      break;
    case "CONFIGURATION_RESTORED": {
      const ids = p.installation_ids === "all_non_factory" ? activeInstallationIds(state) : (p.installation_ids ?? []);
      for (const id of ids) closeInstallation(state, event, id, "restored");
      break;
    }
    default:
      break;
  }
}

/**
 * 重建车辆配置。options.upToVersion 用于只重放到链上某一位置（里程节点快照）。
 * 检测报告与所有权变更属于独立聚合，按车辆标识关联并入状态。
 */
export function projectConfiguration(store, vehicleId, options = {}) {
  const upToVersion = options.upToVersion ?? Infinity;
  const state = emptyState(vehicleId);
  for (const event of store.eventsFor("vehicle_configuration", vehicleId)) {
    if (event.version <= upToVersion) applyConfigEvent(state, event);
  }
  state.inspections = store
    .allEvents()
    .filter((event) => event.aggregate_type === "inspection_finding" && event.payload?.vehicle_id === vehicleId)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  state.transfers = store.eventsFor("ownership_transfer", vehicleId);
  return state;
}

/** 围绕指定里程节点重建当时的在装配置。节点不存在时返回 null。 */
export function configurationAtCheckpoint(store, vehicleId, checkpointId) {
  const full = projectConfiguration(store, vehicleId);
  const checkpoint = full.checkpoints.find((cp) => cp.checkpoint_id === checkpointId);
  if (!checkpoint) return null;
  const atPoint = projectConfiguration(store, vehicleId, { upToVersion: checkpoint.version });
  return {
    checkpoint,
    installations: [...atPoint.installations.values()].filter((inst) => inst.status === "active"),
  };
}

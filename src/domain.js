/**
 * 领域公共词汇：事件类型、聚合类型与各事件负载的必备字段。
 * 这里只约束“记录事实所需的最低信息”，不在此表达任何合规结论。
 */

export const AGGREGATE_TYPES = Object.freeze([
  "vehicle_configuration",
  "certified_part",
  "inspection_finding",
  "ownership_transfer",
]);

export const EVENT_TYPES = Object.freeze([
  "PART_CERTIFIED", // 零部件身份与认证
  "CERTIFICATE_REVOKED", // 证书撤销（命中具体安装组合）
  "PART_INSTALLED", // 零部件安装（含技师与施工记录）
  "INSTALLATION_CALIBRATED", // 施工后的标定
  "ODOMETER_RECORDED", // 不可变里程节点
  "CONFIGURATION_INSPECTED", // 检测报告
  "REGISTRATION_UPDATED", // 登记告知
  "INSURANCE_NOTIFIED", // 保险告知
  "ACCIDENT_REPAIRED", // 事故维修
  "PART_REPLACED", // 替换（旧装组合退役 + 新装组合上线）
  "PART_REMOVED", // 拆除
  "CONFIGURATION_RESTORED", // 复原
  "OWNERSHIP_TRANSFERRED", // 所有权变更（权限切换点）
]);

/**
 * 各事件类型负载（payload）中必须出现的字段，支持点分路径。
 * 聚合归属约定：
 * - vehicle_configuration / ownership_transfer 的 aggregate_id 均为车辆标识；
 * - certified_part 的 aggregate_id 为零部件标识；
 * - inspection_finding 的 aggregate_id 为检测报告标识，车辆由 payload.vehicle_id 关联。
 */
export const PAYLOAD_REQUIRED = Object.freeze({
  PART_CERTIFIED: [
    "part_id",
    "category",
    "certificate.cert_id",
    "certificate.issuer",
    "certificate.standard",
    "certificate.valid_until",
  ],
  CERTIFICATE_REVOKED: ["part_id", "cert_id", "revoked_at", "reason"],
  PART_INSTALLED: [
    "installation_id",
    "part_id",
    "cert_id",
    "technician.tech_id",
    "technician.qualification",
    "work.shop",
    "work.description",
  ],
  INSTALLATION_CALIBRATED: ["installation_id", "part_id", "calibration.method", "calibration.performed_at"],
  ODOMETER_RECORDED: ["checkpoint_id", "mileage"],
  CONFIGURATION_INSPECTED: ["vehicle_id", "inspection_id", "inspector", "covers", "report_ref"],
  REGISTRATION_UPDATED: ["covers", "authority_ref"],
  INSURANCE_NOTIFIED: ["covers", "insurer_ref"],
  ACCIDENT_REPAIRED: ["repair_id", "affects", "description"],
  PART_REPLACED: [
    "replaces_installation_id",
    "installation_id",
    "part_id",
    "cert_id",
    "technician.tech_id",
    "technician.qualification",
    "work.shop",
    "work.description",
  ],
  PART_REMOVED: ["installation_id", "reason"],
  CONFIGURATION_RESTORED: ["installation_ids", "reason"],
  OWNERSHIP_TRANSFERRED: ["vehicle_id", "from_owner", "to_owner"],
});

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** 校验事件负载的必备字段，返回可直接展示的中文错误。 */
export function validatePayload(event) {
  const required = PAYLOAD_REQUIRED[event.event_type];
  if (!required) return [];
  const payload = event.payload ?? {};
  return required.filter((path) => getPath(payload, path) === undefined).map((path) => `payload 缺少字段：${path}`);
}

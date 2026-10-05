/** 本领域允许的事件类型，覆盖演化链各环节。 */
export const EVENT_TYPES = [
  "PART_CERTIFIED", // 零部件身份与认证
  "CERTIFICATE_REVOKED", // 证书撤销
  "PART_INSTALLED", // 安装（含技师、施工与标定）
  "PART_REMOVED", // 替换、拆除、复原
  "ACCIDENT_REPAIR_RECORDED", // 事故维修
  "CONFIGURATION_INSPECTED", // 检测报告
  "REGISTRATION_UPDATED", // 登记告知
  "INSURANCE_NOTIFIED", // 保险告知
  "OWNERSHIP_TRANSFERRED", // 所有权变更
];

/** 底座要求的四类聚合。 */
export const AGGREGATE_TYPES = ["vehicle_configuration", "certified_part", "inspection_finding", "ownership_transfer"];

/** 事件类型与聚合的绑定关系，防止事实挂错对象。 */
export const EVENT_AGGREGATE = {
  PART_CERTIFIED: "certified_part",
  CERTIFICATE_REVOKED: "certified_part",
  PART_INSTALLED: "vehicle_configuration",
  PART_REMOVED: "vehicle_configuration",
  ACCIDENT_REPAIR_RECORDED: "vehicle_configuration",
  CONFIGURATION_INSPECTED: "inspection_finding",
  REGISTRATION_UPDATED: "vehicle_configuration",
  INSURANCE_NOTIFIED: "vehicle_configuration",
  OWNERSHIP_TRANSFERRED: "ownership_transfer",
};

const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

/** 返回可以直接展示给接入方的中文错误；空数组表示通过。 */
export function validateEvent(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return ["事件必须是对象"];
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);

  if ("event_id" in record && (typeof record.event_id !== "string" || record.event_id.length < 8)) {
    errors.push("event_id 必须是长度不少于 8 的字符串");
  }
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未知事件类型：${record.event_type}`);
  }
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未知聚合类型：${record.aggregate_type}`);
  }
  const bound = EVENT_AGGREGATE[record.event_type];
  if (bound && "aggregate_type" in record && record.aggregate_type !== bound) {
    errors.push(`事件类型 ${record.event_type} 应挂在 ${bound} 聚合上`);
  }
  if ("aggregate_id" in record && (typeof record.aggregate_id !== "string" || record.aggregate_id.length < 1)) {
    errors.push("aggregate_id 必须是非空字符串");
  }
  if ("occurred_at" in record && (typeof record.occurred_at !== "string" || Number.isNaN(Date.parse(record.occurred_at)))) {
    errors.push("occurred_at 不是有效时间");
  }
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("summary" in record && (typeof record.summary !== "string" || record.summary.trim().length < 2)) {
    errors.push("summary 至少两个字符");
  }
  if ("fact_key" in record && (typeof record.fact_key !== "string" || record.fact_key.length === 0)) {
    errors.push("fact_key 若提供必须是非空字符串");
  }
  if ("payload" in record && (record.payload === null || typeof record.payload !== "object" || Array.isArray(record.payload))) {
    errors.push("payload 若提供必须是对象");
  }
  return errors;
}

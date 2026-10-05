import { assessPendingScope } from "./compliance.js";

/**
 * 跨地区评估：按车辆使用地“现行”规则评估未来状态的待核验范围。
 * 评估是只读操作——历史事件与既有评估结果一律不被修改。
 *
 * ruleSet 形如：
 * {
 *   region: "甲省",
 *   rule_version: "2026-07",
 *   effective_from: "2026-07-01",
 *   required_links: ["identity_certification", ...],  // 当地要求的证据环节
 * }
 */
export function assessForRegion(store, vehicleId, ruleSet, options = {}) {
  const asOf = options.asOf ?? new Date().toISOString();
  const scope = assessPendingScope(store, vehicleId, { asOf, requiredLinks: ruleSet.required_links });
  return {
    vehicle_id: vehicleId,
    region: ruleSet.region,
    rule_version: ruleSet.rule_version,
    effective_from: ruleSet.effective_from ?? null,
    evaluated_at: asOf,
    nature: scope.nature,
    basis: "按当地现行规则评估未来状态；历史事件与既有评估保持不变。",
    disclaimer: scope.disclaimer,
    items: scope.items,
    anomalies: scope.anomalies,
    conflicts: scope.conflicts,
  };
}

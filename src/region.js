import { coversPart } from "./util.js";

/**
 * 跨地区评估：按目的地现行规则预估车辆未来在当地使用时，
 * 现有证据能满足哪些记录要求、哪些还需补充核验。
 * 评估是只读视图：历史事件不被修改、不被抹除。
 */
export function evaluateForRegion(timeline, registry, rules, { asOf } = {}) {
  const parts = [...timeline.current_parts.values()];
  const categoryOf = (part) => part.category ?? registry.partOf(part.part_id)?.category ?? null;

  const results = rules.requirements.map((req) => {
    const targets = req.applies_to_category ? parts.filter((p) => categoryOf(p) === req.applies_to_category) : parts;
    let satisfied = false;
    let evidence = [];

    switch (req.evidence_required) {
      case "valid_certificate":
        satisfied = targets.length > 0 && targets.every((p) => registry.statusOf(p.certificate_id, asOf) === "有效");
        evidence = targets.map((p) => p.event_id);
        break;
      case "joint_inspection": {
        const latestInstallAt = parts.map((p) => p.installed_at).sort().at(-1) ?? null;
        const joint =
          latestInstallAt &&
          timeline.inspections.find(
            (i) => Date.parse(i.occurred_at) >= Date.parse(latestInstallAt) && parts.every((p) => coversPart(i, p.part_id)),
          );
        satisfied = Boolean(joint);
        evidence = joint ? [joint.event_id] : parts.map((p) => p.event_id);
        break;
      }
      case "registration_notice":
        satisfied =
          targets.length > 0 &&
          targets.every((p) =>
            timeline.registrations.some((r) => Date.parse(r.occurred_at) >= Date.parse(p.installed_at) && coversPart(r, p.part_id)),
          );
        evidence = targets.map((p) => p.event_id);
        break;
      case "insurance_notice":
        satisfied =
          targets.length > 0 &&
          targets.every((p) =>
            timeline.insurance_notices.some((r) => Date.parse(r.occurred_at) >= Date.parse(p.installed_at) && coversPart(r, p.part_id)),
          );
        evidence = targets.map((p) => p.event_id);
        break;
      default:
        satisfied = false;
        evidence = [];
    }

    return {
      rule_id: req.rule_id,
      description: req.description ?? null,
      scope: req.evidence_required === "joint_inspection" ? "当前组合配置" : targets.map((p) => p.part_id).sort(),
      evidence_status: satisfied ? "已有证据" : "待补充核验",
      evidence: [...new Set(evidence)].sort(),
    };
  });

  return {
    region: rules.region,
    rule_version: rules.rule_version ?? null,
    as_of: asOf ?? null,
    evaluates: "未来在当地使用的状态（按当地现行规则预估）",
    history_note: "本次评估只读取历史记录，不做任何修改；历史事实保持原样。",
    disclaimer: "评估结果仅为证据核对提示，不构成检测或登记机关的结论。",
    results,
  };
}

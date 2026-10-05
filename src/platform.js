import { AccessRegistry } from "./access.js";
import { assessPendingVerification } from "./assessment.js";
import { buildHandoffStatement } from "./handoff.js";
import { buildPartRegistry, buildVehicleTimeline } from "./projection.js";
import { evaluateForRegion } from "./region.js";
import { analyzeCertificateRevocation } from "./revocation.js";
import { EventStore } from "./store.js";

/**
 * 平台门面：事件接入（去重、乱序容忍）、配置重建、待核验评估、
 * 撤销影响、跨地区评估、权限切换与交接说明签发。
 */
export function createPlatform() {
  const store = new EventStore();
  const access = new AccessRegistry();

  const timelineOf = (vehicleId) => buildVehicleTimeline(store.all(), vehicleId);
  const registryOf = () => buildPartRegistry(store.all());

  return {
    store,
    access,

    ingest(event) {
      const result = store.ingest(event);
      if (result.status === "accepted" && event.event_type === "OWNERSHIP_TRANSFERRED") {
        access.applyOwnershipTransfer(event);
      }
      return result;
    },

    ingestAll(events) {
      const summary = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0, results: [] };
      for (const event of events) {
        const result = this.ingest(event);
        summary[result.status] += 1;
        summary.results.push(result);
      }
      return summary;
    },

    timeline: timelineOf,
    registry: registryOf,

    /** 依据证据给出待核验范围，不下检测或登记结论。 */
    assess(vehicleId, options = {}) {
      return assessPendingVerification(timelineOf(vehicleId), registryOf(), options);
    },

    /** 证书撤销命中的具体安装组合。 */
    revocationImpact(certificateId) {
      return analyzeCertificateRevocation(store.all(), certificateId);
    },

    /** 按当地现行规则评估未来状态，历史记录保持不变。 */
    evaluateRegion(vehicleId, rules, options = {}) {
      return evaluateForRegion(timelineOf(vehicleId), registryOf(), rules, options);
    },

    /** 向有权主体签发《当前配置说明》。 */
    issueHandoffStatement(vehicleId, requester, options = {}) {
      if (!access.can(requester, vehicleId, "view_handoff")) {
        return { error: `${requester} 无权获取车辆 ${vehicleId} 的当前配置说明` };
      }
      return buildHandoffStatement({ timeline: timelineOf(vehicleId), registry: registryOf(), asOf: options.asOf });
    },
  };
}

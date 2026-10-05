/**
 * 访问权限登记。所有权转移是权限切换点：
 * OWNERSHIP_TRANSFERRED 事件生效时，原车主在该车上的全部权限
 * （尤其是远程查看）随即失效，新车主获得远程查看与交接说明权限。
 * 每次切换都留下可审计记录并回指触发事件。
 */
export class AccessRegistry {
  #grants = new Map(); // key -> { vehicle, principal, capability, basis_event }
  #log = [];

  static #key(vehicle, principal, capability) {
    return `${vehicle}|${principal}|${capability}`;
  }

  grant(vehicle, principal, capability, basisEvent) {
    this.#grants.set(AccessRegistry.#key(vehicle, principal, capability), {
      vehicle,
      principal,
      capability,
      basis_event: basisEvent,
    });
    this.#log.push({ action: "grant", vehicle, principal, capability, basis_event: basisEvent });
  }

  revoke(vehicle, principal, capability, basisEvent, reason) {
    this.#grants.delete(AccessRegistry.#key(vehicle, principal, capability));
    this.#log.push({ action: "revoke", vehicle, principal, capability, basis_event: basisEvent, reason });
  }

  can(principal, vehicle, capability) {
    return this.#grants.has(AccessRegistry.#key(vehicle, principal, capability));
  }

  /** 应用所有权转移事件：旧主权限随即失效，新主获得交接所需权限。 */
  applyOwnershipTransfer(event) {
    const { vehicle_id: vehicle, from_owner: fromOwner, to_owner: toOwner } = event.payload ?? {};
    for (const grant of [...this.#grants.values()]) {
      if (grant.vehicle === vehicle && grant.principal === fromOwner) {
        this.revoke(vehicle, fromOwner, grant.capability, event.event_id, "所有权转移，原车主权限随即失效");
      }
    }
    this.grant(vehicle, toOwner, "remote_view", event.event_id);
    this.grant(vehicle, toOwner, "view_handoff", event.event_id);
  }

  auditLog() {
    return [...this.#log];
  }
}

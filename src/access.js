/**
 * 访问权限：所有权转移是权限切换点。
 * OWNERSHIP_TRANSFERRED 事件一旦被存储接受，旧车主的远程访问随即失效，
 * 仅当前车主可取得新的远程访问凭证。
 */
export class AccessRegistry {
  #sessions = new Map(); // vehicleId -> Map(principal -> token)
  #counter = 0;

  constructor(store) {
    this.store = store;
    store.subscribe((event) => {
      if (event.event_type === "OWNERSHIP_TRANSFERRED") this.#enforceOwnership(event.payload.vehicle_id);
    });
  }

  /** 当前车主：该车辆所有权链上最新一次转移的受让方。 */
  currentOwner(vehicleId) {
    const transfers = this.store.eventsFor("ownership_transfer", vehicleId);
    if (transfers.length === 0) return null;
    return transfers[transfers.length - 1].payload.to_owner;
  }

  transferHistory(vehicleId) {
    return this.store.eventsFor("ownership_transfer", vehicleId);
  }

  grantRemoteAccess(principal, vehicleId) {
    const owner = this.currentOwner(vehicleId);
    if (!owner) return { granted: false, reason: "尚无所有权记录，无法授权" };
    if (principal !== owner) return { granted: false, reason: "仅当前车主可取得远程访问权限" };
    if (!this.#sessions.has(vehicleId)) this.#sessions.set(vehicleId, new Map());
    const token = `tok-${vehicleId}-${++this.#counter}`;
    this.#sessions.get(vehicleId).set(principal, token);
    return { granted: true, token };
  }

  canAccess(principal, vehicleId) {
    return this.#sessions.get(vehicleId)?.has(principal) ?? false;
  }

  #enforceOwnership(vehicleId) {
    const owner = this.currentOwner(vehicleId);
    const sessions = this.#sessions.get(vehicleId);
    if (!sessions) return;
    for (const principal of [...sessions.keys()]) {
      if (principal !== owner) sessions.delete(principal); // 旧车主随即失去远程访问
    }
  }
}

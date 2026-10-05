import { compareEvents, stableStringify } from "./util.js";
import { validateEvent } from "./validator.js";

/**
 * 只追加的事件存储。
 *
 * 去重与冲突规则：
 * - event_id 已存在且内容一致 → duplicate（来源系统重试）；
 * - event_id 已存在但内容不一致 → conflict（疑似篡改，拒绝写入）；
 * - 携带 fact_key 的事件与已存事件同键且负载一致 → duplicate（多方重报同一事实）；
 * - fact_key 相同但负载不一致 → conflict。
 *
 * 事件一旦接受即不可变，里程节点等历史事实不会被后续写入抹掉。
 */
export class EventStore {
  #events = new Map(); // event_id -> event
  #factIndex = new Map(); // 事实键 -> event_id
  #reporters = new Map(); // event_id -> Set(上报方)

  ingest(record) {
    const errors = validateEvent(record);
    if (errors.length > 0) return { status: "rejected", errors };
    const event = structuredClone(record);

    const known = this.#events.get(event.event_id);
    if (known) {
      return stableStringify(known) === stableStringify(event)
        ? { status: "duplicate", event_id: event.event_id }
        : { status: "conflict", event_id: event.event_id, errors: [`事件 ${event.event_id} 与已存记录内容不一致，疑似篡改`] };
    }

    if (typeof event.fact_key === "string") {
      const key = this.#factKey(event);
      const priorId = this.#factIndex.get(key);
      if (priorId) {
        const prior = this.#events.get(priorId);
        if (stableStringify(prior.payload ?? null) === stableStringify(event.payload ?? null)) {
          this.#noteReporter(priorId, event.source);
          return { status: "duplicate", event_id: priorId, alias_of: priorId, note: "多方重报同一事实，已按事实键去重" };
        }
        return { status: "conflict", event_id: event.event_id, errors: [`事实键 ${event.fact_key} 已对应事件 ${priorId}，但负载不一致`] };
      }
      this.#factIndex.set(key, event.event_id);
    }

    this.#events.set(event.event_id, event);
    this.#noteReporter(event.event_id, event.source);
    return { status: "accepted", event_id: event.event_id };
  }

  #factKey(event) {
    return `${event.aggregate_type}|${event.aggregate_id}|${event.event_type}|${event.fact_key}`;
  }

  #noteReporter(eventId, source) {
    if (!this.#reporters.has(eventId)) this.#reporters.set(eventId, new Set());
    if (typeof source === "string" && source.length > 0) this.#reporters.get(eventId).add(source);
  }

  /** 同一事实的全部上报方（含重报方）。 */
  reportersOf(eventId) {
    return [...(this.#reporters.get(eventId) ?? [])];
  }

  get size() {
    return this.#events.size;
  }

  /** 全量事件，按领域统一顺序排序后的副本。 */
  all() {
    return [...this.#events.values()].sort(compareEvents);
  }

  /** 某聚合对象的事件流，按版本回放。 */
  byAggregate(aggregateType, aggregateId) {
    return [...this.#events.values()]
      .filter((e) => e.aggregate_type === aggregateType && e.aggregate_id === aggregateId)
      .sort((a, b) => a.version - b.version || compareEvents(a, b));
  }

  /**
   * 与某车辆相关的全部事件：车辆聚合事件，以及负载中指向该车的
   * 检测报告、所有权转移等外挂聚合事件。
   */
  forVehicle(vehicleId) {
    return [...this.#events.values()]
      .filter((e) => e.aggregate_id === vehicleId || e.payload?.vehicle_id === vehicleId)
      .sort(compareEvents);
  }
}

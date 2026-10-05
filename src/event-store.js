import { validatePayload } from "./domain.js";
import { validateEvent } from "./validator.js";

/** 生成键序稳定的串行化结果，用于判断重报事件内容是否一致。 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function byPosition(a, b) {
  return a.version - b.version || Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.event_id.localeCompare(b.event_id);
}

/**
 * 事件存储：多方乱序重报的入口。
 * - 同一 event_id 内容一致视为重报，幂等去重；内容不同视为标识冲突，拒绝并保留原记录；
 * - 同一聚合同一 version 出现不同事件时双方都保留，但记入冲突清单，交由评估环节列为待核验；
 * - 里程节点（ODOMETER_RECORDED 的 checkpoint_id）一经记录不可变更。
 */
export class EventStore {
  #events = new Map();
  #conflicts = [];
  #listeners = [];

  /** 订阅“已接受”的事件，用于所有权切换等联动。 */
  subscribe(listener) {
    this.#listeners.push(listener);
  }

  append(event) {
    const errors = [...validateEvent(event), ...validatePayload(event)];
    if (errors.length > 0) return { status: "rejected", errors };

    const existing = this.#events.get(event.event_id);
    if (existing) {
      if (canonical(existing) === canonical(event)) return { status: "duplicate", errors: [] };
      return { status: "conflict", errors: [`事件标识冲突：${event.event_id} 已存在不同内容`] };
    }

    const odometerError = this.#checkOdometerImmutable(event);
    if (odometerError) return { status: "rejected", errors: [odometerError] };

    this.#events.set(event.event_id, structuredClone(event));

    const clash = this.eventsFor(event.aggregate_type, event.aggregate_id).find(
      (other) => other.event_id !== event.event_id && other.version === event.version,
    );
    if (clash) {
      this.#conflicts.push({
        type: "version_conflict",
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        version: event.version,
        event_ids: [clash.event_id, event.event_id],
      });
    }

    for (const listener of this.#listeners) listener(structuredClone(event));
    return { status: "accepted", errors: [] };
  }

  appendAll(events) {
    return events.map((event) => this.append(event));
  }

  #checkOdometerImmutable(event) {
    if (event.event_type !== "ODOMETER_RECORDED") return null;
    const checkpointId = event.payload.checkpoint_id;
    const prior = this.eventsFor(event.aggregate_type, event.aggregate_id).find(
      (other) => other.event_type === "ODOMETER_RECORDED" && other.payload.checkpoint_id === checkpointId,
    );
    if (prior && prior.payload.mileage !== event.payload.mileage) {
      return `里程节点不可变更：${checkpointId} 已记录为 ${prior.payload.mileage}`;
    }
    return null;
  }

  /** 按聚合读取事件，按 (version, occurred_at, event_id) 排序，与到达顺序无关。 */
  eventsFor(aggregateType, aggregateId) {
    return [...this.#events.values()]
      .filter((event) => event.aggregate_type === aggregateType && event.aggregate_id === aggregateId)
      .sort(byPosition)
      .map((event) => structuredClone(event));
  }

  aggregateIds(aggregateType) {
    return [...new Set([...this.#events.values()].filter((e) => e.aggregate_type === aggregateType).map((e) => e.aggregate_id))];
  }

  allEvents() {
    return [...this.#events.values()]
      .sort(
        (a, b) =>
          a.aggregate_type.localeCompare(b.aggregate_type) ||
          a.aggregate_id.localeCompare(b.aggregate_id) ||
          byPosition(a, b),
      )
      .map((event) => structuredClone(event));
  }

  conflicts() {
    return structuredClone(this.#conflicts);
  }

  get size() {
    return this.#events.size;
  }
}

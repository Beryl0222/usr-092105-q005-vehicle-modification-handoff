/** 递归排序键后序列化，用于事件内容比对（去重与篡改检测）。 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

/**
 * 领域统一排序：先事实发生时间，再对象版本，最后事件标识。
 * 多方乱序重报时，只要事件集合相同，回放结果必然一致。
 */
export function compareEvents(a, b) {
  const byTime = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  if (byTime !== 0) return byTime;
  if (a.version !== b.version) return a.version - b.version;
  if (a.event_id < b.event_id) return -1;
  if (a.event_id > b.event_id) return 1;
  return 0;
}

/**
 * 判断一条告知/检测类事件是否覆盖某个部件。
 * 未列明 covers_part_ids 时视为整车范围（登记、保险常见写法）。
 */
export function coversPart(event, partId) {
  const covers = event?.payload?.covers_part_ids;
  if (!Array.isArray(covers) || covers.length === 0) return true;
  return covers.includes(partId);
}

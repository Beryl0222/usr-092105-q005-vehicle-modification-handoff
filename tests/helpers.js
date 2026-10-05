import { readFile } from "node:fs/promises";

import { EventStore } from "../src/event-store.js";

export const VEHICLE = "vehicle-rv-002";
export const AS_OF = "2026-10-05T10:00:00+08:00";

export async function loadHistory() {
  return JSON.parse(await readFile(new URL("../data/sample-history.json", import.meta.url), "utf8"));
}

/** 按给定顺序灌入历史事件并断言全部被接受（允许指定跳过的前缀长度）。 */
export async function storeWithHistory(order = (events) => events) {
  const events = order(await loadHistory());
  const store = new EventStore();
  const results = store.appendAll(events);
  return { store, events, results };
}

import { readFile } from "node:fs/promises";

export async function loadScenario() {
  return JSON.parse(await readFile(new URL("../data/scenario.json", import.meta.url), "utf8"));
}

export const VEHICLE = "vehicle-rv-001";
export const AS_OF = "2026-05-02T00:00:00+08:00";

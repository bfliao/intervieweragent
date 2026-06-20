import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Incident } from "./types";

const DATA_PATH = join(process.cwd(), "scenario_generation", "data", "incidents.json");

let cache: Incident[] | null = null;

/** Load the crawled incident corpus (cached in memory). */
export async function loadIncidents(): Promise<Incident[]> {
  if (cache) return cache;
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    cache = JSON.parse(raw) as Incident[];
  } catch {
    cache = [];
  }
  return cache;
}

export async function getIncident(id: string): Promise<Incident | undefined> {
  const all = await loadIncidents();
  return all.find((i) => i.id === id);
}

export async function randomIncident(): Promise<Incident | undefined> {
  const all = await loadIncidents();
  if (all.length === 0) return undefined;
  return all[Math.floor(Math.random() * all.length)];
}

/** Lightweight list for UI pickers. */
export async function listIncidentSummaries(): Promise<
  Array<Pick<Incident, "id" | "title" | "company" | "categories">>
> {
  const all = await loadIncidents();
  return all.map(({ id, title, company, categories }) => ({
    id,
    title,
    company,
    categories,
  }));
}

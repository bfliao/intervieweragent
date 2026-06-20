import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";

export interface StoredAssessmentPackage {
  id: string;
  candidateName?: string;
  candidateEmail?: string;
  jobTitle?: string;
  markdown: string;
  targetRole?: string;
  createdAt: string;
  scenarios?: unknown;
}

const globalForAssessments = globalThis as typeof globalThis & {
  __questionArenaAssessments?: Map<string, StoredAssessmentPackage>;
};

const storePath = path.join(process.cwd(), ".assessment-store.json");

function readPersistedStore() {
  if (!existsSync(storePath)) return new Map<string, StoredAssessmentPackage>();

  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      StoredAssessmentPackage
    >;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map<string, StoredAssessmentPackage>();
  }
}

function persistStore(store: Map<string, StoredAssessmentPackage>) {
  const payload = Object.fromEntries(store.entries());
  const tmpPath = `${storePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  renameSync(tmpPath, storePath);
}

export const assessmentStore =
  globalForAssessments.__questionArenaAssessments ??
  readPersistedStore();

globalForAssessments.__questionArenaAssessments = assessmentStore;

export function getAssessment(id: string) {
  if (assessmentStore.has(id)) return assessmentStore.get(id);

  const persistedStore = readPersistedStore();
  for (const [persistedId, assessment] of Array.from(persistedStore.entries())) {
    assessmentStore.set(persistedId, assessment);
  }

  return assessmentStore.get(id);
}

export function saveAssessment(assessment: StoredAssessmentPackage) {
  assessmentStore.set(assessment.id, assessment);
  persistStore(assessmentStore);
}

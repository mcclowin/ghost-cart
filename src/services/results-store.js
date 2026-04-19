import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { hasDb, loadResultPage, saveResultPage } from './db.js';

const RESULTS_DIR = join(process.cwd(), 'data', 'results');

if (!existsSync(RESULTS_DIR)) {
  mkdirSync(RESULTS_DIR, { recursive: true });
}

function getResultPath(searchId) {
  return join(RESULTS_DIR, `${searchId}.json`);
}

export async function saveResult(searchId, payload) {
  if (hasDb()) {
    const saved = await saveResultPage(searchId, payload);
    if (saved) return;
  }

  writeFileSync(getResultPath(searchId), JSON.stringify(payload, null, 2));
}

export async function loadResult(searchId) {
  if (hasDb()) {
    const result = await loadResultPage(searchId);
    if (result) return result;
  }

  const path = getResultPath(searchId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export { RESULTS_DIR };

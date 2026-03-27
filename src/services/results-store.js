import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const RESULTS_DIR = join(process.cwd(), 'data', 'results');

if (!existsSync(RESULTS_DIR)) {
  mkdirSync(RESULTS_DIR, { recursive: true });
}

function getResultPath(searchId) {
  return join(RESULTS_DIR, `${searchId}.json`);
}

export function saveResult(searchId, payload) {
  writeFileSync(getResultPath(searchId), JSON.stringify(payload, null, 2));
}

export function loadResult(searchId) {
  const path = getResultPath(searchId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export { RESULTS_DIR };

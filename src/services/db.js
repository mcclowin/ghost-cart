/**
 * PostgreSQL connection pool + query helpers.
 *
 * Connects via DATABASE_URL env var (Railway injects this automatically
 * when you add a Postgres plugin).
 *
 * If DATABASE_URL is not set, all logging functions silently no-op
 * so the app works without a DB during local dev.
 */
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('DB pool error:', err.message));
  console.log('🗄️  Postgres connected');
} else {
  console.log('🗄️  DATABASE_URL not set — DB logging disabled');
}

/** Run a query, returns { rows } or null if no DB. */
export async function query(text, params) {
  if (!pool) return null;
  return pool.query(text, params);
}

/** Check if DB is available. */
export function hasDb() {
  return !!pool;
}

// ── Logging helpers (fire-and-forget) ─────────────────

/**
 * Log a search request. Returns the inserted row id.
 */
export async function logSearch({ source, username, query: q, imageFilename, durationMs, resultCount }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO searches (source, username, query, image_filename, duration_ms, result_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [source || 'web', username || null, q || null, imageFilename || null, durationMs || null, resultCount || 0],
    );
    return rows[0].id;
  } catch (err) {
    console.error('DB logSearch error:', err.message);
    return null;
  }
}

/**
 * Log detected brand/item from vision analysis.
 */
export async function logBrand({ searchId, brand, itemType, color, style, material, confidence }) {
  if (!pool || !searchId) return;
  try {
    await pool.query(
      `INSERT INTO brands_detected (search_id, brand, item_type, color, style, material, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [searchId, brand || null, itemType || null, color || null, style || null, material || null, confidence || null],
    );
  } catch (err) {
    console.error('DB logBrand error:', err.message);
  }
}

/**
 * Log results served to user.
 */
export async function logResults(searchId, results) {
  if (!pool || !searchId || !results?.length) return;
  try {
    const values = [];
    const params = [];
    let idx = 1;

    for (const r of results.slice(0, 20)) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(
        searchId,
        r.rank || null,
        (r.title || '').slice(0, 500),
        (r.price || '').toString().slice(0, 50),
        r.marketplace || null,
        r.url || null,
        r.overallScore || r.relevanceScore || null,
      );
    }

    await pool.query(
      `INSERT INTO results_served (search_id, rank, title, price, marketplace, url, relevance_score)
       VALUES ${values.join(', ')}`,
      params,
    );
  } catch (err) {
    console.error('DB logResults error:', err.message);
  }
}

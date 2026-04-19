/**
 * Database migration — creates tables if they don't exist.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/db-migrate.mjs
 *
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ Set DATABASE_URL to run migrations');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
});

await client.connect();
console.log('🗄️  Connected to Postgres');

await client.query(`
  CREATE TABLE IF NOT EXISTS searches (
    id            SERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source        VARCHAR(20) NOT NULL DEFAULT 'web',
    username      VARCHAR(100),
    query         TEXT,
    image_filename VARCHAR(255),
    duration_ms   INTEGER,
    result_count  INTEGER DEFAULT 0,
    exact_model   TEXT,
    exact_search_query TEXT,
    colorway      TEXT,
    discovery_confidence VARCHAR(20),
    discovery_source VARCHAR(50)
  );

  ALTER TABLE searches
    ADD COLUMN IF NOT EXISTS exact_model TEXT,
    ADD COLUMN IF NOT EXISTS exact_search_query TEXT,
    ADD COLUMN IF NOT EXISTS colorway TEXT,
    ADD COLUMN IF NOT EXISTS discovery_confidence VARCHAR(20),
    ADD COLUMN IF NOT EXISTS discovery_source VARCHAR(50);

  CREATE TABLE IF NOT EXISTS brands_detected (
    id          SERIAL PRIMARY KEY,
    search_id   INTEGER REFERENCES searches(id) ON DELETE CASCADE,
    brand       VARCHAR(200),
    item_type   VARCHAR(200),
    color       VARCHAR(100),
    style       VARCHAR(200),
    material    VARCHAR(200),
    confidence  VARCHAR(20)
  );

  CREATE TABLE IF NOT EXISTS results_served (
    id              SERIAL PRIMARY KEY,
    search_id       INTEGER REFERENCES searches(id) ON DELETE CASCADE,
    rank            INTEGER,
    title           VARCHAR(500),
    price           VARCHAR(50),
    marketplace     VARCHAR(200),
    url             TEXT,
    relevance_score REAL
  );

  CREATE TABLE IF NOT EXISTS result_pages (
    search_id  TEXT PRIMARY KEY,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at);
  CREATE INDEX IF NOT EXISTS idx_searches_source ON searches(source);
  CREATE INDEX IF NOT EXISTS idx_searches_exact_search_query ON searches(exact_search_query);
  CREATE INDEX IF NOT EXISTS idx_brands_brand ON brands_detected(brand);
  CREATE INDEX IF NOT EXISTS idx_brands_item_type ON brands_detected(item_type);
  CREATE INDEX IF NOT EXISTS idx_results_marketplace ON results_served(marketplace);
  CREATE INDEX IF NOT EXISTS idx_result_pages_created_at ON result_pages(created_at);
`);

console.log('✅ Tables created:');
console.log('   - searches');
console.log('   - brands_detected');
console.log('   - results_served');
console.log('   - result_pages');

await client.end();

/**
 * GET /find/:id
 * Renders the results page for a search.
 * For now: serve JSON or simple HTML. Full frontend comes later.
 */
import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();
const RESULTS_DIR = 'data/results';

router.get('/find/:id', (req, res) => {
  const { id } = req.params;
  const resultPath = join(RESULTS_DIR, `${id}.json`);

  if (!existsSync(resultPath)) {
    return res.status(404).send(notFoundPage());
  }

  const data = JSON.parse(readFileSync(resultPath, 'utf-8'));
  const accept = req.headers.accept || '';

  // If client wants JSON (API/agent call), return raw
  if (accept.includes('application/json')) {
    return res.json(data);
  }

  // Otherwise render HTML
  res.send(renderResultsPage(data));
});

function notFoundPage() {
  return `<!DOCTYPE html>
<html><head><title>Not Found | GhostCart</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 80px auto; padding: 20px; text-align: center; color: #333; }
  h1 { font-size: 48px; margin-bottom: 8px; }
  p { color: #666; }
</style>
</head><body>
<h1>👻</h1>
<h2>Results not found</h2>
<p>This search may have expired or the link is invalid.</p>
</body></html>`;
}

function renderResultsPage(data) {
  const vision = data.vision || {};
  const ranked = data.ranked || {};
  const results = ranked.results || [];
  const primary = (vision.items || [])[0] || {};

  const itemTitle = [primary.color, primary.brand, primary.item_type]
    .filter(Boolean)
    .join(' ') || 'Clothing Item';

  const resultsHtml = results.map((r, i) => {
    const badge = i === 0 ? '<span class="badge exact">🎯 Best Match</span>' : '<span class="badge alt">Alternative</span>';
    const priceHtml = r.price ? `<span class="price">${r.price}</span>` : '';
    const storeHtml = r.marketplace ? `<span class="store">${r.marketplace}</span>` : '';
    const scoreHtml = `<span class="score">${r.overallScore || '—'}/100</span>`;

    return `
    <div class="result-card ${i === 0 ? 'top-pick' : ''}">
      ${badge}
      <h3><a href="${r.url}" target="_blank" rel="noopener">${r.title || 'Untitled'}</a></h3>
      <div class="meta">
        ${priceHtml} ${storeHtml} ${scoreHtml}
      </div>
      ${r.recommendation ? `<p class="rec">${r.recommendation}</p>` : ''}
    </div>`;
  }).join('\n');

  const styleNotes = vision.overall_style
    ? `<div class="style-notes"><h2>💡 Style Notes</h2><p>${vision.overall_style}</p></div>`
    : '';

  const postCredit = data.post_author
    ? `<p class="credit">From a post by <a href="https://instagram.com/${data.post_author}" target="_blank">@${data.post_author}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${itemTitle} — Found by GhostCart</title>
  <meta name="description" content="Shopping results for ${itemTitle}. Found ${results.length} options.">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a; color: #e0e0e0;
      max-width: 720px; margin: 0 auto; padding: 20px;
      line-height: 1.6;
    }
    header {
      text-align: center; padding: 40px 0 20px;
      border-bottom: 1px solid #222;
      margin-bottom: 30px;
    }
    header h1 { font-size: 28px; color: #fff; margin-bottom: 8px; }
    header .subtitle { color: #888; font-size: 14px; }
    .credit { color: #666; font-size: 13px; margin-top: 8px; }
    .credit a { color: #888; }
    .detected {
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 20px; margin-bottom: 24px;
    }
    .detected h2 { font-size: 16px; color: #aaa; margin-bottom: 10px; }
    .attrs { display: flex; flex-wrap: wrap; gap: 8px; }
    .attr {
      background: #1a1a1a; border: 1px solid #333; border-radius: 8px;
      padding: 4px 12px; font-size: 13px; color: #ccc;
    }
    .result-card {
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 20px; margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .result-card:hover { border-color: #444; }
    .result-card.top-pick { border-color: #4ade80; }
    .result-card h3 { font-size: 16px; margin-bottom: 8px; }
    .result-card h3 a { color: #60a5fa; text-decoration: none; }
    .result-card h3 a:hover { text-decoration: underline; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
    .price { color: #4ade80; font-weight: 700; font-size: 18px; }
    .store { color: #888; font-size: 13px; }
    .score { color: #666; font-size: 12px; }
    .badge {
      display: inline-block; font-size: 11px; font-weight: 600;
      padding: 2px 10px; border-radius: 12px; margin-bottom: 8px;
    }
    .badge.exact { background: #064e3b; color: #4ade80; }
    .badge.alt { background: #1e1e1e; color: #888; }
    .rec { color: #888; font-size: 13px; font-style: italic; }
    .style-notes {
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 20px; margin-top: 24px;
    }
    .style-notes h2 { font-size: 16px; color: #aaa; margin-bottom: 8px; }
    .style-notes p { color: #ccc; }
    footer {
      text-align: center; padding: 40px 0 20px;
      border-top: 1px solid #222; margin-top: 40px;
      color: #555; font-size: 13px;
    }
    footer a { color: #666; }
    .no-results {
      text-align: center; padding: 40px; color: #888;
    }
  </style>
</head>
<body>
  <header>
    <h1>🔍 ${itemTitle}</h1>
    <p class="subtitle">Found ${results.length} option${results.length !== 1 ? 's' : ''} · Searched in ${((data.duration || 0) / 1000).toFixed(1)}s</p>
    ${postCredit}
  </header>

  <div class="detected">
    <h2>🏷️ What I Detected</h2>
    <div class="attrs">
      ${primary.item_type ? `<span class="attr">${primary.item_type}</span>` : ''}
      ${primary.color ? `<span class="attr">${primary.color}</span>` : ''}
      ${primary.brand ? `<span class="attr">${primary.brand}</span>` : ''}
      ${primary.pattern ? `<span class="attr">${primary.pattern}</span>` : ''}
      ${primary.material ? `<span class="attr">${primary.material}</span>` : ''}
      ${primary.style ? `<span class="attr">${primary.style}</span>` : ''}
    </div>
  </div>

  ${results.length > 0 ? resultsHtml : '<div class="no-results"><p>No exact matches found. Try a different image?</p></div>'}

  ${styleNotes}

  <footer>
    <p>👻 Powered by <a href="/">GhostCart</a> · ${new Date(data.createdAt).toLocaleDateString()}</p>
  </footer>
</body>
</html>`;
}

export { router as pagesRouter };

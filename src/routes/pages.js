/**
 * GET /find/:id
 * Renders the results page for a search.
 * For now: serve JSON or simple HTML. Full frontend comes later.
 */
import { Router } from 'express';
import { loadResult } from '../services/results-store.js';

const router = Router();

router.get('/find/:id', (req, res) => {
  const { id } = req.params;
  const data = loadResult(id);
  if (!data) {
    return res.status(404).send(notFoundPage());
  }
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
  const primaryResults = ranked.results || [];
  const exactRanked = data.exact?.ranked || data.exactResults || {};
  const alternativeRanked = data.alternatives?.ranked || data.alternativeResults || {};
  const exactResults = exactRanked.results || [];
  const alternativeResults = alternativeRanked.results || [];
  const primary = (vision.items || [])[0] || {};
  const discovery = data.discovery || {};

  const itemTitle = [primary.color, primary.brand, primary.item_type]
    .filter(Boolean)
    .join(' ') || 'Clothing Item';

  const renderCards = (results, kind) => results.map((r, i) => {
    const badge = kind === 'exact'
      ? '<span class="badge exact">🎯 Exact Match</span>'
      : (i === 0 ? '<span class="badge alt">🏆 Top Alternative</span>' : '<span class="badge alt">Alternative</span>');
    const priceHtml = r.price ? `<span class="price">${r.price}</span>` : '';
    const storeHtml = r.marketplace ? `<span class="store">${r.marketplace}</span>` : '';
    const scoreHtml = `<span class="score">${r.overallScore || '—'}/100</span>`;
    const imgHtml = r.image
      ? `<img class="result-img" src="${escapeHtml(r.image)}" alt="${escapeHtml(r.title || 'Product image')}" onerror="this.parentElement.innerHTML='<div class=result-img-placeholder>📦</div>'" />`
      : '<div class="result-img-placeholder">📦</div>';

    return `
    <div class="result-card ${i === 0 ? 'top-pick' : ''}">
      ${badge}
      <div class="result-card-body">
        <div class="result-img-container">${imgHtml}</div>
        <div class="result-main">
          <h3><a href="${r.url}" target="_blank" rel="noopener">${escapeHtml(r.title || 'Untitled')}</a></h3>
          <div class="meta">
            ${priceHtml} ${storeHtml} ${scoreHtml}
          </div>
          ${r.recommendation ? `<p class="rec">${escapeHtml(r.recommendation)}</p>` : ''}
        </div>
      </div>
    </div>`;
  }).join('\n');

  const exactHtml = exactResults.length > 0 ? `
    <section class="results-section">
      <h2>Exact Match</h2>
      ${discovery.exactModel ? `<p class="section-subtitle">${escapeHtml(discovery.exactModel)}</p>` : ''}
      ${renderCards(exactResults, 'exact')}
    </section>
  ` : '';

  const alternativesHtml = alternativeResults.length > 0 ? `
    <section class="results-section">
      <h2>Alternatives</h2>
      <p class="section-subtitle">Similar items found from vision-derived attributes.</p>
      ${renderCards(alternativeResults, 'alternative')}
    </section>
  ` : '';

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
  <meta name="description" content="Shopping results for ${itemTitle}. Found ${primaryResults.length} primary options.">
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
    .results-section { margin-bottom: 28px; }
    .results-section h2 { font-size: 18px; color: #fff; margin-bottom: 6px; }
    .section-subtitle { color: #888; font-size: 14px; margin-bottom: 14px; }
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
    .result-card-body {
      display: grid;
      grid-template-columns: 108px minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .result-img-container {
      width: 108px;
      height: 108px;
      border-radius: 10px;
      overflow: hidden;
      background: #1a1a1a;
      border: 1px solid #252525;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .result-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .result-img-placeholder {
      color: #666;
      font-size: 28px;
    }
    .result-main {
      min-width: 0;
    }
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
    @media (max-width: 640px) {
      .result-card-body {
        grid-template-columns: 1fr;
      }
      .result-img-container {
        width: 100%;
        height: 220px;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>🔍 ${itemTitle}</h1>
    <p class="subtitle">Found ${primaryResults.length} primary option${primaryResults.length !== 1 ? 's' : ''} · Searched in ${((data.duration || 0) / 1000).toFixed(1)}s</p>
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

  ${exactHtml}
  ${alternativesHtml}
  ${(exactResults.length === 0 && alternativeResults.length === 0)
    ? '<div class="no-results"><p>No matches found. Try a different image?</p></div>'
    : ''}

  ${styleNotes}

  <footer>
    <p>👻 Powered by <a href="/">GhostCart</a> · ${new Date(data.createdAt).toLocaleDateString()}</p>
  </footer>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export { router as pagesRouter };

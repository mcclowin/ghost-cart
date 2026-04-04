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
  const exactRanked = data.exact?.ranked || data.exactResults || {};
  const alternativeRanked = data.alternatives?.ranked || data.alternativeResults || {};
  const exactResults = exactRanked.results || [];
  const alternativeResults = (alternativeRanked.results || []).slice(0, 3);
  const primary = (vision.items || [])[0] || {};
  const discovery = data.discovery || {};
  const lensData = data.lensResults || {};
  const totalResults = exactResults.length + alternativeResults.length;

  // Product identification — prefer LLM discovery over vision
  const identifiedItem = discovery.exactModel || [primary.color, primary.brand, primary.item_type].filter(Boolean).join(' ') || 'Clothing Item';

  // Hero image — best image from Lens results (the actual identified item)
  const lensImages = [
    ...(lensData.exactMatches || []),
    ...(lensData.visualMatches || []),
  ].map(m => m.image).filter(Boolean);
  const heroImage = lensImages[0] || null;

  const ogImageUrl = '/images/kaboom-og.svg';

  const renderCard = (r, badge) => {
    const priceHtml = r.price ? `<span class="price">${r.price}</span>` : '';
    const storeHtml = r.marketplace ? `<span class="store">${r.marketplace}</span>` : '';
    const imgHtml = r.image
      ? `<img class="result-img" src="${escapeHtml(r.image)}" alt="${escapeHtml(r.title || 'Product')}" onerror="this.parentElement.innerHTML='<div class=result-img-placeholder></div>'" />`
      : '<div class="result-img-placeholder"></div>';

    return `
    <a href="${r.url}" target="_blank" rel="noopener" class="result-card">
      ${badge}
      <div class="result-card-body">
        <div class="result-img-container">${imgHtml}</div>
        <div class="result-main">
          <h3>${escapeHtml(r.title || 'Untitled')}</h3>
          <div class="meta">${priceHtml} ${storeHtml}</div>
        </div>
      </div>
    </a>`;
  };

  const exactHtml = exactResults.length > 0 ? `
    <section class="results-section">
      <h2>Where to Buy</h2>
      ${exactResults.map(r => renderCard(r, '<span class="badge exact">Exact Match</span>')).join('\n')}
    </section>
  ` : '';

  const alternativesHtml = alternativeResults.length > 0 ? `
    <section class="results-section">
      <h2>Similar Items</h2>
      ${alternativeResults.map(r => renderCard(r, '<span class="badge alt">Alternative</span>')).join('\n')}
    </section>
  ` : '';

  const postCredit = data.post_author
    ? `<p class="credit">From a post by <a href="https://instagram.com/${data.post_author}" target="_blank">@${data.post_author}</a></p>`
    : '';

  const heroHtml = heroImage ? `
  <div class="hero">
    <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(identifiedItem)}" onerror="this.parentElement.style.display='none'" />
  </div>` : '';

  const confidenceClass = discovery.confidence === 'high' ? 'high' : 'medium';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(identifiedItem)} — Kaboom</title>
  <meta name="description" content="${escapeHtml(identifiedItem)} — found ${totalResults} result${totalResults !== 1 ? 's' : ''}.">
  <meta property="og:title" content="${escapeHtml(identifiedItem)} — Kaboom">
  <meta property="og:description" content="We found ${totalResults} place${totalResults !== 1 ? 's' : ''} to buy this.">
  <meta property="og:image" content="${ogImageUrl}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${ogImageUrl}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a; color: #e0e0e0;
      max-width: 720px; margin: 0 auto; padding: 0 20px 20px;
      line-height: 1.6;
    }
    .logo {
      display: block; margin: 24px auto 20px; max-width: 200px; height: auto;
    }
    .hero {
      width: 100%; border-radius: 16px; overflow: hidden;
      margin-bottom: 20px; background: #111;
      border: 1px solid #222;
    }
    .hero img {
      width: 100%; max-height: 480px; object-fit: contain;
      display: block; background: #111;
    }
    .identification {
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 20px; margin-bottom: 24px; text-align: center;
    }
    .identification h1 { font-size: 20px; color: #fff; margin-bottom: 8px; }
    .id-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #666; margin-bottom: 8px; }
    .confidence {
      display: inline-block; font-size: 11px; font-weight: 600;
      padding: 2px 10px; border-radius: 12px;
    }
    .confidence.high { background: #064e3b; color: #4ade80; }
    .confidence.medium { background: #1e1e1e; color: #f7c948; }
    .attrs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 10px; }
    .attr {
      background: #1a1a1a; border: 1px solid #333; border-radius: 8px;
      padding: 3px 10px; font-size: 12px; color: #aaa;
    }
    .credit { color: #666; font-size: 13px; text-align: center; margin-bottom: 20px; }
    .credit a { color: #888; }
    .results-section { margin-bottom: 24px; }
    .results-section h2 {
      font-size: 14px; color: #888; text-transform: uppercase;
      letter-spacing: 1px; margin-bottom: 12px;
    }
    .result-card {
      display: block; text-decoration: none; color: inherit;
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 14px; margin-bottom: 10px;
      transition: border-color 0.2s;
    }
    .result-card:hover { border-color: #444; }
    .result-card-body {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }
    .result-img-container {
      width: 72px; height: 72px;
      border-radius: 8px; overflow: hidden;
      background: #1a1a1a; border: 1px solid #252525;
      display: flex; align-items: center; justify-content: center;
    }
    .result-img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .result-img-placeholder { width: 100%; height: 100%; background: #1a1a1a; }
    .result-main { min-width: 0; }
    .result-card h3 { font-size: 14px; color: #e0e0e0; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { display: flex; gap: 10px; align-items: center; }
    .price { color: #4ade80; font-weight: 700; font-size: 16px; }
    .store { color: #888; font-size: 13px; }
    .badge {
      display: inline-block; font-size: 10px; font-weight: 600;
      padding: 2px 8px; border-radius: 10px; margin-bottom: 6px;
    }
    .badge.exact { background: #064e3b; color: #4ade80; }
    .badge.alt { background: #1e1e1e; color: #888; }
    footer {
      text-align: center; padding: 24px 0 16px;
      border-top: 1px solid #222; margin-top: 28px;
      color: #444; font-size: 12px;
    }
    footer a { color: #555; }
    .no-results { text-align: center; padding: 40px; color: #888; }
    @media (max-width: 640px) {
      .hero img { max-height: 360px; }
      .result-card-body { grid-template-columns: 60px minmax(0, 1fr); gap: 10px; }
      .result-img-container { width: 60px; height: 60px; }
    }
  </style>
</head>
<body>
  <img class="logo" src="/images/kaboom-logo.svg" alt="Kaboom">

  ${heroHtml}

  <div class="identification">
    <p class="id-label">We identified this as</p>
    <h1>${escapeHtml(identifiedItem)}</h1>
    ${discovery.confidence ? `<span class="confidence ${confidenceClass}">${discovery.confidence} confidence</span>` : ''}
    <div class="attrs">
      ${primary.item_type ? `<span class="attr">${escapeHtml(primary.item_type)}</span>` : ''}
      ${primary.color ? `<span class="attr">${escapeHtml(primary.color)}</span>` : ''}
      ${primary.material ? `<span class="attr">${escapeHtml(primary.material)}</span>` : ''}
      ${primary.style ? `<span class="attr">${escapeHtml(primary.style)}</span>` : ''}
    </div>
  </div>

  ${postCredit}

  ${exactHtml}
  ${alternativesHtml}
  ${totalResults === 0 ? '<div class="no-results"><p>No matches found. Try a different image?</p></div>' : ''}

  <footer>
    <p>Powered by <a href="/">Kaboom</a></p>
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

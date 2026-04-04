/**
 * GET /find/:id
 * Renders the results page for a search.
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

  if (accept.includes('application/json')) {
    return res.json(data);
  }

  res.send(renderResultsPage(data));
});

function notFoundPage() {
  return `<!DOCTYPE html>
<html><head><title>Not Found | Kaboom</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 80px auto; padding: 20px; text-align: center; color: #e0e0e0; background: #0a0a0a; }
  h1 { font-size: 48px; margin-bottom: 8px; }
  p { color: #666; }
</style>
</head><body>
<h1>?</h1>
<h2>Results not found</h2>
<p>This search may have expired or the link is invalid.</p>
</body></html>`;
}

function renderResultsPage(data) {
  const vision = data.vision || {};
  const exactRanked = data.exact?.ranked || data.exactResults || {};
  const alternativeRanked = data.alternatives?.ranked || data.alternativeResults || {};
  const exactResults = (exactRanked.results || []).slice(0, 4);
  const alternativeResults = (alternativeRanked.results || []).slice(0, 3);
  const primary = (vision.items || [])[0] || {};
  const discovery = data.discovery || {};
  const totalResults = exactResults.length + alternativeResults.length;

  const identifiedItem = discovery.exactModel
    || [primary.color, primary.brand, primary.item_type].filter(Boolean).join(' ')
    || 'Clothing Item';

  const originalImage = data.originalImage || null;
  const ogImageUrl = originalImage || '/images/kaboom-og.svg';
  const confidenceClass = discovery.confidence === 'high' ? 'high' : 'medium';

  const renderCard = (r) => {
    const priceHtml = r.price ? `<span class="price">${r.price}</span>` : '';
    const storeHtml = r.marketplace ? `<span class="store">${r.marketplace}</span>` : '';
    const imgHtml = r.image
      ? `<div class="card-img"><img src="${esc(r.image)}" alt="${esc(r.title || '')}" onerror="this.parentElement.style.display='none'" /></div>`
      : '';

    return `
    <a href="${r.url}" target="_blank" rel="noopener" class="card">
      ${imgHtml}
      <div class="card-info">
        <h3>${esc(r.title || 'Untitled')}</h3>
        <div class="meta">${priceHtml} ${storeHtml}</div>
      </div>
    </a>`;
  };

  const exactHtml = exactResults.length > 0 ? `
    <section>
      <h2>Where to Buy</h2>
      ${exactResults.map(renderCard).join('\n')}
    </section>` : '';

  const altsHtml = alternativeResults.length > 0 ? `
    <section>
      <h2>Similar Items</h2>
      ${alternativeResults.map(renderCard).join('\n')}
    </section>` : '';

  const postCredit = data.post_author
    ? `<p class="credit">From a post by <a href="https://instagram.com/${esc(data.post_author)}" target="_blank">@${esc(data.post_author)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(identifiedItem)} — Kaboom</title>
  <meta name="description" content="${esc(identifiedItem)} — found ${totalResults} result${totalResults !== 1 ? 's' : ''}.">
  <meta property="og:title" content="${esc(identifiedItem)} — Kaboom">
  <meta property="og:description" content="We found ${totalResults} place${totalResults !== 1 ? 's' : ''} to buy this.">
  <meta property="og:image" content="${ogImageUrl}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${ogImageUrl}">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;max-width:720px;margin:0 auto;padding:0 16px 24px;line-height:1.5}

    /* Original photo */
    .query-img{width:100%;border-radius:14px;overflow:hidden;margin:20px 0 16px;background:#111;border:1px solid #222}
    .query-img img{width:100%;max-height:380px;object-fit:contain;display:block;background:#111}

    /* Identification */
    .id-box{text-align:center;margin-bottom:20px}
    .id-label{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#555;margin-bottom:6px}
    .id-box h1{font-size:20px;color:#fff;margin-bottom:8px}
    .confidence{display:inline-block;font-size:11px;font-weight:600;padding:2px 10px;border-radius:12px}
    .confidence.high{background:#064e3b;color:#4ade80}
    .confidence.medium{background:#1e1e1e;color:#f7c948}
    .attrs{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:10px}
    .attr{background:#141414;border:1px solid #282828;border-radius:8px;padding:3px 10px;font-size:12px;color:#999}
    .credit{color:#555;font-size:12px;text-align:center;margin-bottom:16px}
    .credit a{color:#777}

    /* Section headings */
    section{margin-bottom:20px}
    section h2{font-size:13px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}

    /* Product cards */
    .card{display:block;text-decoration:none;color:inherit;background:#111;border:1px solid #1e1e1e;border-radius:12px;overflow:hidden;margin-bottom:10px;transition:border-color .15s}
    .card:hover{border-color:#333}
    .card-img{width:100%;max-height:260px;overflow:hidden;background:#141414}
    .card-img img{width:100%;max-height:260px;object-fit:cover;display:block}
    .card-info{padding:12px 14px}
    .card h3{font-size:14px;color:#ddd;margin-bottom:4px}
    .meta{display:flex;gap:10px;align-items:center}
    .price{color:#4ade80;font-weight:700;font-size:15px}
    .store{color:#777;font-size:12px}

    /* Footer */
    footer{text-align:center;padding:20px 0 12px;border-top:1px solid #181818;margin-top:24px;color:#333;font-size:11px}
    footer a{color:#444}

    .no-results{text-align:center;padding:40px;color:#666}

    @media(max-width:640px){
      .query-img img{max-height:300px}
      .card-img,.card-img img{max-height:200px}
    }
  </style>
</head>
<body>

  ${originalImage ? `<div class="query-img"><img src="${esc(originalImage)}" alt="Original photo" onerror="this.parentElement.style.display='none'" /></div>` : ''}

  <div class="id-box">
    <p class="id-label">This is</p>
    <h1>${esc(identifiedItem)}</h1>
    ${discovery.confidence ? `<span class="confidence ${confidenceClass}">${discovery.confidence} confidence</span>` : ''}
    <div class="attrs">
      ${primary.item_type ? `<span class="attr">${esc(primary.item_type)}</span>` : ''}
      ${primary.color ? `<span class="attr">${esc(primary.color)}</span>` : ''}
      ${primary.material ? `<span class="attr">${esc(primary.material)}</span>` : ''}
      ${primary.style ? `<span class="attr">${esc(primary.style)}</span>` : ''}
    </div>
  </div>

  ${postCredit}

  ${exactHtml}
  ${altsHtml}
  ${totalResults === 0 ? '<div class="no-results"><p>No matches found. Try a different image?</p></div>' : ''}

  <footer>
    <p>Powered by <a href="/">Kaboom</a></p>
  </footer>
</body>
</html>`;
}

function esc(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export { router as pagesRouter };

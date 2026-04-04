# Pipeline Development Log

Track every issue, what caused it, how it was fixed, and whether the fix held.
Check this before making changes to avoid repeating mistakes.

---

## Known Patterns

### Pattern: Heuristic filters kill good results
- **Seen:** Multiple times (exact constraints, color filters, brand/model hard requirements)
- **Root cause:** Token-matching filters reject results when wording differs ("copper" vs "metallic", "Rich Oak Bisque" vs "brown")
- **Rule:** Never hard-filter shopping results by keyword matching. Let the ranker sort by relevance, don't throw results away.

### Pattern: Replacing a data source instead of adding to it
- **Seen:** Lens URLs replaced Tavily resolution, breaking the pipeline
- **Root cause:** `if (shoppingProducts.length === 0)` check meant adding Lens products prevented Tavily from running
- **Rule:** New data sources should be additive (bonus candidates), never replace existing working sources. Always resolve shopping results via Tavily.

### Pattern: LLM inconsistency on colorways
- **Seen:** Same image produces "New Balance 740 Rich Oak Bisque Pecan" one run and "New Balance 740 brown" the next
- **Root cause:** LLM summarizes colorway names to generic colors unless explicitly told not to
- **Rule:** Prompt must say: use exact colorway names from Lens titles, do NOT simplify to generic colors.

---

## Run Log

### Run: Alexandre Vauthier dress (2026-04-04)

**Image:** Copper sequin one-shoulder mini dress

| Run | Exact Query | Exact Results | Issue | Fix |
|-----|------------|---------------|-------|-----|
| 1 | "AV Sequin One-shoulder Mini Dress copper" | 9 found, 0 passed strict filter | `matchesExactConstraints` required ALL tokens (sequin+one+shoulder+mini+dress+copper) | Removed heuristic filtering entirely |
| 2 | Same | 6 Lens fallback (eBay, used) | `buildExactLensFallback` replaced good results with raw Lens junk | Removed Lens fallback |
| 3 | Same | 7 results but wrong products | `scoreResult` hard-killed results missing color/brand/model words | Relaxed hard filters, only reject generic pages |
| 4 | Same | Error: filteredProducts undefined | Leftover variable reference from removing constraints | Fixed reference to use shoppingProducts |
| 5 | Same | 8 results, no images on exact | Lens organic results don't have thumbnails, shopping results skipped | Added fallback image from shopping thumbnails |
| 6 | Same | 8 results, wrong colors | Lens URLs prevented Tavily from resolving shopping results | Made Tavily always run, Lens/Offers are additive |

**Current status:** Tavily always resolves shopping results. Lens URLs + Product Offers added as bonus. Needs retest.

### Run: New Balance 740 (2026-04-04)

**Image:** Brown/beige NB 740 Rich Oak Bisque Pecan

| Run | Exact Query | Issue | Fix |
|-----|------------|-------|-----|
| 1 | "NB 740 Rich Oak Bisque" | Wrong colorways in results, exact scoring broken | `scoreExactCandidate` called with null constraints, everything scored same | Switched to LLM ranking for both branches |
| 2 | "NB 740 Rich Oak Bisque Pecan" | Good results | — |
| 3 | "NB 740 brown" | LLM simplified colorway to generic "brown" | Updated prompt to require exact colorway names |
| 4 | "NB 740 Rich Oak Bisque Pecan" | Good query, but shopping results skipped (Lens URLs replaced Tavily) | Made Tavily always run |

**Current status:** Prompt updated for colorways. Tavily restored. Needs retest.

### Run: Prada hooded jacket (2026-04-04)

**Image:** Navy blue hooded zip-up jacket

| Run | Exact Query | Issue | Fix |
|-----|------------|-------|-----|
| 1 (heuristic) | "Harry and Zoe's NYC Stroll" | Heuristic picked reseller name over brand | Switched to LLM-first reconciliation |
| 2 (LLM) | none (medium confidence) | LLM couldn't identify brand from Lens titles | Added related_search to LLM input, updated prompt for brand vs store distinction |

**Current status:** LLM reconciliation is primary. Related searches passed in. Not retested with latest changes.

---

## Architecture Decisions

### Decision: LLM-first reconciliation (not heuristic)
- **Date:** 2026-04-04
- **Why:** Heuristic `inferLensExactMatch` picked winners by title overlap count. Reseller names with more listings beat actual brands. LLM understands brand vs store.
- **Heuristic kept as:** Fallback only when LLM fails.

### Decision: No Lens fallback for exact matches
- **Date:** 2026-04-04
- **Why:** `buildExactLensFallback` grabbed raw Lens URLs (eBay used listings, Instagram, Pinterest) and replaced ranked shopping results. Always worse quality.

### Decision: Tavily always runs for shopping resolution
- **Date:** 2026-04-04
- **Why:** Skipping Tavily when other sources (Lens URLs, Product Offers) existed meant 8+ good shopping results were never resolved. New sources must be additive.

### Decision: No hard kill filters in ranker
- **Date:** 2026-04-04
- **Why:** Hard requirements (must have brand + model + color in title) rejected valid results where wording differed. Only generic/category pages should be filtered.

---

## Data Sources (current)

| Source | Used For | Quality | Notes |
|--------|----------|---------|-------|
| Bright Data Lens | Product identification (Step 1) | High | Returns organic + images + related_search. related_search often has exact product name |
| Bright Data Lens URLs | Bonus exact match candidates | Medium | Organic results have real store URLs but no thumbnails. Many are used/social. Filter needed |
| SerpAPI Google Shopping | Store listings (Step 4) | Medium | Has thumbnails, prices, ratings. URLs are Google redirects needing resolution |
| SerpAPI Product Offers | Real store URLs | High when available | Uses pageToken. Often returns nothing for designer/niche items |
| Tavily | URL resolution | Medium | Resolves Google Shopping redirects to real store URLs. Sometimes resolves to wrong page |
| Vision LLM | Image attributes (Step 1) | Low-Medium | Often hallucinates brands. Good for generic attributes (color, item type) |
| LLM Reconciliation | Product identification (Step 3) | High | Reads all Lens titles + related searches. Inconsistent on colorways without strong prompting |
| LLM Ranking (`rankResults`) | NOT ACTUALLY LLM | — | Despite the name, this is pure heuristic scoring. No LLM call. |

---

## TODO / Known Issues

- [ ] `rankResults` is heuristic, not LLM — misleading name. Consider adding actual LLM ranking or renaming.
- [ ] Tavily sometimes resolves to wrong pages (Pinterest, category pages, different products)
- [ ] Used product filter only runs on exact branch, not alternatives
- [ ] No deduplication of results across exact + alternatives branches
- [ ] `getProductOffers` rarely returns data for designer/niche items — consider removing to save complexity
- [ ] Bright Data Lens `offers` field is captured but never used (has direct buy links with prices)
- [ ] OG image is SVG — Instagram DM previews may not render it (needs PNG)

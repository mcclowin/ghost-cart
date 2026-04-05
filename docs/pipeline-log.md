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
- **Rule:** New data sources should be additive (bonus candidates), never replace existing working sources.

### Pattern: LLM inconsistency on colorways
- **Seen:** Same image produces "New Balance 740 Rich Oak Bisque Pecan" one run and "New Balance 740 brown" the next
- **Root cause:** LLM summarizes colorway names to generic colors unless explicitly told not to
- **Rule:** Prompt must say: use exact colorway names from Lens titles, do NOT simplify to generic colors.

### Pattern: Tavily resolution is unreliable
- **Seen:** Across all queries — resolves to wrong pages, Pinterest, category pages, different products, duplicate URLs
- **Root cause:** Tavily re-searches by product title on a domain, doesn't follow the actual Google redirect. Often finds something else.
- **Evidence:** Loro Piana — 12/14 Tavily calls returned nothing. AV dress — resolved to wrong stores, duplicates. NB 740 — some good, some wrong colorway.
- **Rule:** Don't rely on Tavily as the primary source of product URLs. Use it as a bonus only.

---

## Checkpoint: 2026-04-05 — Lens-first exact match process

### Problem Statement
The exact match pipeline has been non-deterministic. Same image produces great results one run and garbage the next because:
1. Google Shopping returns different results each time
2. Tavily resolution is unreliable (wrong pages, failures, duplicates)
3. Multiple data sources compete/override each other instead of complementing

### Evidence (dry run: NB 740 Rich Oak Bisque Pecan)

**What Lens gave us (free, no extra API calls):**
- offers: GOAT $86 direct link, in stock
- organic: newbalance.com, StockX, Foot Locker, JD Sports, Amazon, iqueens.com, Journeys — all direct product URLs
- Total: ~8 buyable links, all correct product, all correct colorway

**What the current process produced (Google Shopping + Tavily):**
- 40 Google Shopping results → 12 Tavily calls → ASOS, Snipes, Selfridges (good) + broken links, duplicates, wrong colorways
- More API calls, slower, less consistent

**Conclusion:** Lens already found the product on real stores. Re-searching via Google Shopping + Tavily adds complexity and unreliability without improving quality.

### New Process: Lens-first exact matches

```
Step 1: Vision + Lens (parallel) — unchanged
Step 2: LLM reconciliation — unchanged
Step 3: Exact matches FROM LENS DATA:
   a. Lens offers[] — direct buy links with prices (best quality)
   b. Lens organic[] — filter to buyable product URLs
   c. Lens visual[] — filter to buyable product URLs
   → Filter out: social media, used/resale, category pages
   → Deduplicate by URL
   → This IS the exact match list
Step 4: Alternatives ONLY: Google Shopping + Tavily (unchanged)
```

**What this removes from exact branch:** Google Shopping search, Tavily resolution, SerpAPI Product Offers
**What this keeps:** All Lens data (offers + organic + visual), URL classification, used product filter
**Risk:** If Lens returns few buyable URLs, exact matches will be sparse. Mitigated by alternatives section still running full pipeline.
**Image fix:** Match verified results with visual match images by URL or domain. Fallback to first visual match image.

### Implementation: 2026-04-05 — Lens-first with LLM sanity check + web search

**Implemented as:**
```
Step 3a-c: Collect URLs from Lens (offers + organic + visual)
Step 3d: Tavily web search "buy [product name]" for extra stores
Step 4: LLM sanity check — each candidate verified for:
   - Is it a buyable product page?
   - Is it the correct product?
   - Is it the correct colorway?
Step 5: Resolve images from visual matches (URL match → domain match → fallback)
```

**Test results (2026-04-05):**
| Query | Candidates | LLM approved | Quality | Issues |
|-------|-----------|-------------|---------|--------|
| NB 740 Rich Oak (no offers) | 16 | 3 | Good — all correct product/store | No images (fixed with visual match fallback) |
| NB 740 Rich Oak (with offers) | 14 | — | Error (old shape refs) | Fixed |
| Loro Piana Croco | ~12 | 3+ | Good — correct stores with prices | Location varies (India/UAE/US) |
| AV Sequin Dress | ~15 | 3 | Good — 2nd link spot on | 1st link geo-restricted, 3rd link wrong |

### Round 2: OG meta fetch + Firecrawl comparison (2026-04-05)

**Problem:** LLM sanity check was approving wrong colors because Lens titles don't include color info. LLM couldn't tell "Summer Charms Walk Loafers" is Grey vs Brown from title alone.

**Fix (Option A — active):** Fetch og:title + og:image + og:description from each candidate URL before LLM check. Most product pages include color in og:title. Also gives us product images.

**Fix (Option B — log only):** Firecrawl deep scrape of top 4 candidates. Logs content, add-to-cart detection, price detection. For comparison with Option A.

**Also fixed:**
- Dedup by domain (not URL) — same store can't appear twice
- No wrong fallback images — only use images from exact URL or domain match
- Detailed logging of every candidate sent to LLM and every approval/rejection

### Open issue: Bright Data geo-location
Bright Data routes through random countries each request. Results vary dramatically:
- en-IN → Myntra, Ajio (Indian stores, ₹ prices)
- en-DE → THE OUTNET (€ prices)
- en-US → GOAT, ASOS, Shopbop ($, best results)
- en-ZA → Truworths (South African stores)
- en-AE → sands-uae.com (UAE stores)

**Action needed:** Pin Bright Data to US or UK exit node. Researching API parameters.

### Tested against:
| Query | Lens offers | Lens buyable organic | Would work? |
|-------|------------|---------------------|-------------|
| NB 740 Rich Oak | GOAT $86 | 7 stores | Yes — better than current |
| AV Sequin Dress | None | Farfetch, Estar De Moda, Fashion Alta Moda | Yes — these are the good results we got |
| Loro Piana Croco | MILNY PARLON £795 | Lyst, some stores | Yes — better than 12/14 Tavily failures |
| Salomon XT-MM6 | None | Shopbop, Novelship, END, Farfetch, SSENSE | Yes — all real stores |

---

## Run Log

### Run: Alexandre Vauthier dress (2026-04-04)

**Image:** Copper sequin one-shoulder mini dress

| Run | Exact Query | Exact Results | Issue | Fix |
|-----|------------|---------------|-------|-----|
| 1 | "AV Sequin One-shoulder Mini Dress copper" | 9 found, 0 passed strict filter | `matchesExactConstraints` required ALL tokens | Removed heuristic filtering |
| 2 | Same | 6 Lens fallback (eBay, used) | `buildExactLensFallback` replaced good results | Removed Lens fallback |
| 3 | Same | 7 results but wrong products | `scoreResult` hard-killed results | Relaxed hard filters |
| 4 | Same | Error: filteredProducts undefined | Leftover variable reference | Fixed reference |
| 5 | Same | 8 results, no images on exact | Lens organic has no thumbnails | Added fallback images |
| 6 | Same | 8 results, wrong colors | Lens URLs prevented Tavily from running | Made Tavily always run |
| 7 | Same | Decent results, correct links | — | — |

**Current status:** Working. Correct product identification and links.

### Run: New Balance 740 (2026-04-04/05)

**Image:** Brown/beige NB 740 Rich Oak Bisque Pecan

| Run | Exact Query | Issue | Fix |
|-----|------------|-------|-----|
| 1 | "NB 740 Rich Oak Bisque" | Wrong colorways, scoring broken | Switched to LLM ranking |
| 2 | "NB 740 Rich Oak Bisque Pecan" | Good results | — |
| 3 | "NB 740 brown" | LLM simplified colorway | Updated prompt |
| 4 | "NB 740 Rich Oak Bisque Pecan" | Shopping results skipped | Made Tavily always run |
| 5 | "NB 740 Rich Oak Bisque Pecan" | Good — all exact matches correct | — |

**Current status:** Working well. Exact matches all correct product and colorway.

### Run: Loro Piana Croco Touch (2026-04-04)

**Image:** Gray suede loafers with croc strap

| Run | Exact Query | Issue | Fix |
|-----|------------|-------|-----|
| 1 | "LP Croco Touch Summer Walk Eucalyptus" | 12/14 Tavily calls failed (can't resolve loropiana.com) | — |

**Current status:** Poor. Tavily can't resolve luxury brand sites. Lens-first would fix this — offers had MILNY PARLON direct link.

### Run: Prada hooded jacket (2026-04-04)

**Image:** Navy blue hooded zip-up jacket

| Run | Exact Query | Issue | Fix |
|-----|------------|-------|-----|
| 1 (heuristic) | "Harry and Zoe's NYC Stroll" | Heuristic picked reseller over brand | LLM-first reconciliation |
| 2 (LLM) | none (medium) | LLM couldn't identify brand | Added related_search to input |

**Current status:** Needs retest with latest LLM prompt.

---

## Architecture Decisions

### Decision: LLM-first reconciliation (not heuristic)
- **Date:** 2026-04-04
- **Why:** Heuristic picked reseller names over brands. LLM understands brand vs store.
- **Heuristic kept as:** Fallback only when LLM fails.

### Decision: No Lens fallback for exact matches
- **Date:** 2026-04-04
- **Why:** Raw Lens fallback replaced ranked results with eBay/Instagram junk.

### Decision: No hard kill filters in ranker
- **Date:** 2026-04-04
- **Why:** Hard requirements rejected valid results where wording differed.

### Decision: Lens-first exact matches (PROPOSED)
- **Date:** 2026-04-05
- **Why:** Google Shopping + Tavily is unreliable for exact matches. Lens already found the product on real stores. Using Lens offers + organic + visual (filtered) as the primary exact match source removes Tavily unreliability and reduces API calls.
- **Alternatives branch:** Unchanged (Google Shopping + Tavily).

---

## Data Sources

| Source | Used For | Quality | Notes |
|--------|----------|---------|-------|
| Bright Data Lens organic | Product URLs (exact match) | High | Direct store URLs. No thumbnails. Filter out social/used |
| Bright Data Lens visual | Product URLs + images (exact match) | High | Has thumbnails. Filter out social/used |
| Bright Data Lens offers | Direct buy links (exact match, best) | Highest | Has price, availability, store name. Not always present |
| Bright Data Lens related_search | Product identification | High | Often has exact product name from Google AI |
| SerpAPI Google Shopping | Store listings (alternatives only) | Medium | Has thumbnails, prices. URLs need Tavily resolution |
| Tavily | URL resolution (alternatives only) | Low-Medium | Unreliable. Wrong pages, failures, duplicates |
| Vision LLM | Image attributes | Low-Medium | Hallucinates brands. Good for generic attributes |
| LLM Reconciliation | Product identification | High | Reads Lens titles + related searches |
| Heuristic Ranking (`rankResults`) | Result sorting | Medium | Not actually LLM despite the name. Token matching + trust scores |

---

## TODO / Known Issues

- [ ] Implement Lens-first exact match process
- [ ] Capture and use Lens `offers` field
- [ ] Add detailed logging for all Lens data (organic URLs, visual URLs, offers)
- [ ] `rankResults` is heuristic, not LLM — misleading name
- [ ] Used product filter only runs on exact branch, not alternatives
- [ ] No deduplication of results across exact + alternatives branches
- [ ] OG image is SVG — Instagram DM previews may not render it (needs PNG)
- [ ] `getProductOffers` rarely returns data — consider removing to reduce complexity

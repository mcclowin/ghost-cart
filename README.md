# 🛒👻 GhostCart

**Agentic commerce API. Identify any product from a photo and find where to buy it.**

GhostCart is an AI-powered commerce API for agents. It identifies products from images using Google Lens + AI Mode, finds where to buy them across stores with real prices, and supports agent-to-agent payments via x402/USDC. It exposes agent identity on ERC-8004 (Base) and issues on-chain receipts for purchases.

## Quick Start

```bash
pnpm install
cp .env.example .env  # Add your API keys
pnpm run dev
```

## API Endpoints

### Identify a product from an image
```bash
POST /api/search-image
Content-Type: multipart/form-data

# Body: image file + optional metadata
```
Returns: product identification (brand, model, colorway), exact match store links, alternative options, and a results page URL.

### Search by text query
```bash
POST /api/search
Content-Type: application/json

{"query": "Nike Air Force 1 Triple Black", "maxResults": 10}
```
Returns: ranked product listings with prices, store URLs, and images.

### Pay via x402 (agent-to-agent)
```bash
POST /api/payments/checkout
Content-Type: application/json

{
  "provider": "locus",
  "amount": "9.99",
  "description": "Purchase via GhostCart",
  "metadata": { "purchaseIntent": { "url": "...", "title": "...", "price": "..." } }
}
```
Supports Locus USDC payments with on-chain receipts.

## How It Works

1. **Send an image** — photo of any product (clothing, shoes, accessories, furniture, anything)
2. **AI identifies it** — Google Lens + AI Mode + LLM determines exact brand, model, and colorway
3. **Find where to buy** — real store links with prices from across the web
4. **Cheaper alternatives** — similar items from other brands, sorted by price
5. **Agent payments** — x402/USDC for autonomous agent purchasing

## Identification Pipeline

```
Image → Google Lens (visual search)
            ↓
      Google AI Mode (product identification)
            ↓
      Venice LLM (extract exact product name + colorway)
            ↓
      Lens offers + organic + visual URLs (store links)
            ↓
      Firecrawl (enrich with real page data + images)
            ↓
      LLM sanity check (verify correct product + colorway)
            ↓
      Results page + API response
```

## Built With

- [Google Lens](https://lens.google.com) via [Bright Data](https://brightdata.com) — Visual product identification
- [Google AI Mode](https://google.com/aimode) via Bright Data Scrapers — Product knowledge graph
- [Venice AI](https://venice.ai) — LLM for product name extraction and ranking
- [Locus](https://paywithlocus.com) — Agent payments + x402
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — Trustless agent identity on Base
- [Firecrawl](https://firecrawl.dev) — Page scraping for images and verification
- [Tavily](https://tavily.com) — Web search for alternatives

## Agent Discovery

- Agent Card: `https://ghostcart.app/.well-known/agent-card.json`
- Skill File: `https://ghostcart.app/skill.md`

## Docs

- [Architecture](docs/architecture.md)
- [Pipeline Development Log](docs/pipeline-log.md)
- [Deployment](docs/deployment.md)

## License

MIT

# GhostCart — Privacy-First Purchasing Agent

> "Shop the internet. Privately. Your agent buys, you stay invisible."

## Overview

GhostCart is an AI-powered purchasing agent that searches across multiple online marketplaces, compares products, and buys on behalf of users — all while keeping their shopping intent and identity private.

Built for the [Synthesis Hackathon](https://synthesis.md/hack/) (March 2026).

## The Problem

Every time you search for a product online, your intent is logged, profiled, and sold. Search for engagement rings? Expect ring ads for months. Research medical supplies? Your health data is inferred.

AI shopping agents (Perplexity, ChatGPT) make this worse — they process your purchase intent through centralized LLMs that log everything.

Meanwhile, agents that want to buy things need pre-funded accounts or working capital. There's no credit system for agents.

## The Solution

GhostCart is:
1. **Private** — Search queries processed by Venice AI (zero data retention, uncensored)
2. **Multi-marketplace** — Searches eBay, Amazon, AliExpress, specialist stores simultaneously
3. **Buy-on-behalf** — Agent holds store accounts and purchases for you. Stores see the agent, not you.
4. **Credit-enabled** — Agent builds on-chain credit history via Bond.Credit. Uses ZK-verified Stripe receivables (Reclaim Protocol) to get instant credit advances for purchases.
5. **Agent-accessible** — Other agents can use GhostCart via x402 paid API

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     USER                             │
│  "I need a replacement Bosch dishwasher spray arm"   │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│                 GHOSTCART AGENT                       │
│           Registered on ERC-8004 (Base)              │
│                                                      │
│  1. Venice AI interprets request privately            │
│     → extracts: product type, brand, model,          │
│       compatible part numbers                        │
│                                                      │
│  2. Parallel search across marketplaces:              │
│     ├─ eBay Browse API                               │
│     ├─ Amazon (scrape via Firecrawl/Locus)           │
│     ├─ AliExpress (scrape via Firecrawl/Locus)       │
│     └─ Specialist stores (scrape via Tavily/Google)  │
│                                                      │
│  3. Venice AI ranks results:                          │
│     → price, shipping, seller rating, relevance      │
│     → flags counterfeits/suspicious listings         │
│                                                      │
│  4. Returns comparison to user                        │
│  5. User picks one → pays via card or USDC            │
│  6. Agent buys using its store account                │
│     (funded by Bond.Credit line if needed)            │
│  7. Ships to user's address                           │
└─────────────────────────────────────────────────────┘
```

## Payment Flow

### Human Users
- **Card**: Stripe Checkout → agent fronts purchase via Bond.Credit → Stripe settles in 2-7 days → agent repays
- **Crypto**: USDC via Locus Checkout → instant settlement → agent buys immediately

### Agent-to-Agent
- **x402**: Other agents pay USDC per query automatically via x402 protocol

### Credit Line (Bond.Credit + ZK-TLS)
```
1. User pays £17 via Stripe (pending settlement)
2. ZK-TLS proof via Reclaim Protocol: "Stripe confirms incoming £17"
3. Bond.Credit verifies proof on-chain → advances 15 USDC instantly
4. Agent buys item with advanced USDC
5. Stripe settles in 3 days → agent repays Bond.Credit
6. Agent's on-chain credit score improves
```

## User Surfaces

| Surface | Users | Payment Method |
|---------|-------|---------------|
| Web UI | Humans | Stripe (card) + USDC |
| Telegram Bot | Humans | Locus payment link |
| skill.md / API | Other agents | x402 auto-pay |
| ERC-8004 Agent Card | Discovery | On-chain |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js + Express |
| LLM | Venice AI (OpenAI-compatible, zero data retention) |
| Search - eBay | eBay Browse API (free) |
| Search - General | Tavily Search API + Google Custom Search |
| Search - Scraping | Firecrawl via Locus wrapped APIs |
| Card Payments | Stripe Checkout (test mode for demo) |
| Crypto Payments | Locus (USDC on Base) |
| Agent Payments | x402 via Locus |
| Agent Identity | ERC-8004 on Base |
| Agent Credit | Bond.Credit |
| ZK Proofs | Reclaim Protocol (ZK-TLS for Stripe verification) |
| Hosting | rock-5a / Railway |

## Hackathon Tracks

| Track | Integration |
|-------|------------|
| **Venice AI** | Core — private product search + comparison |
| **Locus** | x402 agent payments + wrapped APIs + Checkout |
| **Base** | ERC-8004 agent identity + on-chain receipts |
| **Bond.Credit** | Agent credit scoring + credit line |
| **Open Track** | ✅ |

## Privacy Model

- **Venice AI**: Zero data retention. Shopping queries never logged or used for training.
- **Store accounts**: Stores see GhostCart's identity, not the user's. No profiling.
- **On-chain**: Purchase receipts are on-chain but user identity is pseudonymous (wallet address only).
- **ZK proofs**: Stripe payment verification without exposing full financial details.

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/search | API key or x402 | Submit search query |
| GET | /api/results/:id | API key | Get search results |
| POST | /api/buy | API key + payment | Purchase selected item |
| GET | /api/orders/:id | API key | Track order status |
| POST | /webhook/stripe | Stripe signature | Handle payment events |
| GET | /skill.md | Public | Agent skill file for discovery |
| GET | /.well-known/agent-card.json | Public | ERC-8004 agent card |

## Revenue Model

| Source | Amount |
|--------|--------|
| Search fee | $0.50 per search (x402 for agents) |
| Purchase service fee | 10-15% on "buy for me" orders |
| Affiliate commissions | 1-6% on "buy yourself" link clicks |

## Build Phases

### Phase 1: Core Search (Hours 1-3)
- Express server + basic routes
- Venice AI integration
- eBay Browse API integration
- Web UI with search + results

### Phase 2: Payments (Hours 3-5)
- Stripe Checkout (test mode)
- Locus registration + x402 endpoint
- Firecrawl via Locus for Amazon/AliExpress scraping

### Phase 3: On-Chain + Credit (Hours 5-7)
- ERC-8004 registration on Base
- Bond.Credit integration
- Reclaim Protocol ZK-TLS (Stripe proof)
- On-chain purchase receipts

### Phase 4: Polish + Submit (Hours 7-8)
- Telegram bot interface
- skill.md for agent discovery
- Demo video
- Hackathon submission

## Team

- **Mohammed** (@m38mah) — Product + Strategy
- **McClowin** 🍊🤖 — Engineering + Research

## License

MIT

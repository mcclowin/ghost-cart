# 🛒👻 GhostCart

**Shop the internet. Privately. Your agent buys, you stay invisible.**

GhostCart is a privacy-first AI purchasing agent that searches across multiple marketplaces, compares products, and buys on behalf of users — powered by Venice AI (zero data retention), with payments via Stripe + USDC, agent identity on ERC-8004 (Base), and credit lines via Bond.Credit.

## Quick Start

```bash
npm install
cp .env.example .env  # Add your API keys
npm run dev
```

## How It Works

1. **Tell it what you need** — natural language, any product
2. **Agent searches privately** — Venice AI processes your query with zero data retention
3. **Compare across stores** — eBay, Amazon, AliExpress, specialist stores
4. **Buy your way** — direct link (free), or agent buys for you (service fee)
5. **Stay invisible** — stores see the agent, not you

## Built With

- [Venice AI](https://venice.ai) — Private, uncensored LLM
- [Locus](https://paywithlocus.com) — Agent payments + x402
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — Trustless agent identity on Base
- [Bond.Credit](https://bond.credit) — On-chain agent credit
- [Reclaim Protocol](https://reclaimprotocol.org) — ZK-TLS proofs
- [Stripe](https://stripe.com) — Card payments

## Hackathon

Built for [The Synthesis](https://synthesis.md/hack/) — March 2026.

See [docs/plan.md](docs/plan.md) for full architecture and implementation plan.

## License

MIT

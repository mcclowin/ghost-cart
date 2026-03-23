# 🛒👻 GhostCart

**Shop the internet. Privately. GhostCart searches, collects payment, and prepares checkout while keeping your intent out of the usual shopping loop.**

GhostCart is a privacy-first AI purchasing agent that searches across multiple marketplaces, compares products, collects payment through Stripe or USDC, and prepares merchant checkout in the background. It is powered by Venice AI (zero data retention), exposes agent identity on ERC-8004 (Base), and is designed to support a future credit layer through Bond.Credit. The remaining step for full autonomous purchase execution is GhostCart's own programmatic Visa payment rail, with Visa CLI intended to handle the final checkout payment step and 3DS.

## Quick Start

```bash
pnpm install
cp .env.example .env  # Add your API keys
pnpm run dev
```

## How It Works

1. **Tell it what you need** — natural language, any product
2. **Agent searches privately** — Venice AI processes your query with zero data retention
3. **Compare across stores** — eBay, Amazon, AliExpress, specialist stores
4. **Buy your way** — direct link (free), or pay GhostCart to prepare the purchase flow
5. **Stay invisible** — stores see the agent, not you

## Built With

- [Venice AI](https://venice.ai) — Private, uncensored LLM
- [Locus](https://paywithlocus.com) — Agent payments + x402
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — Trustless agent identity on Base
- [Bond.Credit](https://bond.credit) — On-chain agent credit
- [Reclaim Protocol](https://reclaimprotocol.org) — ZK-TLS proofs
- [Stripe](https://stripe.com) — Card payments

## Testing

### For humans (Stripe test mode)
Stripe is in test mode. Use test card `4242 4242 4242 4242` with any future expiry and any CVC to complete a payment.

### For agents (demo provider)
Agents can use the `demo` payment provider for instant, zero-cost end-to-end testing:

```bash
curl -X POST https://ghostcart.app/api/payments/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "demo",
    "amount": "9.99",
    "description": "GhostCart demo purchase",
    "metadata": {
      "purchaseIntent": {
        "url": "https://www.amazon.co.uk/dp/B0CRG38CXK",
        "title": "USB-C Cable",
        "price": "£9.99",
        "marketplace": "Amazon"
      }
    }
  }'
```

The demo provider auto-confirms instantly — no real funds, no checkout UI. The full flow runs: payment → receipt → background purchase automation.

### For agents (Locus USDC)
Agents with a Locus wallet and USDC balance can pay via `"provider": "locus"` for real on-chain payments.

## Hackathon

Built for [The Synthesis](https://synthesis.md/hack/) — March 2026.

## Docs

- [Docs Index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [User Guide](docs/user-guide.md)
- [Plan](docs/plan.md)

Live URLs:

- `https://ghostcart.app/`
- `https://ghostcart.app/skill.md`
- `https://ghostcart.app/.well-known/agent-card.json`

## License

MIT

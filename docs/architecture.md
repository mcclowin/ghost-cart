# GhostCart Architecture

GhostCart is a privacy-first purchasing agent. A user or another agent describes a product, GhostCart searches and ranks options, GhostCart collects payment, and then GhostCart prepares the merchant checkout in the background.

## System Diagram

```mermaid
flowchart TD
    C[Human or Agent Client] --> UI[GhostCart Web UI or API]

    UI --> SEARCH[POST /api/search]
    SEARCH --> PARSE[Venice or fallback query parser]
    SEARCH --> SHOP[Google Shopping via SerpAPI]
    SHOP --> RESOLVE[Tavily URL resolution]
    RESOLVE --> VALIDATE[Firecrawl or wrapped Firecrawl validation]
    VALIDATE --> RANK[Ranking layer]
    RANK --> UI

    UI --> PAY[POST /api/payments/checkout]
    PAY --> STRIPE[Stripe Checkout]
    PAY --> LOCUS[Locus Checkout]

    STRIPE --> WEBHOOKS[Stripe and Locus webhooks]
    LOCUS --> WEBHOOKS
    WEBHOOKS --> STORE[In-memory payment and receipt store]

    STORE --> PURCHASE[Background purchase orchestration]
    PURCHASE --> BROWSER[Locus Browser Use]
    BROWSER --> MERCHANT[Merchant site]

    UI --> SKILL[/skill.md]
    UI --> CARD[/.well-known/agent-card.json]
```

## Main Flows

### Search Flow

1. A query is sent to `POST /api/search`.
2. GhostCart parses the request into structured search terms.
3. Google Shopping provides initial candidates.
4. Redirected merchant links are resolved.
5. Candidate product pages are optionally validated.
6. Results are ranked by relevance, value, and trust.

Relevant code:

- [src/routes/search.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/routes/search.js)
- [src/services/venice.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/venice.js)
- [src/services/search-serp.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/search-serp.js)
- [src/services/search-web.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/search-web.js)

### Payment Flow

1. A caller creates a payment session through `POST /api/payments/checkout`.
2. GhostCart creates a hosted Stripe or Locus checkout session.
3. The caller completes the payment in the provider checkout.
4. GhostCart receives webhook or polling confirmation.
5. A local receipt is created for the payment.

Relevant code:

- [src/routes/payments.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/routes/payments.js)
- [src/routes/webhook.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/routes/webhook.js)
- [src/services/stripe.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/stripe.js)
- [src/services/locus.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/locus.js)
- [src/services/payments-store.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/payments-store.js)

### Background Purchase Flow

1. A payment session may include `metadata.purchaseIntent`.
2. After payment becomes `PAID`, GhostCart starts background merchant checkout automation.
3. Browser Use opens the merchant site, verifies the item, adds it to cart if possible, and proceeds through checkout.
4. The current flow stops before entering the final merchant payment details and placing the final merchant order.
5. The intended next step is GhostCart's own Visa CLI-backed payment rail, which is expected to handle the final checkout payment step, including 3DS, so orders can be placed automatically.

Relevant code:

- [src/services/purchase.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/purchase.js)
- [src/routes/buy.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/routes/buy.js)

## Public Surface

The deployment is expected to serve:

- `https://ghostcart.app/`
- `https://ghostcart.app/skill.md`
- `https://ghostcart.app/.well-known/agent-card.json`
- `https://ghostcart.app/health`

The skill route is defined in [src/index.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/index.js), and the agent card is built in [src/services/erc8004.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/erc8004.js).

## Trust And Identity

GhostCart exposes an ERC-8004-style agent card. The public URLs advertised by the card are derived from `AGENT_BASE_URL`, so deployment configuration matters directly to discovery and identity.

Relevant code:

- [src/services/erc8004.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/erc8004.js)

## Current Limitations

- Payment and receipt state are stored in memory, so restarts clear them.
- Background checkout automation does not yet complete final merchant payment submission.
- Visa CLI is the intended missing component for full automatic order placement, including the final payment and 3DS step.
- Search quality depends on the configured search and LLM providers.
- Bond.Credit remains a planned credit layer, not a production funding dependency.

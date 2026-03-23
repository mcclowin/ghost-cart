# GhostCart

GhostCart is a privacy-first purchasing agent.

It currently supports:

- private product search across multiple stores
- ranked result comparison
- payment session creation through Stripe or Locus
- background merchant checkout preparation after payment is confirmed

GhostCart currently does **not** finalize merchant checkout automatically. The background purchase flow stops before entering merchant payment credentials or placing the final order.

## What GhostCart Does

1. Accept a natural-language product request.
2. Parse the request into structured search terms.
3. Search across marketplace and web sources.
4. Rank candidate products by relevance, value, and trust.
5. Create a GhostCart payment session.
6. After payment is confirmed, start background browser automation against the merchant site.
7. Return progress updates about the checkout state.

## Privacy Model

- Search intent is processed through Venice AI when configured.
- Stores see GhostCart interacting with the merchant surface, not the user's search session.
- ERC-8004 metadata can be exposed through the agent card endpoint.

## Authentication

All `/api/*` endpoints require a Bearer token when the server has `GHOSTCART_API_KEY` configured.

Include the API key in the `Authorization` header:

```
Authorization: Bearer gc_your_api_key_here
```

If the server has no `GHOSTCART_API_KEY` set, authentication is disabled (development mode) and all requests pass through without a token.

**Error responses:**

| Status | Body |
|--------|------|
| `401`  | `{"error": "unauthorized", "message": "API key required. Pass Authorization: Bearer <key>"}` |
| `403`  | `{"error": "forbidden", "message": "Invalid API key"}` |

Public endpoints that do **not** require authentication:

- `GET /health`
- `GET /.well-known/agent-card.json`
- `GET /skill.md`
- `POST /webhook/*`
- `GET /` (frontend)

## Base URL

Use the host serving this file as the API base.

Examples below assume:

```text
https://your-ghostcart-host.example
```

## Endpoints

### 1. Search products

`POST /api/search`

Request:

```json
{
  "query": "replacement Bosch dishwasher spray arm SMV40C30GB",
  "maxResults": 8
}
```

Response shape:

```json
{
  "searchId": "uuid",
  "query": "replacement Bosch dishwasher spray arm SMV40C30GB",
  "resultCount": 6,
  "results": {
    "results": [
      {
        "rank": 1,
        "title": "Bosch dishwasher spray arm replacement",
        "marketplace": "eBay",
        "url": "https://...",
        "price": "£17.99",
        "image": "https://...",
        "relevanceScore": 92,
        "valueScore": 81,
        "trustScore": 73,
        "overallScore": 86,
        "recommendation": "Top pick with strong relevance and pricing",
        "warnings": []
      }
    ],
    "bestPick": "Short explanation of the best option",
    "filtered": []
  },
  "duration": 1823,
  "sources": {
    "googleShopping": 20,
    "directUrls": 8,
    "resolvedUrls": 5,
    "validatedUrls": 4
  },
  "privacy": "All queries processed with zero data retention"
}
```

Use this endpoint first. The ranked results already include the merchant URL to use later in the checkout flow.

### 2. Fetch a stored search result set

`GET /api/results/:searchId`

This returns the stored search record for a previous search request.

### 3. Create a payment session

`POST /api/payments/checkout`

Providers:

- `demo` for instant testing (no real funds, auto-confirms immediately)
- `stripe` for card checkout (test mode: use card `4242 4242 4242 4242`)
- `locus` for USDC checkout (requires Locus wallet with USDC balance)

**Recommended for agents:** Use `"provider": "demo"` to test the full end-to-end flow without any funds or human interaction.

For a plain payment session:

```json
{
  "provider": "locus",
  "amount": "19.99",
  "description": "GhostCart demo payment"
}
```

For a purchase-linked payment session that should start background checkout after payment:

```json
{
  "provider": "locus",
  "amount": "19.99",
  "description": "GhostCart purchase: Bosch dishwasher spray arm",
  "metadata": {
    "source": "agent",
    "purchaseIntent": {
      "url": "https://merchant.example/product/123",
      "title": "Bosch dishwasher spray arm",
      "price": "£17.99",
      "marketplace": "eBay",
      "paymentMethod": "usdc"
    }
  }
}
```

Response shape:

```json
{
  "paymentId": "uuid",
  "provider": "locus",
  "status": "PENDING",
  "providerStatus": "PENDING",
  "checkoutUrl": "https://...",
  "sessionId": "external-session-id"
}
```

Behavior:

- the caller opens or shares `checkoutUrl`
- GhostCart waits for provider confirmation
- if `metadata.purchaseIntent` is present and the payment becomes `PAID`, GhostCart starts background merchant checkout automation automatically

### 4. Poll payment and purchase status

`GET /api/payments/:paymentId`

This is the main status endpoint after creating a payment session.

Response shape:

```json
{
  "payment": {
    "id": "uuid",
    "provider": "locus",
    "amount": "19.99",
    "currency": "USDC",
    "status": "PAID",
    "providerStatus": "PAID",
    "checkoutUrl": "https://...",
    "paidAt": "2026-03-23T12:00:00.000Z"
  },
  "receipt": {
    "id": "uuid",
    "provider": "locus",
    "externalId": "external-session-id",
    "paymentTxHash": "0x...",
    "payerAddress": "0x..."
  },
  "purchase": {
    "status": "started",
    "stage": "cart",
    "summary": "Item added to cart",
    "pageUrl": "https://merchant.example/cart",
    "blockers": [],
    "paymentOptions": ["card", "paypal"],
    "requiresUserInput": false,
    "stepCount": 6,
    "lastAction": "Click element 5",
    "screenshotUrl": "https://..."
  }
}
```

Interpretation:

- `payment.status` tracks the payment provider state
- `receipt` is present after payment succeeds
- `purchase` is present when GhostCart has started or attempted background checkout automation

### 5. Fetch a payment receipt

`GET /api/payments/:paymentId/receipt`

This returns the stored receipt for a paid payment.

### 6. Start checkout automation directly

`POST /api/buy`

Request:

```json
{
  "url": "https://merchant.example/product/123",
  "title": "Bosch dishwasher spray arm",
  "price": "£17.99",
  "marketplace": "eBay",
  "paymentMethod": "card"
}
```

This starts browser automation without going through GhostCart payment collection first.

Use this only when payment has already been handled elsewhere or when you want checkout-preparation behavior only.

### 7. Poll checkout automation directly

`GET /api/buy/:taskId`

This returns the latest checkout automation snapshot:

- current status
- inferred stage such as `product`, `cart`, `shipping`, `payment`, `login_required`, `blocked`, `mismatch`, or `input_required`
- latest summary
- blockers
- payment options seen on page
- screenshot URL when available

## Recommended Agent Flow

For most agent use cases, use this sequence:

1. Call `POST /api/search`
2. Select one ranked result
3. Call `POST /api/payments/checkout` with `metadata.purchaseIntent`
4. Open or complete the returned `checkoutUrl`
5. Poll `GET /api/payments/:paymentId` until payment is terminal and purchase status is available
6. If needed, inspect the receipt with `GET /api/payments/:paymentId/receipt`

## Current Limits

- GhostCart does not yet place the final merchant order automatically.
- Background checkout automation stops before submitting merchant payment credentials.
- Some payment and purchase records are currently stored in memory, so they are not durable across restarts.
- Search quality depends on configured provider keys such as Venice, SerpAPI, Tavily, Firecrawl, Stripe, and Locus.

## Discovery

- Agent card: `/.well-known/agent-card.json`
- Health check: `/health`

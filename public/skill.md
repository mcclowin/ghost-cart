# GhostCart

GhostCart is an agentic commerce API that identifies products from images and finds where to buy them.

It currently supports:

- visual product identification from photos (brand, model, colorway)
- text-based product search across multiple stores
- ranked result comparison with prices and images
- payment session creation through Locus (x402/USDC)
- on-chain receipts for agent purchases

## What GhostCart Does

1. Accept a product image or natural-language product request.
2. Identify the exact product using Google Lens + AI Mode + LLM.
3. Find where to buy it across stores with real prices.
4. Find cheaper alternatives from other brands.
5. Create a payment session via x402/USDC for agent-to-agent commerce.
6. Issue on-chain receipts on Base.

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

## Endpoints

### 1. Identify a product from an image

`POST /api/search-image`

Send a product image and get back the exact identification + store links.

Request: `multipart/form-data` with an `image` file field.

Response shape:

```json
{
  "dm_text": "Short summary of what was found",
  "page_url": "https://ghostcart.app/find/abc12345",
  "searchId": "abc12345",
  "resultCount": 4,
  "duration": 25000,
  "discovery": {
    "exactModel": "Alo Yoga Sweet Escape Zip Up Hoodie",
    "exactSearchQuery": "Alo Yoga Sweet Escape Zip Up Hoodie Candy Heart Pink",
    "confidence": "high"
  },
  "results": {
    "results": [
      {
        "rank": 1,
        "title": "Sweet Escape Zip Up Hoodie - Candy Heart Pink",
        "marketplace": "aloyoga.com",
        "url": "https://...",
        "price": "$128",
        "image": "https://..."
      }
    ]
  }
}
```

### 2. Search products by text

`POST /api/search`

Request:

```json
{
  "query": "Nike Air Force 1 Triple Black",
  "maxResults": 8
}
```

Response shape:

```json
{
  "searchId": "uuid",
  "query": "Nike Air Force 1 Triple Black",
  "resultCount": 6,
  "results": {
    "results": [
      {
        "rank": 1,
        "title": "Nike Air Force 1 '07",
        "marketplace": "Nike",
        "url": "https://...",
        "price": "£115",
        "image": "https://...",
        "overallScore": 86
      }
    ],
    "bestPick": "Short explanation of the best option"
  },
  "duration": 1823
}
```

### 3. Create a payment session (x402/USDC)

`POST /api/payments/checkout`

Providers:

- `demo` for instant testing (no real funds, auto-confirms)
- `locus` for USDC checkout via x402 (requires Locus wallet)

**Recommended for agents:** Use `"provider": "locus"` for real USDC payments on Base.

```json
{
  "provider": "locus",
  "amount": "19.99",
  "description": "GhostCart purchase",
  "metadata": {
    "purchaseIntent": {
      "url": "https://merchant.example/product/123",
      "title": "Product name",
      "price": "£17.99",
      "marketplace": "Store"
    }
  }
}
```

### 4. Poll payment status

`GET /api/payments/:paymentId`

### 5. Fetch receipt

`GET /api/payments/:paymentId/receipt`

## Recommended Agent Flow

1. Call `POST /api/search-image` with a product photo
2. Get back identified product + store links
3. Select a product to purchase
4. Call `POST /api/payments/checkout` with `metadata.purchaseIntent`
5. Complete payment via x402/USDC
6. Poll `GET /api/payments/:paymentId` for status + receipt

## Discovery

- Agent card: `/.well-known/agent-card.json`
- Health check: `/health`

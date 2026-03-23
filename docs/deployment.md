# Deployment

This document describes the current recommended deployment path for GhostCart.

## Recommended Platform

Deploy GhostCart as a normal Node.js service on Railway.

This is the current recommendation because GhostCart is an Express app with:

- webhook endpoints
- background checkout orchestration
- in-memory payment state
- public API and static pages served from one process

## Runtime

GhostCart should run with:

```bash
npm start
```

The production start script is defined in [package.json](/home/ubuntu/Dropbox/WEB/ghost-cart/package.json).

## Domain

The canonical public domain is:

```text
https://ghostcart.app
```

Expected public URLs:

- `https://ghostcart.app/`
- `https://ghostcart.app/skill.md`
- `https://ghostcart.app/.well-known/agent-card.json`
- `https://ghostcart.app/health`
- `https://ghostcart.app/webhook/stripe`
- `https://ghostcart.app/webhook/locus`

## Railway Settings

Recommended service settings:

- Start command: `npm start`
- Healthcheck path: `/health`
- Public networking: enabled
- Serverless: disabled
- Replicas: `1`

Use a single replica because payment and receipt state are currently stored in memory.

## Environment Variables

The following variables are relevant to deployment.

### Core

```bash
NODE_ENV=production
AGENT_BASE_URL=https://ghostcart.app
```

### Search and ranking

```bash
VENICE_API_KEY=
SERPAPI_KEY=
TAVILY_API_KEY=
FIRECRAWL_API_KEY=
```

### Payments

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CHECKOUT_CURRENCY=gbp

LOCUS_API_KEY=
LOCUS_API_BASE=https://beta-api.paywithlocus.com/api
LOCUS_WEBHOOK_SECRET=
LOCUS_CHECKOUT_INSTANCE_ID=
```

### Identity

```bash
AGENT_NAME=GhostCart
AGENT_DESCRIPTION=GhostCart is a privacy-first AI purchasing agent that searches across marketplaces and buys on behalf of users. Built by Mohammed and McClowin.
BASE_RPC_URL=https://mainnet.base.org
ERC8004_RPC_URL=
ERC8004_PRIVATE_KEY=
```

See [/.env.example](/home/ubuntu/Dropbox/WEB/ghost-cart/.env.example) for the full current example configuration.

## ERC-8004 URL

The public agent registration file should resolve at:

```text
https://ghostcart.app/.well-known/agent-card.json
```

That is the URL that should be used as the agent URI for GhostCart's ERC-8004 registration.

The skill URL advertised by the agent card should be:

```text
https://ghostcart.app/skill.md
```

## Webhook Configuration

### Stripe

Configure the Stripe webhook endpoint as:

```text
https://ghostcart.app/webhook/stripe
```

### Locus

Configure the Locus webhook endpoint as:

```text
https://ghostcart.app/webhook/locus
```

## Smoke Tests

After deployment, verify:

1. `GET /health`
2. `GET /skill.md`
3. `GET /.well-known/agent-card.json`
4. `POST /api/search`
5. `POST /api/payments/checkout`

## Current Risk

GhostCart is deployable today, but not yet fully durable.

The biggest current production risk is that payment and receipt state live in memory. A restart or redeploy clears those records. For demos and hackathon judging this is acceptable; for production usage, persistent storage should be added first.

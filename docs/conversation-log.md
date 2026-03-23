# GhostCart Conversation Log

This file is a working summary of the human-agent collaboration behind GhostCart. It is not a verbatim transcript. It captures the major technical decisions, pivots, blockers, and outcomes so the build process can be reviewed later and reused in submission material.

## Current Session

### Search Pipeline

- We revisited the `SerpAPI -> Tavily -> Firecrawl -> ranking` pipeline because the UI was returning too few results for queries like `mustard puffy jacket for men`.
- We confirmed the main issue was not Tavily alone. Validated pages were still being dropped by the heuristic ranker after validation.
- We changed validation and ranking so Firecrawl passes structured validation signals into the ranker, instead of forcing the ranker to infer everything from a short text snippet.
- We softened style/product-type filtering while keeping explicit color, brand, and model requirements stronger.
- We also tightened category-page rejection to remove generic landers like brand home pages and `/categories/...` pages.

### Checkout Automation

- We confirmed Browser Use can reach merchant checkout pages in the background, but the early UX exposed too much of the raw automation state.
- We decided the user should not see raw internal blockers in normal flow.
- The intended user experience is:
  1. select item
  2. provide shipping details
  3. pay GhostCart
  4. see `Purchasing...`
  5. GhostCart continues the merchant checkout in the background
- We refactored the code so payment confirmation can trigger background purchase automation server-side instead of depending on the frontend tab staying open.
- We reduced coupling by moving the Browser Use orchestration into a shared purchase service.

### Stripe + Locus Payments

- We implemented GhostCart-owned payment collection instead of treating payment choice as just a hint for merchant checkout.
- Stripe was set up for human card payments.
- Locus Checkout was set up for USDC and agent-payable GhostCart sessions.
- We verified the real Locus merchant session route and later converged on the current GhostCart payment entrypoint at `POST /api/payments/checkout`.
- We installed and configured Stripe CLI locally for webhook forwarding.
- Stripe webhook delivery was verified end-to-end with `checkout.session.completed -> 200 OK`.
- Locus session creation was also verified.

### ERC-8004 + Receipts

- We registered GhostCart independently on Base via ERC-8004.
- Registration succeeded:
  - registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
  - agentId: `35889`
  - agentURI: `https://ghostcart.app/.well-known/agent-card.json`
- We agreed that receipts should be tied to GhostCart’s ERC-8004 identity, but stored as separate payment/purchase artifacts rather than inside the ERC-8004 registry itself.
- We implemented a local payment/receipt store so Stripe and Locus payments now create receipt records that can later be upgraded to on-chain proofs.
- We then verified the ERC-8004 design against the spec and confirmed that:
  - ERC-8004 defines identity, reputation, and validation registries
  - payments and receipts are orthogonal to the protocol
  - the correct GhostCart design is a separate receipts contract linked back to the registered agent identity
- We added a dedicated receipts contract deployment flow on Base.
- Deployment succeeded:
  - receipts contract: `0xac689e780712f12861d900640a84b7ff42566335`
- We updated GhostCart so paid Stripe and Locus sessions attempt to write receipt proofs on-chain after payment settlement.
- We updated the agent card builder so GhostCart can expose deployed receipts-contract metadata from local deployment state.
- We also linked the deployed receipts contract back into GhostCart’s ERC-8004 identity metadata using the key `receiptsContract`.
- The metadata link transaction succeeded:
  - tx: `0xcaff70a477a1e4c763866b1cc48577a9eeb94998b9ef5ada1569592181cc7cbe`
- Along the way, we had to fix three deployment issues:
  - the receipts deploy script was not preloading `.env`
  - the deploy path was using a runtime ABI that did not include the contract constructor
  - the ERC-8004 metadata write needed explicit pending-nonce handling to avoid underpriced replacement errors
- We added a separate recovery command so the deployed receipts contract can be linked into ERC-8004 metadata without redeploying.

### Skill / `skill.md`

The intent around `skill.md` was:

> I was trying to move it out of the server file so:
>
> - the skill lives as a real `skill.md` file
> - it’s easier to edit and review
> - the served content matches the file in the repo
> - we stop keeping a big markdown blob embedded in app code
>
> That said, I hadn’t applied the change. I stopped when you interrupted.
>
> If you want zero routing changes, we can do either of these:
>
> 1. Keep the route in `index.js` and just rewrite the inline markdown string there.
> 2. Add `public/skill.md` and leave `index.js` alone for now, then switch it later.
>
> I’d still recommend option 2 eventually, but if you want minimal change right now I can just update the inline `/skill.md` response and nothing else.

That migration was completed later. GhostCart now serves a real file-backed skill from [public/skill.md](/home/ubuntu/Dropbox/WEB/ghost-cart/public/skill.md), routed through [src/index.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/index.js).

### Landing Page UX Polish

- We tightened the landing page after real usage exposed awkward flow and spacing issues.
- The `skill.md` panel on the homepage was too visually heavy between the search box and the results.
- We changed the UI so:
  - the skills panel starts collapsed
  - it can be expanded on demand
  - it now sits lower on the page instead of interrupting the search-to-results flow
- We also changed search behavior so the page scrolls down to the results/status area after a search completes.
- We tightened the buy modal layout because the shipping form was pushing the payment buttons off-screen on smaller viewports.
- The modal now:
  - allows scrolling when needed
  - keeps more shipping fields side-by-side
  - preserves a mobile fallback at smaller breakpoints

## Earlier Sessions

These milestones are reconstructed from the project history and prior collaboration in this repo.

### Initial Search and Env Fixes

- We fixed dotenv loading order for ESM so API keys were available before service modules initialized.
- We improved logging to make provider and key-loading issues visible.
- We added SerpAPI Google Shopping and refactored the search pipeline around it.

Relevant commits:

- `9742b5f` Fix dotenv load order
- `80e1f3b` Add SerpAPI Google Shopping pipeline
- `4b47b3d` Improve provider/key logging

### Search Quality Iterations

- We moved from a more LLM-heavy result cleanup approach to deterministic ranking because Venice was unreliable for strict JSON ranking output.
- We fixed price display and API-key diagnostics.
- We added category-aware store selection and better price extraction.
- We introduced the resolved URL pipeline and Browser Use scaffolding.
- We then narrowed Tavily usage from “search again broadly” toward a more constrained per-product resolver.

Relevant commits:

- `ca48d0e` Better UI and result filtering
- `f2491c4` Better marketplace/category handling
- `8fce686` Price display and env debug
- `c7af608` Deterministic ranking
- `f368b87` Resolved search pipeline and buy scaffolding
- `95cacd8` Prefer direct store URLs from SerpAPI
- `3f112f6` One Tavily call per product, color-aware softer validation

### Browser Use and Checkout Visibility

- We implemented Browser Use integration through Locus.
- We discovered the initial modal was flashing because status snapshots were being overwritten by stale polling responses.
- We added checkpoint history and better task-progress visibility.
- We later reduced exposure of raw internal automation details in favor of a more product-like progress model.

Relevant commits:

- `cee55d1` Improve product validation and checkout progress reporting
- `9914d60` Improve checkout task progress visibility

## Current Open Questions

### Shipping Address

- The agreed direction is to collect or confirm shipping address before payment, not after payment.
- This likely belongs in the buy modal or a profile layer before the payment buttons are shown.

### Auth

- We need a user auth strategy and likely a saved profile model for shipping details.
- Stytch is the likely direction:
  - Consumer Auth for human users
  - Connected Apps / OAuth-style delegation for agents later

### Final Merchant Spend Path

- GhostCart can now collect payment from users.
- GhostCart can also start background merchant checkout automation.
- The remaining gap is a robust final merchant-side spend instrument for fully autonomous purchase completion.

## Suggested Use In Submission

This document can be adapted into:

- the `conversationLog` field for hackathon submission
- a shorter “build log” section in the README
- a demo narration outline explaining the product’s technical pivots

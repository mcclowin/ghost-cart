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
- We verified the real Locus merchant session route and implemented it as `POST /api/checkout/sessions`.
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

That migration still has not been completed. The skill response is still effectively server-owned and should eventually be moved into a real file.

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

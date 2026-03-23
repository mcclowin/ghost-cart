# Bond.Credit Fit And Integration Notes

## Purpose

This document explains how GhostCart intends to use Bond.Credit, what is currently implemented in the repo, what remains hypothetical, and how the credit layer should be designed so the product can ship before a final financing partner is confirmed.

It is written for contributors reviewing the repository, not as an external pitch.

## Product Goal

GhostCart wants to solve a working-capital gap for autonomous purchasing:

1. A user pays GhostCart for an item.
2. Card payments may remain pending before funds are fully available.
3. GhostCart still wants to purchase the item immediately.
4. A financing layer should front capital during that settlement window.
5. The financing layer should be repaid once funds settle.

The intended long-term design is to pair:

- Stripe for user card collection
- Reclaim zkTLS for proof of Stripe payment state, including the fact that funds are pending settlement
- ERC-8004 for agent identity and reputation
- Bond.Credit for underwriting, scoring, or capital access

## Why Bond.Credit Is Relevant

Bond.Credit is relevant to GhostCart because its public positioning is aligned with:

- onchain agent reputation
- creditworthiness derived from agent behavior
- capital routing to autonomous agents
- increasing credit access as verifiable history improves

That aligns with GhostCart's thesis that agents should not always require manual prefunding.

## Current Repo State

The repository currently supports only part of the intended flow.

### Implemented

- Product search and ranking
- Browser-based checkout automation through Locus
- ERC-8004 agent card generation and registration metadata

### Not Implemented Yet

- Stripe Checkout or PaymentIntent flow
- Stripe settlement tracking
- Reclaim proof generation or verification
- Bond.Credit borrowing flow
- Repayment reconciliation tied to settled receivables

## Evidence In This Repository

The intended Bond.Credit flow already appears in the product plan:

- [docs/plan.md](/home/ubuntu/Dropbox/WEB/ghost-cart/docs/plan.md#L63) describes card payments being fronted through Bond.Credit until Stripe settles.
- [docs/plan.md](/home/ubuntu/Dropbox/WEB/ghost-cart/docs/plan.md#L72) describes a Reclaim-backed proof flow for advancing funds.

The codebase itself shows that the financing layer is still conceptual:

- [src/routes/buy.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/routes/buy.js#L173) starts checkout automation, but does not create or verify a user payment.
- [src/routes/buy.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/routes/buy.js#L197) returns an insufficient-balance response when the Locus wallet lacks spendable USDC.
- [src/routes/webhook.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/routes/webhook.js#L9) contains only a placeholder Stripe webhook.
- [package.json](/home/ubuntu/Dropbox/WEB/ghost-cart/package.json#L23) does not currently include Stripe dependencies.
- [src/services/erc8004.js](/home/ubuntu/Dropbox/WEB/ghost-cart/src/services/erc8004.js#L29) already exposes the agent card and existing onchain identity metadata.

## Assessment Of Bond.Credit Fit

### Strong Fit

Bond.Credit appears to be a strong fit for:

- agent credit scoring
- reputation-linked borrowing decisions
- onchain performance history
- future capital access once GhostCart has a track record

### Unproven Fit

The following points are not currently evidenced by public documentation reviewed during repository analysis:

- a public self-serve API for borrowing against pending Stripe receivables
- a documented Reclaim-to-Bond verification flow
- a production ecommerce checkout-financing flow
- a documented repayment mechanism tied to Stripe settlement events

For that reason, Bond.Credit should currently be treated as a plausible financing partner, not an already-verified plug-and-play dependency.

## Important Constraint

The Synthesis Bond.Credit partner track that motivated part of this design is centered on live GMX perpetual trading on Arbitrum, not ecommerce checkout financing.

That matters because:

- it validates Bond.Credit's interest in scoring autonomous agents
- it does not directly validate GhostCart's Stripe-settlement financing use case

Contributors should avoid assuming that hackathon track alignment automatically means product-level API support for GhostCart's desired borrowing flow.

## Recommended Architecture

GhostCart should not hardcode Bond.Credit assumptions into the purchase path.

Instead, the codebase should expose a financing abstraction that can support:

- Bond.Credit later
- manual operator approval in the near term
- another lender if needed
- prefunded internal treasury as a fallback

### Suggested Interface

```ts
interface CreditProvider {
  requestAdvance(input: {
    orderId: string;
    amountUsd: string;
    evidence: {
      stripePaymentIntentId?: string;
      reclaimProofId?: string;
      erc8004AgentId?: string;
    };
  }): Promise<{
    status: 'approved' | 'pending' | 'rejected';
    fundingReference?: string;
    availableAmountUsd?: string;
  }>;

  markSettled(input: {
    orderId: string;
    settlementReference: string;
  }): Promise<void>;
}
```

This preserves flexibility while the real financing path is still being validated.

## Recommended Delivery Sequence

### Phase 1

Implement the purchase and settlement rails that are required regardless of financing partner:

1. Stripe Checkout or PaymentIntent creation
2. Order state machine
3. Stripe webhook reconciliation
4. Internal order ledger for purchase, settlement, refund, and repayment states

### Phase 2

Add evidence and trust layers:

1. Reclaim zkTLS proof generation for the relevant Stripe payment state, especially proof that a payment exists and is still pending settlement
2. ERC-8004-linked purchase and repayment records
3. Internal credit event logging for later underwriting

### Phase 3

Attach a financing adapter:

1. manual credit approval or prefunded treasury for initial operation
2. Bond.Credit adapter if a bespoke or public integration becomes available
3. alternate lender adapter if Bond.Credit is not available for this flow

## Open Questions For A Real Bond.Credit Integration

Any contributor exploring a direct Bond.Credit integration should answer these questions first:

1. Does Bond.Credit currently underwrite pending Stripe card receivables?
2. Can Bond.Credit directly consume Reclaim proofs, and on which chain?
3. What asset is actually lent to the agent?
4. Can an ERC-8004 agent on Base borrow for an offchain purchase flow?
5. How is repayment triggered and confirmed?
6. Is there a public API, SDK, or contract interface for third-party applications?
7. How are chargebacks, refunds, and merchant failures handled in the credit model?

## Bottom Line

Bond.Credit is strategically aligned with GhostCart's vision of agent-native working capital.

Within the current repository, however, Bond.Credit should be modeled as:

- an intended credit and underwriting layer
- a future or bespoke integration target
- not yet a verified production dependency for Stripe settlement-gap financing

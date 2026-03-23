# User Guide

This guide describes how GhostCart currently works for a human user.

## What GhostCart Can Do Today

GhostCart can:

- search for products across multiple sources
- rank and compare results
- let a user pay GhostCart through Stripe or Locus
- prepare the merchant checkout in the background after payment succeeds

GhostCart cannot yet place the final merchant order automatically. The intended next step is a Visa CLI-backed GhostCart payment rail that can handle the final checkout payment step and 3DS automatically.

## Basic Flow

### 1. Search

Open `https://ghostcart.app/` and describe the product you want in natural language.

Examples:

- `replacement Bosch dishwasher spray arm SMV40C30GB`
- `men's black puffer jacket size M`
- `USB-C charger for MacBook Air`

GhostCart will return ranked options with marketplace, price, and trust signals.

### 2. Review Results

Each result includes:

- title
- marketplace
- price
- score breakdown
- a direct merchant link
- a GhostCart buy option

You can either:

- click through to buy directly from the merchant
- or ask GhostCart to handle the purchase flow

### 3. Pay GhostCart

If you choose the GhostCart buy path, GhostCart creates a payment session.

Available payment rails:

- Stripe for card payments
- Locus for USDC payments

### 4. Background Checkout

After payment is confirmed, GhostCart can start background automation against the merchant site.

That automation can:

- open the product page
- verify the item
- add it to cart
- move through checkout until shipping or payment stage

### 5. Current Limitation

GhostCart stops before entering merchant payment credentials or placing the final order.

This means the current product is best understood as:

- search and compare
- collect payment
- prepare merchant checkout

not yet fully autonomous final purchase execution

The expected next step is GhostCart's own Visa CLI-backed payment flow, which is intended to unlock fully automatic final order placement.

## What To Expect From Payment Pages

If Stripe checkout succeeds, GhostCart redirects to a success page and the app continues polling for final confirmation.

If checkout is cancelled, GhostCart shows a cancellation page and no payment is recorded as completed.

## Privacy Model

GhostCart is designed to reduce direct exposure of shopping intent:

- query interpretation can run through Venice AI when configured
- merchant interaction happens through GhostCart's flow rather than the user's own browsing session

## Agent And API Usage

If another agent wants to call GhostCart directly, use:

- `https://ghostcart.app/skill.md`

That file documents the agent-facing API contract in detail.

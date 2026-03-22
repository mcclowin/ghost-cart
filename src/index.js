import dotenv from 'dotenv';
dotenv.config(); // MUST be first — before any service imports read env vars

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { searchRouter } from './routes/search.js';
import { buyRouter } from './routes/buy.js';
import { webhookRouter } from './routes/webhook.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for dev — our frontend uses inline scripts
}));
app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static('public'));

// API Routes
app.use('/api', searchRouter);
app.use('/api', buyRouter);
app.use('/webhook', webhookRouter);

// Agent Card (ERC-8004)
app.get('/.well-known/agent-card.json', (req, res) => {
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "GhostCart",
    description: "Privacy-first AI purchasing agent. Searches across multiple marketplaces and buys on your behalf. Powered by Venice AI for zero data retention.",
    image: "https://github.com/mcclowin/ghost-cart/raw/main/public/logo.png",
    endpoints: [
      {
        name: "API",
        endpoint: `http://localhost:${PORT}/api`,
        version: "1.0.0"
      }
    ],
    supportedTrust: ["reputation"],
    capabilities: ["search", "compare", "purchase"],
    pricing: {
      search: "0.50 USDC",
      purchaseFee: "10-15%"
    }
  });
});

// Skill file for agent discovery
app.get('/skill.md', (req, res) => {
  res.type('text/markdown').send(`# GhostCart - Privacy-First Purchasing Agent

## What I Do
I search across multiple online marketplaces, compare products, and buy on behalf of users — all privately via Venice AI (zero data retention).

## Endpoints

### Search for Products
\`\`\`
POST /api/search
Content-Type: application/json

{
  "query": "replacement Bosch dishwasher spray arm SMV40C30GB",
  "maxResults": 5,
  "marketplaces": ["ebay", "amazon", "aliexpress"]
}
\`\`\`

### Get Results
\`\`\`
GET /api/results/:searchId
\`\`\`

### Buy an Item
\`\`\`
POST /api/buy
Content-Type: application/json

{
  "searchId": "...",
  "itemIndex": 0,
  "shippingAddress": { ... }
}
\`\`\`

## Payment
- Agents: x402 (0.50 USDC per search)
- Humans: Stripe (card) or USDC via Locus

## Privacy
All queries processed by Venice AI with zero data retention.
Stores see GhostCart's identity, not yours.
`);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'GhostCart', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`🛒👻 GhostCart running on port ${PORT}`);
});

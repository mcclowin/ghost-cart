import 'dotenv/config'; // Preload env before ESM imports evaluate dependent modules

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { resolve } from 'path';
import { searchRouter } from './routes/search.js';
import { buyRouter } from './routes/buy.js';
import { webhookRouter } from './routes/webhook.js';
import { paymentsRouter } from './routes/payments.js';
import { buildAgentCard } from './services/erc8004.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for dev — our frontend uses inline scripts
}));
app.use(cors());
app.use('/webhook', webhookRouter);
app.use(express.json());

// Serve static frontend
app.use(express.static('public'));

// API Routes
app.use('/api', searchRouter);
app.use('/api', buyRouter);
app.use('/api', paymentsRouter);

// Agent Card (ERC-8004)
app.get('/.well-known/agent-card.json', (req, res) => {
  res.json(buildAgentCard(req));
});

// Skill file for agent discovery
app.get('/skill.md', (req, res) => {
  res.sendFile(resolve(process.cwd(), 'public', 'skill.md'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'GhostCart', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`🛒👻 GhostCart running on port ${PORT}`);
});

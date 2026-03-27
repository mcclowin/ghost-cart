import 'dotenv/config'; // Preload env before ESM imports evaluate dependent modules

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { resolve } from 'path';
import { searchRouter } from './routes/search.js';
import { searchImageRouter } from './routes/search-image.js';
import { pagesRouter } from './routes/pages.js';
import { buyRouter } from './routes/buy.js';
import { webhookRouter } from './routes/webhook.js';
import { paymentsRouter } from './routes/payments.js';
import { buildAgentCard } from './services/erc8004.js';
import { apiKeyAuth } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 1);

// Respect x-forwarded-* headers from ngrok/reverse proxies when building public URLs.
app.set('trust proxy', TRUST_PROXY_HOPS);

// Rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Search rate limit exceeded. This endpoint uses expensive API credits.' },
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Checkout rate limit exceeded, please try again later.' },
});

// Middleware
app.use(globalLimiter);
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for dev — our frontend uses inline scripts
}));
app.use(cors());
app.use('/webhook', webhookRouter);
app.use(express.json());

// Serve static frontend
app.use(express.static('public'));
app.use('/uploads', express.static(resolve(process.cwd(), 'media', 'uploads')));

// API key auth for all /api/* routes (skipped when GHOSTCART_API_KEY is unset)
app.use('/api', apiKeyAuth);

// API Routes
app.use('/api/search', searchLimiter);
app.use('/api/search-image', searchLimiter);
app.use('/api/payments/checkout', checkoutLimiter);
app.use('/api', searchRouter);
app.use('/api', searchImageRouter);
app.use('/api', buyRouter);
app.use('/api', paymentsRouter);

// Results pages (public, no auth)
app.use('/', pagesRouter);

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

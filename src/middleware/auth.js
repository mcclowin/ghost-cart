/**
 * API key authentication middleware.
 *
 * Checks the Authorization header for a valid Bearer token against the
 * GHOSTCART_API_KEY environment variable.
 *
 * If GHOSTCART_API_KEY is not set, all requests pass through (dev mode).
 * Browser requests from the same origin (frontend) are always allowed.
 */
export function apiKeyAuth(req, res, next) {
  const apiKey = process.env.GHOSTCART_API_KEY;

  // No key configured → development mode, skip auth
  if (!apiKey) {
    return next();
  }

  // Allow browser requests from our own frontend (same-origin)
  const referer = req.headers.referer || req.headers.origin || '';
  const host = req.headers.host || '';
  if (referer && (referer.includes(host) || referer.includes('localhost') || referer.includes('127.0.0.1'))) {
    return next();
  }

  // Also allow if request accepts HTML (likely a browser, not an agent)
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'API key required. Pass Authorization: Bearer <key>',
    });
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];

  if (!token || token !== apiKey) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Invalid API key',
    });
  }

  next();
}

// ══════════════════════════════════════════════════════
//  Card Stock — API Proxy Server
//  Proxies eBay Browse, Finding, Trading APIs + PSA API
// ══════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const ebayRoutes = require('./routes/ebay');
const psaRoutes  = require('./routes/psa');
const { cache, clearCache, TTL } = require('./middleware/cache');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS ───────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET'],
}));

app.use(express.json());

// ── Global rate limiter (100 req / 15 min per IP) ──────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
});
app.use(limiter);

// ── Routes ─────────────────────────────────────────────
app.use('/api/ebay', ebayRoutes);
app.use('/api/psa',  psaRoutes);

// ── Health check ───────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      ebay: !!process.env.EBAY_CLIENT_ID,
      psa:  !!process.env.PSA_API_KEY,
    },
  });
});

// ── Cache stats — see what's currently cached ──────────
// GET /api/cache/stats
app.get('/api/cache/stats', (req, res) => {
  const keys = cache.keys();
  const psaKeys   = keys.filter(k => k.includes('/psa/'));
  const ebayKeys  = keys.filter(k => k.includes('/ebay/'));

  res.json({
    totalCached:  keys.length,
    psaCached:    psaKeys.length,
    ebayCached:   ebayKeys.length,
    ttls: {
      psa_cert_hours:       TTL.PSA_CERT / 3600,
      psa_population_hours: TTL.PSA_POPULATION / 3600,
      ebay_search_minutes:  TTL.EBAY_SEARCH / 60,
      ebay_sold_minutes:    TTL.EBAY_SOLD / 60,
    },
    cachedKeys: keys,
  });
});

// ── Cache clear — flush all or by pattern ─────────────
// DELETE /api/cache?pattern=psa   (clear only PSA entries)
// DELETE /api/cache               (clear everything)
app.delete('/api/cache', (req, res) => {
  const { pattern } = req.query;
  const cleared = clearCache(pattern);
  res.json({ cleared, pattern: pattern || 'all' });
});

// ── 404 ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🃏 Card Stock API running on http://localhost:${PORT}`);
  console.log(`   eBay key loaded : ${!!process.env.EBAY_CLIENT_ID}`);
  console.log(`   PSA key loaded  : ${!!process.env.PSA_API_KEY}\n`);
});

// ══════════════════════════════════════════════════════
//  Cache middleware
//  Two-layer cache:
//    1. In-memory (NodeCache) — fast, lost on restart
//    2. File-based (JSON)     — survives restarts
//
//  PSA calls use 24h TTL to protect the 100/day quota.
//  eBay calls use shorter TTLs (2-5 min) for fresh data.
// ══════════════════════════════════════════════════════

const NodeCache = require('node-cache');
const fs        = require('fs');
const path      = require('path');

// ── TTL constants (seconds) ────────────────────────────
const TTL = {
  PSA_CERT:       86400,   // 24 hours  — PSA quota is 100/day
  PSA_POPULATION: 86400,   // 24 hours
  EBAY_SEARCH:    180,     // 3 minutes
  EBAY_SOLD:      300,     // 5 minutes
  EBAY_PRICE:     300,     // 5 minutes
  EBAY_LISTINGS:  120,     // 2 minutes
  DEFAULT:        300,     // 5 minutes
};

// ── File cache path ────────────────────────────────────
const CACHE_FILE = path.join(__dirname, '..', '.cache.json');

// ── In-memory cache ────────────────────────────────────
const memCache = new NodeCache({ stdTTL: TTL.DEFAULT, checkperiod: 120 });

// ── Load persisted cache from disk on startup ──────────
function loadFileCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw  = fs.readFileSync(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    const now  = Date.now();
    let loaded = 0;

    Object.entries(data).forEach(([key, entry]) => {
      const remainingTTL = Math.floor((entry.expiresAt - now) / 1000);
      if (remainingTTL > 10) {
        memCache.set(key, entry.value, remainingTTL);
        loaded++;
      }
    });

    console.log(`[Cache] Loaded ${loaded} entries from disk`);
  } catch (err) {
    console.warn('[Cache] Could not load file cache:', err.message);
  }
}

// ── Save a single entry to disk ────────────────────────
function saveToFile(key, value, ttlSeconds) {
  try {
    let data = {};
    if (fs.existsSync(CACHE_FILE)) {
      try { data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
    }

    // Purge expired entries before saving
    const now = Date.now();
    Object.keys(data).forEach(k => {
      if (data[k].expiresAt < now) delete data[k];
    });

    data[key] = { value, expiresAt: now + ttlSeconds * 1000 };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[Cache] Could not write file cache:', err.message);
  }
}

// ── Boot: load from disk ───────────────────────────────
loadFileCache();

// ── Cache middleware factory ───────────────────────────
/**
 * cacheMiddleware(ttlSeconds, persist)
 * @param {number}  ttlSeconds  How long to cache (use TTL constants above)
 * @param {boolean} persist     true = also write to disk (use for PSA)
 */
function cacheMiddleware(ttlSeconds = TTL.DEFAULT, persist = false) {
  return (req, res, next) => {
    const key    = req.originalUrl;
    const cached = memCache.get(key);

    if (cached !== undefined) {
      console.log(`[Cache HIT] ${key}`);
      return res.json({ ...cached, _cached: true, _cachedAt: cached._cachedAt });
    }

    console.log(`[Cache MISS] ${key}`);

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode === 200 && data && !data.error) {
        const toStore = { ...data, _cachedAt: new Date().toISOString() };
        memCache.set(key, toStore, ttlSeconds);
        if (persist) saveToFile(key, toStore, ttlSeconds);
      }
      return originalJson(data);
    };

    next();
  };
}

// ── Manual cache clear (for admin use) ────────────────
function clearCache(keyPattern) {
  const keys = memCache.keys();
  const matched = keyPattern
    ? keys.filter(k => k.includes(keyPattern))
    : keys;
  matched.forEach(k => memCache.del(k));
  console.log(`[Cache] Cleared ${matched.length} entries`);
  return matched.length;
}

module.exports = { cache: memCache, cacheMiddleware, clearCache, TTL };

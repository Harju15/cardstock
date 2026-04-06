// ══════════════════════════════════════════════════════
//  eBay Routes
//
//  GET /api/ebay/search?q=charizard+psa+10&limit=20
//    → Browse API: live active listings
//
//  GET /api/ebay/sold?q=charizard+psa+10&limit=20
//    → Finding API: completed/sold listings (comps)
//
//  GET /api/ebay/price?q=charizard+psa+10
//    → Aggregated sold price stats (avg, high, low)
//
//  GET /api/ebay/listings?token=USER_OAUTH_TOKEN
//    → Trading API: the logged-in user's active listings
//
// ══════════════════════════════════════════════════════

const express  = require('express');
const axios    = require('axios');
const { cacheMiddleware, TTL } = require('../middleware/cache');

const router = express.Router();

// ── eBay OAuth token (App-level, cached in memory) ────
let appToken     = null;
let tokenExpires = 0;

async function getAppToken() {
  if (appToken && Date.now() < tokenExpires) return appToken;

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const isProd = process.env.EBAY_ENV !== 'sandbox';
  const url    = isProd
    ? 'https://api.ebay.com/identity/v1/oauth2/token'
    : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';

  const res = await axios.post(url,
    'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  appToken     = res.data.access_token;
  tokenExpires = Date.now() + (res.data.expires_in - 60) * 1000;
  return appToken;
}

// ── Base URLs ──────────────────────────────────────────
function baseUrl(api = 'browse') {
  const isProd = process.env.EBAY_ENV !== 'sandbox';
  const domain = isProd ? 'api.ebay.com' : 'api.sandbox.ebay.com';
  const paths  = {
    browse:  `https://${domain}/buy/browse/v1`,
    finding: `https://svcs.ebay.com/services/search/FindingService/v1`,
    trading: `https://api.ebay.com/ws/api.dll`,
  };
  return paths[api];
}

// ─────────────────────────────────────────────────────
//  1. SEARCH — live active listings (Browse API)
//     GET /api/ebay/search?q=charizard+psa+10&limit=20
// ─────────────────────────────────────────────────────
router.get('/search', cacheMiddleware(TTL.EBAY_SEARCH), async (req, res) => {
  const { q, limit = 20, category = '' } = req.query;

  if (!q) return res.status(400).json({ error: 'Query param "q" is required' });

  try {
    const token = await getAppToken();

    const params = {
      q,
      limit: Math.min(Number(limit), 50),
      fieldgroups: 'MATCHING_ITEMS,EXTENDED',
    };

    // Optionally scope to Trading Cards category (183050)
    if (category) params.category_ids = category;

    const response = await axios.get(`${baseUrl('browse')}/item_summary/search`, {
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    });

    const items = (response.data.itemSummaries || []).map(item => ({
      id:           item.itemId,
      title:        item.title,
      price:        item.price?.value,
      currency:     item.price?.currency,
      condition:    item.condition,
      image:        item.image?.imageUrl,
      url:          item.itemWebUrl,
      seller:       item.seller?.username,
      location:     item.itemLocation?.country,
      bids:         item.bidCount,
      buyItNow:     item.buyingOptions?.includes('FIXED_PRICE'),
      endDate:      item.itemEndDate,
    }));

    res.json({
      query:      q,
      totalFound: response.data.total || items.length,
      items,
    });

  } catch (err) {
    console.error('[eBay /search]', err.response?.data || err.message);
    res.status(502).json({ error: 'eBay search failed', detail: err.response?.data?.errors?.[0]?.message });
  }
});

// ─────────────────────────────────────────────────────
//  2. SOLD — completed/sold listings (Finding API)
//     GET /api/ebay/sold?q=charizard+psa+10&limit=20
// ─────────────────────────────────────────────────────
router.get('/sold', cacheMiddleware(TTL.EBAY_SOLD), async (req, res) => {
  const { q, limit = 20 } = req.query;

  if (!q) return res.status(400).json({ error: 'Query param "q" is required' });

  try {
    const response = await axios.get(baseUrl('finding'), {
      params: {
        'OPERATION-NAME':            'findCompletedItems',
        'SERVICE-VERSION':           '1.0.0',
        'SECURITY-APPNAME':          process.env.EBAY_CLIENT_ID,
        'RESPONSE-DATA-FORMAT':      'JSON',
        'REST-PAYLOAD':              '',
        'keywords':                  q,
        'itemFilter(0).name':        'SoldItemsOnly',
        'itemFilter(0).value':       'true',
        'itemFilter(1).name':        'ListingType',
        'itemFilter(1).value':       'AuctionWithBIN',
        'paginationInput.entriesPerPage': Math.min(Number(limit), 50),
        'sortOrder':                 'EndTimeSoonest',
        'outputSelector':            'SellerInfo',
      },
    });

    const raw = response.data
      ?.findCompletedItemsResponse?.[0]
      ?.searchResult?.[0]
      ?.item || [];

    const items = raw.map(item => ({
      id:        item.itemId?.[0],
      title:     item.title?.[0],
      price:     item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
      currency:  item.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId'],
      condition: item.condition?.[0]?.conditionDisplayName?.[0],
      image:     item.galleryURL?.[0],
      url:       item.viewItemURL?.[0],
      endDate:   item.listingInfo?.[0]?.endTime?.[0],
      soldFor:   item.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales',
    }));

    res.json({ query: q, totalFound: items.length, items });

  } catch (err) {
    console.error('[eBay /sold]', err.response?.data || err.message);
    res.status(502).json({ error: 'eBay sold search failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  3. PRICE STATS — avg / high / low from sold data
//     GET /api/ebay/price?q=charizard+psa+10
// ─────────────────────────────────────────────────────
router.get('/price', cacheMiddleware(TTL.EBAY_PRICE), async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query param "q" is required' });

  try {
    // Reuse sold endpoint internally
    const soldRes = await axios.get(`http://localhost:${process.env.PORT || 3001}/api/ebay/sold`, {
      params: { q, limit: 50 },
    });

    const prices = soldRes.data.items
      .filter(i => i.soldFor && i.price)
      .map(i => parseFloat(i.price))
      .filter(p => !isNaN(p))
      .sort((a, b) => a - b);

    if (!prices.length) {
      return res.json({ query: q, message: 'No sold data found', stats: null });
    }

    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 !== 0
      ? prices[mid]
      : (prices[mid - 1] + prices[mid]) / 2;

    res.json({
      query: q,
      stats: {
        count:    prices.length,
        low:      prices[0].toFixed(2),
        high:     prices[prices.length - 1].toFixed(2),
        average:  avg.toFixed(2),
        median:   median.toFixed(2),
        currency: 'USD',
      },
    });

  } catch (err) {
    console.error('[eBay /price]', err.message);
    res.status(502).json({ error: 'Price stats failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  4. USER LISTINGS — seller's active listings
//     GET /api/ebay/listings?token=USER_OAUTH_TOKEN
//
//  NOTE: Requires user-level OAuth token.
//  The user must authorize your app at:
//  https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html
// ─────────────────────────────────────────────────────
router.get('/listings', cacheMiddleware(TTL.EBAY_LISTINGS), async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({
      error: 'User OAuth token required',
      help:  'The user must authorize your eBay app. See README for OAuth setup.',
    });
  }

  try {
    const response = await axios.get(`${baseUrl('browse')}/item_summary/search`, {
      params: {
        fieldgroups: 'MATCHING_ITEMS',
        limit: 50,
        // Filter to only this seller — requires seller username or use Trading API
      },
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    // Trading API call to get the user's own active listings
    const tradingRes = await axios.post(baseUrl('trading'), null, {
      headers: {
        'X-EBAY-API-CALL-NAME':       'GetMyeBaySelling',
        'X-EBAY-API-APP-NAME':        process.env.EBAY_CLIENT_ID,
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-SITEID':          '0',
        'Content-Type':               'text/xml',
        Authorization:                `Bearer ${token}`,
      },
      data: `<?xml version="1.0" encoding="utf-8"?>
        <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
            <eBayAuthToken>${token}</eBayAuthToken>
          </RequesterCredentials>
          <ActiveList>
            <Include>true</Include>
            <Pagination>
              <EntriesPerPage>50</EntriesPerPage>
              <PageNumber>1</PageNumber>
            </Pagination>
          </ActiveList>
        </GetMyeBaySellingRequest>`,
    });

    res.json({
      message: 'Trading API response received — parse XML as needed',
      raw: tradingRes.data,
    });

  } catch (err) {
    console.error('[eBay /listings]', err.response?.data || err.message);
    res.status(502).json({ error: 'Listings fetch failed', detail: err.message });
  }
});

module.exports = router;

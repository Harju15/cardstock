# Card Stock — API Backend
eBay + PSA proxy server for the Card Stock app.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template
cp .env.example .env

# 3. Fill in your API keys (see setup guides below)
nano .env

# 4. Start the server
npm run dev     # development (auto-restarts)
npm start       # production
```

Server runs at: **http://localhost:3001**

---

## eBay Setup (you don't have an account yet)

### Step 1 — Create a developer account
1. Go to **https://developer.ebay.com**
2. Click **Sign In** → use or create a regular eBay account
3. Accept the developer agreement

### Step 2 — Create an application
1. Go to **https://developer.ebay.com/my/keys**
2. Click **Create an App Key**
3. Name it `Card Stock` → select **Production**
4. Copy your **App ID (Client ID)** and **Cert ID (Client Secret)**
5. Paste them into your `.env` file:
   ```
   EBAY_CLIENT_ID=CardSto-CardStoc-PRD-xxxxxxxxxxxx-xxxxxxxx
   EBAY_CLIENT_SECRET=PRD-xxxxxxxxxxxxxxxxxxxx
   ```

### Step 3 — Enable the APIs you need
In the eBay developer portal, make sure these are enabled for your key:
- **Browse API** (live listings / search)
- **Finding API** (sold/completed listings)
- **Trading API** (user's own listings — requires user OAuth)

### Step 4 — (Optional) User OAuth for "My Listings"
To let users see their own eBay listings, they need to authorize your app:
1. In the developer portal → **Auth Token** → **Get a User Token**
2. Use the **Authorization Code Grant** flow
3. The user's token goes in the `?token=` param on `/api/ebay/listings`

---

## PSA Setup (you already have this)

Paste your existing key into `.env`:
```
PSA_API_KEY=your_psa_key_here
```

PSA API docs: **https://www.psacard.com/api**

---

## API Endpoints Reference

### eBay

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ebay/search?q=charizard+psa+10&limit=20` | Live active listings |
| GET | `/api/ebay/sold?q=charizard+psa+10&limit=20` | Completed/sold listings |
| GET | `/api/ebay/price?q=charizard+psa+10` | Avg/high/low from sold data |
| GET | `/api/ebay/listings?token=USER_TOKEN` | User's active eBay listings |

### PSA

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/psa/cert/:certNumber` | Look up one cert |
| GET | `/api/psa/population?name=Charizard&set=Base+Set&year=1999` | Pop report |
| POST | `/api/psa/certs` | Batch cert lookup (body: `{certNumbers:[...]}`) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Check server + keys are loaded |

---

## Using the Frontend Client (js/api.js)

Copy `js/api.js` into your Card Stock project, then add it to any HTML page:

```html
<script src="js/api.js"></script>
```

### Search eBay for live listings
```javascript
const results = await CardStockAPI.ebay.search('Charizard PSA 10 Base Set');
console.log(results.items);       // array of listings
console.log(results.totalFound);  // total count
```

### Get sold comp data
```javascript
const sold = await CardStockAPI.ebay.sold('Miriam PSA 10 SVI');
sold.items.forEach(item => {
  console.log(item.title, item.price);
});
```

### Get price stats (avg/high/low)
```javascript
const { stats } = await CardStockAPI.ebay.priceStats('Charizard PSA 10');
console.log(`Average: $${stats.average}`);
console.log(`High: $${stats.high}, Low: $${stats.low}`);
console.log(`Based on ${stats.count} recent sales`);
```

### Look up a PSA cert
```javascript
const cert = await CardStockAPI.psa.cert('12345678');
console.log(cert.grade);      // "10"
console.log(cert.subject);    // "Charizard"
console.log(cert.totalPop);   // total population
```

### Batch look up all your certs at once
```javascript
const { results } = await CardStockAPI.psa.batchCerts([
  '12345678', '87654321', '11223344'
]);
results.forEach(r => {
  console.log(r.certNumber, r.grade, r.found ? '✓' : '✗');
});
```

### Auto-inject market price into a table cell
```javascript
// card is one object from your ALL_CARDS array
const cell = document.querySelector('.market-price-cell');
CardStockAPI.injectMarketPrice(card, cell);
// → fills the cell with avg sold price + "X of N sold"
```

### Auto-inject PSA cert info into a table cell
```javascript
CardStockAPI.injectCertData('12345678', gradeCell);
// → shows "PSA 10 ↗" link + population count
```

---

## Caching

Responses are cached in memory to avoid burning API rate limits:

| Endpoint | Cache TTL |
|----------|-----------|
| eBay search | 3 minutes |
| eBay sold | 5 minutes |
| eBay price stats | 5 minutes |
| eBay listings | 2 minutes |
| PSA cert lookup | 1 hour |
| PSA population | 30 minutes |

---

## Deploying to Production

The cheapest options for a small Node.js backend:

| Option | Cost | Notes |
|--------|------|-------|
| **Railway** | Free tier | Push from GitHub, instant deploy |
| **Render** | Free tier | Sleeps after 15 min idle |
| **Fly.io** | Free tier | More control, Docker-based |
| **VPS (DigitalOcean)** | ~$6/mo | Most control |

Once deployed, update `BASE_URL` in `js/api.js` to your live URL:
```javascript
const BASE_URL = 'https://your-app.railway.app/api';
```

Also update `.env`:
```
ALLOWED_ORIGIN=https://your-cardstock-site.com
```

---

## Project Structure

```
cardstock-api/
├── server.js              ← Entry point
├── package.json
├── .env.example           ← Copy to .env, fill in keys
├── middleware/
│   └── cache.js           ← In-memory response cache
├── routes/
│   ├── ebay.js            ← All eBay endpoints
│   └── psa.js             ← All PSA endpoints
└── js/
    └── api.js             ← Drop into your frontend
```

// ══════════════════════════════════════════════════════
//  Card Stock — API Client
//  Drop this file in your project as: js/api.js
//  Then add <script src="js/api.js"></script> to any
//  page that needs eBay or PSA data.
// ══════════════════════════════════════════════════════

const CardStockAPI = (() => {

  // ── Change this to your server URL when deployed ────
  const BASE_URL = 'http://localhost:3001/api';

  // ── Generic fetch wrapper with error handling ───────
  async function request(path) {
    try {
      const res = await fetch(`${BASE_URL}${path}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`[CardStockAPI] ${path} →`, err.message);
      throw err;
    }
  }

  // ════════════════════════════════════════════════════
  //  eBay Methods
  // ════════════════════════════════════════════════════
  const ebay = {

    /**
     * Search live eBay listings
     * @param {string} query  - e.g. "Charizard PSA 10 Base Set"
     * @param {number} limit  - max results (default 20, max 50)
     * @returns {Promise<{totalFound, items}>}
     */
    search(query, limit = 20) {
      return request(`/ebay/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    },

    /**
     * Get completed/sold eBay listings (comp data)
     * @param {string} query
     * @param {number} limit
     * @returns {Promise<{totalFound, items}>}
     */
    sold(query, limit = 20) {
      return request(`/ebay/sold?q=${encodeURIComponent(query)}&limit=${limit}`);
    },

    /**
     * Get aggregated price stats from sold data
     * @param {string} query
     * @returns {Promise<{stats: {low, high, average, median, count}}>}
     */
    priceStats(query) {
      return request(`/ebay/price?q=${encodeURIComponent(query)}`);
    },

    /**
     * Get the logged-in user's active eBay listings
     * @param {string} userOAuthToken - user's eBay OAuth token
     * @returns {Promise<object>}
     */
    myListings(userOAuthToken) {
      return request(`/ebay/listings?token=${encodeURIComponent(userOAuthToken)}`);
    },
  };

  // ════════════════════════════════════════════════════
  //  PSA Methods
  // ════════════════════════════════════════════════════
  const psa = {

    /**
     * Look up a single PSA cert
     * @param {string|number} certNumber
     * @returns {Promise<{grade, subject, year, brand, series, totalPop, ...}>}
     */
    cert(certNumber) {
      return request(`/psa/cert/${certNumber}`);
    },

    /**
     * Get population report for a card
     * @param {string} name      - card subject name
     * @param {string} set       - optional set name
     * @param {string|number} year - optional year
     * @returns {Promise<{results: [{population: {...}, ...}]}>}
     */
    population(name, set = '', year = '') {
      let path = `/psa/population?name=${encodeURIComponent(name)}`;
      if (set)  path += `&set=${encodeURIComponent(set)}`;
      if (year) path += `&year=${year}`;
      return request(path);
    },

    /**
     * Batch look up multiple PSA certs at once (max 20)
     * @param {string[]} certNumbers
     * @returns {Promise<{results: [...]}> }
     */
    async batchCerts(certNumbers) {
      const res = await fetch(`${BASE_URL}/psa/certs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certNumbers }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  };

  // ════════════════════════════════════════════════════
  //  Convenience helpers for Card Stock UI
  // ════════════════════════════════════════════════════

  /**
   * Build an eBay search query from a card object.
   * Pass in a card row from your ALL_CARDS array.
   * Example: buildQuery({ name: "Charizard", company: "PSA", grade: 10, set: "Base Set" })
   * → "Charizard PSA 10 Base Set"
   */
  function buildQuery(card) {
    const parts = [card.name];
    if (card.company) parts.push(card.company);
    if (card.grade)   parts.push(card.grade);
    if (card.set)     parts.push(card.set);
    return parts.join(' ');
  }

  /**
   * Fetch market price for a card and return a display string.
   * Shows average sold price from recent eBay comps.
   */
  async function getMarketPrice(card) {
    const query = buildQuery(card);
    try {
      const data = await ebay.priceStats(query);
      if (data.stats) {
        return {
          average: `$${data.stats.average}`,
          low:     `$${data.stats.low}`,
          high:    `$${data.stats.high}`,
          median:  `$${data.stats.median}`,
          count:   data.stats.count,
          query,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Add a "Market Price" column to a table row element.
   * Fetches live eBay comp data and injects it into the cell.
   *
   * Usage in stockpiledetails.html:
   *   const priceCell = tr.querySelector('.market-price-cell');
   *   CardStockAPI.injectMarketPrice(card, priceCell);
   */
  async function injectMarketPrice(card, cellElement) {
    if (!cellElement) return;
    cellElement.textContent = '…';
    cellElement.style.color = 'var(--ink-muted)';

    try {
      const result = await getMarketPrice(card);
      if (result) {
        cellElement.innerHTML = `
          <span style="font-family:'Cinzel',serif;font-weight:700;color:var(--gold-light);">
            ${result.average}
          </span>
          <span style="display:block;font-size:10px;color:var(--ink-muted);margin-top:2px;">
            avg of ${result.count} sold
          </span>`;
      } else {
        cellElement.textContent = 'N/A';
      }
    } catch {
      cellElement.textContent = 'Error';
      cellElement.style.color = 'var(--down)';
    }
  }

  /**
   * Inject PSA cert data into a table row.
   * Verifies the grade matches what you have recorded.
   *
   * Usage:
   *   CardStockAPI.injectCertData("12345678", gradeCell);
   */
  async function injectCertData(certNumber, cellElement) {
    if (!cellElement || !certNumber) return;

    try {
      const data = await psa.cert(certNumber);
      cellElement.innerHTML = `
        <a href="https://www.psacard.com/cert/${certNumber}"
           target="_blank"
           style="color:var(--gold);font-size:11px;font-weight:600;text-decoration:none;">
          PSA ${data.grade} ↗
        </a>
        <span style="display:block;font-size:10px;color:var(--ink-muted);">
          Pop: ${data.totalPop?.toLocaleString() || '—'}
        </span>`;
    } catch {
      cellElement.textContent = '—';
    }
  }

  // Public API
  return { ebay, psa, buildQuery, getMarketPrice, injectMarketPrice, injectCertData };

})();

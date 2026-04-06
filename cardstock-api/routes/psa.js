// ══════════════════════════════════════════════════════
//  PSA Routes
//
//  GET /api/psa/test           ← run this first to diagnose
//  GET /api/psa/cert/:certNumber
//  GET /api/psa/population?name=charizard&set=base&year=1999
//  POST /api/psa/certs         ← batch lookup
//
// ══════════════════════════════════════════════════════

const express = require('express');
const axios   = require('axios');
const { cacheMiddleware, TTL } = require('../middleware/cache');

const router = express.Router();

const PSA_BASE = 'https://api.psacard.com/publicapi';

function psaHeaders() {
  return {
    Authorization: `bearer ${process.env.PSA_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// ─────────────────────────────────────────────────────
//  DIAGNOSTIC — run this to see exactly what PSA says
//  GET /api/psa/test
//  Open http://localhost:3001/api/psa/test in browser
// ─────────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  const tokenLoaded = !!process.env.PSA_API_KEY;
  const tokenPreview = tokenLoaded
    ? process.env.PSA_API_KEY.slice(0, 8) + '...'
    : 'NOT SET';

  // Try a known public cert (PSA uses this in their docs)
  const testCert = '80258881';

  let psaResult = null;
  let psaError  = null;
  let psaStatus = null;
  let psaRawResponse = null;

  try {
    const response = await axios.get(
      `${PSA_BASE}/cert/GetByCertNumber/${testCert}`,
      { headers: psaHeaders() }
    );
    psaStatus      = response.status;
    psaRawResponse = response.data;
    psaResult      = 'SUCCESS';
  } catch (err) {
    psaStatus      = err.response?.status;
    psaRawResponse = err.response?.data;
    psaError       = err.message;
    psaResult      = 'FAILED';
  }

  res.json({
    diagnosis: {
      token_loaded:    tokenLoaded,
      token_preview:   tokenPreview,
      psa_base_url:    PSA_BASE,
      test_cert:       testCert,
      result:          psaResult,
      http_status:     psaStatus,
      psa_raw_response: psaRawResponse,
      error_message:   psaError,
    },
    next_steps: psaResult === 'SUCCESS'
      ? 'PSA is working! Your token is valid.'
      : 'Check psa_raw_response above — it shows exactly what PSA said.',
  });
});

// ─────────────────────────────────────────────────────
//  1. CERT LOOKUP
//     GET /api/psa/cert/:certNumber
// ─────────────────────────────────────────────────────
router.get('/cert/:certNumber', cacheMiddleware(TTL.PSA_CERT, true), async (req, res) => {
  const { certNumber } = req.params;

  if (!certNumber || isNaN(certNumber)) {
    return res.status(400).json({ error: 'Valid cert number required' });
  }

  try {
    const response = await axios.get(
      `${PSA_BASE}/cert/GetByCertNumber/${certNumber}`,
      { headers: psaHeaders() }
    );

    const d = response.data?.PSACert;

    if (!d) {
      return res.status(404).json({ error: 'Certificate not found', raw: response.data });
    }

    res.json({
      certNumber:  d.CertNumber,
      grade:       d.CardGrade,
      gradeText:   d.GradeDescription,
      subject:     d.Subject,
      year:        d.Year,
      brand:       d.Brand,
      series:      d.Series,
      cardNumber:  d.CardNumber,
      variety:     d.Variety,
      totalPop:    d.TotalPopulation,
      popHigher:   d.PopulationHigher,
      isMasterSet: d.IsMasterSet,
      reverse:     d.ReverseHolo,
      specNo:      d.SpecNo,
      labelType:   d.LabelType,
    });

  } catch (err) {
    const status  = err.response?.status;
    const rawBody = err.response?.data;

    // Log full detail to your terminal
    console.error('[PSA /cert] HTTP status:', status);
    console.error('[PSA /cert] Raw response:', JSON.stringify(rawBody, null, 2));
    console.error('[PSA /cert] Error message:', err.message);

    if (status === 404) return res.status(404).json({ error: 'Cert not found' });
    if (status === 401) return res.status(401).json({ error: 'Invalid PSA token — check PSA_API_KEY in .env' });
    if (status === 429) return res.status(429).json({ error: 'PSA rate limit hit — quota exceeded for today' });

    res.status(502).json({
      error:      'PSA cert lookup failed',
      psaStatus:  status,
      psaMessage: rawBody,
      detail:     err.message,
    });
  }
});

// ─────────────────────────────────────────────────────
//  2. POPULATION REPORT
//     GET /api/psa/population?name=Charizard&set=Base%20Set&year=1999
// ─────────────────────────────────────────────────────
router.get('/population', cacheMiddleware(TTL.PSA_POPULATION, true), async (req, res) => {
  const { name, set, year, cardNumber } = req.query;

  if (!name) return res.status(400).json({ error: 'Query param "name" is required' });

  try {
    const response = await axios.get(
      `${PSA_BASE}/pop/GetItemsBySubjectName`,
      {
        params: {
          subjectName: name,
          ...(set        && { seriesName: set }),
          ...(year       && { year }),
          ...(cardNumber && { cardNumber }),
        },
        headers: psaHeaders(),
      }
    );

    const items = response.data?.PSASetItems || [];

    const formatted = items.map(item => ({
      specNumber:  item.SpecNo,
      subject:     item.Subject,
      year:        item.Year,
      brand:       item.Brand,
      series:      item.Series,
      cardNumber:  item.CardNumber,
      variety:     item.Variety,
      population: {
        auth:  item.Auth     || 0,
        poor:  item.Poor     || 0,
        fr:    item.FR       || 0,
        gd:    item.GD       || 0,
        vg:    item.VG       || 0,
        vgEx:  item.VGEX     || 0,
        ex:    item.EX       || 0,
        exMt:  item.EXMT     || 0,
        nmMt:  item.NMMT     || 0,
        nmMtP: item.NMMTPlus || 0,
        psa10: item.PSA10    || 0,
        total: item.TotalPop || 0,
      },
    }));

    res.json({ query: { name, set, year }, results: formatted });

  } catch (err) {
    const status  = err.response?.status;
    const rawBody = err.response?.data;
    console.error('[PSA /population] HTTP status:', status);
    console.error('[PSA /population] Raw response:', JSON.stringify(rawBody, null, 2));
    res.status(502).json({
      error:      'PSA population lookup failed',
      psaStatus:  status,
      psaMessage: rawBody,
      detail:     err.message,
    });
  }
});

// ─────────────────────────────────────────────────────
//  3. BATCH CERT LOOKUP
//     POST /api/psa/certs
//     Body: { certNumbers: ["12345", "67890"] }
// ─────────────────────────────────────────────────────
router.post('/certs', async (req, res) => {
  const { certNumbers } = req.body;

  if (!Array.isArray(certNumbers) || certNumbers.length === 0) {
    return res.status(400).json({ error: 'certNumbers array required in body' });
  }

  if (certNumbers.length > 20) {
    return res.status(400).json({ error: 'Max 20 cert numbers per request' });
  }

  try {
    const results = await Promise.allSettled(
      certNumbers.map(cert =>
        axios.get(`${PSA_BASE}/cert/GetByCertNumber/${cert}`, { headers: psaHeaders() })
      )
    );

    const certs = results.map((result, i) => {
      if (result.status === 'fulfilled') {
        const d = result.value.data?.PSACert;
        return {
          certNumber: certNumbers[i],
          found:      true,
          grade:      d?.CardGrade,
          gradeText:  d?.GradeDescription,
          subject:    d?.Subject,
          year:       d?.Year,
          brand:      d?.Brand,
          series:     d?.Series,
          cardNumber: d?.CardNumber,
          variety:    d?.Variety,
          totalPop:   d?.TotalPopulation,
          popHigher:  d?.PopulationHigher,
        };
      } else {
        return {
          certNumber: certNumbers[i],
          found:      false,
          error:      result.reason?.response?.data || result.reason?.message,
        };
      }
    });

    res.json({ results: certs });

  } catch (err) {
    console.error('[PSA /certs batch]', err.message);
    res.status(502).json({ error: 'Batch cert lookup failed', detail: err.message });
  }
});

module.exports = router;


// ─────────────────────────────────────────────────────
//  1. CERT LOOKUP
//     GET /api/psa/cert/12345678
//
//  Returns: grade, subject, year, brand, card number,
//           variety, pop data for that grade
// ─────────────────────────────────────────────────────
router.get('/cert/:certNumber', cacheMiddleware(TTL.PSA_CERT, true), async (req, res) => {
  const { certNumber } = req.params;

  if (!certNumber || isNaN(certNumber)) {
    return res.status(400).json({ error: 'Valid cert number required' });
  }

  try {
    const response = await axios.get(
      `${PSA_BASE}/cert/GetByCertNumber/${certNumber}`,
      { headers: psaHeaders() }
    );

    const d = response.data?.PSACert;

    if (!d) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    res.json({
      certNumber:  d.CertNumber,
      grade:       d.CardGrade,
      gradeText:   d.GradeDescription,
      subject:     d.Subject,
      year:        d.Year,
      brand:       d.Brand,
      series:      d.Series,
      cardNumber:  d.CardNumber,
      variety:     d.Variety,
      totalPop:    d.TotalPopulation,
      popHigher:   d.PopulationHigher,
      isMasterSet: d.IsMasterSet,
      reverse:     d.ReverseHolo,
      specNo:      d.SpecNo,
      labelType:   d.LabelType,
    });

  } catch (err) {
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: 'Cert not found' });
    if (status === 401) return res.status(401).json({ error: 'Invalid PSA API key' });
    console.error('[PSA /cert]', err.response?.data || err.message);
    res.status(502).json({ error: 'PSA cert lookup failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  2. POPULATION REPORT
//     GET /api/psa/population?name=Charizard&set=Base%20Set&year=1999
//
//  Returns pop counts by grade (1-10, Auth, etc.)
// ─────────────────────────────────────────────────────
router.get('/population', cacheMiddleware(TTL.PSA_POPULATION, true), async (req, res) => {
  const { name, set, year, cardNumber } = req.query;

  if (!name) return res.status(400).json({ error: 'Query param "name" is required' });

  try {
    // PSA uses their Set registry; we search by subject name
    const response = await axios.get(
      `${PSA_BASE}/pop/GetItemsBySubjectName`,
      {
        params: {
          subjectName: name,
          ...(set && { seriesName: set }),
          ...(year && { year }),
          ...(cardNumber && { cardNumber }),
        },
        headers: psaHeaders(),
      }
    );

    const items = response.data?.PSASetItems || [];

    const formatted = items.map(item => ({
      specNumber:  item.SpecNo,
      subject:     item.Subject,
      year:        item.Year,
      brand:       item.Brand,
      series:      item.Series,
      cardNumber:  item.CardNumber,
      variety:     item.Variety,
      population: {
        auth:  item.Auth  || 0,
        poor:  item.Poor  || 0,
        fr:    item.FR    || 0,
        gd:    item.GD    || 0,
        vg:    item.VG    || 0,
        vgEx:  item.VGEX  || 0,
        ex:    item.EX    || 0,
        exMt:  item.EXMT  || 0,
        nmMt:  item.NMMT  || 0,
        nmMtP: item.NMMTPlus || 0,
        psa10: item.PSA10 || 0,
        total: item.TotalPop || 0,
      },
    }));

    res.json({ query: { name, set, year }, results: formatted });

  } catch (err) {
    console.error('[PSA /population]', err.response?.data || err.message);
    res.status(502).json({ error: 'PSA population lookup failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────
//  3. MULTI-CERT BATCH LOOKUP
//     POST /api/psa/certs
//     Body: { certNumbers: ["12345", "67890", ...] }
//
//  Looks up multiple certs at once (max 20 per call).
//  Useful for loading your whole stockpile at once.
// ─────────────────────────────────────────────────────
router.post('/certs', async (req, res) => {
  const { certNumbers } = req.body;

  if (!Array.isArray(certNumbers) || certNumbers.length === 0) {
    return res.status(400).json({ error: 'certNumbers array required in body' });
  }

  if (certNumbers.length > 20) {
    return res.status(400).json({ error: 'Max 20 cert numbers per request' });
  }

  try {
    const results = await Promise.allSettled(
      certNumbers.map(cert =>
        axios.get(
          `${PSA_BASE}/cert/GetByCertNumber/${cert}`,
          { headers: psaHeaders() }
        )
      )
    );

    const certs = results.map((result, i) => {
      if (result.status === 'fulfilled') {
        const d = result.value.data?.PSACert;
        return {
          certNumber:  certNumbers[i],
          found:       true,
          grade:       d?.CardGrade,
          gradeText:   d?.GradeDescription,
          subject:     d?.Subject,
          year:        d?.Year,
          brand:       d?.Brand,
          series:      d?.Series,
          cardNumber:  d?.CardNumber,
          variety:     d?.Variety,
          totalPop:    d?.TotalPopulation,
          popHigher:   d?.PopulationHigher,
        };
      } else {
        return { certNumber: certNumbers[i], found: false, error: result.reason?.message };
      }
    });

    res.json({ results: certs });

  } catch (err) {
    console.error('[PSA /certs batch]', err.message);
    res.status(502).json({ error: 'Batch cert lookup failed', detail: err.message });
  }
});

module.exports = router;

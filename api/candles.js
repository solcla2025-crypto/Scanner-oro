const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9'
};

const YAHOO_RANGE = { '1m': '1d', '5m': '5d', '15m': '5d', '1h': '1mo', '1d': '3mo' };

// --- Utilidades ----------------------------------------------------------
async function fetchJSON(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeInterval(x) {
  const allowed = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
  return allowed.includes(x) ? x : '1m';
}

function clampLimit(n) {
  const v = parseInt(n, 10);
  if (isNaN(v)) return 250;
  return Math.max(30, Math.min(500, v));
}

// --- XAU -----------------------------------------------------------------
async function fetchXAUCandles(interval, limit) {
  try {
    const range = YAHOO_RANGE[interval] || '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${interval}&range=${range}`;
    const data = await fetchJSON(url, { headers: YAHOO_HEADERS });
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('Yahoo empty response');
    const ts = result.timestamp || [];
    const q = result.indicators.quote[0];
    const candles = ts.map((t, i) => ({
      time: t * 1000,
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume[i] || 0
    })).filter(c => c.open != null && c.close != null);
    if (candles.length < 5) throw new Error('Yahoo insufficient data');
    return { source: 'yahoo', candles: candles.slice(-limit) };
  } catch (e1) {
    try {
      const stooqInterval = ['1m','5m','15m','30m','1h'].includes(interval) ? '5' : 'd';
      const url = `https://stooq.com/q/d/l/?s=xauusd&i=${stooqInterval}`;
      const r = await fetch(url, { headers: YAHOO_HEADERS });
      if (!r.ok) throw new Error(`Stooq HTTP ${r.status}`);
      const text = await r.text();
      const lines = text.trim().split('\n').slice(1);
      const candles = lines.slice(-limit).map(line => {
        const [date, o, h, l, c, v] = line.split(',');
        return {
          time: new Date(date).getTime(),
          open: +o, high: +h, low: +l, close: +c, volume: +v || 0
        };
      }).filter(c => !isNaN(c.close));
      return { source: 'stooq', candles };
    } catch (e2) {
      throw new Error(`XAU upstream failure: ${e1.message} / ${e2.message}`);
    }
  }
}

async function fetchXAUTicker() {
  // Prioridad 1: goldprice.dev
  try {
    const data = await fetchJSON('https://api.goldprice.dev/v1/spot/XAU-USD-SPOT');
    if (data && data.price) {
      const price = parseFloat(data.price);
      return {
        source: 'goldprice.dev',
        bid: price - 0.25,
        ask: price + 0.25,
        price: price,
        spread: 0.5,
        ts: Date.now()
      };
    }
  } catch (e1) {}

  // Prioridad 2: Yahoo
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d`;
    const data = await fetchJSON(url, { headers: YAHOO_HEADERS });
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price) {
      return {
        source: 'yahoo',
        bid: price - 0.20,
        ask: price + 0.20,
        price: price,
        spread: 0.4,
        ts: Date.now()
      };
    }
  } catch (e2) {}

  throw new Error('No se pudo obtener precio de XAU');
}

// --- Handler -------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const asset = (req.query.asset || 'XAU').toUpperCase();
  const mode = req.query.mode || 'candles';
  const interval = normalizeInterval(req.query.interval || '1m');
  const limit = clampLimit(req.query.limit || 250);

  try {
    let payload;
    if (mode === 'ticker') {
      if (asset === 'XAU') {
        payload = await fetchXAUTicker();
      } else {
        throw new Error('Asset not supported');
      }
      res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=5');
    } else {
      let result;
      if (asset === 'XAU') {
        result = await fetchXAUCandles(interval, limit);
      } else {
        throw new Error('Asset not supported');
      }
      payload = { ...result, interval, count: result.candles.length };
      res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=15');
    }
    return res.status(200).json({ ok: true, asset, mode, ...payload });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      asset,
      mode,
      error: e.message || String(e),
      ts: Date.now()
    });
  }
}

// ============================================================================
//  SOLCLA SCANNER · Data Gateway v3
//  Lee precio y velas REALES desde Supabase, alimentado por el EA de MT5
//  (SolclaPriceFeed_v2.mq5) — ya no depende de Yahoo/TwelveData/gold-api.
// ============================================================================

// ── CONFIGURACION: completar en Vercel (Settings > Environment Variables) ──
// SUPABASE_URL      = https://TU-PROYECTO.supabase.co
// SUPABASE_ANON_KEY = tu anon public key

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function send(res, status, body) {
  res.status(status).json(body);
}

async function fetchFeed(symbol) {
  const url = `${SUPABASE_URL}/rest/v1/live_feed?symbol=eq.${symbol}&select=*`;
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
  const rows = await r.json();
  if (!rows.length) throw new Error(`Sin datos para ${symbol} — ¿el EA de MT5 está corriendo?`);
  const row = rows[0];

  // Chequeo de "dato viejo": si el EA se desconectó, avisar en vez de mentir
  const ageSeconds = (Date.now() - new Date(row.updated_at).getTime()) / 1000;
  if (ageSeconds > 30) {
    throw new Error(`Feed de MT5 desactualizado (${Math.round(ageSeconds)}s) — revisá que el EA esté corriendo en tu MT5`);
  }

  return row;
}

// Convierte el array de velas guardado por el EA al formato que espera el frontend
function normalizeCandles(rawCandles) {
  return (rawCandles || []).map(c => ({
    time: c.time * 1000, // el EA manda segundos, el frontend espera milisegundos
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: 0
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return send(res, 500, { ok: false, error: 'Falta configurar SUPABASE_URL / SUPABASE_ANON_KEY en Vercel' });
  }

  const asset = (req.query.asset || 'XAU').toUpperCase();
  const mode = req.query.mode || 'candles';
  const interval = req.query.interval || '5m';

  // Mapeo de intervalo del Scanner -> columna del EA (m1, m5, m15)
  const intervalMap = { '1m': 'm1', '5m': 'm5', '15m': 'm15' };
  const column = intervalMap[interval] || 'm5';

  // Símbolo tal como lo tenés cargado en MT5/Vantage
  const symbolMap = { XAU: 'XAUUSD', BTC: 'BTCUSD' };
  const symbol = symbolMap[asset] || 'XAUUSD';

  try {
    const row = await fetchFeed(symbol);

    if (mode === 'ticker') {
      const spread = row.ask - row.bid;
      res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=2');
      return send(res, 200, {
        ok: true,
        asset,
        source: 'mt5-vantage',
        price: row.price,
        bid: row.bid,
        ask: row.ask,
        spread,
        ts: new Date(row.updated_at).getTime()
      });
    }

    const candles = normalizeCandles(row[column]);
    res.setHeader('Cache-Control', 's-maxage=3, stale-while-revalidate=10');
    return send(res, 200, {
      ok: true,
      asset,
      source: 'mt5-vantage',
      interval,
      candles,
      count: candles.length
    });
  } catch (e) {
    return send(res, 502, { ok: false, asset, mode, error: e.message || String(e) });
  }
}

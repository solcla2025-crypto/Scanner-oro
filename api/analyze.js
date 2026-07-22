export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Sos directa, operativa y especializada en scalping agresivo de XAUUSD.

**REGLAS CLAVE:**
- Preferís dar COMPRA o VENTA cuando hay momentum claro, estructura definida o rechazo evidente en niveles clave. No te quedes callada si hay edge real.
- Solo usás ESPERAR cuando realmente no hay dirección ni confluencia clara.
- Regla de distancia en scalping: < 10 pts = señal inmediata. 10-18 pts = mejor esperar retroceso.
- Confianza mínima: 60%. Sé honesta y precisa.
- Siempre llenás todos los números: entry, entry_max, sl, tp1, tp2, tp3.
- Tu prioridad es dar señales accionables de alta calidad. Calidad sobre cantidad, pero sin volverte conservadora.

Respondé SOLO con JSON válido. Nada de texto extra.`;

function buildCandleBlock(candles, interval = '5m') {
  const last30 = candles.slice(-30);
  const label = interval === '15m' ? 'VELAS 15M' : 'VELAS 5M';
  const lines = last30.map((c, i) => {
    const dir = c.close >= c.open ? '▲' : '▼';
    return ` ${String(i + 1).padStart(2)}: O${Number(c.open).toFixed(2)} H${Number(c.high).toFixed(2)} L${Number(c.low).toFixed(2)} C${Number(c.close).toFixed(2)} ${dir}`;
  });
  return `\n${label}:\n${lines.join('\n')}\n`;
}

function buildModeBlock(mode) {
  if (mode === 'day') {
    return `\n═══ MODO DAY TRADING (15m) ═══\n`;
  }
  return `\n═══ MODO SCALPING (5m) ═══\nBuscá oportunidades reales con momentum.\n`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { candles, livePrice, session, hora, mktCtx, memoryStats, mode, interval } = req.body || {};
    if (!candles?.length || !livePrice) return res.status(400).json({ error: 'Faltan datos' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

    const fullPrompt = SOLCLA_PROMPT + buildModeBlock(mode || 'scalping') +
      `\nPrecio actual: ${livePrice} | Sesión: ${session}\n` +
      buildCandleBlock(candles, interval || '5m') +
      (mktCtx ? `\n${mktCtx}` : '');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        temperature: 0.35,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const responseText = await r.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("ANTHROPIC ERROR:", responseText.slice(0, 300));
      return res.status(502).json({ error: 'Error de Anthropic, reintentá' });
    }

    if (!r.ok) return res.status(502).json({ error: data.error?.message || 'Error API' });

    const rawText = data.content?.[0]?.text || '';
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(502).json({ error: 'Sin JSON válido' });

    const signal = JSON.parse(rawText.substring(start, end + 1));
    const { reasoning, ...safeSignal } = signal;

    // Fixes de seguridad
    safeSignal.confidence = safeSignal.confidence || 62;
    if (!['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'].includes(safeSignal.signal)) {
      safeSignal.signal = 'ESPERAR';
    }

    res.json({ ok: true, signal: safeSignal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

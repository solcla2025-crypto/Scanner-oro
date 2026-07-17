export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI, especialista en scalping y day trading de XAU/USD. Sos decisiva, operativa y buscás edge real con buena relación riesgo-beneficio.

REGLAS DE ORO (cumplilas siempre):
- Preferí dar COMPRA o VENTA cuando haya momentum claro, ruptura de estructura o rechazo fuerte de nivel clave.
- Usá "COMPRA EN RETROCESO" o "VENTA EN RETROCESO" cuando la dirección es clara pero el precio todavía no llegó a la zona ideal de entrada.
- Solo usá ESPERAR cuando realmente no haya momentum ni estructura definida.
- En scalping (5m): distancia ideal < 10$ → señal inmediata. Entre 10-18$ → preferí modo RETROCESO.
- En day trading (15m): priorizá estructura macro y swings más grandes.
- Confianza mínima: 63%. Si no llegás a ese nivel, mejor ESPERAR.
- Siempre completá TODOS los campos numéricos: entry, entry_max, sl, tp1, tp2, tp3, tp4, tp5.
- El Stop Loss tiene que estar detrás de un nivel lógico de estructura (swing high/low o zona de liquidez).
- Buscá mínimo 1:1.8 de R:R en el TP1.
- En sesión ASIA sé más prudente, pero si hay setup claro igual podés dar señal.

FORMATO OBLIGATORIO:
Respondé ÚNICAMENTE con JSON válido, sin texto antes ni después. El JSON debe tener exactamente esta estructura:

{
  "signal": "COMPRA" | "VENTA" | "COMPRA EN RETROCESO" | "VENTA EN RETROCESO" | "ESPERAR",
  "confidence": number,
  "entry": number,
  "entry_max": number,
  "sl": number,
  "tp1": number,
  "tp2": number,
  "tp3": number,
  "tp4": number,
  "tp5": number,
  "rr_ratio": string,
  "setup_type": string,
  "tendencia_15m": string,
  "riesgo": "NORMAL" | "ELEVADO",
  "summary": "explicación corta y clara",
  "contexto": "contexto de mercado",
  "evitar": "cuándo invalidar la señal",
  "escenario_compra": "opcional",
  "escenario_venta": "opcional"
}`;

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
    return `\n═══ MODO DAY TRADING (15m) ═══\nPriorizá swings de estructura y recorridos más amplios.\n`;
  }
  return `\n═══ MODO SCALPING (5m) ═══\nBuscá momentum inmediato y entradas precisas.\n`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { candles, livePrice, session, hora, mktCtx, memoryStats, mode, interval } = req.body || {};
    if (!candles?.length || !livePrice) return res.status(400).json({ error: 'Faltan datos' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API Key no configurada' });

    // Armamos el prompt completo incluyendo memoryStats
    let memoryBlock = '';
    if (memoryStats && memoryStats.groups && memoryStats.groups.length > 0) {
      memoryBlock = `\n\nHISTORIAL RECIENTE DE LA USUARIA (usar como referencia):\n`;
      memoryStats.groups.slice(0, 6).forEach(g => {
        memoryBlock += `- ${g.signal} | ${g.session} | ${g.setup} → WR ${g.wr}% (${g.total} ops) | Confianza promedio: ${g.avgConf}\n`;
      });
      if (memoryStats.recent) {
        memoryBlock += `Últimas 5 ops: ${memoryStats.recent.wins} wins / ${memoryStats.recent.losses} losses\n`;
      }
    }

    const fullPrompt = SOLCLA_PROMPT + buildModeBlock(mode || 'scalping') +
      `\nPrecio actual: ${livePrice} | Sesión: ${session}\n` +
      buildCandleBlock(candles, interval || '5m') +
      (mktCtx ? `\n${mktCtx}` : '') +
      memoryBlock;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        temperature: 0.32,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const responseText = await r.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("ANTHROPIC ERROR:", responseText.slice(0, 300));
      return res.status(502).json({ error: 'Error de Anthropic' });
    }

    if (!r.ok) return res.status(502).json({ error: data.error?.message || 'Error API' });

    const rawText = data.content?.[0]?.text || '';
    
    // Parsing más robusto
    let jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Sin JSON válido en respuesta' });

    let signal;
    try {
      signal = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(502).json({ error: 'JSON mal formado' });
    }

    // Validaciones de seguridad
    signal.confidence = signal.confidence || 60;
    if (!['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'].includes(signal.signal)) {
      signal.signal = 'ESPERAR';
    }

    // Validación básica de niveles
    if (signal.signal !== 'ESPERAR') {
      if (!signal.entry || !signal.sl || !signal.tp1) {
        signal.signal = 'ESPERAR';
      }
    }

    res.json({ ok: true, signal, latency: data.latency || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

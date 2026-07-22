export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Sos decisiva, operativa y buscas oportunidades reales de scalping y day trading en XAU/USD.

REGLAS CLAVE:
- Preferís dar COMPRA o VENTA cuando hay momentum o estructura clara.
- Solo usás ESPERAR cuando realmente no hay dirección.
- Confianza mínima: 58%.
- Siempre completá: entry, entry_max, sl, tp1, tp2, tp3, tp4, tp5.
- Si el precio ya está dentro de la zona de entrada → da señal DIRECTA (nunca RETROCESO).
- Regla de distancia: < 10 pts = señal directa. 10-18 pts = podés usar RETROCESO.
- En sesión ASIA sé más selectiva, pero si hay setup claro igual da la señal.

Responde ÚNICAMENTE con JSON válido.`;

function buildModeBlock(mode) {
  if (mode === 'day') {
    return `
═══ MODO DAY TRADING (15m) ═══
Pensá de forma ESTRUCTURAL.
- Priorizá la tendencia dominante y los swings importantes.
- Buscá zonas de soporte/resistencia claras y recorrido potencial más amplio.
- Evitá señales solo por momentum de las últimas 5-8 velas.
- Preferí setups con mejor R:R.
- Sé más paciente que en scalping.
`;
  }
  return `
═══ MODO SCALPING (5m) ═══
Pensá de forma TÁCTICA y rápida.
- Buscá momentum claro y entradas precisas.
- Si hay impulso y estructura a favor, da la señal.
- Sé operativa, no te quedes en ESPERAR sin motivo fuerte.
`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { livePrice, session, hora, mktCtx, memoryCtx, mode } = req.body || {};

    if (!livePrice) return res.status(400).json({ error: 'Faltan datos' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API Key no configurada' });

    const fullPrompt = SOLCLA_PROMPT + buildModeBlock(mode || 'scalping') +
      `\nPrecio actual: ${livePrice} | Sesión: ${session || 'N/A'} | Hora: ${hora || 'N/A'}\n` +
      (mktCtx ? `\n${mktCtx}` : '') +
      (memoryCtx ? `\n${memoryCtx}` : '');

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
        temperature: 0.33,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const responseText = await r.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("ANTHROPIC ERROR:", responseText.slice(0, 250));
      return res.status(502).json({ error: 'Error de Anthropic' });
    }

    if (!r.ok) return res.status(502).json({ error: data.error?.message || 'Error API' });

    // Devolvemos la respuesta cruda de Claude para que el frontend actual siga funcionando sin cambios
    res.json(data);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

async function fetchXAUTicker() {
  // Prioridad 1: goldprice.dev (más estable)
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

  // Prioridad 2: Yahoo (fallback)
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

const fetchConTimeout = require('./fetchConTimeout');

// TNA de financiación con tarjeta de crédito: la publica el BCRA como variable 1215
// ("Tasa de interés de financiaciones con tarjetas de crédito", % nominal anual, mensual).
// Mismo criterio que Préstamos y Reservas: tasa de mercado, no una inventada por tuo.
const URL_BCRA = 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/1215';
const TNA_RESPALDO = 0.80;               // si el BCRA no responde (último valor publicado ~80%)
const CACHE_MS = 6 * 60 * 60 * 1000;     // la serie es mensual: no hace falta pedirla en cada compra

let cache = null;

async function obtenerTnaTarjeta() {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.datos;
  try {
    const res = await fetchConTimeout(URL_BCRA, {}, 8000);
    if (!res.ok) throw new Error('BCRA respondió ' + res.status);
    const data = await res.json();
    const ultimo = data.results?.[0]?.detalle?.[0];
    const valor = Number(ultimo?.valor);
    if (!(valor > 0)) throw new Error('BCRA sin valor de tasa');
    const datos = { tna: valor / 100, fuente: 'BCRA', fecha: ultimo.fecha };
    cache = { ts: Date.now(), datos };
    return datos;
  } catch (e) {
    console.error('No se pudo obtener la TNA de tarjetas del BCRA, uso la de respaldo:', e.message);
    // Si había un valor viejo en caché, mejor ese que el fijo.
    return cache ? cache.datos : { tna: TNA_RESPALDO, fuente: 'respaldo', fecha: null };
  }
}

// TEA equivalente con capitalización mensual. No hay comisiones ni seguros, así que el
// CFT coincide con la TEA.
const teaDesdeTna = (tna) => Math.pow(1 + tna / 12, 12) - 1;

async function obtenerTasasTarjeta() {
  const { tna, fuente, fecha } = await obtenerTnaTarjeta();
  const tea = teaDesdeTna(tna);
  return { tna, tea, cft: tea, fuente, fecha };
}

module.exports = { obtenerTasasTarjeta, teaDesdeTna };

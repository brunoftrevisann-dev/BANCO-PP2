// Integración con la Central de Deudores del Banco Central — compartida por
// prestamoController.js (al otorgar/pagar/cancelar un préstamo) y cronController.js
// (al escalar cuotas vencidas), para no duplicar la lógica ni que un controller
// tenga que importar el estado privado de otro.
const fetchBC = require('./fetchConTimeout');

async function consultarSituacionBC(dni) {
  const res = await fetchBC(`${process.env.BANCO_URL}/central-deudores/${dni}`, {
    headers: { 'x-api-key': process.env.BANCO_TOKEN, 'x-environment': process.env.BANCO_ENV }
  }, 8000);
  if (!res.ok) return null;
  return res.json();
}

// Fire-and-forget desde los llamadores: nunca debe bloquear ni romper la respuesta al usuario.
async function reportarSituacionBC(dni, monto, situacion) {
  const res = await fetchBC(`${process.env.BANCO_URL}/central-deudores`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.BANCO_TOKEN,
      'x-environment': process.env.BANCO_ENV,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dni, monto: Math.max(0, Math.round(monto)), situacion })
  }, 8000);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.errors?.[0]?.msg || 'Error reportando situación al Banco Central');
  }
}

// Escalada de situación (1-5) según cuántas cuotas vencidas sin pagar tiene la persona.
const situacionPorVencidas = (vencidas) => (vencidas === 0 ? 1 : Math.min(vencidas + 1, 5));

module.exports = { consultarSituacionBC, reportarSituacionBC, situacionPorVencidas };

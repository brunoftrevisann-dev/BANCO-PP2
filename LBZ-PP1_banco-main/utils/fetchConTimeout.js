// Wrapper de fetch con timeout por AbortController — compartido por todos los controllers
// que llaman a APIs externas (Banco Central, dolarapi.com, api.argentinadatos.com), antes
// copiado igual en cada controller por separado.
function fetchConTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(tid));
}

module.exports = fetchConTimeout;

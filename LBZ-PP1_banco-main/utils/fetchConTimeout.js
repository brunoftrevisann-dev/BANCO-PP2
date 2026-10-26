function fetchConTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(tid));
}

module.exports = fetchConTimeout;

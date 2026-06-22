// NODE_OPTIONS preload: add Accept: application/json to HyperBEAM device fetches.
// Latest edge defaults to httpsig@1.0/HTML unless the client asks for JSON.
// We only add the header for device paths (~meta@1.0, ~reference@1.0, etc.),
// not for the root health/redirect endpoint or fetch-by-ID formatter.
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url, init) => {
  const urlStr = typeof url === 'string' ? url : (url?.href || String(url));
  if (urlStr.includes('~')) {
    init = init || {};
    const headers = init.headers || {};
    if (!headers.Accept && !headers.accept) {
      init = { ...init, headers: { ...headers, Accept: 'application/json' } };
    }
  }
  return originalFetch(url, init);
};

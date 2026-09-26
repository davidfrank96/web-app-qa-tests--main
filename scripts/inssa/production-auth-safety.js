// Production authentication has a deliberately small network write allowlist.
// Application/data writes and account mutation endpoints are never permitted.
function assertAuthenticationTarget(environment, rawUrl) {
  const expected = environment === 'production' ? 'https://inssa.us' : environment === 'staging' ? 'https://staging.inssa.us' : null;
  const url = new URL(rawUrl);
  if (!expected || url.origin !== expected || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Authentication monitoring target is not allowlisted for ' + environment);
  }
}
function productionAuthRequestAllowed(rawUrl, method) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname === 'staging.inssa.us' || url.hostname.endsWith('.staging.inssa.us')) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (method !== 'POST') return false;
  if (url.hostname === 'identitytoolkit.googleapis.com') return ['/v1/accounts:signInWithPassword', '/v1/accounts:lookup'].includes(url.pathname);
  if (url.hostname === 'securetoken.googleapis.com') return url.pathname === '/v1/token';
  // Firestore read streams and queries only; never Write, commit, batchWrite or document creation.
  if (url.hostname === 'firestore.googleapis.com') return url.pathname === '/google.firestore.v1.Firestore/Listen/channel' || /^\/v1\/projects\/[^/]+\/databases\/[^/]+\/documents:(batchGet|runQuery|runAggregationQuery)$/.test(url.pathname);
  return false;
}
module.exports = { assertAuthenticationTarget, productionAuthRequestAllowed };

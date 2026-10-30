// Test-only stand-in: session is a JSON cookie, unsigned. Real deployments use the real cookie-session.
export default () => (req, res, next) => {
  const m = /hub=([^;]+)/.exec(req.headers.cookie || ''); req.session = m ? JSON.parse(decodeURIComponent(m[1])) : {};
  const end = res.end; res.end = function (...a) { res.setHeader('set-cookie', `hub=${encodeURIComponent(JSON.stringify(req.session || {}))}; Path=/`); return end.apply(res, a); };
  next();
};

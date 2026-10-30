export async function resolve(spec, ctx, next) {
  if (spec === 'express') return { url: new URL('./express.js', import.meta.url).href, shortCircuit: true };
  if (spec === 'cookie-session') return { url: new URL('./cookie-session.js', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}

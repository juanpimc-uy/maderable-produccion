// api/_baru-auth-helper.js
// Helper compartido para autenticación del portal BARU.
// Token = base64url( timestamp + ":" + HMAC-SHA256(timestamp, secret) )
// Expiración: 12 horas.

const encoder = new TextEncoder();

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Buffer.from(sig).toString('hex');
}

export async function generarToken() {
  const secret = process.env.BARU_SESSION_SECRET || '';
  const ts = String(Date.now());
  const sig = await hmac(ts, secret);
  const payload = ts + ':' + sig;
  return Buffer.from(payload).toString('base64url');
}

export async function verificarToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const secret = process.env.BARU_SESSION_SECRET || '';
  try {
    const payload = Buffer.from(token, 'base64url').toString();
    const [ts, sig] = payload.split(':');
    if (!ts || !sig) return false;
    // Verificar firma
    const expected = await hmac(ts, secret);
    if (sig !== expected) return false;
    // Verificar expiración (12 horas)
    const age = Date.now() - parseInt(ts, 10);
    if (age > 12 * 60 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function err(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function options() {
  return new Response(null, { status: 204, headers: CORS });
}

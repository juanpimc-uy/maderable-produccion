// api/baru-auth.js — POST login para portal BARU
import { generarToken, ok, err, options, CORS } from './_baru-auth-helper.js';
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return err('Method not allowed', 405);

  try {
    const { usuario, password } = await req.json();
    const validUser = process.env.BARU_USER || 'baru';
    const validPass = process.env.BARU_PASSWORD || 'maderable2024';

    if (usuario !== validUser || password !== validPass) {
      return err('Credenciales incorrectas', 401);
    }

    const token = await generarToken();
    return ok({ ok: true, token });
  } catch (e) {
    return err(e.message, 500);
  }
}

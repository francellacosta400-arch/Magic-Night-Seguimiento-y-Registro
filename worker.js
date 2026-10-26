// Magic Night: sirve la página y guarda las hojas en la base de datos D1 (binding "DB").
// Leer las hojas es público. Agregar o eliminar exige la clave secreta ADMIN_KEY.

const REGIONAL = /^(0[1-9]|1[0-8])$/;
const MAX_POR_REGIONAL = 60;
const MAX_CUERPO = 5000;
const enc = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
const fallo = (error, status) => json({ ok: false, error }, status);

function urlValida(raw) {
  try {
    const texto = String(raw || '').trim();
    if (texto.length > 2000) return null;
    const u = new URL(texto);
    if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || !u.pathname.startsWith('/spreadsheets/')) return null;
    return u.href;
  } catch (e) { return null; }
}

// Comparación de claves sin revelar cuántos caracteres coinciden.
async function mismaClave(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Devuelve null si la clave es correcta, o la respuesta de error que hay que enviar.
async function exigirAdmin(request, env) {
  if (!env.ADMIN_KEY) return fallo('Falta configurar la clave de administrador (ADMIN_KEY) en Cloudflare.', 503);
  const dada = request.headers.get('X-Admin-Key') || '';
  if (!dada || !(await mismaClave(dada, String(env.ADMIN_KEY)))) return fallo('Clave incorrecta.', 401);
  return null;
}

async function hojasDe(env, regional) {
  const { results } = await env.DB
    .prepare('SELECT id, titulo, url FROM hojas WHERE regional = ? ORDER BY creado, id')
    .bind(regional).all();
  return results || [];
}

async function manejarApi(request, env, url) {
  if (!env.DB) return fallo('Falta conectar la base de datos D1 (binding DB).', 503);
  const ruta = url.pathname.replace(/\/+$/, '');

  if (ruta === '/api/admin') {
    if (request.method !== 'GET') return fallo('Método no permitido.', 405);
    return (await exigirAdmin(request, env)) || json({ ok: true });
  }

  if (ruta !== '/api/hojas') return fallo('No encontrado.', 404);

  if (request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id, regional, titulo, url FROM hojas ORDER BY regional, creado, id').all();
    const hojas = {};
    for (const fila of results || []) {
      (hojas[fila.regional] = hojas[fila.regional] || []).push({ id: fila.id, titulo: fila.titulo, url: fila.url });
    }
    return json({ ok: true, hojas });
  }

  if (request.method === 'POST') {
    const negado = await exigirAdmin(request, env);
    if (negado) return negado;
    let cuerpo;
    try {
      const texto = await request.text();
      if (texto.length > MAX_CUERPO) return fallo('Datos demasiado grandes.', 413);
      cuerpo = JSON.parse(texto);
    } catch (e) { return fallo('Datos inválidos.', 400); }
    const regional = String((cuerpo && cuerpo.regional) || '');
    const titulo = String((cuerpo && cuerpo.titulo) || '').trim().slice(0, 80);
    const enlace = urlValida(cuerpo && cuerpo.url);
    if (!REGIONAL.test(regional)) return fallo('Regional inválida.', 400);
    if (!titulo) return fallo('Escribe el nombre de la hoja.', 400);
    if (!enlace) return fallo('El enlace debe ser de Google Sheets.', 400);
    const conteo = await env.DB.prepare('SELECT COUNT(*) AS n FROM hojas WHERE regional = ?').bind(regional).first();
    if (conteo && conteo.n >= MAX_POR_REGIONAL) return fallo('Esta regional llegó al máximo de hojas.', 400);
    await env.DB
      .prepare('INSERT INTO hojas (id, regional, titulo, url, creado) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), regional, titulo, enlace, Date.now()).run();
    return json({ ok: true, hojas: await hojasDe(env, regional) });
  }

  if (request.method === 'DELETE') {
    const negado = await exigirAdmin(request, env);
    if (negado) return negado;
    const regional = url.searchParams.get('regional') || '';
    const id = url.searchParams.get('id') || '';
    if (!REGIONAL.test(regional) || !id) return fallo('Datos inválidos.', 400);
    const res = await env.DB.prepare('DELETE FROM hojas WHERE id = ? AND regional = ?').bind(id, regional).run();
    if (!res.meta || !res.meta.changes) return fallo('Esa hoja ya no existe.', 404);
    return json({ ok: true, hojas: await hojasDe(env, regional) });
  }

  return fallo('Método no permitido.', 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await manejarApi(request, env, url); }
      catch (e) { return fallo('Error del servidor.', 500); }
    }
    return env.ASSETS.fetch(request);
  },
};

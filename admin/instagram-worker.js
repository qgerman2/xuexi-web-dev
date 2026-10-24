/* Instagram · Xuexi Club UC
 * Paste into a separate Cloudflare Worker using the Cloudflare dashboard.
 * Secret: IG_ACCESS_TOKEN
 * Text variables: FIREBASE_API_KEY, FIREBASE_PROYECTO
 * KV namespace binding: IG_TOKEN_KV (private, dedicated to this Worker)
 * Cron Trigger: 0 9 * * * (daily, 09:00 UTC; refresh when due)
 * Keep IG_ACCESS_TOKEN as the bootstrap secret. Refreshed tokens live in KV;
 * changing the bootstrap secret starts a new token lifecycle automatically.
 * GET /instagram/posts requires a Firebase ID token and a current admin role.
 * GET /instagram/media/<media-id> downloads an image from those latest posts.
 */

const ORIGENES_PERMITIDOS = new Set([
  'https://xuexiclub.cl',
  'https://www.xuexiclub.cl',
  'https://xuexi-club-uc.github.io',
  'https://qgerman2.github.io'
]);

const CLAVE_TOKEN = 'instagram:token';
const DIA = 24 * 60 * 60 * 1000;
const INTERVALO_RENOVACION = 7 * DIA;
const MARGEN_CADUCIDAD = 7 * DIA;
const MAX_IMAGEN = 20 * 1024 * 1024;

async function descargarImagen(media, headers) {
  let url;
  try { url = new URL(media.media_url); } catch { return null; }
  // URLs come exclusively from the authenticated account's Graph response.
  // Also restrict destinations; never accept a caller-supplied download URL.
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return null;
  const respuesta = await fetch(url, {
    // workerd supports follow/manual, but rejects redirect: 'error'.
    // A manual 3xx response fails the ok check below without following it.
    redirect: 'manual', signal: AbortSignal.timeout(25000)
  });
  const tipo = (respuesta.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!respuesta.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(tipo) || !respuesta.body ||
      Number(respuesta.headers.get('Content-Length')) > MAX_IMAGEN) {
    await respuesta.body?.cancel();
    return null;
  }
  const lector = respuesta.body.getReader();
  const bloques = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGEN) { await lector.cancel(); return null; }
      bloques.push(value);
    }
  } finally { lector.releaseLock(); }
  if (!total) return null;
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[tipo];
  return new Response(new Blob(bloques, { type: tipo }), {
    headers: {
      ...headers, 'Content-Type': tipo, 'Content-Length': String(total),
      'Content-Disposition': 'attachment; filename="ig-' + media.id + '.' + extension + '"',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function leerCredencial(env) {
  const inicial = typeof env.IG_ACCESS_TOKEN === 'string' ? env.IG_ACCESS_TOKEN.trim() : '';
  if (!inicial) throw new Error('Falta el secreto IG_ACCESS_TOKEN.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inicial));
  const seedHash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  const bootstrap = { accessToken: inicial, seedHash, refreshedAt: null, expiresAt: null };

  // Preserve the existing endpoint while the KV binding is being configured.
  // The scheduled handler requires KV and fails explicitly if it is missing.
  if (!env.IG_TOKEN_KV) return bootstrap;
  let guardado;
  try {
    guardado = await env.IG_TOKEN_KV.get(CLAVE_TOKEN, 'json');
  } catch {
    throw new Error('No se pudo leer el token de Instagram desde KV.');
  }
  // Rotating the bootstrap secret must override an old persisted token.
  if (!guardado || guardado.seedHash !== seedHash) return bootstrap;
  if (typeof guardado.accessToken !== 'string' || !guardado.accessToken.trim() ||
      !Number.isSafeInteger(guardado.refreshedAt) || guardado.refreshedAt <= 0 ||
      !Number.isSafeInteger(guardado.expiresAt) || guardado.expiresAt <= guardado.refreshedAt) {
    throw new Error('El estado del token de Instagram en KV no es válido.');
  }
  return guardado;
}

async function renovarToken(env) {
  if (!env.IG_TOKEN_KV) throw new Error('Falta el binding KV IG_TOKEN_KV para renovar Instagram.');
  const actual = await leerCredencial(env);
  const ahora = Date.now();
  if (actual.expiresAt && actual.expiresAt <= ahora) {
    throw new Error('El token de Instagram caducó. Reemplaza IG_ACCESS_TOKEN por un token de larga duración válido.');
  }
  if (actual.refreshedAt) {
    const antiguedad = ahora - actual.refreshedAt;
    // Meta only refreshes long-lived tokens at least 24 hours old.
    if (antiguedad < DIA) return;
    if (antiguedad < INTERVALO_RENOVACION && actual.expiresAt - ahora > MARGEN_CADUCIDAD) return;
  }

  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', actual.accessToken);
  let respuesta;
  try {
    respuesta = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'manual' });
  } catch {
    // Never propagate an exception that could contain the credential-bearing URL.
    throw new Error('No se pudo conectar con Instagram para renovar el token.');
  }
  if (!respuesta.ok) {
    throw new Error('Instagram rechazó la renovación del token (HTTP ' + respuesta.status + ').');
  }
  let datos;
  try { datos = await respuesta.json(); }
  catch { throw new Error('Instagram devolvió una respuesta de renovación no válida.'); }
  const segundos = Number(datos?.expires_in);
  if (typeof datos?.access_token !== 'string' || !datos.access_token.trim() ||
      !Number.isSafeInteger(segundos) || segundos <= 0 ||
      !Number.isSafeInteger(ahora + segundos * 1000)) {
    throw new Error('Instagram no devolvió un token y una caducidad válidos.');
  }
  const nuevo = {
    accessToken: datos.access_token.trim(), seedHash: actual.seedHash,
    refreshedAt: ahora, expiresAt: ahora + segundos * 1000
  };
  try {
    // No TTL: retain expiry metadata so an expired token is not silently
    // replaced with the original bootstrap secret after a long outage.
    await env.IG_TOKEN_KV.put(CLAVE_TOKEN, JSON.stringify(nuevo));
  } catch {
    throw new Error('No se pudo guardar el token renovado de Instagram en KV.');
  }
  console.info('Instagram: token renovado; vigencia de ' + segundos + ' segundos.');
}

export default {
  async scheduled(controller, env) {
    // Await errors so Cloudflare records failed invocations. No public HTTP
    // refresh route: only the configured Cron Trigger can invoke this handler.
    await renovarToken(env);
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = {
      'Cache-Control': 'no-store',
      'Vary': 'Origin'
    };

    if (origin && ORIGENES_PERMITIDOS.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Authorization';
      headers['Access-Control-Max-Age'] = '86400';
    }

    const json = (body, status = 200) =>
      Response.json(body, { status, headers });

    // Requests without Origin (e.g. curl) still require authentication.
    if (origin && !ORIGENES_PERMITIDOS.has(origin)) {
      return json({ error: 'Origen no permitido' }, 403);
    }

    const ruta = new URL(request.url).pathname;
    const imagenSolicitada = ruta.match(/^\/instagram\/media\/(\d{1,30})$/)?.[1];
    if (ruta !== '/instagram/posts' && !imagenSolicitada) {
      return json({ error: 'Ruta no encontrada' }, 404);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'GET') {
      headers.Allow = 'GET, OPTIONS';
      return json({ error: 'Método no permitido' }, 405);
    }

    const token = request.headers
      .get('Authorization')
      ?.match(/^Bearer\s+(\S+)$/i)?.[1];

    if (!token) {
      return json({ error: 'Falta la sesión de Firebase' }, 401);
    }

    if (!env.FIREBASE_API_KEY ||
        !env.FIREBASE_PROYECTO ||
        !env.IG_ACCESS_TOKEN) {
      return json({ error: 'Configuración incompleta del Worker' }, 500);
    }

    try {
      // 1. Validate the Firebase token and obtain its user's UID.
      const identity = await fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:lookup' +
          '?key=' + encodeURIComponent(env.FIREBASE_API_KEY),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token }),
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!identity.ok) {
        return json(
          { error: 'No se pudo validar la sesión' },
          identity.status >= 500 || identity.status === 429 ? 503 : 401
        );
      }

      const user = (await identity.json()).users?.[0];

      if (!user?.localId || user.disabled) {
        return json({ error: 'Sesión no válida' }, 401);
      }

      // 2. Read their membership using their own Firebase token.
      // Firestore security rules still apply.
      const membership = await fetch(
        'https://firestore.googleapis.com/v1/projects/' +
          encodeURIComponent(env.FIREBASE_PROYECTO) +
          '/databases/(default)/documents/miembros/' +
          encodeURIComponent(user.localId),
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!membership.ok) {
        return json(
          { error: 'No se pudo comprobar el permiso de administrador' },
          membership.status >= 500 || membership.status === 429 ? 503 : 403
        );
      }

      const member = await membership.json();

      if (member.fields?.rol?.stringValue !== 'admin') {
        return json({ error: 'Solo administradores de Xuexi' }, 403);
      }

      // 3. Prefer the persisted refreshed token over the bootstrap secret.
      const credencial = await leerCredencial(env);
      if (credencial.expiresAt && credencial.expiresAt <= Date.now()) {
        return json({ error: 'La conexión con Instagram caducó. Renueva el token del conector.' }, 502);
      }
      const url = new URL('https://graph.instagram.com/v25.0/me/media');
      url.searchParams.set('limit', '10');
      url.searchParams.set(
        'fields',
        'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,' +
          'children{id,media_type,media_url,thumbnail_url}'
      );

      const instagram = await fetch(url, {
        headers: {
          Authorization: `Bearer ${credencial.accessToken}`
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!instagram.ok) {
        // Do not forward upstream errors or URLs containing credentials.
        return json({ error: 'No se pudieron obtener las publicaciones' }, 502);
      }

      const result = await instagram.json();

      if (!Array.isArray(result.data)) {
        return json({ error: 'Respuesta inesperada de Instagram' }, 502);
      }

      if (imagenSolicitada) {
        const medios = result.data.slice(0, 10).flatMap(post =>
          post.media_type === 'CAROUSEL_ALBUM' ? (post.children?.data || []) : [post]);
        const media = medios.find(m => m.id === imagenSolicitada && m.media_type === 'IMAGE');
        if (!media) return json({ error: 'Imagen no disponible en las últimas publicaciones' }, 404);
        const archivo = await descargarImagen(media, headers);
        return archivo || json({ error: 'No se pudo descargar la imagen (JPG, PNG o WEBP, máximo 20 MB)' }, 502);
      }

      // Return only post fields. Exclude pagination URLs, which may
      // contain the Instagram access token.
      const cleanMedia = (media) => ({
        id: media.id,
        caption: media.caption,
        media_type: media.media_type,
        media_url: media.media_url,
        thumbnail_url: media.thumbnail_url,
        permalink: media.permalink,
        timestamp: media.timestamp,
        ...(Array.isArray(media.children?.data)
          ? { children: { data: media.children.data.map(cleanMedia) } }
          : {})
      });

      return json({ data: result.data.slice(0, 10).map(cleanMedia) });
    } catch {
      return json({ error: 'Error de conexión con el servicio' }, 502);
    }
  }
};

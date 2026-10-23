/* Instagram · Xuexi Club UC
 * Paste into a separate Cloudflare Worker using the Cloudflare dashboard.
 * Secret: IG_ACCESS_TOKEN
 * Text variables: FIREBASE_API_KEY, FIREBASE_PROYECTO
 * GET /instagram/posts requires a Firebase ID token and a current admin role.
 */

const ORIGENES_PERMITIDOS = new Set([
  'https://xuexiclub.cl',
  'https://www.xuexiclub.cl',
  'https://xuexi-club-uc.github.io',
  'https://qgerman2.github.io'
]);

export default {
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

    if (new URL(request.url).pathname !== '/instagram/posts') {
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

      // 3. Fetch the latest 10 posts using the server's Instagram secret.
      const url = new URL('https://graph.instagram.com/v25.0/me/media');
      url.searchParams.set('limit', '10');
      url.searchParams.set(
        'fields',
        'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,' +
          'children{id,media_type,media_url,thumbnail_url}'
      );

      const instagram = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`
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

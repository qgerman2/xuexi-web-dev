/*
 * Conector de acceso para el panel de edición (Decap CMS).
 *
 * Se instala en Cloudflare Workers, no en este sitio. Su único trabajo es
 * hacer el intercambio con GitHub para saber quién entra al panel.
 *
 * Existe porque GitHub exige un "client secret" que no puede vivir en el
 * navegador: cualquiera podría verlo en el código fuente. Aquí queda guardado
 * del lado del servidor, en las variables del Worker.
 *
 * Quién puede guardar cambios lo decide GitHub según los permisos de la
 * organización, no este archivo.
 *
 * Instrucciones de instalación: admin/LEEME-instalacion.md
 */

const GITHUB_AUTORIZAR = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';

// Desde dónde se permite abrir el panel.
const ORIGENES_PERMITIDOS = [
  'https://xuexiclub.cl',
  'https://www.xuexiclub.cl',
  'https://xuexi-club-uc.github.io',
  // Copia de desarrollo (qgerman2/xuexi-web-dev en GitHub Pages). El origen no
  // lleva la ruta del proyecto: postMessage compara esquema, host y puerto.
  'https://qgerman2.github.io'
];

function paginaRespuesta(mensaje, origenes) {
  // Le devuelve el resultado a la ventana que abrió el panel.
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Conectando…</title></head>
<body><p style="font-family:system-ui;padding:24px">Conectando con GitHub…</p>
<script>
(function(){
  var mensaje = ${JSON.stringify(mensaje)};
  var permitidos = ${JSON.stringify(origenes)};
  function responder(e){
    // Solo le contestamos al sitio del club, no a cualquier ventana.
    if (permitidos.indexOf(e.origin) === -1) return;
    window.opener.postMessage(mensaje, e.origin);
    window.removeEventListener('message', responder, false);
  }
  window.addEventListener('message', responder, false);
  window.opener.postMessage('authorizing:github', '*');
})();
<\/script></body></html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(peticion, entorno) {
    const url = new URL(peticion.url);

    // Paso 1: mandamos a la persona a identificarse en GitHub.
    if (url.pathname === '/auth') {
      const estado = crypto.randomUUID();
      const parametros = new URLSearchParams({
        client_id: entorno.GITHUB_CLIENT_ID,
        redirect_uri: `${url.origin}/callback`,
        // Permiso acotado: solo repositorios públicos.
        scope: url.searchParams.get('scope') || 'public_repo',
        state: estado
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${GITHUB_AUTORIZAR}?${parametros}`,
          // Guardamos el estado para verificarlo al volver.
          'Set-Cookie': `estado=${estado}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
        }
      });
    }

    // Paso 2: GitHub nos devuelve aquí con un código de un solo uso.
    if (url.pathname === '/callback') {
      const codigo = url.searchParams.get('code');
      const estadoRecibido = url.searchParams.get('state');
      const galletas = peticion.headers.get('Cookie') || '';
      const estadoGuardado = (galletas.match(/estado=([^;]+)/) || [])[1];

      // Si el estado no calza, la petición no salió de nuestro panel.
      if (!codigo || !estadoRecibido || estadoRecibido !== estadoGuardado) {
        return paginaRespuesta(
          'authorization:github:error:' + JSON.stringify({ message: 'Solicitud no válida' }),
          ORIGENES_PERMITIDOS
        );
      }

      const respuesta = await fetch(GITHUB_TOKEN, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: entorno.GITHUB_CLIENT_ID,
          client_secret: entorno.GITHUB_CLIENT_SECRET,
          code: codigo
        })
      });
      const datos = await respuesta.json();

      if (!datos.access_token) {
        return paginaRespuesta(
          'authorization:github:error:' + JSON.stringify({ message: datos.error || 'No se pudo entrar' }),
          ORIGENES_PERMITIDOS
        );
      }

      return paginaRespuesta(
        'authorization:github:success:' +
          JSON.stringify({ token: datos.access_token, provider: 'github' }),
        ORIGENES_PERMITIDOS
      );
    }

    return new Response('Conector del panel de Xuexi Club UC.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

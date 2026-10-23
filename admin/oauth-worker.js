/* Conector del panel de edición · Xuexi Club UC
 *
 * Decap corre entero en el navegador, así que no puede guardar un token de
 * GitHub: cualquiera lo leería. Este Worker hace de intermediario.
 *
 *   1. /auth          pide correo y contraseña de Xuexi. El navegador habla
 *                     directo con Firebase — aquí nunca pasa una contraseña.
 *                     Devuelve el idToken a Decap con el apretón de manos que
 *                     Decap espera.
 *
 *   2. /github/...    Decap cree que habla con api.github.com (api_root en
 *                     admin/config.yml). En realidad pasa por aquí: se valida
 *                     el idToken, se comprueba que la persona sea 'admin' en
 *                     Firestore, y recién entonces se reenvía a GitHub con el
 *                     token del programa, que nunca sale de este Worker.
 *
 * De paso se reescribe /user y el autor de cada commit, para que el historial
 * diga quién editó de verdad y no el dueño del token.
 *
 * Secretos (npx wrangler secret put ...):
 *   GITHUB_BOT_TOKEN    PAT de grano fino, un solo repo, Contents: RW
 * Variables ([vars] en wrangler.toml, públicas):
 *   FIREBASE_API_KEY    la clave web del proyecto
 *   FIREBASE_PROYECTO   p.ej. xuexi-sandbox-01
 *   GITHUB_REPO         p.ej. qgerman2/xuexi-web-dev
 */

const ORIGENES_PERMITIDOS = [
  'https://xuexiclub.cl',
  'https://www.xuexiclub.cl',
  'https://xuexi-club-uc.github.io',
  'https://qgerman2.github.io',
  'http://localhost:8000'
];

const ROL_REQUERIDO = 'admin';
const GITHUB_API = 'https://api.github.com';

// Cuánto dura una sesión del panel. El idToken de Firebase dura una hora y
// Decap se queda con una copia en memoria, así que una sesión larga se cortaba
// a media edición. Esto lo sustituye por algo que sí aguanta una tarde.
const SESION_HORAS = 8;
const PREFIJO_SESION = 'xs1.';

// ─────────────────────────── Identidad ───────────────────────────

// Caché por isolate: Decap hace muchas peticiones seguidas y cada una costaría
// dos llamadas de red. 60 segundos es poco para que un cambio de rol quede
// colgado, y suficiente para que una sesión de edición no se arrastre.
const cache = new Map();

function leerToken(peticion) {
  const h = peticion.headers.get('Authorization') || '';
  const m = h.match(/^(?:token|Bearer)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Acepta la sesión del panel o, la primera vez, un idToken de Firebase.
async function verificar(testigo, entorno) {
  if (!testigo) return null;
  if (testigo.startsWith(PREFIJO_SESION)) return abrirSesion(testigo, entorno);
  return verificarFirebase(testigo, entorno);
}

async function verificarFirebase(idToken, entorno) {
  if (!idToken) return null;

  const guardado = cache.get(idToken);
  if (guardado && guardado.hasta > Date.now()) return guardado.miembro;

  // ¿El idToken es válido y de este proyecto? Google responde con el uid.
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${entorno.FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }) });
  if (!r.ok) return null;
  const uid = (await r.json()).users?.[0]?.localId;
  if (!uid) return null;

  // Su propia ficha. Usamos su token, no uno de administrador: las reglas ya
  // permiten que cada quien lea la suya, así que nada aquí las esquiva.
  const f = await fetch(
    `https://firestore.googleapis.com/v1/projects/${entorno.FIREBASE_PROYECTO}` +
    `/databases/(default)/documents/miembros/${uid}`,
    { headers: { Authorization: 'Bearer ' + idToken } });
  if (!f.ok) return null;

  const campos = (await f.json()).fields || {};
  if (campos.rol?.stringValue !== ROL_REQUERIDO) return null;

  const miembro = {
    uid,
    nombre: campos.nombre?.stringValue || 'Miembro Xuexi',
    email: campos.email?.stringValue || `${uid}@xuexiclub.cl`
  };
  cache.set(idToken, { miembro, hasta: Date.now() + 60_000 });
  return miembro;
}

// ───────────────────── Sesión propia del panel ─────────────────────
//
// Un testigo firmado con HMAC: lleva dentro quién es la persona y hasta cuándo
// vale, y se comprueba sin tocar la red. No hace falta guardarlo en ningún
// sitio — la firma es la prueba.
//
// A cambio, el rol viaja dentro: si a alguien se le quita 'admin', sigue
// pudiendo editar hasta que su sesión caduque. Para cortar todas de golpe,
// cambia SESION_SECRETO.

const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const deB64 = (s) => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function claveSesion(entorno) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(entorno.SESION_SECRETO),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function firmarSesion(miembro, entorno) {
  const datos = JSON.stringify({
    uid: miembro.uid, nombre: miembro.nombre, email: miembro.email,
    exp: Date.now() + SESION_HORAS * 3600_000
  });
  const bytes = new TextEncoder().encode(datos);
  const mac = await crypto.subtle.sign('HMAC', await claveSesion(entorno), bytes);
  return PREFIJO_SESION + b64(bytes) + '.' + b64(mac);
}

async function abrirSesion(testigo, entorno) {
  try {
    const [cuerpo, mac] = testigo.slice(PREFIJO_SESION.length).split('.');
    if (!cuerpo || !mac) return null;
    const bytes = deB64(cuerpo);
    const vale = await crypto.subtle.verify(
      'HMAC', await claveSesion(entorno), deB64(mac), bytes);
    if (!vale) return null;
    const d = JSON.parse(new TextDecoder().decode(bytes));
    return d.exp > Date.now() ? { uid: d.uid, nombre: d.nombre, email: d.email } : null;
  } catch (e) {
    return null;
  }
}

// ──────────────────────────── CORS ────────────────────────────

function cabecerasCors(origen) {
  if (!ORIGENES_PERMITIDOS.includes(origen)) return null;
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag, Link',
    'Access-Control-Max-Age': '86400'
  };
}

// ───────────────────── Apretón de manos con Decap ─────────────────────

function paginaLogin(entorno, origenes) {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso al panel · Xuexi Club UC</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1a1010;
       color:#f4ece0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  form{width:min(340px,88vw);display:grid;gap:12px}
  h1{font-size:1.15rem;font-weight:600;margin:0 0 4px;text-align:center}
  p.sub{margin:0 0 10px;text-align:center;font-size:.82rem;opacity:.7}
  label{font-size:.76rem;opacity:.8}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:7px;
        border:1px solid #4a3030;background:#241616;color:inherit;font:inherit}
  button{padding:11px;border:0;border-radius:7px;background:#C0392B;color:#fff;
         font:inherit;font-weight:600;cursor:pointer}
  button[disabled]{opacity:.6;cursor:default}
  .err{background:rgba(192,57,43,.18);border:1px solid #C0392B;border-radius:7px;
       padding:9px 11px;font-size:.8rem;display:none}
</style></head>
<body>
<form id="f">
  <h1><span style="color:#D4AF61">学习</span> Panel de edición</h1>
  <p class="sub">Entra con tu cuenta de miembro. Solo coordinación.</p>
  <div class="err" id="err"></div>
  <label for="e">Correo electrónico</label>
  <input id="e" type="email" required autocomplete="username">
  <label for="p">Contraseña</label>
  <input id="p" type="password" required autocomplete="current-password">
  <button id="b" type="submit">Entrar</button>
</form>

<script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
<script>
(function(){
  var PERMITIDOS = ${JSON.stringify(origenes)};
  firebase.initializeApp({
    apiKey: ${JSON.stringify(entorno.FIREBASE_API_KEY)},
    authDomain: ${JSON.stringify(entorno.FIREBASE_PROYECTO + '.firebaseapp.com')},
    projectId: ${JSON.stringify(entorno.FIREBASE_PROYECTO)}
  });

  var form = document.getElementById('f'),
      err  = document.getElementById('err'),
      btn  = document.getElementById('b');

  function fallar(t){ err.textContent = t; err.style.display = 'block';
                      btn.disabled = false; btn.textContent = 'Entrar'; }

  // Decap escucha este mensaje. Primero preguntamos a la ventana que nos abrió
  // para enterarnos de su origen, y solo le contestamos a ella: así el token
  // no se reparte a cualquier pestaña.
  function entregar(token){
    var mensaje = 'authorization:github:success:' +
                  JSON.stringify({ token: token, provider: 'github' });
    function responder(e){
      if (PERMITIDOS.indexOf(e.origin) === -1) return;
      window.opener.postMessage(mensaje, e.origin);
      window.removeEventListener('message', responder, false);
      document.body.innerHTML = '<p style="font-family:system-ui">Listo, ya puedes cerrar.</p>';
    }
    window.addEventListener('message', responder, false);
    window.opener.postMessage('authorizing:github', '*');
  }

  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Verificando…';

    firebase.auth()
      .signInWithEmailAndPassword(document.getElementById('e').value.trim(),
                                  document.getElementById('p').value)
      .then(function(cred){ return cred.user.getIdToken(); })
      .then(function(idToken){
        if (!window.opener) { fallar('Abre el panel desde /admin/, no directamente.'); return; }
        entregar(idToken);
      })
      .catch(function(e){
        fallar(e.code === 'auth/invalid-credential'
          ? 'Correo o contraseña incorrectos.'
          : (e.message || 'No se pudo entrar.'));
      });
  });
})();
<\/script></body></html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// ──────────────────────────── Worker ────────────────────────────

export default {
  async fetch(peticion, entorno) {
    const url = new URL(peticion.url);
    const origen = peticion.headers.get('Origin') || '';

    // 1 · La pantalla de acceso.
    if (url.pathname === '/auth') {
      return paginaLogin(entorno, ORIGENES_PERMITIDOS);
    }

    // 2 · Cambiar un idToken de Firebase por una sesión del panel.
    if (url.pathname === '/sesion' && peticion.method === 'POST') {
      const cors = cabecerasCors(origen);
      if (!cors) return Response.json({ message: 'Origen no permitido' }, { status: 403 });
      const miembro = await verificarFirebase(leerToken(peticion), entorno);
      if (!miembro) {
        return Response.json({ message: 'Sin permisos de coordinación' },
                             { status: 401, headers: cors });
      }
      return Response.json({ token: await firmarSesion(miembro, entorno) },
                           { headers: cors });
    }

    if (url.pathname === '/sesion' && peticion.method === 'OPTIONS') {
      const cors = cabecerasCors(origen);
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }

    // 3 · Todo lo que Decap cree que es api.github.com.
    if (url.pathname.startsWith('/github')) {
      const cors = cabecerasCors(origen);

      if (peticion.method === 'OPTIONS') {
        return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
      }
      if (!cors) {
        return Response.json({ message: 'Origen no permitido' }, { status: 403 });
      }

      const miembro = await verificar(leerToken(peticion), entorno);
      if (!miembro) {
        // 401 y no 403: así Decap ofrece volver a entrar cuando el idToken
        // caduca (dura una hora).
        return Response.json(
          { message: 'Sesión no válida o sin permisos de coordinación' },
          { status: 401, headers: cors });
      }

      // /user no se reenvía: lo inventamos, y de ahí sale {{author-login}}.
      if (url.pathname === '/github/user') {
        return Response.json({
          login: miembro.nombre,
          name: miembro.nombre,
          email: miembro.email,
          avatar_url: ''
        }, { headers: cors });
      }

      let cuerpo;
      if (!['GET', 'HEAD'].includes(peticion.method)) {
        cuerpo = await peticion.text();

        // Quien firma el commit es la persona; quien lo sube, el panel.
        //
        // Solo se toca el cuerpo si es pequeño. Al subir una foto, Decap manda
        // la imagen entera en base64 dentro del JSON: un JPEG de 2 MB son casi
        // 3 MB de texto, y parsearlo y volver a serializarlo se come el tiempo
        // de CPU que tiene un Worker (en el plan gratuito, 10 ms). Si pasa del
        // límite, el commit lo firma el dueño del token y ya está: perder la
        // autoría de una foto es mucho mejor que fallar la subida.
        const LIMITE = 256 * 1024;
        const esCommit = url.pathname.includes('/contents/')
                      || url.pathname.includes('/git/commits');
        if (esCommit && cuerpo.length <= LIMITE) {
          try {
            const json = JSON.parse(cuerpo);
            json.author = { name: miembro.nombre, email: miembro.email };
            json.committer = { name: 'Panel Xuexi', email: 'panel@xuexiclub.cl' };
            cuerpo = JSON.stringify(json);
          } catch (e) { /* no era JSON: lo dejamos como vino */ }
        }
      }

      const arriba = GITHUB_API + url.pathname.slice('/github'.length) + url.search;
      const r = await fetch(arriba, {
        method: peticion.method,
        headers: {
          Authorization: 'Bearer ' + entorno.GITHUB_BOT_TOKEN,
          Accept: 'application/vnd.github+json',
          'Content-Type': peticion.headers.get('Content-Type') || 'application/json',
          'User-Agent': 'xuexi-panel'
        },
        body: cuerpo
      });

      const salida = new Headers(cors);
      for (const k of ['Content-Type', 'ETag', 'Link']) {
        const v = r.headers.get(k);
        if (v) salida.set(k, v);
      }
      return new Response(r.body, { status: r.status, headers: salida });
    }

    return new Response('Conector del panel de Xuexi Club UC.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

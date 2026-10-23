/* Autenticación y datos de miembros · Xuexi Club UC
 *
 * PRINCIPIO: este módulo falla cerrado.
 *
 * El sitio es estático y no tiene servidor propio, así que no puede verificar
 * nada por sí mismo. Toda la seguridad real la aporta Firebase: la identidad
 * (Firebase Auth) y las reglas de acceso a los datos (Firestore Rules).
 *
 * Si Firebase no está configurado, NO hay acceso de miembros. No existe un
 * "modo demo": guardar contraseñas en el navegador o aceptar códigos escritos
 * en el código fuente daría una falsa sensación de seguridad, porque cualquiera
 * puede leer estos archivos.
 *
 * Los códigos de invitación viven SOLO en Firestore, nunca en el repositorio:
 * todo lo que está aquí es público.
 */
(function(){
  'use strict';

  var db = null;
  var auth = null;
  var listo = false;

  var SIN_CONFIGURAR = 'El acceso de miembros todavía no está habilitado. ' +
    'Escríbenos por Instagram (@xuexiclub.uc) y te ayudamos.';

  function iniciar(){
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return false;
    try {
      auth = firebase.auth();
      db = firebase.firestore();
      listo = true;
    } catch (e) {
      listo = false;
    }
    return listo;
  }

  iniciar();

  function noDisponible(){
    return Promise.reject(new Error(SIN_CONFIGURAR));
  }

  // ─────────────────────────── Sesión ───────────────────────────

  function onAuth(callback){
    if (!listo && !iniciar()){ callback(null); return function(){}; }
    return auth.onAuthStateChanged(function(user){
      if (!user){ callback(null); return; }
      // Adjuntamos el perfil del miembro (nombre, comisión, rol) al usuario.
      db.collection('miembros').doc(user.uid).get()
        .then(function(doc){
          var perfil = doc.exists ? doc.data() : {};
          callback({
            uid: user.uid,
            email: user.email,
            nombre: perfil.nombre || user.email,
            comision: perfil.comision || '',
            rol: perfil.rol || 'miembro',
            estadoPago: perfil.estadoPago || 'pendiente',
            pagoDeclarado: perfil.pagoDeclarado || null,
            ultimoPago: perfil.ultimoPago || null
          });
        })
        .catch(function(){ callback({ uid: user.uid, email: user.email, rol: 'miembro' }); });
    });
  }

  function login(email, password){
    if (!listo && !iniciar()) return noDisponible();
    return auth.signInWithEmailAndPassword(email, password);
  }

  function logout(){
    if (!listo && !iniciar()) return Promise.resolve();
    return auth.signOut();
  }

  // ──────────────────── Códigos de invitación ────────────────────

  function normalizar(codigo){
    return String(codigo || '').trim().toUpperCase();
  }

  function validarCodigo(codigo){
    codigo = normalizar(codigo);
    if (!codigo) return Promise.reject(new Error('Ingresa un código de invitación.'));
    if (!listo && !iniciar()) return noDisponible();

    return db.collection('codigos_invitacion').doc(codigo).get().then(function(doc){
      if (!doc.exists) throw new Error('El código de invitación no existe o es inválido.');
      if (doc.data().usado){
        throw new Error('Este código ya fue utilizado. Pide uno nuevo a la coordinación.');
      }
      return doc.data();
    });
  }

  // ───────────────────────── Registro ─────────────────────────

  function registrar(codigo, nombre, comision, email, password){
    codigo = normalizar(codigo);
    if (!listo && !iniciar()) return noDisponible();

    return validarCodigo(codigo)
      .then(function(){ return auth.createUserWithEmailAndPassword(email, password); })
      .then(function(cred){
        var uid = cred.user.uid;
        var refCodigo = db.collection('codigos_invitacion').doc(codigo);
        var refMiembro = db.collection('miembros').doc(uid);

        // Transacción: si dos personas usan el mismo código a la vez, solo una
        // lo consigue. Comprobar y marcar por separado no daría esa garantía.
        return db.runTransaction(function(tx){
          return tx.get(refCodigo).then(function(doc){
            if (!doc.exists) throw new Error('El código de invitación ya no existe.');
            if (doc.data().usado) throw new Error('Ese código acaba de ser utilizado por otra persona.');

            tx.set(refMiembro, {
              nombre: nombre,
              comision: comision || 'xuexi',
              email: email,
              rol: 'miembro',
              estadoPago: 'pendiente',
              codigoUsado: codigo,
              fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
            });
            tx.update(refCodigo, {
              usado: true,
              usadoPor: uid,
              fechaUso: firebase.firestore.FieldValue.serverTimestamp()
            });
          });
        }).catch(function(err){
          // La cuenta quedó creada pero el código no se pudo reclamar: la
          // borramos para no dejar usuarios sin perfil dando vueltas.
          return cred.user.delete()
            .catch(function(){})
            .then(function(){ throw err; });
        });
      });
  }

  // ─────────────────────── Datos del portal ───────────────────────

  // El calendario vive SOLO en Firestore. Antes existía una copia en
  // data/calendario_interno.json, pero ese archivo se servía públicamente:
  // de "interno" tenía únicamente el nombre.
  function obtenerCalendarioInterno(){
    if (!listo && !iniciar()) return Promise.resolve([]);
    return db.collection('calendario_interno').orderBy('fecha', 'asc').get()
      .then(function(snap){
        var lista = [];
        snap.forEach(function(doc){
          var e = doc.data(); e.id = doc.id; lista.push(e);
        });
        return lista;
      })
      .catch(function(){ return []; });
  }

  // Avisar que se pagó la cuota. NO cambia el estado: solo deja constancia para
  // que la coordinación lo confirme contra la cartola. Las reglas de Firestore
  // impiden que alguien se marque al día a sí mismo, y así debe seguir siendo.
  function declararPago(){
    if (!listo && !iniciar()) return noDisponible();
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error('Necesitas iniciar sesión.'));
    var hoy = new Date();
    return db.collection('miembros').doc(u.uid).update({
      pagoDeclarado: {
        fecha: hoy.toISOString().slice(0, 10),
        mes: hoy.getMonth() + 1,
        anio: hoy.getFullYear()
      }
    });
  }

  function obtenerConfigMembresia(){
    return fetch('data/membresias.json', {cache:'no-cache'})
      .then(function(r){ return r.ok ? r.json() : {}; })
      .catch(function(){ return {}; });
  }

  // El estado de pago NO se puede cambiar desde el navegador: lo confirma la
  // coordinación. Si alguien pudiera marcarse "al día" solo, no significaría
  // nada. Las reglas de Firestore también lo impiden del lado del servidor.

  // ──────────────────────── Fotos de eventos ────────────────────────
  // Permite a la coordinación subir fotos directamente desde la web.

  // Usa la misma configuración y el mismo conector autenticado que Decap.
  // Las fotos y el JSON del evento se publican juntos en un único commit.
  var backendFotos = null;
  var fotosRepositorioSesion = [];

  async function configuracionFotos(){
    if (backendFotos) return backendFotos;
    var r = await fetch(new URL('admin/config.yml', document.baseURI), { cache: 'no-store' });
    if (!r.ok) throw new Error('No se pudo leer la configuración del panel.');
    var texto = await r.text();
    function campo(nombre){
      var m = texto.match(new RegExp('^  ' + nombre + ':\\s*([^\\r\\n#]+)', 'm'));
      return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
    }
    var api = campo('api_root'), repo = campo('repo'), branch = campo('branch');
    if (!/^https:\/\//.test(api) || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !branch){
      throw new Error('La configuración del backend de fotos está incompleta.');
    }
    backendFotos = { api: api.replace(/\/$/, ''), repo: repo, branch: branch };
    return backendFotos;
  }

  async function subirFotosEvento(eventoId, files, caption, onProgreso){
    if (!listo && !iniciar()) return noDisponible();
    var usuario = auth.currentUser;
    if (!usuario) throw new Error('Debes iniciar sesión como administrador.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(eventoId || '')){
      throw new Error('Selecciona un evento publicado antes de subir fotos.');
    }
    files = Array.from(files || []);
    if (!files.length) throw new Error('Selecciona al menos una foto.');
    files.forEach(function(file){
      if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)){
        throw new Error('Usa imágenes JPG, PNG o WEBP: ' + (file?.name || 'archivo desconocido'));
      }
      if (!file.size || file.size > 20 * 1024 * 1024){
        throw new Error('Cada imagen debe tener contenido y pesar como máximo 20 MB: ' + file.name);
      }
    });
    var perfil = await db.collection('miembros').doc(usuario.uid).get();
    if (!perfil.exists || perfil.data().rol !== 'admin'){
      throw new Error('Solo administradores pueden subir fotos.');
    }
    var config = await configuracionFotos();
    var base = '/repos/' + config.repo;
    var rama = config.branch.split('/').map(encodeURIComponent).join('/');
    var token = await usuario.getIdToken();
    async function api(ruta, method, body){
      if (!auth.currentUser || auth.currentUser.uid !== usuario.uid){
        throw new Error('La sesión cambió. Vuelve a iniciar sesión.');
      }
      var respuesta = await fetch(config.api + base + ruta, {
        method: method || 'GET', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });
      var datos = await respuesta.json();
      if (!respuesta.ok){
        var error = new Error(respuesta.status === 401 || respuesta.status === 403
          ? 'Tu sesión no permite subir fotos. Vuelve a iniciar sesión.'
          : 'No se pudo guardar la foto en el repositorio (' + respuesta.status + ').');
        error.status = respuesta.status;
        throw error;
      }
      return datos;
    }
    function progreso(pct){ if (typeof onProgreso === 'function') onProgreso(pct); }
    var fotos = files.map(function(file){
      var nombre = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
      return { file: file, ruta: 'assets/eventos/' + eventoId + '/' + Date.now().toString(36) + '-' +
        crypto.randomUUID().slice(0, 8) + '-' + nombre, sha: null };
    });
    var rutaEvento = 'data/eventos/' + eventoId + '.json';
    progreso(5);

    for (var intento = 0; intento < 3; intento++){
      var head = await api('/git/ref/heads/' + rama);
      var commitBase = await api('/git/commits/' + head.object.sha);
      var archivo;
      try {
        archivo = await api('/contents/' + rutaEvento + '?ref=' + encodeURIComponent(head.object.sha));
      } catch(e){
        if (e.status === 404) throw new Error('El evento todavía no está publicado en el repositorio.');
        throw e;
      }
      var bytes = Uint8Array.from(atob(archivo.content.replace(/\s/g, '')), function(c){ return c.charCodeAt(0); });
      var evento = JSON.parse(new TextDecoder().decode(bytes));
      if (evento.id !== eventoId) throw new Error('El identificador del evento no coincide con su archivo.');
      var galeria = Array.isArray(evento.galeria) ? evento.galeria : (evento.galeria ? [evento.galeria] : []);
      evento.galeria = galeria.map(function(f){ return typeof f === 'string' ? f : f.foto; }).filter(Boolean);
      for (var i = 0; i < fotos.length; i++){
        var fotoArchivo = fotos[i];
        if (evento.galeria.indexOf(fotoArchivo.ruta) === -1) evento.galeria.push(fotoArchivo.ruta);
        if (!fotoArchivo.sha){
          var contenido = await new Promise(function(resolve, reject){
            var reader = new FileReader();
            reader.onload = function(){ resolve(String(reader.result).split(',')[1]); };
            reader.onerror = function(){ reject(new Error('No se pudo leer la imagen.')); };
            reader.readAsDataURL(fotoArchivo.file);
          });
          var blob = await api('/git/blobs', 'POST', { content: contenido, encoding: 'base64' });
          fotoArchivo.sha = blob.sha;
        }
        progreso(10 + Math.round((i + 1) / fotos.length * 45));
      }
      var eventoBlob = await api('/git/blobs', 'POST', {
        content: JSON.stringify(evento, null, 2) + '\n', encoding: 'utf-8'
      });
      var entradas = fotos.map(function(f){
        return { path: f.ruta, mode: '100644', type: 'blob', sha: f.sha };
      });
      entradas.push({ path: rutaEvento, mode: '100644', type: 'blob', sha: eventoBlob.sha });
      var tree = await api('/git/trees', 'POST', { base_tree: commitBase.tree.sha, tree: entradas });
      var commit = await api('/git/commits', 'POST', {
        message: 'Añade ' + fotos.length + ' foto(s) a ' + eventoId + ' desde la galería',
        tree: tree.sha, parents: [head.object.sha]
      });
      progreso(85);
      try {
        await api('/git/refs/heads/' + rama, 'PATCH', { sha: commit.sha, force: false });
      } catch(e){
        // Si otra persona guardó entre tanto, releemos su versión y sumamos la
        // foto sin pisar sus cambios. Nunca se fuerza el avance de la rama.
        if ((e.status === 409 || e.status === 422) && intento < 2) continue;
        throw e;
      }
      var guardadas = fotos.map(function(f){
        return { id: 'repo:' + f.ruta, eventoId: eventoId,
          url: URL.createObjectURL(f.file), caption: caption || evento.titulo || '',
          nombreArchivo: f.file.name, repoPath: f.ruta, esRepositorio: true };
      });
      fotosRepositorioSesion = fotosRepositorioSesion.concat(guardadas);
      progreso(100);
      return guardadas;
    }
  }

  function subirFotoEvento(eventoId, file, caption, onProgreso){
    return subirFotosEvento(eventoId, [file], caption, onProgreso).then(function(fotos){ return fotos[0]; });
  }

  function obtenerFotosEvento(eventoId){
    if (!listo && !iniciar()) return Promise.resolve([]);
    var q = db.collection('fotos_eventos');
    if (eventoId) {
      q = q.where('eventoId', '==', eventoId);
    }
    return q.get()
      .then(function(snap){
        var lista = [];
        snap.forEach(function(doc){
          var d = doc.data();
          d.id = doc.id;
          lista.push(d);
        });
        return lista;
      })
      .catch(function(){ return []; })
      .then(function(fotos){
        return fotos.concat(fotosRepositorioSesion.filter(function(f){ return !eventoId || f.eventoId === eventoId; }));
      });
  }

  function eliminarFotoEvento(docId, rutaStorage){
    if (!listo && !iniciar()) return noDisponible();
    var storage = null;
    try { storage = firebase.storage(); } catch(e){}

    var pStorage = Promise.resolve();
    if (storage && rutaStorage){
      pStorage = storage.ref(rutaStorage).delete().catch(function(){});
    }

    return pStorage.then(function(){
      return db.collection('fotos_eventos').doc(docId).delete();
    });
  }

  function obtenerTodasLasFotosEventos(){
    return obtenerFotosEvento('');
  }

  // ──────────────────────── Enlace en el menú ────────────────────────

  function actualizarNav(){
    var item = document.getElementById('nav-item-cuenta');
    if (!item) return;

    item.hidden = false;
    if (!listo && !iniciar()) return;

    onAuth(function(user){
      item.innerHTML = user
        ? '<a href="miembro.html" class="nav-member-link"><span class="zh">会员</span>Mi portal</a>'
        : '<a href="login.html"><span class="zh">登录</span>Miembros</a>';
    });
  }

  window.XuexiAuth = {
    disponible: function(){ return listo || iniciar(); },
    onAuth: onAuth,
    login: login,
    logout: logout,
    validarCodigo: validarCodigo,
    registrar: registrar,
    obtenerCalendarioInterno: obtenerCalendarioInterno,
    obtenerConfigMembresia: obtenerConfigMembresia,
    declararPago: declararPago,
    subirFotoEvento: subirFotoEvento,
    subirFotosEvento: subirFotosEvento,
    obtenerFotosEvento: obtenerFotosEvento,
    eliminarFotoEvento: eliminarFotoEvento,
    obtenerTodasLasFotosEventos: obtenerTodasLasFotosEventos,
    actualizarNav: actualizarNav
  };

  document.addEventListener('DOMContentLoaded', function(){
    iniciar();
    actualizarNav();
  });
})();

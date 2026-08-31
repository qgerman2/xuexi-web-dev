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

  function subirFotoEvento(eventoId, file, caption, onProgreso){
    if (!listo && !iniciar()) return noDisponible();
    if (!auth.currentUser) return Promise.reject(new Error('Debes iniciar sesión como administrador.'));

    var storage = null;
    try { storage = firebase.storage(); } catch(e){}

    var cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var rutaStorage = 'eventos/' + (eventoId || 'general') + '/' + Date.now() + '_' + cleanName;

    function guardarEnFirestore(url){
      return db.collection('fotos_eventos').add({
        eventoId: eventoId || '',
        url: url,
        caption: caption || '',
        nombreArchivo: file.name,
        rutaStorage: rutaStorage,
        creadoPor: auth.currentUser.uid,
        creadoPorEmail: auth.currentUser.email || '',
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function(docRef){
        return {
          id: docRef.id,
          eventoId: eventoId,
          url: url,
          caption: caption || '',
          nombreArchivo: file.name
        };
      });
    }

    if (storage) {
      var ref = storage.ref(rutaStorage);
      var uploadTask = ref.put(file);

      return new Promise(function(resolve, reject){
        uploadTask.on('state_changed',
          function(snap){
            if (typeof onProgreso === 'function' && snap.totalBytes > 0){
              var pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              onProgreso(pct);
            }
          },
          function(err){
            // Fallback a compresión Base64 / Data URL si storage tuviese error de CORS
            var reader = new FileReader();
            reader.onload = function(e){
              guardarEnFirestore(e.target.result).then(resolve).catch(reject);
            };
            reader.onerror = function(){ reject(err); };
            reader.readAsDataURL(file);
          },
          function(){
            uploadTask.snapshot.ref.getDownloadURL().then(function(url){
              guardarEnFirestore(url).then(resolve).catch(reject);
            }).catch(reject);
          }
        );
      });
    } else {
      // Fallback si Storage SDK no está cargado: DataURL en Firestore
      return new Promise(function(resolve, reject){
        var reader = new FileReader();
        reader.onload = function(e){
          guardarEnFirestore(e.target.result).then(resolve).catch(reject);
        };
        reader.onerror = function(err){ reject(err); };
        reader.readAsDataURL(file);
      });
    }
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
      .catch(function(){ return []; });
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

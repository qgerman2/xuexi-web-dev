/* Panel de cuotas · Xuexi Club UC
 *
 * Muestra lo que el worker de Mercado Pago responde en /everything: los cobros
 * y las suscripciones de todo el club. Solo lo ve quien tenga rol 'admin', y
 * eso lo decide el worker, no esta página: pedir /everything sin ser admin
 * devuelve 403 aunque se llame a estas funciones desde la consola.
 *
 * El worker no filtra ni busca: entrega los datos y el filtrado ocurre aquí,
 * sobre lo ya cargado. Por eso primero se trae todo (de 100 en 100) y después
 * se dibuja.
 */
(function(){
  'use strict';

  var WORKER = 'https://mp.xuexiclub.workers.dev';

  var datos = { miembros: [], pagos: [], suscripciones: [] };
  var filtro = '';
  var logUrl = '';

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }

  function aviso(caja, texto, error){
    caja.innerHTML = '<p class="coord-aviso' + (error ? ' coord-error' : '') + '">' +
      esc(texto) + '</p>';
  }

  function fecha(iso){
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('es-CL');
  }

  function monto(n){
    return n == null ? '—' : '$' + Number(n).toLocaleString('es-CL');
  }

  function email(s){
    return String(s || '').trim().toLowerCase();
  }

  function miembroPorUid(uid){
    uid = normalizarUid(uid);
    for (var i = 0; i < datos.miembros.length; i++) {
      if (datos.miembros[i].uid === uid) return datos.miembros[i];
    }
    return null;
  }

  function normalizarUid(uid){
    uid = String(uid || '');
    return uid.indexOf('xuexi-') === 0 ? uid.slice(6) : uid;
  }

  function nombreMiembro(uid){
    var raw = uid;
    uid = normalizarUid(uid);
    var m = miembroPorUid(uid);
    if (!m) return '<code>' + esc(raw || uid) + '</code>';
    return esc(m.nombre || m.email || uid) + '<br><span class="coord-sub">' +
      esc(m.email || uid) + '</span>';
  }

  // ───────────────────────────── Datos ─────────────────────────────

  // El token lo pone Firebase; el worker lo verifica contra las llaves de
  // Google y lee miembros/{uid} para saber si es admin.
  function pedir(ruta){
    return firebase.auth().currentUser.getIdToken().then(function(token){
      return fetch(WORKER + ruta, { headers: { Authorization: 'Bearer ' + token } });
    }).then(function(r){
      return r.json().then(function(cuerpo){
        if (!r.ok) throw new Error(cuerpo.error || ('HTTP ' + r.status));
        return cuerpo;
      });
    });
  }

  // /everything entrega una página a la vez y dice en nextOffset dónde sigue.
  // Pagos y suscripciones se acaban por separado, así que se avanza mientras
  // cualquiera de los dos tenga continuación.
  function cargarPagos(){
    datos.pagos = [];
    datos.suscripciones = [];
    function pagina(offset){
      return pedir('/everything?offset=' + offset).then(function(d){
        datos.pagos = datos.pagos.concat(d.payments.items);
        datos.suscripciones = datos.suscripciones.concat(d.subscriptions.items);
        var sigue = d.payments.nextOffset != null ? d.payments.nextOffset
                  : d.subscriptions.nextOffset;
        return sigue == null ? datos : pagina(sigue);
      });
    }
    return pagina(0);
  }

  function cargarMiembros(){
    return firebase.firestore().collection('miembros').get().then(function(snap){
      datos.miembros = [];
      snap.forEach(function(doc){
        var d = doc.data();
        datos.miembros.push({
          uid: doc.id,
          nombre: d.nombre || '',
          email: d.email || '',
          comision: d.comision || '',
          rol: d.rol || 'miembro',
          estadoManual: d.estadoPago || 'pendiente'
        });
      });
      datos.miembros.sort(function(a,b){
        return (a.nombre || a.email || a.uid).localeCompare(b.nombre || b.email || b.uid);
      });
    });
  }

  function cargarTodo(){
    datos = { miembros: [], pagos: [], suscripciones: [] };
    return Promise.all([cargarMiembros(), cargarPagos()]).then(function(){ return datos; });
  }

  // ──────────────────────────── Dibujo ────────────────────────────

  var SALUD = {
    ok:       ['Al día', 'cuota-ok'],
    retrying: ['Reintentando', 'cuota-aviso'],
    failing:  ['Cobro fallido', 'cuota-mal']
  };

  function coincide(texto){
    return !filtro || String(texto == null ? '' : texto).toLowerCase().indexOf(filtro) !== -1;
  }

  // Igual que el contrato: cada cobro aprobado y no devuelto concede 30 días.
  // Los días se apilan desde el vencimiento anterior o desde la fecha del cobro,
  // lo que ocurra más tarde.
  function pagosDe(uid){
    uid = normalizarUid(uid);
    return datos.pagos.filter(function(p){ return normalizarUid(p.userId) === uid; });
  }

  function suscripcionesDe(uid){
    uid = normalizarUid(uid);
    return datos.suscripciones.filter(function(s){ return normalizarUid(s.userId) === uid; });
  }

  function diasDesdePagos(pagos){
    var DAY = 86400000;
    var expiry = pagos
      .filter(function(p){ return p.status === 'approved' && !p.refunded; })
      .map(function(p){ return new Date(p.date); })
      .filter(function(d){ return !isNaN(d.getTime()); })
      .sort(function(a,b){ return a - b; })
      .reduce(function(exp, at){
        return Math.max(exp, at.getTime()) + 30 * DAY;
      }, 0);
    return Math.max(0, Math.ceil((expiry - Date.now()) / DAY));
  }

  function ultimoPago(pagos){
    return pagos
      .filter(function(p){ return p.status === 'approved' && !p.refunded; })
      .sort(function(a,b){ return new Date(b.date) - new Date(a.date); })[0] || null;
  }

  function suscripcionActual(suscripciones){
    return suscripciones.filter(function(s){ return s.status !== 'cancelled'; })[0] || null;
  }

  function estadoMiembro(m){
    var pagos = pagosDe(m.uid);
    var subs = suscripcionesDe(m.uid);
    var sub = suscripcionActual(subs);
    var dias = diasDesdePagos(pagos);
    var ultimo = ultimoPago(pagos);
    var label = 'Sin días';
    var clase = 'cuota-mal';
    var detalle = 'Sin pagos aprobados';

    if (sub && sub.health === 'failing') {
      label = 'Cobro fallido';
      clase = 'cuota-mal';
      detalle = 'Suscripción requiere atención';
    } else if (sub && sub.health === 'retrying') {
      label = 'Reintentando';
      clase = 'cuota-aviso';
      detalle = 'Mercado Pago sigue intentando cobrar';
    } else if (dias > 0) {
      label = dias < 15 ? 'Por renovar' : 'Al día';
      clase = dias < 15 ? 'cuota-aviso' : 'cuota-ok';
      detalle = dias + ' día' + (dias === 1 ? '' : 's') + ' restante' + (dias === 1 ? '' : 's');
    } else if (sub) {
      label = 'Suscripción pendiente';
      clase = 'cuota-aviso';
      detalle = 'Aún sin cobro aprobado';
    }

    return {
      miembro: m,
      pagos: pagos,
      suscripciones: subs,
      suscripcion: sub,
      dias: dias,
      ultimoPago: ultimo,
      label: label,
      clase: clase,
      detalle: detalle
    };
  }

  function estadosMiembros(){
    return datos.miembros.map(estadoMiembro);
  }

  function tablaEstados(){
    var filas = estadosMiembros().filter(function(e){
      var m = e.miembro;
      return coincide(m.nombre) || coincide(m.email) || coincide(m.comision) ||
        coincide(m.uid) || coincide(e.label) || coincide(e.detalle) ||
        coincide(e.suscripcion && e.suscripcion.health);
    });
    if (!filas.length) return '<p class="coord-aviso">Sin miembros que mostrar.</p>';
    return '<table class="coord-tabla"><thead><tr>' +
      '<th>Miembro</th><th>Comisión</th><th>Estado</th><th>Días</th>' +
      '<th>Suscripción</th><th>Último pago</th><th>Cobros</th></tr></thead><tbody>' +
      filas.map(function(e){
        var m = e.miembro;
        var sub = e.suscripcion;
        var salud = sub ? (SALUD[sub.health] || ['Pendiente', 'cuota-aviso']) : ['Sin suscripción', ''];
        return '<tr>' +
          '<td>' + esc(m.nombre || '—') + '<br><span class="coord-sub">' +
            esc(m.email || m.uid) + '</span></td>' +
          '<td>' + esc(m.comision || '—') + '</td>' +
          '<td><b class="' + e.clase + '">' + esc(e.label) + '</b><br>' +
            '<span class="coord-sub">' + esc(e.detalle) + '</span></td>' +
          '<td>' + e.dias + '</td>' +
          '<td class="' + salud[1] + '">' + esc(salud[0]) +
            (sub && sub.nextPaymentDate ? '<br><span class="coord-sub">Próximo: ' +
              esc(fecha(sub.nextPaymentDate)) + '</span>' : '') + '</td>' +
          '<td>' + (e.ultimoPago ? fecha(e.ultimoPago.date) + '<br><span class="coord-sub">' +
            monto(e.ultimoPago.amount) + (e.ultimoPago.recurring ? ' · Suscripción' : ' · Pago único') +
            '</span>' : '—') + '</td>' +
          '<td>' + e.pagos.length + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function tablaSuscripciones(aplicarFiltro){
    var filas = datos.suscripciones.filter(function(s){
      return aplicarFiltro === false ||
        coincide(s.userId) || coincide(s.status) || coincide(s.health);
    });
    if (!filas.length) return '<p class="coord-aviso">Sin suscripciones que mostrar.</p>';
    return '<table class="coord-tabla"><thead><tr>' +
      '<th>Miembro</th><th>Estado</th><th>Cobro</th><th>Monto</th>' +
      '<th>Días</th><th>Próximo</th></tr></thead><tbody>' +
      filas.map(function(s){
        var salud = SALUD[s.health] || ['—', ''];
        return '<tr>' +
          '<td>' + nombreMiembro(s.userId) + '</td>' +
          '<td>' + esc(s.status) + '</td>' +
          '<td class="' + salud[1] + '">' + esc(salud[0]) + '</td>' +
          '<td>' + monto(s.amount) + '</td>' +
          '<td>' + (s.daysLeft == null ? '—' : s.daysLeft) + '</td>' +
          '<td>' + fecha(s.nextPaymentDate) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function tablaPagos(aplicarFiltro){
    var filas = datos.pagos.filter(function(p){
      return aplicarFiltro === false || coincide(p.userId) || coincide(p.status);
    });
    if (!filas.length) return '<p class="coord-aviso">Sin cobros que mostrar.</p>';
    return '<table class="coord-tabla"><thead><tr>' +
      '<th>Fecha</th><th>Miembro</th><th>Monto</th><th>Estado</th><th>Origen</th>' +
      '</tr></thead><tbody>' +
      filas.map(function(p){
        return '<tr class="' + (p.refunded ? 'coord-usado' : '') + '">' +
          '<td>' + fecha(p.date) + '</td>' +
          '<td>' + nombreMiembro(p.userId) + '</td>' +
          '<td>' + monto(p.amount) + '</td>' +
          '<td>' + esc(p.refunded ? 'Devuelto' : p.status) + '</td>' +
          '<td>' + (p.recurring ? 'Suscripción' : 'Pago único') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function htmlLogCompleto(){
    return '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Log completo de cuotas · Xuexi Club UC</title>' +
      '<style>' +
      'body{margin:0;padding:28px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#140d0d;color:#f6eee4}' +
      'h1{font-family:Georgia,serif;font-weight:400;margin:0 0 6px}h2{font-family:Georgia,serif;font-weight:400;margin:28px 0 10px}' +
      'p{color:#cdbfb5}table{width:100%;border-collapse:collapse;font-size:13px;background:#1e1414}' +
      'th{text-align:left;color:#d4af61;text-transform:uppercase;font-size:11px;letter-spacing:.08em;border-bottom:1px solid #5a3832;padding:8px}' +
      'td{border-bottom:1px solid #34201d;padding:8px;color:#e8dcd0;vertical-align:top}code{color:#f2d37b}.coord-usado td{opacity:.55}' +
      '.cuota-ok{color:#a3e4d7}.cuota-aviso{color:#d4af61}.cuota-mal{color:#f5b7b1}' +
      '</style></head><body>' +
      '<h1>Log completo de cuotas</h1>' +
      '<p>' + datos.suscripciones.length + ' suscripciones · ' + datos.pagos.length +
        ' cobros · generado ' + esc(new Date().toLocaleString('es-CL')) + '</p>' +
      '<h2>Suscripciones</h2>' + tablaSuscripciones(false) +
      '<h2>Cobros</h2>' + tablaPagos(false) +
      '</body></html>';
  }

  function prepararLogUrl(){
    if (logUrl) URL.revokeObjectURL(logUrl);
    logUrl = URL.createObjectURL(new Blob([htmlLogCompleto()], {type:'text/html'}));
    return logUrl;
  }

  // Dos suscripciones vivas para un mismo miembro significan dos cobros al mes.
  // Pasa si alguien alcanza a apretar el botón dos veces, así que conviene que
  // salte a la vista.
  function duplicadas(){
    var porMiembro = {};
    datos.suscripciones.forEach(function(s){
      if (s.status === 'cancelled') return;
      var uid = normalizarUid(s.userId);
      (porMiembro[uid] = porMiembro[uid] || []).push(s.id);
    });
    var malas = Object.keys(porMiembro).filter(function(u){ return porMiembro[u].length > 1; });
    if (!malas.length) return '';
    return '<p class="coord-aviso coord-error">Atención: ' + malas.length +
      ' miembro(s) con más de una suscripción activa — ' +
      malas.map(function(u){ return esc(u); }).join(', ') + '</p>';
  }

  function dibujar(){
    var caja = document.getElementById('cuotas-panel');
    if (!caja) return;
    var estados = estadosMiembros();
    var alDia = estados.filter(function(e){ return e.dias > 0 && e.clase === 'cuota-ok'; }).length;
    var porRenovar = estados.filter(function(e){ return e.dias > 0 && e.clase === 'cuota-aviso'; }).length;
    var conProblema = estados.filter(function(e){ return e.clase === 'cuota-mal' || e.label === 'Cobro fallido'; }).length;
    caja.innerHTML =
      duplicadas() +
      '<p class="coord-aviso">' + datos.miembros.length + ' miembros · ' +
        alDia + ' al día · ' + porRenovar + ' por renovar/reintento · ' +
        conProblema + ' sin días o con problema · ' + datos.suscripciones.length +
        ' suscripciones · ' + datos.pagos.length + ' cobros (últimos 12 meses)</p>' +
      '<input id="cuotas-filtro" class="coord-input" placeholder="Filtrar por miembro o estado…" value="' + esc(filtro) + '">' +
      '<h3>Estado por miembro</h3>' + tablaEstados() +
      '<div class="coord-fila cuotas-raw-toggle">' +
        '<a class="coord-btn-mini" id="cuotas-abrir-raw" href="' + esc(prepararLogUrl()) + '" target="_blank" rel="noopener">' +
          'Abrir log completo en pestaña nueva</a>' +
        '<span class="coord-sub">Datos crudos del worker: suscripciones y cobros, sin filtrar.</span>' +
      '</div>';

    var input = document.getElementById('cuotas-filtro');
    input.addEventListener('input', function(){
      filtro = input.value.trim().toLowerCase();
      dibujar();
      var otro = document.getElementById('cuotas-filtro');
      otro.focus();
      otro.setSelectionRange(otro.value.length, otro.value.length);
    });

  }

  function recargar(){
    var caja = document.getElementById('cuotas-panel');
    if (!caja) return;
    aviso(caja, 'Cargando cuotas…');
    cargarTodo().then(dibujar).catch(function(e){
      aviso(caja, 'No se pudieron leer las cuotas: ' + e.message, true);
    });
  }

  // Mismo trato que XuexiCoordinacion: miembro.html llama a iniciar() desde su
  // callback de onAuth. Si quien entra no es coordinación no se dibuja nada —
  // y si alguien llamara esto a mano, el worker responde 403 igual.
  window.XuexiCuotas = {
    iniciar: function(user){
      if (!user || user.rol !== 'admin') return;
      if (typeof firebase === 'undefined' || !firebase.apps.length) return;
      var host = document.getElementById('cuotas-admin');
      if (host) host.hidden = false;
      var btn = document.getElementById('cuotas-recargar');
      if (btn && !btn.dataset.cuotasListo) {
        btn.dataset.cuotasListo = '1';
        btn.addEventListener('click', recargar);
      }
      recargar();
    },
    recargar: recargar
  };
})();

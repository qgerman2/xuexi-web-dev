/* Panel de coordinación · Xuexi Club UC
 *
 * Se dibuja dentro de miembro.html y solo para quien tenga rol 'admin'.
 *
 * Ojo: ocultar esta sección NO es la seguridad. Cualquiera puede leer este
 * archivo y llamar a las mismas funciones desde la consola del navegador. Lo
 * que realmente impide que alguien sin permiso cree códigos o cambie cuotas
 * son las reglas de Firestore (ver firestore.rules), que se aplican en el
 * servidor. Esto es solo la interfaz.
 */
(function(){
  'use strict';

  var db = null;
  var usuario = null;

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }

  function aviso(caja, texto, error){
    caja.innerHTML = '<p class="coord-aviso' + (error ? ' coord-error' : '') + '">' +
      esc(texto) + '</p>';
  }

  // ───────────────────── Códigos de invitación ─────────────────────

  // Sin ambigüedades: fuera 0/O y 1/I para que nadie se equivoque al copiarlo.
  function generarCodigo(){
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var s = '';
    var vals = new Uint32Array(8);
    crypto.getRandomValues(vals);
    for (var i = 0; i < 8; i++) s += abc[vals[i] % abc.length];
    return 'XX-' + s.slice(0,4) + '-' + s.slice(4);
  }

  function listarCodigos(){
    var caja = document.getElementById('coord-codigos-lista');
    aviso(caja, 'Cargando…');
    db.collection('codigos_invitacion').get().then(function(snap){
      if (snap.empty){ aviso(caja, 'Todavía no hay códigos creados.'); return; }
      var filas = [];
      snap.forEach(function(doc){
        var d = doc.data();
        filas.push({ codigo: doc.id, usado: !!d.usado, nota: d.nota || '', usadoPor: d.usadoPor || '' });
      });
      filas.sort(function(a,b){ return (a.usado === b.usado) ? 0 : (a.usado ? 1 : -1); });
      caja.innerHTML = '<table class="coord-tabla"><thead><tr>' +
        '<th>Código</th><th>Estado</th><th>Para</th><th></th></tr></thead><tbody>' +
        filas.map(function(f){
          return '<tr class="' + (f.usado ? 'coord-usado' : '') + '">' +
            '<td><code>' + esc(f.codigo) + '</code></td>' +
            '<td>' + (f.usado ? 'Usado' : 'Disponible') + '</td>' +
            '<td>' + esc(f.nota || '—') + '</td>' +
            '<td>' + (f.usado ? '' :
              '<button class="coord-btn-mini" data-borrar="' + esc(f.codigo) + '">Anular</button>') +
            '</td></tr>';
        }).join('') + '</tbody></table>';

      [].forEach.call(caja.querySelectorAll('[data-borrar]'), function(b){
        b.addEventListener('click', function(){
          var cod = b.getAttribute('data-borrar');
          if (!confirm('¿Anular el código ' + cod + '? Dejará de servir para registrarse.')) return;
          db.collection('codigos_invitacion').doc(cod).delete()
            .then(listarCodigos)
            .catch(function(e){ alert('No se pudo anular: ' + e.message); });
        });
      });
    }).catch(function(e){
      aviso(caja, 'No se pudieron leer los códigos: ' + e.message, true);
    });
  }

  // ── Creación masiva: un código por persona ──
  // Acepta una lista pegada desde una planilla o escrita a mano. De cada línea
  // toma lo que parezca correo y el resto como nombre.
  function parsearLinea(linea){
    var partes = linea.split(/[\t,;]+/).map(function(s){ return s.trim(); }).filter(Boolean);
    var correo = '', nombre = [];
    partes.forEach(function(p){
      if (!correo && p.indexOf('@') !== -1) correo = p; else nombre.push(p);
    });
    return { nombre: nombre.join(' ').trim(), correo: correo };
  }

  function crearLote(){
    var caja = document.getElementById('coord-lote-resultado');
    var texto = document.getElementById('coord-lote-lista').value;
    // Las líneas que empiezan con # son títulos de sección, no personas.
    var lineas = texto.split('\n')
      .map(function(l){ return l.trim(); })
      .filter(function(l){ return l && l.charAt(0) !== '#'; });

    if (!lineas.length){
      caja.innerHTML = '<p class="coord-aviso coord-error">Pega al menos una línea con un nombre.</p>';
      return;
    }
    if (lineas.length > 200){
      caja.innerHTML = '<p class="coord-aviso coord-error">Son demasiadas de una vez. Hazlo en tandas de 200.</p>';
      return;
    }
    if (!confirm('Se crearán ' + lineas.length + ' códigos, uno por línea. ¿Continuar?')) return;

    caja.innerHTML = 'Creando ' + lineas.length + ' códigos…';
    var personas = lineas.map(parsearLinea);
    var lote = db.batch();

    personas.forEach(function(p){
      p.codigo = generarCodigo();
      lote.set(db.collection('codigos_invitacion').doc(p.codigo), {
        usado: false,
        nota: p.nombre + (p.correo ? ' · ' + p.correo : ''),
        creadoPor: usuario.uid,
        fechaCreacion: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    lote.commit().then(function(){
      // Separado por tabulaciones: al pegarlo en Google Sheets cae en columnas.
      var tsv = 'Nombre\tCorreo\tCodigo\n' + personas.map(function(p){
        return p.nombre + '\t' + p.correo + '\t' + p.codigo;
      }).join('\n');

      caja.innerHTML = '<p class="coord-ok">Listos los ' + personas.length + ' códigos.</p>' +
        '<button class="coord-btn-mini" id="coord-copiar-tsv">Copiar para pegar en la planilla</button>' +
        '<span class="coord-sub" id="coord-copiado"></span>' +
        '<table class="coord-tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Código</th></tr></thead><tbody>' +
        personas.map(function(p){
          return '<tr><td>' + esc(p.nombre) + '</td><td>' + esc(p.correo || '—') + '</td>' +
                 '<td><code>' + esc(p.codigo) + '</code></td></tr>';
        }).join('') + '</tbody></table>';

      document.getElementById('coord-copiar-tsv').addEventListener('click', function(){
        navigator.clipboard.writeText(tsv).then(function(){
          document.getElementById('coord-copiado').textContent = ' ✓ Copiado';
        }).catch(function(){
          document.getElementById('coord-copiado').textContent = ' No se pudo copiar; selecciona la tabla a mano.';
        });
      });

      document.getElementById('coord-lote-lista').value = '';
      listarCodigos();
    }).catch(function(e){
      caja.innerHTML = '<p class="coord-aviso coord-error">No se pudieron crear: ' + esc(e.message) + '</p>';
    });
  }

  function crearCodigo(){
    var nota = document.getElementById('coord-codigo-nota').value.trim();
    var codigo = generarCodigo();
    var caja = document.getElementById('coord-codigo-nuevo');
    caja.innerHTML = 'Creando…';
    db.collection('codigos_invitacion').doc(codigo).set({
      usado: false,
      nota: nota,
      creadoPor: usuario.uid,
      fechaCreacion: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function(){
      caja.innerHTML = '<p class="coord-ok">Código creado: <code>' + esc(codigo) + '</code><br>' +
        '<span>Cópialo y entrégalo a la persona. Sirve una sola vez.</span></p>';
      document.getElementById('coord-codigo-nota').value = '';
      listarCodigos();
    }).catch(function(e){
      caja.innerHTML = '<p class="coord-aviso coord-error">No se pudo crear: ' + esc(e.message) + '</p>';
    });
  }

  // ───────────────────── Calendario interno ─────────────────────

  // No repetimos aquí el listado del calendario: ya está arriba, con mejor
  // diseño. En vez de duplicarlo, agregamos un botón de eliminar sobre esas
  // mismas tarjetas cuando quien mira es de la coordinación.
  function ponerBotonesEnTarjetas(){
    var tarjetas = document.querySelectorAll('.timeline-card[data-id]');
    [].forEach.call(tarjetas, function(card){
      if (card.querySelector('.coord-eliminar')) return;
      var pie = card.querySelector('.timeline-footer');
      if (!pie) return;
      var b = document.createElement('button');
      b.className = 'coord-btn-mini coord-eliminar';
      b.textContent = 'Eliminar';
      b.addEventListener('click', function(){
        var id = card.getAttribute('data-id');
        if (!confirm('¿Eliminar "' + card.getAttribute('data-titulo') + '" del calendario interno?')) return;
        db.collection('calendario_interno').doc(id).delete()
          .then(function(){ if (window.recargarCalendarioInterno) window.recargarCalendarioInterno(); })
          .catch(function(e){ alert('No se pudo eliminar: ' + e.message); });
      });
      pie.appendChild(b);
    });
  }

  function listarCalendario(){
    // El calendario lo dibuja miembro.html; aquí solo añadimos los controles.
    ponerBotonesEnTarjetas();
  }

  function agregarEvento(){
    var t = document.getElementById('coord-cal-titulo').value.trim();
    var f = document.getElementById('coord-cal-fecha').value;
    var h = document.getElementById('coord-cal-hora').value.trim();
    var l = document.getElementById('coord-cal-lugar').value.trim();
    var tp = document.getElementById('coord-cal-tipo').value;
    var d = document.getElementById('coord-cal-detalle').value.trim();
    var caja = document.getElementById('coord-cal-resultado');

    if (!t || !f){
      caja.innerHTML = '<p class="coord-aviso coord-error">El título y la fecha son obligatorios.</p>';
      return;
    }
    caja.innerHTML = 'Guardando…';
    db.collection('calendario_interno').add({
      titulo: t, fecha: f, hora: h, lugar: l, tipo: tp, detalle: d,
      creadoPor: usuario.uid
    }).then(function(){
      caja.innerHTML = '<p class="coord-ok">Actividad agregada. Aparece en el calendario de arriba.</p>';
      ['titulo','fecha','hora','lugar','detalle'].forEach(function(c){
        document.getElementById('coord-cal-' + c).value = '';
      });
      if (window.recargarCalendarioInterno) window.recargarCalendarioInterno();
    }).catch(function(e){
      caja.innerHTML = '<p class="coord-aviso coord-error">No se pudo guardar: ' + esc(e.message) + '</p>';
    });
  }

  // Plan de la Comisión Wailian 2026, tomado del "Organizador de Contenido
  // Mensual" (agosto a diciembre de 2026).
  //
  // El PDF traía además dos hojas de agosto y septiembre del AÑO PASADO: sus
  // rejillas cuadran con 2025, no con 2026. Están descartadas a propósito.
  //
  // Ninguna actividad se importa como confirmada: el organizador es una
  // planificación interna, no una agenda cerrada. La coordinación confirma
  // cada una cuando corresponda.
  //
  // AVISO SOBRE NOVIEMBRE: en el PDF la rejilla de noviembre está corrida un
  // día (dibuja el 1 en sábado, que es 2025; en 2026 cae domingo). Mandan los
  // números escritos en cada casilla, que son los que se usan aquí.
  //
  //   [ título, fecha ISO o '', fecha de término o '', texto de la fecha,
  //     tipo, detalle, a cargo, con ]
  var PLAN_ORGANIZADOR = [
    // ───────────────────────────── Agosto ─────────────────────────────
    ['Taller Introducción al idioma chino I','2026-08-25','','25 de agosto','capacitacion','Clase básica de saludos y palabras simples.','Karen y Carolina',''],
    ['Compra: potes, pliegos kraft y papel de caligrafía','2026-08-29','','29 de agosto','gestion','Materiales para el taller de caligrafía.','',''],

    // ─────────────────────────── Septiembre ───────────────────────────
    ['Contacto con el Instituto Confucio: charla "cómo hacer negocios en China"','2026-09-01','2026-09-03','1 al 3 de septiembre','gestion','Gestionar la charla con el Instituto Confucio.','Catalina','Instituto Confucio UC'],
    ['Entrega de galletas, jugos y servilletas para la charla de Douyin','2026-09-01','2026-09-05','Primera semana de septiembre','gestion','Incluye conseguir un voluntario con computador.','',''],
    ['Taller de caligrafía','2026-09-04','','4 de septiembre','capacitacion','Arte de la escritura china con pincel y tinta.','Sofía','Comisión Xinxi'],
    ['Reunión Wailian','2026-09-05','','5 de septiembre','interna','','',''],
    ['Charla de Douyin Make up','2026-09-07','','7 de septiembre','social','Técnicas de maquillaje popularizadas en Douyin.','Martina',''],
    ['Compra: kraft, tinta roja, potes, pinceles, toallitas húmedas y galletas','2026-09-14','2026-09-18','Semana del 14 al 18 de septiembre','gestion','Materiales para el taller de arte chino.','',''],
    ['Taller Introducción al idioma chino II','2026-09-18','','18 de septiembre','capacitacion','','',''],
    ['Pedir sala para el Taller de Arte Chino','2026-09-21','','21 de septiembre','gestion','','Sofía','Comisión Xinxi'],
    ['Ciclo de Cine Chino · U. de Concepción','2026-09-21','2026-09-25','Semana del 21 al 25 de septiembre','social','','Nadja','Club de Cine UdeC'],
    ['Ciclo de Cine Chino · U. de Chile','2026-09-28','2026-09-30','28 al 30 de septiembre','social','','','U. de Chile'],

    // ───────────────────────────── Octubre ────────────────────────────
    ['Teatro de sombras','2026-10-02','','2 de octubre','social','','Sofía',''],
    ['Charla: ¿Cómo es estudiar en China?','2026-10-05','2026-10-09','Semana del 5 al 9 de octubre','interna','En el organizador aparece marcada como CONFIRMAR.','Catalina','Instituto Confucio UC'],
    ['Demostración Danza del León','2026-10-13','2026-10-15','13 al 15 de octubre','social','','Javier',''],
    ['Ciclo de Cine Chino · CEAE','2026-10-21','','21 de octubre','social','','Cata','Centro UC de Estudios Asiáticos'],

    // ──────────────────────────── Noviembre ───────────────────────────
    ['Charla con la empresa Fiberhome','2026-11-05','','5 de noviembre','interna','','','Fiberhome'],
    ['Taller de cocina','2026-11-07','','7 de noviembre','social','','',''],
    ['Actividad con las maestras del templo','2026-11-13','','13 de noviembre','social','','','Templo Fo Guang Shan'],
    ['Medicina china con Junzi','2026-11-19','','19 de noviembre','interna','','','Junzi'],
    ['Taller de Taichi','2026-11-20','','20 de noviembre','social','','',''],
    ['Sesión de Cineclub (Shanghái)','2026-11-20','','20 de noviembre','social','','',''],
    ['Taller de acupuntura','2026-11-25','','25 de noviembre','social','En el organizador la etiqueta queda entre el 25 y el 26: hay que fijar el día.','',''],
    ['Sesión de Cineclub (Wuxi)','','','Noviembre · sin día definido','social','Aparece en el listado de actividades del mes, fuera de la rejilla.','',''],
    ['Charla de Shaanxi, Xi\'an o Zhejiang','','','Noviembre · sin día definido','interna','Aparece en el listado de actividades del mes, fuera de la rejilla. Falta elegir la provincia.','',''],

    // ──────────────────────────── Diciembre ───────────────────────────
    ['Visita Xuexi al templo','','','Diciembre · sin día definido','social','','','Templo Fo Guang Shan']
  ];

  function idImportado(i){
    return 'organizador-2026-' + String(i).padStart(2, '0');
  }

  // Firestore acepta como máximo 500 operaciones por lote.
  var TOPE_LOTE = 400;

  // Aplica una lista de operaciones en tandas, una tras otra. Devolver la
  // promesa encadenada (y no lanzarlas todas a la vez) mantiene el orden:
  // primero se vacía la colección, después se escribe el plan nuevo.
  function enTandas(ops){
    var tandas = [];
    for (var i = 0; i < ops.length; i += TOPE_LOTE) tandas.push(ops.slice(i, i + TOPE_LOTE));
    return tandas.reduce(function(cadena, tanda){
      return cadena.then(function(){
        var lote = db.batch();
        tanda.forEach(function(op){ op(lote); });
        return lote.commit();
      });
    }, Promise.resolve());
  }

  // Deja el calendario interno EXACTAMENTE como el Organizador Mensual:
  // primero borra todo lo que hay, después escribe el plan. Es destructivo a
  // propósito — se pidió partir de cero porque arrastrar importaciones viejas
  // junto a las nuevas estaba confundiendo a la coordinación.
  function importarPlan(){
    var caja = document.getElementById('coord-import-resultado');
    if (!confirm('Se BORRARÁ todo el calendario interno actual y quedarán solo las ' +
        PLAN_ORGANIZADOR.length + ' actividades del Organizador Mensual ' +
        '(agosto a diciembre de 2026).\n\n' +
        'Esto incluye las actividades agregadas a mano: también se borran. ' +
        'No se puede deshacer. ¿Continuar?')) return;
    caja.innerHTML = 'Vaciando el calendario…';

    db.collection('calendario_interno').get().then(function(snap){
      var borrados = snap.size;
      var ops = [];
      snap.forEach(function(doc){
        ops.push(function(lote){ lote.delete(doc.ref); });
      });

      PLAN_ORGANIZADOR.forEach(function(a, i){
        var ref = db.collection('calendario_interno').doc(idImportado(i + 1));
        ops.push(function(lote){
          lote.set(ref, {
            titulo: a[0],
            fecha: a[1],          // vacía si el organizador no da un día concreto
            fechaFin: a[2],       // solo en las actividades que ocupan varios días
            fechaTexto: a[3],     // lo que dice el organizador, tal cual
            confirmada: false,    // es una planificación, no una agenda cerrada
            hora: '',
            lugar: '',
            tipo: a[4],
            detalle: a[5],
            responsable: a[6],
            colaborador: a[7],
            comision: 'wailian',
            origen: 'organizador-mensual-2026',
            creadoPor: usuario.uid
          });
        });
      });

      caja.innerHTML = 'Escribiendo ' + PLAN_ORGANIZADOR.length + ' actividades…';
      return enTandas(ops).then(function(){ return borrados; });
    }).then(function(borrados){
      caja.innerHTML = '<p class="coord-ok">Calendario reiniciado: se borraron ' + borrados +
        ' actividades y quedaron las ' + PLAN_ORGANIZADOR.length + ' del organizador. ' +
        'Puedes volver a pulsarlo cuando cambie el organizador.</p>';
      if (window.recargarCalendarioInterno) window.recargarCalendarioInterno();
    }).catch(function(e){
      caja.innerHTML = '<p class="coord-aviso coord-error">No se pudo importar: ' + esc(e.message) + '</p>';
    });
  }

  // ─────────────────────────── Miembros ───────────────────────────

  // Guardamos el último listado leído para poder exportarlo y para marcar
  // cuotas en lote sin volver a consultar.
  var miembrosCache = [];

  function exportarMiembros(){
    if (!miembrosCache.length){ alert('Todavía no se ha cargado el listado.'); return; }
    var tsv = 'Nombre\tCorreo\tComision\tRol\tCuota\n' + miembrosCache.map(function(m){
      return [m.nombre, m.email, m.comision, m.rol,
              m.pago === 'al_dia' ? 'Al día' : 'Pendiente'].join('\t');
    }).join('\n');
    var av = document.getElementById('coord-miembros-aviso');
    navigator.clipboard.writeText(tsv).then(function(){
      av.textContent = ' ✓ Copiado: ' + miembrosCache.length + ' miembros. Pégalo en una planilla.';
    }).catch(function(){
      av.textContent = ' No se pudo copiar. Selecciona la tabla a mano.';
    });
  }

  // Marcar cuotas en lote. Pensado para el cierre de mes: se pega la lista de
  // quienes pagaron y el resto queda pendiente, en vez de ir uno por uno.
  function marcarCuotasEnLote(){
    var caja = document.getElementById('coord-cuotas-resultado');
    var texto = document.getElementById('coord-cuotas-lista').value;

    // De cada línea tomamos lo que parezca un correo.
    var correos = [];
    texto.split(/[\n,;\t ]+/).forEach(function(p){
      p = p.trim().toLowerCase();
      if (p.indexOf('@') !== -1) correos.push(p);
    });
    if (!correos.length){
      caja.innerHTML = '<p class="coord-aviso coord-error">No encontré ningún correo en lo que pegaste.</p>';
      return;
    }

    var alDia = [], pendientes = [], noEncontrados = correos.slice();
    miembrosCache.forEach(function(m){
      var e = (m.email || '').toLowerCase();
      var i = noEncontrados.indexOf(e);
      if (i !== -1){ noEncontrados.splice(i, 1); alDia.push(m); }
      else pendientes.push(m);
    });

    var marcarPend = document.getElementById('coord-cuotas-resto').checked;
    var resumen = 'Se marcarán ' + alDia.length + ' como AL DÍA' +
      (marcarPend ? ' y ' + pendientes.length + ' como PENDIENTE' : '') + '. ¿Continuar?';
    if (!confirm(resumen)) return;

    caja.innerHTML = 'Actualizando…';
    var lote = db.batch();
    var sello = firebase.firestore.FieldValue.serverTimestamp();
    alDia.forEach(function(m){
      lote.update(db.collection('miembros').doc(m.uid), {estadoPago:'al_dia', ultimoCambioPago:sello,
        pagoDeclarado: firebase.firestore.FieldValue.delete()});
    });
    if (marcarPend) pendientes.forEach(function(m){
      lote.update(db.collection('miembros').doc(m.uid), {estadoPago:'pendiente', ultimoCambioPago:sello});
    });

    lote.commit().then(function(){
      caja.innerHTML = '<p class="coord-ok">Listo: ' + alDia.length + ' al día' +
        (marcarPend ? ', ' + pendientes.length + ' pendientes' : '') + '.</p>' +
        (noEncontrados.length
          ? '<p class="coord-aviso">Estos correos no corresponden a ninguna cuenta creada, así que ' +
            'no se pudo marcarlos (probablemente aún no se registran): <br><span class="coord-sub">' +
            esc(noEncontrados.join(', ')) + '</span></p>'
          : '');
      document.getElementById('coord-cuotas-lista').value = '';
      listarMiembros();
    }).catch(function(e){
      caja.innerHTML = '<p class="coord-aviso coord-error">No se pudo actualizar: ' + esc(e.message) + '</p>';
    });
  }

  function listarMiembros(){
    var caja = document.getElementById('coord-miembros-lista');
    aviso(caja, 'Cargando…');
    db.collection('miembros').get().then(function(snap){
      if (snap.empty){ aviso(caja, 'Todavía no hay miembros registrados.'); return; }
      var filas = [];
      snap.forEach(function(doc){
        var d = doc.data();
        filas.push({ uid: doc.id, nombre: d.nombre || '', email: d.email || '',
                     comision: d.comision || '', rol: d.rol || 'miembro',
                     pago: d.estadoPago || 'pendiente',
                     declarado: d.pagoDeclarado || null });
      });
      // Quienes avisaron que pagaron van primero: son los que esperan respuesta.
      filas.sort(function(a,b){
        var da = a.declarado && a.pago !== 'al_dia' ? 0 : 1;
        var dbb = b.declarado && b.pago !== 'al_dia' ? 0 : 1;
        if (da !== dbb) return da - dbb;
        return a.nombre.localeCompare(b.nombre);
      });
      miembrosCache = filas;
      var res = document.getElementById('coord-miembros-resumen');
      if (res){
        var n = filas.filter(function(f){ return f.pago === 'al_dia'; }).length;
        var av = filas.filter(function(f){ return f.declarado && f.pago !== 'al_dia'; }).length;
        res.textContent = filas.length + ' con cuenta · ' + n + ' al día · ' + (filas.length - n) + ' pendientes' +
          (av ? ' · ' + av + ' esperando confirmación' : '');
      }
      caja.innerHTML = '<table class="coord-tabla"><thead><tr>' +
        '<th>Nombre</th><th>Comisión</th><th>Rol</th><th>Cuota</th><th></th></tr></thead><tbody>' +
        filas.map(function(f){
          var alDia = f.pago === 'al_dia';
          return '<tr><td>' + esc(f.nombre) + '<br><span class="coord-sub">' + esc(f.email) + '</span></td>' +
            '<td>' + esc(f.comision || '—') + '</td>' +
            '<td>' + esc(f.rol) + '</td>' +
            '<td>' + (alDia ? 'Al día' : 'Pendiente') +
              (f.declarado && !alDia
                ? '<br><span class="coord-declarado">Avisó que pagó el ' + esc(f.declarado.fecha) + '</span>'
                : '') + '</td>' +
            '<td><button class="coord-btn-mini' + (f.declarado && !alDia ? ' coord-confirmar' : '') +
              '" data-pago="' + esc(f.uid) + '" data-estado="' + (alDia ? 'pendiente' : 'al_dia') + '">' +
              (alDia ? 'Marcar pendiente' : (f.declarado ? 'Confirmar pago' : 'Marcar al día')) +
              '</button></td></tr>';
        }).join('') + '</tbody></table>';

      [].forEach.call(caja.querySelectorAll('[data-pago]'), function(b){
        b.addEventListener('click', function(){
          var uid = b.getAttribute('data-pago');
          var estado = b.getAttribute('data-estado');
          var cambio = {
            estadoPago: estado,
            ultimoCambioPago: firebase.firestore.FieldValue.serverTimestamp()
          };
          // Confirmado el pago, el aviso ya cumplió su función.
          if (estado === 'al_dia') cambio.pagoDeclarado = firebase.firestore.FieldValue.delete();
          db.collection('miembros').doc(uid).update(cambio).then(listarMiembros)
            .catch(function(e){ alert('No se pudo actualizar: ' + e.message); });
        });
      });
    }).catch(function(e){
      aviso(caja, 'No se pudo leer el listado: ' + e.message, true);
    });
  }

  // ──────────────────────────── Interfaz ────────────────────────────

  function pintarPanel(){
    var host = document.getElementById('coordinacion');
    if (!host) return;
    host.hidden = false;
    host.innerHTML =
      '<div class="wrap">' +
      '<div class="sec-h"><span class="zh">管理</span><h2>Coordinación</h2>' +
        '<span class="more">Solo para la coordinación</span></div>' +

      '<div class="coord-bloque">' +
        '<h3>Códigos de invitación</h3>' +
        '<p class="coord-desc">Cada código sirve para que una persona cree su cuenta, y solo una vez.</p>' +
        '<div class="coord-fila">' +
          '<input type="text" id="coord-codigo-nota" placeholder="¿Para quién es? (opcional)">' +
          '<button class="btn btn-sello" id="coord-crear-codigo">Crear código</button>' +
        '</div>' +
        '<div id="coord-codigo-nuevo"></div>' +

        '<div class="coord-import">' +
          '<h4 class="coord-sub-h">Crear varios de una vez</h4>' +
          '<p class="coord-desc">Una persona por línea: nombre y, si lo tienes, su correo. ' +
            'Puedes pegar directamente desde una planilla.</p>' +
          '<textarea id="coord-lote-lista" rows="6" ' +
            'placeholder="Andrea Díaz Inzunza, adi@uc.cl&#10;Catalina Leiva Gutiérrez, cleivg@uc.cl&#10;Nathaly Jeria Cabello"></textarea>' +
          '<button class="btn btn-sello" id="coord-crear-lote">Crear un código por persona</button>' +
          '<div id="coord-lote-resultado"></div>' +
        '</div>' +

        '<div id="coord-codigos-lista"></div>' +
      '</div>' +

      '<div class="coord-bloque">' +
        '<h3>Calendario interno</h3>' +
        '<p class="coord-desc">Solo lo ven miembros con sesión iniciada.</p>' +
        '<div class="coord-grid">' +
          '<input type="text" id="coord-cal-titulo" placeholder="Nombre de la actividad">' +
          '<input type="date" id="coord-cal-fecha">' +
          '<input type="text" id="coord-cal-hora" placeholder="Hora (ej. 18:30)">' +
          '<input type="text" id="coord-cal-lugar" placeholder="Lugar">' +
          '<select id="coord-cal-tipo">' +
            '<option value="interna">Reunión de coordinación</option>' +
            '<option value="capacitacion">Capacitación interna</option>' +
            '<option value="social">Actividad social / tándem</option>' +
            '<option value="gestion">Gestión o compra</option>' +
          '</select>' +
          '<textarea id="coord-cal-detalle" placeholder="Detalle (opcional)"></textarea>' +
        '</div>' +
        '<button class="btn btn-sello" id="coord-agregar-evento">Agregar actividad</button>' +
        '<div id="coord-cal-resultado"></div>' +
        '<div class="coord-import">' +
          '<button class="coord-btn-mini coord-btn-riesgo" id="coord-importar">Reiniciar calendario ' +
            'con el Organizador Mensual (' + PLAN_ORGANIZADOR.length + ')</button>' +
          '<p class="coord-sub">Borra TODO el calendario interno y lo deja solo con el ' +
            'organizador de agosto a diciembre de 2026, incluidas las actividades agregadas ' +
            'a mano. Ninguna queda confirmada, así que no pasan a la agenda pública.</p>' +
          '<div id="coord-import-resultado"></div>' +
        '</div>' +
      '</div>' +

        '<div class="coord-bloque">' +
        '<h3>Miembros</h3>' +
        '<p class="coord-desc">El estado de la cuota lo marca la coordinación: nadie puede marcarse solo. ' +
          '<span id="coord-miembros-resumen" class="coord-sub"></span></p>' +

        '<div class="coord-fila">' +
          '<button class="coord-btn-mini" id="coord-exportar">Copiar listado para planilla</button>' +
          '<span class="coord-sub" id="coord-miembros-aviso"></span>' +
        '</div>' +

        '<div class="coord-import">' +
          '<h4 class="coord-sub-h">Marcar cuotas del mes</h4>' +
          '<p class="coord-desc">Pega los correos de quienes pagaron. Sirve una lista, una columna ' +
            'copiada de la planilla o texto separado por comas.</p>' +
          '<textarea id="coord-cuotas-lista" rows="5" ' +
            'placeholder="adi@uc.cl&#10;clgarrido1@uc.cl&#10;durzs@uc.cl"></textarea>' +
          '<label class="coord-check"><input type="checkbox" id="coord-cuotas-resto" checked> ' +
            'Marcar como pendiente a quienes no estén en la lista</label>' +
          '<button class="btn btn-sello" id="coord-marcar-cuotas">Aplicar</button>' +
          '<div id="coord-cuotas-resultado"></div>' +
        '</div>' +

        '<div id="coord-miembros-lista"></div>' +
      '</div>' +

      '<div class="coord-bloque">' +
        '<h3>Fotografías y Galerías de Eventos</h3>' +
        '<p class="coord-desc">Sube y gestiona fotos oficiales directamente en la galería de cada actividad.</p>' +
        '<div class="coord-fila">' +
          '<select id="coord-foto-evento-select">' +
            '<option value="">Cargando actividades…</option>' +
          '</select>' +
          '<button class="btn btn-sello" id="coord-btn-ir-evento">Abrir galería para subir fotos →</button>' +
        '</div>' +
      '</div>' +
      '</div>';

    document.getElementById('coord-crear-codigo').addEventListener('click', crearCodigo);
    document.getElementById('coord-crear-lote').addEventListener('click', crearLote);
    document.getElementById('coord-exportar').addEventListener('click', exportarMiembros);
    document.getElementById('coord-marcar-cuotas').addEventListener('click', marcarCuotasEnLote);
    document.getElementById('coord-agregar-evento').addEventListener('click', agregarEvento);
    document.getElementById('coord-importar').addEventListener('click', importarPlan);

    // Cargar eventos para el selector de fotos
    var selEventos = document.getElementById('coord-foto-evento-select');
    var btnIrEvento = document.getElementById('coord-btn-ir-evento');

    fetch('data/eventos.json', {cache:'no-cache'})
      .then(function(r){ return r.ok ? r.json() : {eventos:[]}; })
      .then(function(d){
        var evs = d.eventos || [];
        selEventos.innerHTML = '<option value="">Selecciona una actividad…</option>' +
          evs.map(function(ev){
            return '<option value="' + esc(ev.id || encodeURIComponent(ev.titulo)) + '">' +
              esc(ev.fecha || 'Sin fecha') + ' · ' + esc(ev.titulo) +
            '</option>';
          }).join('');
      })
      .catch(function(){
        selEventos.innerHTML = '<option value="">No se pudieron cargar actividades</option>';
      });

    btnIrEvento.addEventListener('click', function(){
      var evId = selEventos.value;
      if (!evId){
        alert('Por favor selecciona una actividad de la lista.');
        return;
      }
      window.location.href = 'evento.html?id=' + encodeURIComponent(evId);
    });

    listarCodigos();
    listarCalendario();
    listarMiembros();
  }

  window.XuexiCoordinacion = {
    iniciar: function(user){
      if (!user || user.rol !== 'admin') return;
      if (typeof firebase === 'undefined' || !firebase.apps.length) return;
      usuario = user;
      db = firebase.firestore();
      pintarPanel();
    },
    // La llama el calendario de miembro.html cada vez que se redibuja, para
    // añadir los botones de eliminar. Si no hay sesión de coordinación, no hace
    // nada.
    decorarCalendario: function(){
      if (!db || !usuario) return;
      ponerBotonesEnTarjetas();
    }
  };
})();

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

  // Plan de la Comisión Wailian 2026, tal como está en la planilla del club.
  //
  // Ninguna actividad tiene fecha confirmada. Por eso 'fecha' queda VACÍA
  // cuando la planilla no da un día concreto: inventar una para poder ordenar
  // haría que se mostrara como si fuera real. El texto original va en
  // 'fechaTexto' y se muestra tal cual ("Octubre", "Sin fecha definida").
  //   [ título, fecha ISO o '', texto de la fecha, tipo, detalle, a cargo, con ]
  var PLAN_WAILIAN = [
    ['Charla: ¿Cómo hacer negocios con China?','','Octubre','interna','Charla con un experto en negocios con China.','Catalina Leiva','Instituto Confucio UC'],
    ['Ciclo de Cine Chino · Sesión 1','','Sin fecha definida','social','Ciclo interuniversitario, con el Club de Cine de la U. de Concepción.','Nadja Albarrán','Club de Cine UdeC'],
    ['Charla: ¿Cómo es estudiar en China?','','Octubre','interna','Experiencias de estudio en China (pregrado, magíster, doctorado), con y sin beca.','Catalina Leiva','Instituto Confucio UC'],
    ['Ceremonia del té','','Por consultar al templo','social','Visita al templo budista Fo Guang Shan para aprender las etapas de la ceremonia.','Caro Marín','Templo Fo Guang Shan'],
    ['Taller de Douyin Makeup','','Sin fecha definida','social','Técnicas de maquillaje popularizadas en Douyin.','Martina Soto','Interno'],
    ['Taller Introducción al idioma chino I','','Última semana de agosto, cualquier día salvo miércoles','capacitacion','Clase básica de saludos y palabras simples. Difusión vía Consejerías Académicas.','Martina Soto','Interno'],
    ['Taller Introducción al idioma chino II','2026-08-21','21 al 23 de agosto','capacitacion','Clase básica de saludos y palabras simples. Difusión vía Consejerías Académicas.','Karen Quijada','Interno'],
    ['Ciclo de Cine Chino · Sesión 2','','Sin fecha definida','social','Segunda sesión, con una agrupación de la Universidad de Chile.','Sofía Lizama','U. de Chile'],
    ['Taller de Wantanes fritos','','Cuarta semana de agosto, sujeto a disponibilidad del laboratorio','social','Taller para aprender a preparar wantanes fritos.','Benjamín Varas','Interno'],
    ['Taller de Taichi','','Por coordinar','social','Taichi y meditación como herramienta de concentración y bienestar.','Nathaly Jeria','Academia Longhun Wudao'],
    ['Ciclo de Cine Chino · Sesión 3','','Por consultar','social','Tercera sesión; se propone colaboración con el Centro UC de Estudios Asiáticos.','Catalina Leiva','Centro UC de Estudios Asiáticos (a confirmar)'],
    ['Degustación de Pasteles de Luna','','Agosto','social','Dulce tradicional del Festival de Medio Otoño.','Sofía Lizama','Interno'],
    ['Ciclo de Cine Chino · Sesión 4','','Sin fecha definida','social','Cuarta sesión, en colaboración con equipo de la U. de Chile.','Martina Soto','U. de Chile (a confirmar)'],
    ['Demostración Danza del León','','Ojalá octubre','social','Muestra de danza del león al aire libre en un campus.','Javier Zúñiga','Grupo de danza (a confirmar)'],
    ['Charla de taoísmo','','Octubre','interna','Acercamiento al taoísmo como tradición filosófica y espiritual china.','Benjamín Varas','Interno'],
    ['Taller de caligrafía','2026-09-07','Lunes 7 de septiembre','capacitacion','Arte de la escritura china con pincel y tinta.','Sofía (Xinxi)','Instituto Confucio UC (a confirmar)'],
    ['Taller de cocina de Jiaozi','','Agosto','social','Taller para aprender a cocinar jiaozi.','Sofía Lizama','Interno'],
    ['Taller de arte chino','2026-09-12','Sábado 12 de septiembre','capacitacion','Pintura china, reutilizando materiales del taller de caligrafía.','Sofía (Xinxi)','Interno'],
    ['Actividad infantil con Biblioteca Escolar Futuro','2026-09-25','25 de septiembre','social','Colaboración con Biblioteca Escolar Futuro.','Sofía (Xinxi)','Biblioteca Escolar Futuro']
  ];

  function importarPlan(){
    var caja = document.getElementById('coord-import-resultado');
    if (!confirm('Se agregarán ' + PLAN_WAILIAN.length + ' actividades al calendario interno. ¿Continuar?')) return;
    caja.innerHTML = 'Importando…';

    var lote = db.batch();
    PLAN_WAILIAN.forEach(function(a, i){
      var ref = db.collection('calendario_interno').doc('wailian-2026-' + String(i+1).padStart(2,'0'));
      lote.set(ref, {
        titulo: a[0],
        fecha: a[1],          // vacía si la planilla no da un día concreto
        fechaTexto: a[2],     // lo que dice la planilla, tal cual
        confirmada: false,    // ninguna está confirmada todavía
        hora: '',
        lugar: '',
        tipo: a[3],
        detalle: a[4],
        responsable: a[5],
        colaborador: a[6],
        comision: 'wailian',
        creadoPor: usuario.uid
      });
    });

    lote.commit().then(function(){
      caja.innerHTML = '<p class="coord-ok">Se importaron ' + PLAN_WAILIAN.length +
        ' actividades. Puedes volver a pulsar el botón si actualizas la planilla: ' +
        'se sobrescriben, no se duplican.</p>';
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
      lote.update(db.collection('miembros').doc(m.uid), {estadoPago:'al_dia', ultimoCambioPago:sello});
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
                     pago: d.estadoPago || 'pendiente' });
      });
      filas.sort(function(a,b){ return a.nombre.localeCompare(b.nombre); });
      miembrosCache = filas;
      var res = document.getElementById('coord-miembros-resumen');
      if (res){
        var n = filas.filter(function(f){ return f.pago === 'al_dia'; }).length;
        res.textContent = filas.length + ' con cuenta · ' + n + ' al día · ' + (filas.length - n) + ' pendientes';
      }
      caja.innerHTML = '<table class="coord-tabla"><thead><tr>' +
        '<th>Nombre</th><th>Comisión</th><th>Rol</th><th>Cuota</th><th></th></tr></thead><tbody>' +
        filas.map(function(f){
          var alDia = f.pago === 'al_dia';
          return '<tr><td>' + esc(f.nombre) + '<br><span class="coord-sub">' + esc(f.email) + '</span></td>' +
            '<td>' + esc(f.comision || '—') + '</td>' +
            '<td>' + esc(f.rol) + '</td>' +
            '<td>' + (alDia ? 'Al día' : 'Pendiente') + '</td>' +
            '<td><button class="coord-btn-mini" data-pago="' + esc(f.uid) + '" data-estado="' +
              (alDia ? 'pendiente' : 'al_dia') + '">' +
              (alDia ? 'Marcar pendiente' : 'Marcar al día') + '</button></td></tr>';
        }).join('') + '</tbody></table>';

      [].forEach.call(caja.querySelectorAll('[data-pago]'), function(b){
        b.addEventListener('click', function(){
          var uid = b.getAttribute('data-pago');
          var estado = b.getAttribute('data-estado');
          db.collection('miembros').doc(uid).update({
            estadoPago: estado,
            ultimoCambioPago: firebase.firestore.FieldValue.serverTimestamp()
          }).then(listarMiembros)
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
          '</select>' +
          '<textarea id="coord-cal-detalle" placeholder="Detalle (opcional)"></textarea>' +
        '</div>' +
        '<button class="btn btn-sello" id="coord-agregar-evento">Agregar actividad</button>' +
        '<div id="coord-cal-resultado"></div>' +
        '<div class="coord-import">' +
          '<button class="coord-btn-mini" id="coord-importar">Importar plan Wailian 2026 (19 actividades)</button>' +
          '<p class="coord-sub">Las carga con su fecha tentativa. Ninguna está confirmada, ' +
            'así que se guardan solo aquí y no en la agenda pública.</p>' +
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

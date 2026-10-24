/* Vista compartida de un evento · página pública y vista previa de Decap.
 * Solo genera HTML: no inicia sesiones, no lee Firebase y no guarda datos.
 */
(function(){
  'use strict';
  var MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var DIAS  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  var ESTADOS = {
    abierto  :{txt:'Inscripción abierta', cls:'e-abierto'},
    pronto   :{txt:'Próximamente',        cls:'e-pronto'},
    lleno    :{txt:'Cupos llenos',        cls:'e-lleno'},
    online   :{txt:'Inscripción abierta', cls:'e-online'},
    realizado:{txt:'Realizado',           cls:'e-lleno'}
  };
  var TIPOS = {
    taller:'Taller', charla:'Charla', congreso:'Congreso', almuerzo:'Almuerzo',
    festival:'Festival', stand:'Stand', jornada:'Jornada de investigación',
    voluntariado:'Voluntariado'
  };
  var COMISIONES = {
    wailian:{zh:'外联', nom:'Wailian'},
    xuexi  :{zh:'学习', nom:'Xuexi'},
    xinxi  :{zh:'信息', nom:'Xinxi'}
  };

  var PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>';
  var CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>';

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function ruta(valor, carpeta){
    var v = String(valor || '').trim();
    if (!v) return '';
    if (/^(https?:)?\/\//.test(v) || /^(blob:|data:image)/.test(v)) return v;
    return v.indexOf('/') !== -1 ? v.replace(/^\//, '') : carpeta + v;
  }

  function comoArchivo(f){
    if (!f) return '';
    if (typeof f === 'string') return f.trim();
    if (typeof f === 'object' && f.foto) return String(f.foto).trim();
    return '';
  }

  function fecha(iso){
    if (!iso) return new Date();
    var partes = iso.split('-');
    if (partes.length < 3) return new Date(iso);
    return new Date(parseInt(partes[0],10), parseInt(partes[1],10)-1, parseInt(partes[2],10));
  }

  function esPasado(ev){
    if (!ev || !ev.fecha) return false;
    var d = fecha(ev.fecha);
    d.setHours(23,59,59,999);
    return d < new Date();
  }

  function renderizar(ev, evs){
    ev = ev || {};
    evs = evs || [ev];
    var d = fecha(ev.fecha);
    var est = esPasado(ev) ? {txt:'Ya realizado', cls:'e-lleno'} : (ESTADOS[ev.estado] || ESTADOS.pronto);
    var com = COMISIONES[ev.comision];
    var fechaConfirmada = ev.fecha && !isNaN(d.getTime());
    var fechaTexto = fechaConfirmada
      ? DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()].toLowerCase() + ' de ' + d.getFullYear()
      : 'Por confirmar';
    var pasado = esPasado(ev) || ev.estado === 'realizado';
    var inscripcionAbierta = !pasado && (ev.estado === 'abierto' || ev.estado === 'online');
    var organizador = com ? 'Xuexi Club UC · Comisión ' + com.nom : 'Xuexi Club UC';
    var enlaceInstagram = /^https:\/\/(www\.)?instagram\.com\//i.test(ev.instagram || '')
      ? ev.instagram : '';

    function icono(trazos){
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + trazos + '</svg>';
    }
    var RELOJ = icono('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
    var PERSONAS = icono('<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0112 0v2M16 5a3 3 0 010 6M21 21v-2a6 6 0 00-3-5.2"/>');
    var cupos = Number(ev.cupos);
    var capacidadVacia = ev.cupos == null || String(ev.cupos).trim() === '';
    var mostrarCapacidad = capacidadVacia || (Number.isSafeInteger(cupos) && cupos > 0);
    var cuposTexto = Number.isSafeInteger(cupos) && cupos > 0 ? String(cupos) : 'Ilimitado';
    var mediaPortada = ev.imagen
      ? '<img src="' + esc(ruta(ev.imagen, 'assets/')) + '" alt="' + esc(ev.titulo) + '" fetchpriority="high">'
      : '<span class="glyph zh" aria-hidden="true">' + esc(ev.hanzi || '学') + '</span>';
    var inscripcion = '';
    try {
      var urlInscripcion = new URL(ev.inscripcion || 'https://forms.gle/QGBvhXRK1Yc75obk8');
      if (urlInscripcion.protocol === 'https:') inscripcion = urlInscripcion.href;
    } catch(e){}
    var accion = inscripcionAbierta && inscripcion
      ? '<a href="' + esc(inscripcion) + '" target="_blank" rel="noopener noreferrer" class="btn btn-sello">Inscribirme <span aria-hidden="true">↗</span></a>' : '';
    var horario = ev.hora ? ev.hora + (ev.horaFin ? '–' + ev.horaFin : '') + ' hrs.' : 'Horario por confirmar';
    var lugar = ev.lugar || (ev.estado === 'online' ? 'En línea' : 'Lugar por confirmar');
    function textoParrafos(texto){
      return String(texto || '').trim().split(/\n\s*\n/).filter(Boolean).map(function(p){
        return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
      }).join('');
    }
    var parrafos = textoParrafos(ev.detalle);
    var parrafosFinales = textoParrafos(ev.detalleFinal);

    var relacionados = evs.filter(function(otro){ return otro.id && otro.id !== ev.id; })
      .sort(function(a, b){
        var afinA = (a.comision && a.comision === ev.comision ? 2 : 0) + (a.tipo === ev.tipo ? 1 : 0);
        var afinB = (b.comision && b.comision === ev.comision ? 2 : 0) + (b.tipo === ev.tipo ? 1 : 0);
        if (afinA !== afinB) return afinB - afinA;
        if (esPasado(a) !== esPasado(b)) return esPasado(a) ? 1 : -1;
        return esPasado(a) ? String(b.fecha || '').localeCompare(a.fecha || '')
          : String(a.fecha || '9999').localeCompare(b.fecha || '9999');
      }).slice(0, 3);
    var masActividades = relacionados.length ?
      '<section class="event-related" aria-labelledby="otras-actividades">' +
        '<div class="event-related-head"><h2 class="event-section-heading" id="otras-actividades"><span class="zh" aria-hidden="true">发现</span> Más actividades</h2>' +
          '<a href="eventos.html">Explorar la agenda <span aria-hidden="true">↗</span></a></div>' +
        '<div class="event-related-grid">' + relacionados.map(function(otro){
          var f = fecha(otro.fecha);
          return '<a class="event-related-card" href="evento/' + esc(encodeURIComponent(otro.id)) + '/">' +
            '<div class="event-related-media">' + (otro.imagen
              ? '<img src="' + esc(ruta(otro.imagen, 'assets/')) + '" alt="" loading="lazy">'
              : '<span class="zh" aria-hidden="true">' + esc(otro.hanzi || '学') + '</span>') + '</div>' +
            '<div class="event-related-copy"><small>' + esc(TIPOS[otro.tipo] || 'Actividad') + '</small>' +
              '<h3>' + esc(otro.titulo) + '</h3>' +
              (otro.fecha && !isNaN(f.getTime()) ? '<time datetime="' + esc(otro.fecha) + '">' + f.getDate() + ' de ' + MESES[f.getMonth()].toLowerCase() + '</time>' : '') +
              '<span>Ver actividad <span aria-hidden="true">↗</span></span></div></a>';
        }).join('') + '</div></section>' : '';

    var html = '' +
      '<nav class="event-breadcrumb" aria-label="Ruta de navegación"><a href="eventos.html">← Agenda</a></nav>' +
      '<div class="event-overview">' +
        '<figure class="event-cover' + (!ev.imagen ? ' event-cover--empty' : '') + '">' + mediaPortada + '</figure>' +
      '<header class="event-heading">' +
        '<div class="event-tags"><span class="event-type">' + esc(TIPOS[ev.tipo] || 'Actividad') + '</span>' +
          '<span class="estado ' + est.cls + '">' + esc(est.txt) + '</span></div>' +
        '<h1>' + esc(ev.titulo) + '</h1>' +
        '<div class="event-meta">' +
          '<div class="event-meta-item">' + CAL + '<div><span class="event-meta-label">Fecha</span>' +
            (fechaConfirmada ? '<time datetime="' + esc(ev.fecha) + '">' + esc(fechaTexto) + '</time>' : 'Por confirmar') + '</div></div>' +
          '<div class="event-meta-item">' + RELOJ + '<div><span class="event-meta-label">Horario</span>' + esc(horario) + '</div></div>' +
          '<div class="event-meta-item">' + PIN + '<div><span class="event-meta-label">Lugar</span>' + esc(lugar) + '</div></div>' +
          (mostrarCapacidad ? '<div class="event-meta-item">' + PERSONAS + '<div><span class="event-meta-label">Capacidad</span>' + cuposTexto + '</div></div>' : '') +
        '</div>' +
        '<div class="event-actions">' + accion +
          (enlaceInstagram ? '<a class="event-instagram" href="' + esc(enlaceInstagram) + '" target="_blank" rel="noopener noreferrer">Ver en Instagram <span aria-hidden="true">↗</span></a>' : '') +
          '<a class="btn btn-gold" id="editar-evento" href="admin.html?evento=' + esc(encodeURIComponent(ev.id)) + '" hidden>Editar evento <span aria-hidden="true">↗</span></a>' +
        '</div>' +
        '<p class="event-credit">' + esc(organizador) + '</p>' +
      '</header></div>' +
      (parrafos ? '<article class="event-information event-intro-text" aria-label="Descripción de la actividad"><div class="event-description">' + parrafos + '</div></article>' : '') +

      '<div class="gallery-section" id="fotos-evento">' +
        '<div class="gallery-head">' +
          '<h2 class="event-section-heading"><span class="zh" aria-hidden="true">相册</span> Galería de fotos</h2>' +
          '<span class="gallery-counter" id="fotos-counter">GALERÍA</span>' +
        '</div>' +

        '<div class="ev-stage-box" id="ev-stage-box">' +
          '<div class="ev-stage-screen">' +
            '<img id="stage-img" class="ev-stage-img" alt="" role="button" tabindex="0" aria-label="Ampliar fotografía">' +
            '<span class="ev-stage-hanzi zh" id="stage-hanzi">' + esc(ev.hanzi || '学') + '</span>' +
            '<button type="button" class="ev-stage-nav ev-stage-prev" id="stage-prev" aria-label="Fotografía anterior">&#10094;</button>' +
            '<button type="button" class="ev-stage-nav ev-stage-next" id="stage-next" aria-label="Fotografía siguiente">&#10095;</button>' +
            '<div class="ev-stage-caption">' +
              '<div class="ev-stage-info">' +
                '<span class="ev-stage-count" id="stage-count">FOTOGRAFÍA 1 DE 1</span>' +
                '<h4 id="stage-caption-title">' + esc(ev.titulo) + '</h4>' +
              '</div>' +
              '<button type="button" class="ev-stage-btn-zoom" id="stage-btn-zoom">Ampliar ↗</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<p class="event-gallery-empty" id="fotos-vacio" hidden>Aún no hay fotografías de esta actividad.</p>' +
        '<div class="ev-thumbs-track" id="gallery-thumbs-track"></div>' +
        '<div id="admin-photo-container"></div>' +
        '<p class="gal-nota">Las fotografías oficiales son publicadas por el equipo de coordinación.</p>' +
      '</div>' +
      (parrafosFinales ? '<article class="event-information event-followup" aria-label="Texto adicional"><div class="event-description">' + parrafosFinales + '</div></article>' : '') +
      masActividades;

    return html;
  }

  function fotosDelEvento(ev){
    var fotos = Array.isArray(ev.galeria) ? ev.galeria : (ev.galeria ? [ev.galeria] : []);
    return fotos.map(comoArchivo).filter(function(f){ return f && f !== ev.imagen; });
  }

  window.XuexiEventoVista = {
    renderizar: renderizar, fotosDelEvento: fotosDelEvento,
    esc: esc, ruta: ruta, comoArchivo: comoArchivo
  };
})();

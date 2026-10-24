/* Import into Decap 3.17.1's native draft media queue, through its DOM.
 * Files stay in memory until Decap saves the event and its assets to GitHub.
 * No Instagram URLs or browser blob URLs are written into event fields.
 */
(function(){
  'use strict';
  var MAX_FOTO = 20 * 1024 * 1024;
  var MAX_TOTAL = 80 * 1024 * 1024;
  var EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  function campo(d, nombre){
    var etiqueta = Array.from(d.querySelectorAll('label')).find(function(l){
      return l.textContent.trim().toLowerCase().startsWith(nombre.toLowerCase());
    });
    return etiqueta && d.getElementById(etiqueta.htmlFor);
  }

  async function importar(opciones){
    var vistas = [];
    try {
      return await preparar(opciones, function(file){
        vistas.push(URL.createObjectURL(file));
        opciones.onVistaPrevia(vistas.slice());
      });
    } finally {
      opciones.onVistaPrevia(null);
      vistas.forEach(function(url){ URL.revokeObjectURL(url); });
    }
  }

  async function preparar(opciones, mostrar){
    var d = opciones.documento;
    var ventana = d.defaultView;
    var ruta = ventana.location.hash;
    var formulario = campo(d, 'Identificador');
    var signal = opciones.signal;
    function comprobar(){
      signal.throwIfAborted();
      opciones.comprobar();
      if (ventana.location.hash !== ruta || campo(d, 'Identificador') !== formulario){
        throw new Error('Cambiaste de evento. Vuelve a elegir la publicación.');
      }
    }
    async function esperar(buscar, limite){
      var fin = limite ? Date.now() + limite : Infinity;
      while (true){
        comprobar();
        var resultado = buscar();
        if (resultado) return resultado;
        if (Date.now() > fin) throw new Error('El editor no pudo preparar las fotos. Vuelve a intentarlo.');
        await new Promise(function(resolve){ setTimeout(resolve, 100); });
      }
    }
    var post = opciones.post;
    var medios = (post.media_type === 'CAROUSEL_ALBUM' ? (post.children?.data || []) : [post])
      .filter(function(m){ return m.media_type === 'IMAGE' && /^\d{1,30}$/.test(m.id); });
    var archivos = [];
    if (!medios.length) return { id: null, rutas: [], archivos: [] };
    var total = 0;
    var lote = crypto.randomUUID().slice(0, 8);
    for (var i = 0; i < medios.length; i++){
      comprobar();
      opciones.onEstado('Descargando foto ' + (i + 1) + ' de ' + medios.length + '…');
      var token = await opciones.usuario.getIdToken();
      comprobar();
      var respuesta = await fetch(opciones.endpoint + '/instagram/media/' + medios[i].id, {
        headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(45000)])
      });
      if (!respuesta.ok) throw new Error(respuesta.status === 404
        ? 'Actualiza el Worker de Instagram y la lista de publicaciones para importar las fotos.'
        : 'No se pudo descargar una foto de Instagram. Vuelve a intentarlo.');
      var foto = await respuesta.blob();
      comprobar();
      var extension = EXTENSION[foto.type];
      total += foto.size;
      if (!extension || !foto.size || foto.size > MAX_FOTO || total > MAX_TOTAL){
        throw new Error('Usa JPG, PNG o WEBP: máximo 20 MB por foto y 80 MB por importación.');
      }
      archivos.push(new ventana.File([foto], 'ig-' + medios[i].id + '-' + lote + '.' + extension, { type: foto.type }));
      // Show downloaded images immediately, even before a new event has an ID.
      // This overlay never puts temporary blob URLs into the entry's fields.
      mostrar(archivos[archivos.length - 1]);
    }

    // New events deliberately start with a blank identifier. Download first,
    // then wait for the editor to choose it before resolving the media folder.
    opciones.onEstado('Completa el identificador para importar las fotos.');
    var ultimoId = '';
    var desde = 0;
    var identificador = await esperar(function(){
      var input = campo(d, 'Identificador');
      var valor = input?.value || '';
      if (valor !== ultimoId){ ultimoId = valor; desde = Date.now(); }
      return input !== d.activeElement && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(valor) && Date.now() - desde >= 700 && valor;
    });
    var inputId = campo(d, 'Identificador');
    var soloLectura = inputId.readOnly;
    inputId.dataset.importandoInstagram = 'true';
    inputId.readOnly = true;
    var modal;
    try {
      comprobar();
      var etiqueta = Array.from(d.querySelectorAll('label')).find(function(l){
        return l.textContent.trim().startsWith('Imagen de portada');
      });
      var boton = etiqueta && Array.from(etiqueta.parentElement.parentElement.querySelectorAll('button'))
        .find(function(b){ return !/URL|eliminar|remove|borrar|quita/i.test(b.textContent); });
      if (!boton) throw new Error('No se encontró el selector de imágenes de Decap.');
      boton.click();
      var entrada = await esperar(function(){ return d.querySelector('[role="dialog"] input[type="file"]'); }, 20000);
      modal = entrada.closest('[role="dialog"]');
      for (var j = 0; j < archivos.length; j++){
        comprobar();
        opciones.onEstado('Preparando foto ' + (j + 1) + ' de ' + archivos.length + '…');
        entrada = modal.querySelector('input[type="file"]');
        var transferencia = new ventana.DataTransfer();
        transferencia.items.add(archivos[j]);
        entrada.files = transferencia.files;
        entrada.dispatchEvent(new ventana.Event('change', { bubbles: true }));
        await esperar(function(){
          return Array.from(modal.querySelectorAll('p')).find(function(p){ return p.textContent === archivos[j].name; });
        }, 20000);
      }
      comprobar();
      if (campo(d, 'Identificador').value !== identificador){
        throw new Error('El identificador cambió. Vuelve a importar las fotos.');
      }
    } finally {
      delete inputId.dataset.importandoInstagram;
      inputId.readOnly = soloLectura;
      if (modal?.isConnected){
        var cerrar = modal.querySelector('button[aria-label*="Cerrar"],button[aria-label*="Close"]');
        if (cerrar) cerrar.click();
      }
    }
    comprobar();
    // Wait for the media dialog's close transition before touching the widgets.
    await esperar(function(){ return !d.querySelector('[role="dialog"] input[type="file"]'); }, 5000);
    var rutas = archivos.map(function(file){ return 'assets/eventos/' + identificador + '/' + file.name; });
    var portada = rutas.slice(0, 1);
    var galeria = rutas.slice(1);
    if (!opciones.inyectarFotos('Imagen de portada', portada, false) ||
        !opciones.inyectarFotos('Galería de fotos', galeria, true)){
      throw new Error('No se pudieron rellenar las fotos. Revisa el formulario.');
    }
    return { id: identificador, rutas: rutas, archivos: archivos };
  }

  window.XuexiIGMedios = { importar: importar };
})();

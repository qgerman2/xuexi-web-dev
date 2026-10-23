/* Vista previa de Agenda. Reutiliza la vista pública y los medios de Decap. */
(function(){
  'use strict';
  var raiz = new URL('../', window.location.href);

  window.registrarPreviewEvento = function(CMS){
    CMS.registerPreviewStyle(new URL('assets/site.css?v=30', raiz).href);
    CMS.registerPreviewStyle(new URL('assets/evento.css?v=30', raiz).href);
    CMS.registerPreviewStyle('html,body{margin:0;padding:0}.frame-content{margin:0}', { raw: true });

    var PreviewEvento = window.createClass({
      getInitialState: function(){ return { ampliada: false }; },
      componentDidMount: function(){ this.actualizarGaleria(); },
      componentDidUpdate: function(anterior, estadoAnterior){
        this.actualizarGaleria();
        if (this.state.ampliada && !this.fotos.length) { this.cerrar(); return; }
        if (this.state.ampliada && !estadoAnterior.ampliada && this.cerrarBoton){
          this.overflowAnterior = this.nodo.ownerDocument.body.style.overflow;
          this.nodo.ownerDocument.body.style.overflow = 'hidden';
          this.cerrarBoton.focus();
        }
        if (!this.state.ampliada && estadoAnterior.ampliada){
          this.nodo.ownerDocument.body.style.overflow = this.overflowAnterior || '';
          if (this.focoAnterior && this.focoAnterior.isConnected) this.focoAnterior.focus();
        }
      },
      componentWillUnmount: function(){
        if (this.nodo) this.nodo.ownerDocument.body.style.overflow = this.overflowAnterior || '';
      },
      medio: function(valor){
        if (!valor) return '';
        if (/^(https?:|data:|blob:)/i.test(valor)) return valor;
        var asset;
        try { asset = this.props.getAsset(valor); } catch(e){}
        // Mientras carga, Decap devuelve el mismo empty.svg para cualquier
        // imagen. Usar la URL pública en ese intervalo evita mostrarlo como foto.
        var url = asset && asset.path !== 'empty.svg' ? asset.toString() : valor;
        if (/^(https?:|data:|blob:)/i.test(url)) return url;
        return new URL(url.replace(/^\/+/, ''), raiz).href;
      },
      actualizarGaleria: function(){
        if (!this.nodo) return;
        var n = this.fotos.length;
        this.indice = n ? Math.min(this.indice || 0, n - 1) : 0;
        this.nodo.querySelector('#fotos-evento').hidden = !n;
        this.nodo.querySelector('#ev-stage-box').hidden = !n;
        this.nodo.querySelector('#fotos-vacio').hidden = !!n;
        this.nodo.querySelector('#fotos-counter').textContent = n + (n === 1 ? ' FOTOGRAFÍA' : ' FOTOGRAFÍAS');
        this.nodo.querySelector('#stage-prev').hidden = this.nodo.querySelector('#stage-next').hidden = n < 2;
        var img = this.nodo.querySelector('#stage-img');
        if (n){ img.src = this.fotos[this.indice]; img.alt = this.evento.titulo + ' · Foto ' + (this.indice + 1); }
        else img.removeAttribute('src');
        this.nodo.querySelector('#stage-count').textContent = 'FOTOGRAFÍA ' + (this.indice + 1) + ' DE ' + n;
        this.nodo.querySelector('#stage-caption-title').hidden = true;
        var self = this, esc = window.XuexiEventoVista.esc;
        var track = this.nodo.querySelector('#gallery-thumbs-track');
        track.hidden = n < 2;
        track.innerHTML = this.fotos.map(function(url, i){
          return '<div class="ev-thumb-item' + (i === self.indice ? ' active' : '') + '">' +
            '<button type="button" class="event-thumb-open" data-idx="' + i + '" aria-label="Ver fotografía ' + (i + 1) + '" aria-pressed="' + (i === self.indice) + '">' +
            '<img src="' + esc(url) + '" alt="" loading="lazy"></button></div>';
        }).join('');
      },
      cambiarFoto: function(indice){
        if (!this.fotos.length) return;
        this.indice = (indice + this.fotos.length) % this.fotos.length;
        this.actualizarGaleria();
        if (this.state.ampliada) this.setState({ ampliada: true });
      },
      abrir: function(){
        if (!this.fotos.length) return;
        this.focoAnterior = this.nodo.ownerDocument.activeElement;
        this.setState({ ampliada: true });
      },
      cerrar: function(){ this.setState({ ampliada: false }); },
      clic: function(e){
        var target = e.target;
        if (target.closest('a:not([target="_blank"])')) { e.preventDefault(); return; }
        if (target.closest('#stage-prev')) this.cambiarFoto((this.indice || 0) - 1);
        else if (target.closest('#stage-next')) this.cambiarFoto((this.indice || 0) + 1);
        else if (target.closest('.event-thumb-open')) this.cambiarFoto(Number(target.closest('.event-thumb-open').dataset.idx));
        else if (target.closest('#stage-btn-zoom,#stage-img')) this.abrir();
      },
      teclado: function(e){
        if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'stage-img'){
          e.preventDefault(); this.abrir();
        }
      },
      tecladoModal: function(e){
        if (e.key === 'Escape') { e.preventDefault(); this.cerrar(); }
        else if (e.key === 'ArrowLeft') this.cambiarFoto((this.indice || 0) - 1);
        else if (e.key === 'ArrowRight') this.cambiarFoto((this.indice || 0) + 1);
        else if (e.key === 'Tab'){
          var botones = e.currentTarget.querySelectorAll('button');
          var primero = botones[0], ultimo = botones[botones.length - 1];
          if (e.shiftKey && e.target === primero) { e.preventDefault(); ultimo.focus(); }
          else if (!e.shiftKey && e.target === ultimo) { e.preventDefault(); primero.focus(); }
        }
      },
      render: function(){
        var h = window.h, self = this;
        var dato = this.props.entry.get('data');
        var evento = dato ? dato.toJS() : {};
        var originales = window.XuexiEventoVista.fotosDelEvento(evento);
        evento.imagen = this.medio(evento.imagen);
        evento.galeria = originales.map(function(url){ return self.medio(url); });
        evento.id = evento.id || 'vista-previa';
        evento.titulo = evento.titulo || 'Título del evento';
        this.evento = evento;
        this.fotos = evento.galeria;
        var firma = this.fotos.join('\n');
        if (firma !== this.firmaFotos) { this.indice = 0; this.firmaFotos = firma; }
        var foto = this.fotos[this.indice || 0];
        return h('div', {},
          h('main', {}, h('section', { className: 'event-page' },
            h('div', { className: 'wrap wrap-event-detail', ref: function(n){ self.nodo = n; },
              onClick: this.clic, onKeyDown: this.teclado,
              dangerouslySetInnerHTML: { __html: window.XuexiEventoVista.renderizar(evento, [evento]) } }))),
          this.state.ampliada && foto ? h('div', {
            className: 'lightbox-modal active', role: 'dialog', 'aria-modal': true,
            'aria-label': 'Fotografías del evento', onKeyDown: this.tecladoModal,
            onClick: function(e){ if (e.target === e.currentTarget) self.cerrar(); }
          },
            h('button', { className: 'lightbox-close', type: 'button', 'aria-label': 'Cerrar imagen', onClick: this.cerrar,
              ref: function(n){ self.cerrarBoton = n; } }, '×'),
            this.fotos.length > 1 ? h('button', { className: 'lightbox-nav lightbox-prev', type: 'button', 'aria-label': 'Imagen anterior',
              onClick: function(){ self.cambiarFoto((self.indice || 0) - 1); } }, '❮') : null,
            h('div', { className: 'lightbox-content' }, h('img', { className: 'lightbox-img', src: foto, alt: evento.titulo })),
            this.fotos.length > 1 ? h('button', { className: 'lightbox-nav lightbox-next', type: 'button', 'aria-label': 'Imagen siguiente',
              onClick: function(){ self.cambiarFoto((self.indice || 0) + 1); } }, '❯') : null
          ) : null
        );
      }
    });
    CMS.registerPreviewTemplate('agenda', PreviewEvento);
  };
})();

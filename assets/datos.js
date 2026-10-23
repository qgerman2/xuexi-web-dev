/* Carga los eventos desde una planilla de Google publicada como CSV.
   Si la planilla no está configurada o falla, usa data/eventos.json.
   Así el sitio nunca se queda sin agenda. */
(function(){
  'use strict';

  // Pega aquí la URL que entrega Google al publicar la hoja como CSV.
  // Archivo > Compartir > Publicar en la Web > Valores separados por comas (.csv)
  // Si queda vacío, el sitio lee data/eventos.json como siempre.
  var URL_PLANILLA = '';

  // Convierte texto CSV en una lista de objetos, respetando comillas,
  // comas y saltos de línea dentro de una celda.
  function leerCSV(texto){
    texto = texto.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    var filas = [], campo = '', fila = [], entreComillas = false;

    for (var i = 0; i < texto.length; i++){
      var c = texto[i];
      if (entreComillas){
        if (c === '"'){
          if (texto[i+1] === '"'){ campo += '"'; i++; }
          else entreComillas = false;
        } else campo += c;
      } else if (c === '"'){
        entreComillas = true;
      } else if (c === ','){
        fila.push(campo); campo = '';
      } else if (c === '\n'){
        fila.push(campo); filas.push(fila); fila = []; campo = '';
      } else campo += c;
    }
    if (campo !== '' || fila.length){ fila.push(campo); filas.push(fila); }
    if (!filas.length) return [];

    var cab = filas.shift().map(function(h){ return h.trim(); });
    return filas
      .filter(function(f){ return f.some(function(v){ return String(v).trim() !== ''; }); })
      .map(function(f){
        var o = {};
        cab.forEach(function(h, j){ o[h] = (f[j] || '').trim(); });
        return o;
      });
  }

  // La planilla entrega todo como texto; dejamos los tipos como los espera el sitio.
  function normalizar(e){
    if (e.cupos !== undefined && e.cupos !== '') e.cupos = parseInt(e.cupos, 10) || 0;
    else e.cupos = 0;
    // Google puede devolver la fecha como 03-08-2026 o 3/8/2026; la dejamos ISO.
    var f = String(e.fecha || '').trim();
    var m = f.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) e.fecha = m[3] + '-' + ('0'+m[2]).slice(-2) + '-' + ('0'+m[1]).slice(-2);
    return e;
  }

  function desdeJSON(){
    return fetch('data/eventos.json', {cache:'no-cache'})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
  }

  // Devuelve siempre {eventos}, venga de donde venga.
  window.cargarEventos = function(){
    if (!URL_PLANILLA){ return desdeJSON(); }

    return fetch(URL_PLANILLA, {cache:'no-cache'})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
      .then(function(txt){
        var evs = leerCSV(txt).map(normalizar).filter(function(e){ return e.titulo && e.fecha; });
        if (!evs.length) throw new Error('planilla vacía');
        return {eventos: evs};
      })
      .catch(function(err){
        console.warn('No se pudo leer la planilla, uso data/eventos.json:', err.message);
        return desdeJSON();
      });
  };
})();

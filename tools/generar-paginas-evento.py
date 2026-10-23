#!/usr/bin/env python3
"""Genera /evento/<id>/index.html para cada evento · Xuexi Club UC

Por qué existe: WhatsApp, Instagram, LinkedIn y compañía leen el HTML tal cual
se sirve y NO ejecutan JavaScript. evento.html pone el título por JS, así que
al compartir cualquier evento salía siempre la misma vista previa genérica, sin
nombre ni foto. Estas páginas traen las etiquetas Open Graph ya escritas.

Cada página es una copia de evento.html con:
  · <base href="../../">        para que las rutas relativas sigan valiendo
                                 estando dos niveles más abajo (y da igual si
                                 el sitio cuelga de la raíz o de un subdirectorio)
  · <title> y etiquetas og:/twitter: del evento
  · window.EVENTO_ID            para que la página sepa cuál mostrar sin ?id=

Se ejecuta solo:  python3 tools/generar-paginas-evento.py
"""
import glob
import io
import json
import os
import re
import shutil
import sys

# Dirección pública del sitio. og:image y og:url tienen que ser absolutas:
# los rastreadores no resuelven rutas relativas.
SITIO = os.environ.get('XUEXI_SITIO', 'https://qgerman2.github.io/xuexi-web-dev')

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTOS = os.path.join(RAIZ, 'data', 'eventos')
PLANTILLA = os.path.join(RAIZ, 'evento.html')
SALIDA = os.path.join(RAIZ, 'evento')


def escapar(t):
    return (str(t or '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def recortar(t, n=200):
    t = ' '.join(str(t or '').split())
    return t if len(t) <= n else t[:n - 1].rsplit(' ', 1)[0] + '…'


def ruta_imagen(valor):
    """Igual que ruta() en el sitio: el panel guarda 'assets/foo.jpg' y la
    planilla solo 'foo.jpg'. Aceptamos las dos."""
    v = str(valor or '').strip()
    if not v:
        return 'assets/logo.png'
    if re.match(r'^(https?:)?//', v):
        return v
    return v.lstrip('/') if '/' in v else 'assets/' + v


def absoluta(ruta):
    if re.match(r'^(https?:)?//', ruta):
        return ruta
    return SITIO.rstrip('/') + '/' + ruta.lstrip('/')


def cabecera(ev):
    """Etiquetas que van al final del <head>. La <base> va aparte, arriba."""
    titulo = escapar(ev['titulo'])
    descripcion = escapar(recortar(ev.get('detalle')
                                   or f"Actividad de Xuexi Club UC el {ev.get('fecha','')}."))
    imagen = escapar(absoluta(ruta_imagen(ev.get('imagen'))))
    url = escapar(f"{SITIO.rstrip('/')}/evento/{ev['id']}/")
    return f"""<title>{titulo} · Xuexi Club UC</title>
<meta name="description" content="{descripcion}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Xuexi Club UC">
<meta property="og:locale" content="es_CL">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{descripcion}">
<meta property="og:image" content="{imagen}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{titulo}">
<meta name="twitter:description" content="{descripcion}">
<meta name="twitter:image" content="{imagen}">
<script>window.EVENTO_ID = {json.dumps(ev['id'])};</script>"""


def main():
    plantilla = io.open(PLANTILLA, encoding='utf-8').read()

    # Fuera el <title> y la <meta description> genéricos de la plantilla.
    plantilla = re.sub(r'<title>.*?</title>\n?', '', plantilla, count=1, flags=re.S)
    plantilla = re.sub(r'<meta name="description"[^>]*>\n?', '', plantilla, count=1)

    archivos = sorted(glob.glob(os.path.join(EVENTOS, '*.json')))
    if not archivos:
        print('No hay eventos en data/eventos/', file=sys.stderr)
        return 1

    vivos = set()
    for f in archivos:
        ev = json.load(io.open(f, encoding='utf-8'))
        nombre = os.path.basename(f)[:-5]
        if ev.get('id') != nombre:
            print(f'ERROR: {f} tiene id={ev.get("id")!r} pero se llama {nombre!r}',
                  file=sys.stderr)
            return 1
        vivos.add(nombre)

        pagina = plantilla.replace('</head>', cabecera(ev) + '\n</head>', 1)
        # Arriba del todo, justo tras el charset: la <base> solo afecta a lo
        # que viene después, y la hoja de estilos está en las primeras líneas.
        pagina = pagina.replace('<meta charset="utf-8">',
                                '<meta charset="utf-8">\n<base href="../../">', 1)
        # Con <base>, una ancla suelta apuntaría a la raíz del sitio.
        pagina = pagina.replace('href="#contenido"', f'href="evento/{nombre}/#contenido"')

        carpeta = os.path.join(SALIDA, nombre)
        os.makedirs(carpeta, exist_ok=True)
        io.open(os.path.join(carpeta, 'index.html'), 'w', encoding='utf-8').write(pagina)
        print(f'  evento/{nombre}/index.html')

    # Si se borra un evento, su página no puede quedarse viva para siempre.
    if os.path.isdir(SALIDA):
        for d in os.listdir(SALIDA):
            if os.path.isdir(os.path.join(SALIDA, d)) and d not in vivos:
                shutil.rmtree(os.path.join(SALIDA, d))
                print(f'  (eliminada) evento/{d}/')

    print(f'\n{len(vivos)} páginas · base {SITIO}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

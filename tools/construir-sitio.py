#!/usr/bin/env python3
"""Construye el sitio público en _site/ sin modificar los archivos fuente.

Uso: python3 tools/construir-sitio.py
Vista local: python3 -m http.server 8000 --directory _site
XUEXI_SITIO define la URL pública para las etiquetas de enlaces compartidos.
"""
from pathlib import Path
import shutil
import subprocess
import sys

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / '_site'
ARCHIVOS_EDITOR = ('index.html', 'config.yml', 'preview-evento.js', 'instagram-media.js')


def copiar(origen, destino):
    if origen.is_symlink():
        raise ValueError(f'No se publican enlaces simbólicos: {origen}')
    if origen.is_dir():
        for archivo in origen.rglob('*'):
            if archivo.is_symlink():
                raise ValueError(f'No se publican enlaces simbólicos: {archivo}')
        shutil.copytree(origen, destino)
    else:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(origen, destino)


def main():
    if SALIDA.is_symlink():
        raise ValueError('_site no puede ser un enlace simbólico')
    if SALIDA.exists():
        shutil.rmtree(SALIDA)
    SALIDA.mkdir()

    for pagina in sorted(RAIZ.glob('*.html')):
        copiar(pagina, SALIDA / pagina.name)
    for carpeta in ('assets', 'data'):
        copiar(RAIZ / carpeta, SALIDA / carpeta)
    for archivo in ARCHIVOS_EDITOR:
        copiar(RAIZ / 'admin' / archivo, SALIDA / 'admin' / archivo)
    if (RAIZ / 'CNAME').exists():
        copiar(RAIZ / 'CNAME', SALIDA / 'CNAME')
    (SALIDA / '.nojekyll').touch()

    for script, destino in (
        ('agregar-eventos.py', SALIDA / 'data' / 'eventos.json'),
        ('generar-paginas-evento.py', SALIDA / 'evento'),
    ):
        subprocess.run([sys.executable, str(RAIZ / 'tools' / script), '--salida', str(destino)], check=True)
    print(f'Sitio construido en {SALIDA}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

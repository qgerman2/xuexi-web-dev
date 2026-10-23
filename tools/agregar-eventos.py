#!/usr/bin/env python3
"""Junta data/eventos/*.json en data/eventos.json · Xuexi Club UC

El panel edita un archivo por evento, que es lo que permite previsualizar y
enlazar cada uno por separado. Pero el sitio es estático: no puede listar una
carpeta, así que necesita un único archivo que leer de una vez. Esto lo arma.

data/eventos.json pasa a ser GENERADO: no se edita a mano, se regenera desde
la carpeta. Lo que no sea la lista de eventos (temporada, _instrucciones,
_referencia) se conserva tal cual estaba.

El id de cada evento sale del NOMBRE DEL ARCHIVO, que es la única fuente de
verdad: es la URL pública y la clave con la que se guardan sus fotos. Si el
campo id de dentro no coincide, esto falla en vez de inventarse una respuesta.

Se ejecuta solo:  python3 tools/agregar-eventos.py
"""
import glob
import io
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETA = os.path.join(RAIZ, 'data', 'eventos')
SALIDA = os.path.join(RAIZ, 'data', 'eventos.json')
CABECERA = os.path.join(RAIZ, 'data', 'agenda.json')


def main():
    archivos = sorted(glob.glob(os.path.join(CARPETA, '*.json')))
    if not archivos:
        print('No hay eventos en data/eventos/', file=sys.stderr)
        return 1

    eventos, problemas = [], []
    for f in archivos:
        nombre = os.path.basename(f)[:-5]
        try:
            e = json.load(io.open(f, encoding='utf-8'))
        except json.JSONDecodeError as err:
            problemas.append(f'{f}: JSON inválido ({err})')
            continue
        if e.get('id') != nombre:
            problemas.append(
                f'{f}: el campo id es {e.get("id")!r} pero el archivo se llama '
                f'{nombre!r}. El nombre manda; corrige el campo o renombra.')
            continue
        if not e.get('titulo'):
            problemas.append(f'{f}: sin título')
        eventos.append(e)

    if problemas:
        print('No se generó nada. Primero:', file=sys.stderr)
        for p in problemas:
            print('  -', p, file=sys.stderr)
        return 1

    # Por fecha ascendente. Los que no tienen fecha van al final, no al
    # principio: una cadena vacía ordenaría antes que cualquier fecha.
    eventos.sort(key=lambda e: (not e.get('fecha'), e.get('fecha') or '', e['id']))

    # Lo que no son eventos (temporada y demás) vive aparte, en
    # data/agenda.json, porque este archivo se regenera entero.
    cabecera = {}
    if os.path.exists(CABECERA):
        cabecera = json.load(io.open(CABECERA, encoding='utf-8'))

    salida = dict(cabecera)
    salida['_generado'] = ('Archivo generado por tools/agregar-eventos.py a partir '
                           'de data/eventos/. No lo edites a mano: se sobrescribe.')
    salida['eventos'] = eventos

    texto = json.dumps(salida, ensure_ascii=False, indent=2) + '\n'
    antes = io.open(SALIDA, encoding='utf-8').read() if os.path.exists(SALIDA) else None
    if antes == texto:
        print(f'{len(eventos)} eventos · sin cambios')
        return 0

    io.open(SALIDA, 'w', encoding='utf-8').write(texto)
    print(f'{len(eventos)} eventos → data/eventos.json')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

"""Pruebas del artefacto publicado, sin acceso a GitHub ni cambios al repositorio."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

FUENTE = Path(__file__).resolve().parent.parent


class ConstruccionSitio(unittest.TestCase):
    def setUp(self):
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        for carpeta in ('tools', 'assets', 'data/eventos', 'admin', '.git'):
            (self.raiz / carpeta).mkdir(parents=True)
        for nombre in ('construir-sitio.py', 'agregar-eventos.py', 'generar-paginas-evento.py'):
            shutil.copyfile(FUENTE / 'tools' / nombre, self.raiz / 'tools' / nombre)
        shutil.copyfile(FUENTE / 'evento.html', self.raiz / 'evento.html')
        (self.raiz / 'index.html').write_text('<h1>Inicio</h1>')
        (self.raiz / 'assets' / 'cartel.jpg').write_bytes(b'foto de prueba')
        for nombre in ('index.html', 'config.yml', 'preview-evento.js', 'instagram-media.js'):
            (self.raiz / 'admin' / nombre).write_text('editor')
        for privado in ('PANEL.md', 'HANDOFF.md', 'wrangler.toml', '.git/config', 'admin/instagram-worker.js'):
            (self.raiz / privado).write_text('no publicar')
        self.evento = {
            'id': 'actividad', 'titulo': 'Charla "China" & UC',
            'detalle': 'Una charla sobre China.', 'fecha': '2026-12-01',
            'imagen': 'assets/cartel.jpg', 'galeria': 'assets/cartel.jpg'
        }
        self.guardar(self.evento)

    def guardar(self, evento):
        (self.raiz / 'data' / 'eventos' / (evento['id'] + '.json')).write_text(json.dumps(evento))

    def construir(self):
        env = dict(os.environ, XUEXI_SITIO='https://example.test/club')
        return subprocess.run([sys.executable, str(self.raiz / 'tools' / 'construir-sitio.py')],
                              env=env, capture_output=True, text=True)

    def test_artefacto_completo_con_metadatos_sin_modificar_fuentes(self):
        # Ignore stale root outputs, even if a developer still has local copies.
        (self.raiz / 'data/eventos.json').write_text('agenda vieja')
        (self.raiz / 'evento/viejo').mkdir(parents=True)
        (self.raiz / 'evento/viejo/index.html').write_text('página vieja')
        resultado = self.construir()
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        sitio = self.raiz / '_site'
        self.assertTrue((sitio / 'index.html').exists())
        self.assertTrue((sitio / 'admin/instagram-media.js').exists())
        self.assertTrue((sitio / '.nojekyll').exists())
        self.assertEqual((sitio / 'assets/cartel.jpg').read_bytes(), b'foto de prueba')
        agregado = json.loads((sitio / 'data/eventos.json').read_text())
        self.assertEqual(agregado['eventos'][0]['galeria'], ['assets/cartel.jpg'])
        pagina = (sitio / 'evento/actividad/index.html').read_text()
        self.assertIn('property="og:title" content="Charla &quot;China&quot; &amp; UC"', pagina)
        self.assertIn('property="og:image" content="https://example.test/club/assets/cartel.jpg"', pagina)
        self.assertIn('rel="canonical" href="https://example.test/club/evento/actividad/"', pagina)
        self.assertLess(pagina.index('<base href="../../">'), pagina.index('<link '))
        self.assertIn('window.EVENTO_ID = "actividad"', pagina)
        self.assertFalse((sitio / 'evento/viejo').exists())
        for privado in ('PANEL.md', 'HANDOFF.md', 'wrangler.toml', '.git', 'tools', 'admin/instagram-worker.js'):
            self.assertFalse((sitio / privado).exists(), privado)
        self.assertEqual((self.raiz / 'data/eventos.json').read_text(), 'agenda vieja')
        self.assertEqual((self.raiz / 'evento/viejo/index.html').read_text(), 'página vieja')
        self.assertEqual(json.loads((self.raiz / 'data/eventos/actividad.json').read_text()), self.evento)

    def test_reconstruccion_elimina_paginas_de_eventos_borrados(self):
        self.guardar(dict(self.evento, id='borrado'))
        resultado = self.construir()
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertTrue((self.raiz / '_site/evento/borrado/index.html').exists())
        (self.raiz / 'data/eventos/borrado.json').unlink()
        resultado = self.construir()
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertFalse((self.raiz / '_site/evento/borrado').exists())
        self.assertEqual(len(json.loads((self.raiz / '_site/data/eventos.json').read_text())['eventos']), 1)

    def test_datos_invalidos_impiden_publicar(self):
        ruta = self.raiz / 'data/eventos/actividad.json'
        ruta.write_text(json.dumps(dict(self.evento, id='otro')))
        resultado = self.construir()
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('El nombre manda', resultado.stderr)
        self.assertFalse((self.raiz / '_site/evento/actividad/index.html').exists())


if __name__ == '__main__':
    unittest.main()

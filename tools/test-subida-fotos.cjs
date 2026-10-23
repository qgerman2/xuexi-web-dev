// Ejecutar: node --test tools/test-subida-fotos.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { File } = require('node:buffer');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/auth.js'), 'utf8');

function entorno({ conflicto = false, fallaImagen = false, rol = 'admin' } = {}) {
  const estado = {
    evento: { id: 'prueba', titulo: 'Taller de caligrafía 书法', detalle: 'Original', galeria: ['assets/anterior.jpg'] },
    head: 'inicial', blobs: new Map(), trees: new Map(), commits: new Map(),
    solicitudes: [], imagenes: 0, avances: 0
  };
  const usuario = { uid: 'admin', getIdToken: async () => 'sesion-firebase' };
  class Reader {
    readAsDataURL(file) {
      file.arrayBuffer().then(bytes => {
        this.result = 'data:' + file.type + ';base64,' + Buffer.from(bytes).toString('base64');
        this.onload();
      }).catch(() => this.onerror());
    }
  }
  const contexto = {
    firebase: { apps: [{}], auth: () => ({ currentUser: usuario }), firestore: () => ({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ rol }) }) }) })
    }) },
    document: { baseURI: 'https://sitio.test/', addEventListener() {} },
    window: {}, URL, FileReader: Reader, Uint8Array, TextDecoder, AbortSignal,
    crypto: webcrypto, atob, console,
    fetch: async (url, opciones = {}) => {
      url = String(url);
      if (url.endsWith('/admin/config.yml')) {
        return new Response('backend:\n  api_root: https://panel.test/github\n  repo: org/repo\n  branch: main\n');
      }
      assert.equal(opciones.headers.Authorization, 'Bearer sesion-firebase');
      const ruta = new URL(url).pathname.replace('/github/repos/org/repo', '');
      const body = opciones.body ? JSON.parse(opciones.body) : null;
      estado.solicitudes.push({ ruta, body });
      if (ruta === '/git/ref/heads/main') return Response.json({ object: { sha: estado.head } });
      if (ruta.startsWith('/git/commits/') && !body) return Response.json({ tree: { sha: 'base-' + estado.head } });
      if (ruta === '/contents/data/eventos/prueba.json') {
        return Response.json({ content: Buffer.from(JSON.stringify(estado.evento)).toString('base64') });
      }
      if (ruta === '/git/blobs') {
        if (body.encoding === 'base64') {
          estado.imagenes++;
          if (fallaImagen && estado.imagenes === 2) return Response.json({}, { status: 500 });
        }
        const sha = 'blob-' + estado.blobs.size;
        estado.blobs.set(sha, body);
        return Response.json({ sha });
      }
      if (ruta === '/git/trees') {
        assert.equal(body.base_tree, 'base-' + estado.head);
        const sha = 'tree-' + estado.trees.size;
        estado.trees.set(sha, body);
        return Response.json({ sha });
      }
      if (ruta === '/git/commits') {
        const sha = 'commit-' + estado.commits.size;
        estado.commits.set(sha, body);
        return Response.json({ sha });
      }
      if (ruta === '/git/refs/heads/main') {
        assert.equal(body.force, false);
        if (conflicto) {
          conflicto = false;
          estado.head = 'guardado-concurrente';
          estado.evento.detalle = 'Cambio de otra persona';
          estado.evento.galeria.push('assets/concurrente.jpg');
          return Response.json({}, { status: 422 });
        }
        const commit = estado.commits.get(body.sha);
        assert.deepEqual(commit.parents, [estado.head]);
        estado.head = body.sha;
        estado.avances++;
        const tree = estado.trees.get(commit.tree);
        const evento = tree.tree.find(f => f.path === 'data/eventos/prueba.json');
        estado.evento = JSON.parse(estado.blobs.get(evento.sha).content);
        return Response.json({ object: { sha: body.sha } });
      }
      throw new Error('Ruta inesperada: ' + ruta);
    }
  };
  vm.runInNewContext(source, contexto);
  return { api: contexto.window.XuexiAuth, estado };
}
const archivos = () => [
  new File(['foto-uno'], 'uno.png', { type: 'image/png' }),
  new File(['foto-dos'], 'dos.jpg', { type: 'image/jpeg' })
];

test('dos fotos y sus referencias se publican en un solo commit', async () => {
  const { api, estado } = entorno();
  const resultado = await api.subirFotosEvento('prueba', archivos(), '');
  assert.equal(resultado.length, 2);
  assert.equal(estado.avances, 1);
  assert.equal(estado.commits.size, 1);
  assert.equal([...estado.trees.values()][0].tree.length, 3);
  assert.equal(estado.evento.titulo, 'Taller de caligrafía 书法');
  assert.equal(estado.evento.galeria.length, 3);
  for (const foto of resultado) assert.ok(estado.evento.galeria.includes(foto.repoPath));
  for (const foto of resultado) URL.revokeObjectURL(foto.url);
});

test('un conflicto conserva los cambios ajenos sin duplicar fotos', async () => {
  const { api, estado } = entorno({ conflicto: true });
  const resultado = await api.subirFotosEvento('prueba', archivos(), '');
  assert.equal(estado.evento.detalle, 'Cambio de otra persona');
  assert.ok(estado.evento.galeria.includes('assets/concurrente.jpg'));
  assert.equal(new Set(estado.evento.galeria).size, 4);
  assert.equal(estado.imagenes, 2);
  assert.equal(estado.avances, 1);
  for (const foto of resultado) URL.revokeObjectURL(foto.url);
});

test('un error en una foto no publica un lote parcial', async () => {
  const { api, estado } = entorno({ fallaImagen: true });
  await assert.rejects(api.subirFotosEvento('prueba', archivos(), ''));
  assert.equal(estado.avances, 0);
  assert.equal(estado.commits.size, 0);
  assert.equal(estado.head, 'inicial');
  assert.deepEqual(estado.evento.galeria, ['assets/anterior.jpg']);
});

test('un miembro sin rol admin no escribe en GitHub', async () => {
  const { api, estado } = entorno({ rol: 'miembro' });
  await assert.rejects(api.subirFotosEvento('prueba', archivos(), ''), /Solo administradores/);
  assert.equal(estado.solicitudes.length, 0);
});

test('un archivo inválido rechaza el lote antes de escribir', async () => {
  const { api, estado } = entorno();
  const files = [...archivos(), new File(['texto'], 'texto.txt', { type: 'text/plain' })];
  await assert.rejects(api.subirFotosEvento('prueba', files, ''), /JPG, PNG o WEBP/);
  assert.equal(estado.solicitudes.length, 0);
});

/* Browser regression with the real pinned Decap bundle and fake services.
 * Requires Playwright + Chromium. Never sends writes to Firebase, Meta or GitHub.
 * Optional CHROME_BIN and DECAP_BUNDLE select a browser and a cached bundle.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

test('Instagram import stages native Decap media and publishes photos + entry in one commit', { timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.yml': 'text/yaml', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await chromium.launch({
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
    headless: true, args: ['--no-sandbox']
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const requests = [];
  const stub = `(function(){
    const user={uid:'fixture-admin',email:'fixture@example.com',getIdToken:async()=> 'fixture-firebase'};
    const auth={currentUser:user,onAuthStateChanged:fn=>setTimeout(()=>fn(user),0)};
    window.firebase={apps:[{}],auth:()=>auth,firestore:()=>({collection:()=>({doc:()=>({
      get:async()=>({exists:true,data:()=>({rol:'admin',nombre:'Fixture'})})
    })})})};
  })();`;
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({
    contentType: 'application/javascript', body: route.request().url().includes('firebase-app-compat') ? stub : ''
  }));
  if (process.env.DECAP_BUNDLE) {
    await page.route('https://unpkg.com/decap-cms@3.17.1/dist/decap-cms.js', route => route.fulfill({
      contentType: 'application/javascript', path: process.env.DECAP_BUNDLE
    }));
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  let downloadFailure = false;
  await page.route('https://ig.qgerman2.workers.dev/**', route => {
    const url = route.request().url();
    if (url.includes('/instagram/media/')) return route.fulfill(downloadFailure
      ? { status: 502, json: { error: 'Fixture download failed' } }
      : { contentType: 'image/png', body: Buffer.concat([png, Buffer.from(url)]) });
    return route.fulfill({ json: { data: [{
      id: '123', caption: 'Descripción importada', media_type: 'CAROUSEL_ALBUM',
      permalink: 'https://www.instagram.com/p/fixture/', children: { data: [
        { id: '111', media_type: 'IMAGE' }, { id: '222', media_type: 'IMAGE' }
      ] }
    }] } });
  });
  await page.route('https://panel.qgerman2.workers.dev/**', async route => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace('/github', '');
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    requests.push({ p, method, body });
    let response;
    let status = 200;
    if (p === '/sesion') response = { token: 'xs1.fixture' };
    else if (p === '/user') response = { login: 'fixture', name: 'Fixture', email: 'fixture@example.com' };
    else if (p === '/repos/qgerman2/xuexi-web-dev') response = { permissions: { push: true }, owner: { login: 'qgerman2' } };
    else if (p.includes('/contents/')) { status = 404; response = { message: 'Not found' }; }
    else if (p.includes('/git/trees/')) response = { sha: 'fixture-base-tree', tree: [], truncated: false };
    else if (p.includes('/git/ref')) response = { object: { sha: 'fixture-base-commit', type: 'commit' } };
    else if (p.includes('/branches/')) response = { commit: { sha: 'fixture-base-commit' } };
    else if (p.endsWith('/git/blobs')) response = { sha: 'fixture-blob-' + requests.length };
    else if (p.endsWith('/git/trees')) response = { sha: 'fixture-new-tree' };
    else if (p.endsWith('/git/commits')) response = { sha: 'fixture-new-commit' };
    else throw new Error('Unexpected GitHub fixture request: ' + method + ' ' + p);
    requests[requests.length - 1].response = response;
    await route.fulfill({ status, json: response });
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/admin.html');
  const frame = page.frameLocator('#cms');
  const choose = page.locator('.ig-elegir');
  await choose.click();
  await page.getByText('Completa el identificador para importar las fotos.', { exact: true }).waitFor();
  assert.equal(await frame.getByLabel('Identificador').first().inputValue(), '');
  assert.equal(await frame.getByLabel('Título', { exact: true }).inputValue(), '');
  assert.equal(await frame.getByLabel(/^Detalle/).inputValue(), 'Descripción importada');
  assert.match(await page.evaluate(() => {
    try { window.PanelXuexi.validarImportacion(null); } catch (error) { return error.message; }
  }), /Espera a que termine/);
  await page.locator('#ig-cancelar').click();
  await page.getByText('Importación cancelada.', { exact: true }).waitFor();

  downloadFailure = true;
  await choose.click();
  await page.getByText('No se pudo descargar una foto de Instagram. Vuelve a intentarlo.', { exact: true }).waitFor();
  assert.equal(requests.filter(r => r.method !== 'GET' && r.p !== '/sesion').length, 0);
  downloadFailure = false;
  await choose.click();
  await page.getByText('Completa el identificador para importar las fotos.', { exact: true }).waitFor();
  await frame.getByLabel('Identificador').first().fill('prueba-ig');
  await frame.getByLabel('Identificador').first().press('Tab');
  await page.getByText('Importado. Guarda el evento para subir las fotos.', { exact: true }).waitFor();
  const previews = await page.locator('#cms').evaluate(el => Array.from(el.contentDocument.querySelectorAll('img')).map(img => img.src));
  assert.equal(previews.length, 2);
  assert.ok(previews.every(src => src.startsWith('blob:')));
  await frame.getByLabel('Título', { exact: true }).fill('Evento de prueba');
  await frame.getByText('Ahora', { exact: true }).click();
  await frame.getByLabel('Tipo', { exact: true }).click();
  await frame.getByText('Taller', { exact: true }).click();
  const publish = async () => {
    await frame.getByRole('button', { name: 'Publicar', exact: true }).click();
    await frame.getByText('Publicar ahora', { exact: true }).click();
  };
  await frame.getByLabel('Identificador').first().fill('');
  await frame.getByLabel('Identificador').first().fill('otro-id');
  assert.equal(await frame.getByLabel('Identificador').first().inputValue(), 'otro-id');
  // Pinned Decap shows a toast and also rejects the publish action's promise
  // when a preSave validator throws. Capture that expected rejection only.
  const validationRejection = page.waitForEvent('pageerror');
  await publish();
  await frame.getByText(/El identificador cambió\. Vuelve a importar/).first().waitFor();
  assert.equal((await validationRejection).message, 'Uncaught (in promise) #<Object>');
  assert.equal(pageErrors.length, 1);
  pageErrors.length = 0;
  assert.equal(requests.filter(r => r.method !== 'GET' && r.p !== '/sesion').length, 0);
  await frame.getByLabel('Identificador').first().fill('');
  await frame.getByLabel('Identificador').first().fill('prueba-ig');
  assert.equal(await frame.getByLabel('Identificador').first().inputValue(), 'prueba-ig');
  await publish();
  const deadline = Date.now() + 15000;
  while (!requests.some(r => r.method === 'PATCH') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const tree = requests.find(r => r.method === 'POST' && r.p.endsWith('/git/trees'))?.body.tree;
  assert.ok(tree, 'save creates a Git tree: ' + JSON.stringify(requests.map(r => [r.method, r.p])) + '\n' +
    await page.locator('#cms').evaluate(el => el.contentDocument.body.innerText.slice(0, 1400)));
  assert.equal(tree.length, 3, 'one event JSON and two images');
  const eventFile = tree.find(file => file.path === 'data/eventos/prueba-ig.json');
  const blob = requests.find(r => r.response?.sha === eventFile.sha).body;
  const event = JSON.parse(Buffer.from(blob.content, 'base64').toString());
  assert.match(event.imagen, /^assets\/eventos\/prueba-ig\/ig-111-.*\.png$/);
  assert.match(event.galeria[0], /^assets\/eventos\/prueba-ig\/ig-222-.*\.png$/);
  assert.equal(event.detalle, 'Descripción importada');
  assert.equal(event.instagram, 'https://www.instagram.com/p/fixture/');
  assert.ok([event.imagen, ...event.galeria].every(file => tree.some(node => node.path === file)));
  assert.equal(requests.filter(r => r.method === 'POST' && r.p.endsWith('/git/commits')).length, 1);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
  assert.deepEqual(pageErrors, []);
});

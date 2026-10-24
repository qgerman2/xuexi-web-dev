/* Real Cloudflare workerd runtime, mocked upstream services. Requires miniflare.
 * Node fetch accepts options (e.g. redirect: 'error') that workerd rejects,
 * so the unit suite alone cannot catch every deployment incompatibility.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Miniflare, createFetchMock } = require('miniflare');
const path = require('node:path');

test('workerd refreshes into KV, serves image bytes and rejects CDN redirects', async t => {
  const mock = createFetchMock();
  mock.disableNetConnect();
  mock.get('https://identitytoolkit.googleapis.com').intercept({ path: /./, method: 'POST' })
    .reply(200, JSON.stringify({ users: [{ localId: 'fixture' }] })).persist();
  mock.get('https://firestore.googleapis.com').intercept({ path: /./ })
    .reply(200, JSON.stringify({ fields: { rol: { stringValue: 'admin' } } })).persist();
  mock.get('https://graph.instagram.com').intercept({
    path: '/refresh_access_token?grant_type=ig_refresh_token&access_token=fixture-bootstrap'
  }).reply(200, JSON.stringify({ access_token: 'fixture-renewed', expires_in: 5184000 }));
  // This mock only matches when the HTTP handler reads the refreshed token.
  mock.get('https://graph.instagram.com').intercept({
    path: /\/v25\.0\/me\/media\?/, headers: { authorization: 'Bearer fixture-renewed' }
  }).reply(200, JSON.stringify({ data: [
    { id: '1', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/image.jpg' },
    { id: '2', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/redirect.jpg' }
  ] })).persist();
  const image = Buffer.from([255, 216, 255, 1, 2, 3]);
  mock.get('https://scontent.cdninstagram.com').intercept({ path: '/image.jpg' })
    .reply(200, image, { headers: { 'Content-Type': 'image/jpeg' } });
  mock.get('https://scontent.cdninstagram.com').intercept({ path: '/redirect.jpg' })
    .reply(302, '', { headers: { Location: 'https://untrusted.example/image.jpg' } });
  const mf = new Miniflare({
    modules: true, scriptPath: path.resolve(__dirname, '../admin/instagram-worker.js'),
    compatibilityDate: '2026-07-30', cf: false, kvNamespaces: ['IG_TOKEN_KV'], fetchMock: mock,
    bindings: {
      IG_ACCESS_TOKEN: 'fixture-bootstrap', FIREBASE_API_KEY: 'fixture', FIREBASE_PROYECTO: 'fixture'
    }
  });
  t.after(() => mf.dispose());
  const scheduled = await (await mf.getWorker()).scheduled({ cron: '0 9 * * *' });
  assert.equal(scheduled.outcome, 'ok');
  const kv = await mf.getKVNamespace('IG_TOKEN_KV');
  const saved = await kv.get('instagram:token', 'json');
  assert.equal(saved.accessToken, 'fixture-renewed');
  assert.equal(saved.expiresAt - saved.refreshedAt, 5184000 * 1000);
  const options = { headers: { Authorization: 'Bearer fixture-firebase', Origin: 'https://xuexiclub.cl' } };
  const response = await mf.dispatchFetch('https://ig.example/instagram/media/1', options);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://xuexiclub.cl');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  const redirect = await mf.dispatchFetch('https://ig.example/instagram/media/2', options);
  assert.equal(redirect.status, 502);
  assert.match((await redirect.json()).error, /No se pudo descargar la imagen/);
  mock.assertNoPendingInterceptors();
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');

const source = readFileSync(require('node:path').join(__dirname, '../admin/instagram-worker.js'));
const workerPromise = import('data:text/javascript;base64,' + source.toString('base64'));
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 24, 9);
const hash = token => createHash('sha256').update(token).digest('hex');
const record = (age = 8 * DAY, remaining = 52 * DAY) => ({
  accessToken: 'stored-token', seedHash: hash('bootstrap-token'),
  refreshedAt: NOW - age, expiresAt: NOW + remaining
});

function fixture(t, saved = null) {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(console, 'info', () => {});
  let state = saved;
  const writes = [];
  let reads = 0;
  const env = {
    IG_ACCESS_TOKEN: 'bootstrap-token', FIREBASE_API_KEY: 'test-key', FIREBASE_PROYECTO: 'test-project',
    IG_TOKEN_KV: {
      async get(key, type) {
        assert.equal(key, 'instagram:token');
        assert.equal(type, 'json');
        reads++;
        return state;
      },
      async put(...args) {
        writes.push(args);
        state = JSON.parse(args[1]);
      }
    }
  };
  return { env, writes, state: () => state, reads: () => reads };
}

test('first scheduled refresh persists token, expiry and bootstrap fingerprint without a TTL', async t => {
  const { default: worker } = await workerPromise;
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin + url.pathname, 'https://graph.instagram.com/refresh_access_token');
    assert.equal(url.searchParams.get('grant_type'), 'ig_refresh_token');
    assert.equal(url.searchParams.get('access_token'), 'bootstrap-token');
    assert.equal(options.redirect, 'manual');
    return Response.json({ access_token: 'renewed-token', expires_in: 60 * DAY / 1000 });
  });
  await worker.scheduled({}, f.env);
  assert.deepEqual(f.state(), {
    accessToken: 'renewed-token', seedHash: hash('bootstrap-token'),
    refreshedAt: NOW, expiresAt: NOW + 60 * DAY
  });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].length, 2);
});

test('fresh tokens skip refresh, including tokens younger than 24 hours', async t => {
  const { default: worker } = await workerPromise;
  for (const saved of [record(6 * DAY), record(DAY / 2, DAY)]) {
    const f = fixture(t, saved);
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected refresh'); });
    await worker.scheduled({}, f.env);
    assert.equal(f.writes.length, 0);
  }
});

test('refreshes the persisted token weekly or early when approaching expiry', async t => {
  const { default: worker } = await workerPromise;
  for (const saved of [record(7 * DAY), record(2 * DAY, 6 * DAY)]) {
    const f = fixture(t, saved);
    t.mock.method(globalThis, 'fetch', async url => {
      assert.equal(url.searchParams.get('access_token'), 'stored-token');
      return Response.json({ access_token: 'next-token', expires_in: 5184000 });
    });
    await worker.scheduled({}, f.env);
    assert.equal(f.state().accessToken, 'next-token');
  }
});

test('changing the bootstrap secret replaces old persisted credentials', async t => {
  const { default: worker } = await workerPromise;
  const f = fixture(t, record(70 * DAY, -DAY));
  f.env.IG_ACCESS_TOKEN = 'replacement-bootstrap';
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.searchParams.get('access_token'), 'replacement-bootstrap');
    return Response.json({ access_token: 'replacement-renewed', expires_in: 5184000 });
  });
  await worker.scheduled({}, f.env);
  assert.equal(f.state().seedHash, hash('replacement-bootstrap'));
});

test('upstream failures preserve credentials and do not expose tokens in errors', async t => {
  const { default: worker } = await workerPromise;
  for (const respond of [
    async () => new Response('stored-token', { status: 400 }),
    async () => { throw new Error('https://example.com/?access_token=stored-token'); },
    async () => new Response('not JSON'),
    async () => Response.json({ access_token: 'bad-token', expires_in: 0 })
  ]) {
    const saved = record();
    const f = fixture(t, saved);
    t.mock.method(globalThis, 'fetch', respond);
    await assert.rejects(worker.scheduled({}, f.env), error => {
      assert.doesNotMatch(error.message, /stored-token|bad-token|access_token=/);
      return true;
    });
    assert.equal(f.state(), saved);
    assert.equal(f.writes.length, 0);
  }
});

test('expired credentials and missing storage fail explicitly without upstream requests', async t => {
  const { default: worker } = await workerPromise;
  const f = fixture(t, record(61 * DAY, -DAY));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  await assert.rejects(worker.scheduled({}, f.env), /Reemplaza IG_ACCESS_TOKEN/);
  delete f.env.IG_TOKEN_KV;
  await assert.rejects(worker.scheduled({}, f.env), /IG_TOKEN_KV/);
});

test('KV write failures mark a scheduled run failed', async t => {
  const { default: worker } = await workerPromise;
  const f = fixture(t);
  f.env.IG_TOKEN_KV.put = async () => { throw new Error('private diagnostic'); };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ access_token: 'next', expires_in: 5184000 }));
  await assert.rejects(worker.scheduled({}, f.env), /No se pudo guardar/);
});

test('post requests use refreshed credentials only after verifying current admin role', async t => {
  const { default: worker } = await workerPromise;
  const f = fixture(t, record());
  let role = 'admin';
  let mediaCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    url = String(url);
    if (url.includes('accounts:lookup')) return Response.json({ users: [{ localId: 'user' }] });
    if (url.includes('firestore.googleapis.com')) return Response.json({ fields: { rol: { stringValue: role } } });
    assert.match(url, /graph\.instagram\.com\/v25\.0\/me\/media/);
    assert.equal(options.headers.Authorization, 'Bearer stored-token');
    mediaCalls++;
    return Response.json({ data: [{ id: '1', secret: 'omit' }], paging: { next: 'token' } });
  });
  const request = () => new Request('https://ig.example/instagram/posts', {
    headers: { Authorization: 'Bearer firebase-token' }
  });
  let response = await worker.fetch(request(), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [{ id: '1' }] });
  role = 'miembro';
  response = await worker.fetch(request(), f.env);
  assert.equal(response.status, 403);
  response = await worker.fetch(new Request('https://ig.example/instagram/posts'), f.env);
  assert.equal(response.status, 401);
  assert.equal(mediaCalls, 1);
  assert.equal(f.reads(), 1);
});

test('image download verifies admin and account ownership and returns binary with CORS', async t => {
  const { default: worker } = await workerPromise;
  const f = fixture(t, record());
  let role = 'admin';
  let cdnCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    url = String(url);
    if (url.includes('accounts:lookup')) return Response.json({ users: [{ localId: 'user' }] });
    if (url.includes('firestore.googleapis.com')) return Response.json({ fields: { rol: { stringValue: role } } });
    if (url.includes('/me/media')) return Response.json({ data: [{
      id: '1', media_type: 'CAROUSEL_ALBUM', children: { data: [
        { id: '2', media_type: 'IMAGE', media_url: 'https://scontent.example.fbcdn.net/photo.jpg' },
        { id: '3', media_type: 'VIDEO', media_url: 'https://scontent.example.fbcdn.net/video.mp4' }
      ] }
    }] });
    assert.equal(url, 'https://scontent.example.fbcdn.net/photo.jpg');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers, undefined, 'never forward credentials to CDN');
    cdnCalls++;
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const request = id => new Request('https://ig.example/instagram/media/' + id, {
    headers: { Authorization: 'Bearer firebase', Origin: 'https://xuexiclub.cl' }
  });
  const response = await worker.fetch(request('2'), f.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://xuexiclub.cl');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  for (const id of ['3', '99']) assert.equal((await worker.fetch(request(id), f.env)).status, 404);
  role = 'miembro';
  assert.equal((await worker.fetch(request('2'), f.env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://ig.example/instagram/media/2'), f.env)).status, 401);
  assert.equal(cdnCalls, 1);
});

test('download rejects arbitrary destinations, unsafe types and oversized streams', async t => {
  const { default: worker } = await workerPromise;
  const f = fixture(t, record());
  let destination = 'https://evil.example/image.jpg';
  let contentType = 'image/jpeg';
  let size = 3;
  let cdnCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    url = String(url);
    if (url.includes('accounts:lookup')) return Response.json({ users: [{ localId: 'user' }] });
    if (url.includes('firestore.googleapis.com')) return Response.json({ fields: { rol: { stringValue: 'admin' } } });
    if (url.includes('/me/media')) return Response.json({ data: [{ id: '2', media_type: 'IMAGE', media_url: destination }] });
    cdnCalls++;
    return new Response(new Uint8Array(size), { headers: { 'Content-Type': contentType } });
  });
  const request = () => new Request('https://ig.example/instagram/media/2', { headers: { Authorization: 'Bearer firebase' } });
  for (const url of ['https://evil.example/image.jpg', 'http://scontent.fbcdn.net/a', 'https://fbcdn.net.evil.example/a', 'https://scontent.fbcdn.net:8443/a']) {
    destination = url;
    assert.equal((await worker.fetch(request(), f.env)).status, 502);
  }
  assert.equal(cdnCalls, 0);
  destination = 'https://scontent.fbcdn.net/image.jpg';
  contentType = 'text/html';
  assert.equal((await worker.fetch(request(), f.env)).status, 502);
  contentType = 'image/jpeg';
  size = 20 * 1024 * 1024 + 1;
  assert.equal((await worker.fetch(request(), f.env)).status, 502);
});

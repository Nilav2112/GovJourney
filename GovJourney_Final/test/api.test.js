const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const base = 'http://127.0.0.1:3101';
let server;

async function request(pathname, options = {}) {
  const response = await fetch(base + pathname, options);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test.before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: '3101', JWT_SECRET: 'test-secret', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 5000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('GovJourney running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('error', reject);
  });
});

test.after(() => server?.kill());

test('health reports demo mode', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.database, 'demo-mode');
});

test('protected resources reject missing authentication', async () => {
  const { response } = await request('/api/journeys');
  assert.equal(response.status, 401);
});

test('registered user can create an owned journey and upload a vault document', async () => {
  const email = `test-${Date.now()}@example.com`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test Citizen', email, password: 'StrongPass123' })
  });
  assert.equal(registration.response.status, 201);
  const token = registration.body.token;
  const headers = { authorization: `Bearer ${token}` };

  const journey = await request('/api/journeys', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ eventId: 'new-job', answers: ['Yes'] })
  });
  assert.equal(journey.response.status, 201);

  const journeys = await request('/api/journeys', { headers });
  assert.equal(journeys.response.status, 200);
  assert.equal(journeys.body.journeys.length, 1);
  assert.equal(journeys.body.journeys[0].event_id, 'new-job');

  const form = new FormData();
  form.append('category', 'Employment');
  form.append('document', new Blob(['private test document'], { type: 'text/plain' }), 'test.txt');
  const upload = await request('/api/vault', { method: 'POST', headers, body: form });
  assert.equal(upload.response.status, 201);
  assert.equal(upload.body.document.name, 'test.txt');
  assert.ok(upload.body.document.checksum);
});

test('chat response includes an official source for the pilot journey', async () => {
  const result = await request('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Starting a New Job' })
  });
  assert.equal(result.response.status, 200);
  assert.match(result.body.reply, /Starting a New Job/);
  assert.ok(result.body.sources.length > 0);
});

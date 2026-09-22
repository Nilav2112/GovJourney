const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const multer = require('multer');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const VAULT_KEY = crypto.createHash('sha256').update(process.env.VAULT_ENCRYPTION_KEY || JWT_SECRET).digest();
const DIGILOCKER_CLIENT_ID = process.env.DIGILOCKER_CLIENT_ID || '';
const DIGILOCKER_REDIRECT_URI = process.env.DIGILOCKER_REDIRECT_URI || `http://localhost:${PORT}/api/digilocker/callback`;
const DIGILOCKER_AUTH_URL = process.env.DIGILOCKER_AUTH_URL || 'https://digilocker.gov.in/oauth2/1/authorize';
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
}) : null;

const inMemoryUsers = [];
const inMemoryJourneys = [];
const inMemoryReminders = [];
const inMemoryVault = [];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const DEFAULT_EVENTS = [
  {
    id: 'marriage',
    slug: 'marriage',
    name: 'Marriage',
    category: 'Family',
    icon: 'marriage',
    description: 'Register your marriage and update identity, address and related records.',
    duration: '2–4 weeks',
    documents: ['Identity proof for both partners', 'Address proof', 'Age proof', 'Passport-size photos', 'Marriage certificate'],
    steps: [
      { title: 'Verify identity and address', desc: 'Prepare the required personal records and proof.', dept: 'Sub-Registrar Office' },
      { title: 'Book or visit the Sub-Registrar office', desc: 'Submit the application and complete the date booking.', dept: 'Sub-Registrar Office' },
      { title: 'Submit marriage registration', desc: 'Provide the documents and complete the legal procedure.', dept: 'Sub-Registrar Office' },
      { title: 'Collect marriage certificate', desc: 'Store the official certificate and keep a copy on file.', dept: 'Sub-Registrar Office' },
      { title: 'Update Aadhaar and related records', desc: 'Sync downstream identity records as needed.', dept: 'UIDAI' }
    ],
    departments: ['Sub-Registrar Office', 'UIDAI', 'Income Tax Department', 'Passport Seva'],
    portal: ['Sub-Registrar Office', 'https://services.ecourts.gov.in/'],
    questions: ['Is this related to marriage?', 'Do you already have the basic documents?', 'Do you need help finding the relevant office?', 'Would you like reminders for this journey?']
  },
  {
    id: 'new-job',
    slug: 'new-job',
    name: 'Starting a New Job',
    category: 'Employment',
    icon: 'work',
    description: 'Prepare employment records, tax, social-security and address updates.',
    duration: '1–4 weeks',
    documents: ['Offer/appointment letter', 'PAN card', 'Aadhaar card', 'Bank details'],
    steps: [
      { title: 'Submit joining documents', desc: 'Share your identity, bank and employment information.', dept: 'Employer HR' },
      { title: 'Verify PAN and Aadhaar details', desc: 'Ensure your official records are consistent.', dept: 'Income Tax Department' },
      { title: 'Set up salary bank details', desc: 'Link your compensation account to your employee profile.', dept: 'Bank' },
      { title: 'Check EPF and UAN information', desc: 'Review the social security setup for onboarding.', dept: 'EPFO' },
      { title: 'Update nominee details', desc: 'Complete the required beneficiary records.', dept: 'Employer HR' }
    ],
    departments: ['Employer HR', 'EPFO', 'Income Tax Department', 'Bank'],
    portal: ['EPFO', 'https://www.epfindia.gov.in/'],
    questions: ['Is this related to starting a new job?', 'Do you already have the basic documents?', 'Do you need help finding the relevant office?', 'Would you like reminders for this journey?']
    ,sources: [
      ['EPFO onboarding and UAN', 'https://www.epfindia.gov.in/site_en/For_Employees.php'],
      ['Income Tax PAN services', 'https://www.incometax.gov.in/iec/foportal/']
    ],
    last_verified_at: '2026-09-22'
  },
  {
    id: 'passport',
    slug: 'passport',
    name: 'Passport & Travel',
    category: 'Travel',
    icon: 'passport',
    description: 'Prepare passport applications, updates and supporting documents.',
    duration: '2–8 weeks',
    documents: ['Aadhaar or passport ID', 'Address proof', 'Birth or age proof', 'Photograph'],
    steps: [
      { title: 'Check passport requirement', desc: 'Confirm the application type and category.', dept: 'Passport Seva' },
      { title: 'Prepare application', desc: 'Collect the necessary identity and address documents.', dept: 'Passport Seva' },
      { title: 'Book appointment', desc: 'Schedule your application and verification slot.', dept: 'Passport Seva' },
      { title: 'Attend verification', desc: 'Visit the passport office with originals and copies.', dept: 'Passport Seva' },
      { title: 'Track passport status', desc: 'Monitor the progress online and keep the acknowledgement safe.', dept: 'Passport Seva' }
    ],
    departments: ['Passport Seva', 'Police Department'],
    portal: ['Passport Seva', 'https://www.passportindia.gov.in/'],
    questions: ['Is this related to passport and travel?', 'Do you already have the basic documents?', 'Do you need help finding the relevant office?', 'Would you like reminders for this journey?']
  }
];

function normalizeEvent(row) {
  return {
    id: row.slug || row.id,
    slug: row.slug || row.id,
    name: row.name,
    category: row.category,
    icon: row.icon || 'documents',
    description: row.description || '',
    duration: row.duration || 'Flexible',
    documents: Array.isArray(row.documents) ? row.documents : [],
    steps: Array.isArray(row.steps) ? row.steps : [],
    departments: Array.isArray(row.departments) ? row.departments : [],
    portal: Array.isArray(row.portal) ? row.portal : ['Official portal', 'https://www.india.gov.in/'],
    questions: Array.isArray(row.questions) ? row.questions : []
    ,sources: Array.isArray(row.sources) ? row.sources : []
    ,last_verified_at: row.last_verified_at || null
  };
}

async function runQuery(sql, params = []) {
  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }
  return pool.query(sql, params);
}

async function initializeDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL not set. Running in demo mode without PostgreSQL persistence.');
    if (!getDemoUser('demo@govjourney.com')) {
      inMemoryUsers.push({
        id: 1,
        name: 'Demo Citizen',
        email: 'demo@govjourney.com',
        mobile: '9900000000',
        password_hash: hashPassword('Demo@123'),
        role: 'user',
        language: 'en'
      });
    }
    return;
  }

  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await runQuery(schemaSql);
    await runQuery("ALTER TABLE life_events ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]'; ALTER TABLE life_events ADD COLUMN IF NOT EXISTS last_verified_at DATE; ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS checksum VARCHAR(128);");
    const result = await runQuery('SELECT COUNT(*)::int AS count FROM life_events');
    if (result.rows[0].count === 0) {
      const inserts = DEFAULT_EVENTS.map((event, idx) => {
        return runQuery(
          `INSERT INTO life_events (slug, name, category, icon, description, duration, documents, steps, departments, portal, questions, sources, last_verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            event.slug,
            event.name,
            event.category,
            event.icon,
            event.description,
            event.duration,
            JSON.stringify(event.documents),
            JSON.stringify(event.steps),
            JSON.stringify(event.departments),
            JSON.stringify(event.portal),
            JSON.stringify(event.questions),
            JSON.stringify(event.sources || []),
            event.last_verified_at || null
          ]
        );
      });
      await Promise.all(inserts);
    }
    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Database initialization failed:', error.message);
  }
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function createToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role || 'user' }, JWT_SECRET, { expiresIn: '8h' });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, mobile: user.mobile, language: user.language, role: user.role };
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

function ownUserId(req) {
  return Number(req.auth.sub);
}

function requireAdmin(req, res, next) {
  if (req.auth.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  next();
}

function getDemoUser(email) {
  return inMemoryUsers.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
}

async function getEventsFromDb() {
  if (!pool) {
    return DEFAULT_EVENTS.map((event) => normalizeEvent(event));
  }

  const result = await runQuery('SELECT * FROM life_events ORDER BY id');
  return result.rows.map((row) => normalizeEvent({
    ...row,
    documents: row.documents || [],
    steps: row.steps || [],
    departments: row.departments || [],
    portal: row.portal || ['Official portal', 'https://www.india.gov.in/'],
    questions: row.questions || []
  }));
}

function buildChatReply(message, events = DEFAULT_EVENTS) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return 'Please choose a life event to get a personalized government action plan.';
  }
  const event = events.find((item) => `${item.name} ${item.description}`.toLowerCase().includes(text));
  if (event) {
    const source = event.sources?.[0]?.[1] || event.portal?.[1];
    return `${event.name}: ${event.description} Start with ${event.steps?.[0]?.title || 'the first listed step'}. Source: ${source || 'official portal linked in the journey.'}`;
  }
  if (text.includes('document')) {
    return 'Open Documents to manage your checklist and local digital vault.';
  }
  if (text.includes('office')) {
    return 'Open Office Locator to search departments and map directions.';
  }
  if (text.includes('reminder')) {
    return 'Open Reminders to create a deadline and export an .ics calendar file.';
  }
  return 'Open Life Events and choose the closest match. I can guide you through documents, departments and next steps.';
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'GovJourney', version: '2.0.0', database: pool ? 'postgres' : 'demo-mode' });
});

app.get('/api/config', (req, res) => {
  res.json({ googleMapsConfigured: !!process.env.GOOGLE_MAPS_API_KEY, databaseConfigured: !!DATABASE_URL, digilockerConfigured: !!DIGILOCKER_CLIENT_ID });
});

app.get('/api/events', async (req, res) => {
  try {
    const events = await getEventsFromDb();
    res.json({ source: pool ? 'postgres' : 'demo', events });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load life events', message: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const message = String(req.body.message || '');
  const events = await getEventsFromDb();
  const reply = buildChatReply(message, events);
  res.json({ reply, sources: events.filter((event) => message.toLowerCase().includes(event.name.toLowerCase().split(' ')[0])).flatMap((event) => event.sources || [event.portal]).slice(0, 3) });
});

app.get('/api/digilocker/status', requireAuth, (req, res) => {
  res.json({ configured: !!DIGILOCKER_CLIENT_ID, connected: false, message: DIGILOCKER_CLIENT_ID ? 'DigiLocker connection is ready for OAuth.' : 'Add approved DigiLocker partner credentials to enable document sync.' });
});

app.get('/api/digilocker/connect', requireAuth, (req, res) => {
  if (!DIGILOCKER_CLIENT_ID) return res.status(503).json({ error: 'DigiLocker sync is not configured. Open DigiLocker directly or add approved partner credentials.' });
  const state = jwt.sign({ sub: String(req.auth.sub), purpose: 'digilocker' }, JWT_SECRET, { expiresIn: '10m' });
  const url = new URL(DIGILOCKER_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', DIGILOCKER_CLIENT_ID);
  url.searchParams.set('redirect_uri', DIGILOCKER_REDIRECT_URI);
  url.searchParams.set('state', state);
  res.json({ url: url.toString() });
});

app.get('/api/digilocker/callback', (req, res) => {
  res.send('<!doctype html><title>DigiLocker connection</title><p>DigiLocker authorization received. Configure the official token exchange and document APIs to complete syncing.</p><script>window.close()</script>');
});

app.get('/api/digilocker/documents', requireAuth, (req, res) => {
  res.status(503).json({ error: 'DigiLocker document sync requires approved partner API credentials and a completed OAuth token exchange.' });
});

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const mobile = String(req.body.mobile || '').trim();
  const password = String(req.body.password || '');

  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return res.status(400).json({ error: 'Name, valid email and password (8+ chars) are required.' });
  }

  try {
    if (!pool) {
      const existing = getDemoUser(email);
      if (existing) {
        return res.status(409).json({ error: 'Account already exists.' });
      }
      const user = { id: Date.now(), name, email, mobile, password_hash: hashPassword(password), role: 'user', language: 'en' };
      inMemoryUsers.push(user);
      return res.status(201).json({ user: publicUser(user), token: createToken(user) });
    }

    const existing = await runQuery('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Account already exists.' });
    }

    const result = await runQuery(
      `INSERT INTO users (name, email, mobile, password_hash, language, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, mobile, language, role`,
      [name, email, mobile, hashPassword(password), 'en', 'user']
    );

    res.status(201).json({ user: publicUser(result.rows[0]), token: createToken(result.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed', message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  try {
    if (!pool) {
      const user = getDemoUser(email);
      if (!user || !comparePassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      return res.json({ user: publicUser(user), token: createToken(user) });
    }

    const result = await runQuery('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    const user = result.rows[0];
    if (!user || !comparePassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    res.json({ user: publicUser(user), token: createToken(user) });
  } catch (error) {
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

app.get('/api/journeys', requireAuth, async (req, res) => {
  try {
    if (!pool) {
      return res.json({ journeys: inMemoryJourneys.filter((journey) => journey.user_id === ownUserId(req)) });
    }

    const userId = ownUserId(req);
    const query = 'SELECT * FROM journeys WHERE user_id = $1 ORDER BY created_at DESC';
    const values = [userId];
    const { rows } = await runQuery(query, values);
    res.json({ journeys: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load journeys', message: error.message });
  }
});

app.post('/api/journeys', requireAuth, async (req, res) => {
  const { eventId, status = 'active', completed_steps = [], answers = [] } = req.body || {};
  if (!eventId || !Array.isArray(completed_steps) || !Array.isArray(answers)) return res.status(400).json({ error: 'A valid event and journey arrays are required.' });

  try {
    if (!pool) {
      const journey = { id: Date.now(), user_id: ownUserId(req), event_id: eventId, status, completed_steps, answers, created_at: new Date().toISOString() };
      inMemoryJourneys.push(journey);
      return res.status(201).json({ journey });
    }

    const result = await runQuery(
      `INSERT INTO journeys (user_id, event_id, completed_steps, answers, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ownUserId(req), eventId, JSON.stringify(completed_steps), JSON.stringify(answers), status]
    );
    res.status(201).json({ journey: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save journey', message: error.message });
  }
});

app.put('/api/journeys/:id', requireAuth, async (req, res) => {
  const { completed_steps = [], answers, status } = req.body || {};

  try {
    if (!pool) {
      const journey = inMemoryJourneys.find((item) => item.id === Number(req.params.id) && item.user_id === ownUserId(req));
      if (!journey) return res.status(404).json({ error: 'Journey not found.' });
      journey.completed_steps = completed_steps;
      if (answers) journey.answers = answers;
      if (status) journey.status = status;
      journey.updated_at = new Date().toISOString();
      return res.json({ journey });
    }

    const result = await runQuery(
      `UPDATE journeys
       SET completed_steps = $1, answers = COALESCE($2, answers), status = COALESCE($3, status), updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [JSON.stringify(completed_steps), answers ? JSON.stringify(answers) : null, status || null, Number(req.params.id), ownUserId(req)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Journey not found.' });
    res.json({ journey: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update journey', message: error.message });
  }
});

app.get('/api/reminders', requireAuth, async (req, res) => {
  try {
    if (!pool) {
      return res.json({ reminders: inMemoryReminders.filter((reminder) => reminder.user_id === ownUserId(req)) });
    }

    const userId = ownUserId(req);
    const query = 'SELECT * FROM reminders WHERE user_id = $1 ORDER BY due_at ASC';
    const values = [userId];
    const { rows } = await runQuery(query, values);
    res.json({ reminders: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load reminders', message: error.message });
  }
});

app.post('/api/reminders', requireAuth, async (req, res) => {
  const { title, due_at, notes = '' } = req.body || {};

  if (!title || !due_at) {
    return res.status(400).json({ error: 'Reminder title and due date are required.' });
  }

  try {
    if (!pool) {
      const reminder = { id: Date.now(), user_id: ownUserId(req), title, due_at, notes, created_at: new Date().toISOString() };
      inMemoryReminders.push(reminder);
      return res.status(201).json({ reminder });
    }

    const result = await runQuery(
      `INSERT INTO reminders (user_id, title, due_at, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [ownUserId(req), title, due_at, notes]
    );
    res.status(201).json({ reminder: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create reminder', message: error.message });
  }
});

app.delete('/api/reminders/:id', requireAuth, async (req, res) => {
  try {
    if (!pool) {
      const index = inMemoryReminders.findIndex((item) => item.id === Number(req.params.id) && item.user_id === ownUserId(req));
      if (index < 0) return res.status(404).json({ error: 'Reminder not found.' });
      inMemoryReminders.splice(index, 1);
      return res.status(204).end();
    }

    const result = await runQuery('DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id', [Number(req.params.id), ownUserId(req)]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Reminder not found.' });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete reminder', message: error.message });
  }
});

app.get('/api/vault', requireAuth, async (req, res) => {
  try {
    if (!pool) return res.json({ documents: inMemoryVault.filter((document) => document.user_id === ownUserId(req)).map(({ encrypted, ...document }) => document) });
    const { rows } = await runQuery('SELECT id, category, name, mime_type, size_bytes, checksum, created_at FROM vault_documents WHERE user_id = $1 ORDER BY created_at DESC', [ownUserId(req)]);
    res.json({ documents: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load documents', message: error.message });
  }
});

app.post('/api/vault', requireAuth, upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A document file is required.' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(req.file.buffer), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  const checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

  try {
    if (!pool) {
      const document = { id: Date.now(), user_id: ownUserId(req), category: req.body.category || 'Other', name: req.file.originalname, mime_type: req.file.mimetype, size_bytes: req.file.size, checksum, encrypted: payload.toString('base64'), created_at: new Date().toISOString() };
      inMemoryVault.push(document);
      const { encrypted: ignored, ...publicDocument } = document;
      return res.status(201).json({ document: publicDocument });
    }

    const storageDir = path.join(__dirname, '..', 'vault-storage');
    fs.mkdirSync(storageDir, { recursive: true });
    const storagePath = path.join(storageDir, `${crypto.randomUUID()}.bin`);
    fs.writeFileSync(storagePath, payload);
    const result = await runQuery(
      `INSERT INTO vault_documents (user_id, category, name, mime_type, size_bytes, storage_path, checksum)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, category, name, mime_type, size_bytes, checksum, created_at`,
      [ownUserId(req), req.body.category || 'Other', req.file.originalname, req.file.mimetype, req.file.size, storagePath, checksum]
    );
    res.status(201).json({ document: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to store document', message: error.message });
  }
});

app.delete('/api/vault/:id', requireAuth, async (req, res) => {
  try {
    if (!pool) {
      const index = inMemoryVault.findIndex((document) => document.id === Number(req.params.id) && document.user_id === ownUserId(req));
      if (index < 0) return res.status(404).json({ error: 'Document not found.' });
      inMemoryVault.splice(index, 1);
      return res.status(204).end();
    }
    const result = await runQuery('DELETE FROM vault_documents WHERE id = $1 AND user_id = $2 RETURNING storage_path', [Number(req.params.id), ownUserId(req)]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Document not found.' });
    if (result.rows[0].storage_path) fs.rmSync(result.rows[0].storage_path, { force: true });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document', message: error.message });
  }
});

app.post('/api/admin/events', requireAuth, requireAdmin, async (req, res) => {
  const event = req.body || {};
  if (!event.slug || !event.name || !event.category) return res.status(400).json({ error: 'Slug, name and category are required.' });
  try {
    if (!pool) return res.status(503).json({ error: 'Admin event persistence requires PostgreSQL.' });
    const result = await runQuery(
      `INSERT INTO life_events (slug, name, category, icon, description, duration, documents, steps, departments, portal, questions, sources, last_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [event.slug, event.name, event.category, event.icon || 'documents', event.description || '', event.duration || 'Flexible', JSON.stringify(event.documents || []), JSON.stringify(event.steps || []), JSON.stringify(event.departments || []), JSON.stringify(event.portal || []), JSON.stringify(event.questions || []), JSON.stringify(event.sources || []), event.last_verified_at || null]
    );
    res.status(201).json({ event: normalizeEvent(result.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create event', message: error.message });
  }
});

app.delete('/api/admin/events/:slug', requireAuth, requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Admin event persistence requires PostgreSQL.' });
  const result = await runQuery('DELETE FROM life_events WHERE slug = $1 RETURNING id', [req.params.slug]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Event not found.' });
  res.status(204).end();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => console.log(`GovJourney running at http://localhost:${PORT}`));
}

startServer();


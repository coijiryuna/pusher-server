/**
 * Pusher Admin Dashboard — Backend API
 * Express API (standalone, no static serving)
 * JWT Auth + user-scoped apps
 */

const express = require('express');
const mysql   = require('mysql2/promise');
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const os      = require('os');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

/* ── Config ── */
const CONFIG_PATH = path.join(__dirname, 'config.json');
const JWT_SECRET  = process.env.JWT_SECRET || 'pusher-dash-secret-change-in-prod';

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/* ── MySQL Pool ── */
let pool = null;

function createPool(cfg) {
  if (cfg['appManager.driver'] !== 'mysql') return null;
  return mysql.createPool({
    host:     cfg['appManager.mysql.host']     || 'localhost',
    port:     cfg['appManager.mysql.port']     || 3306,
    user:     cfg['appManager.mysql.user']     || 'root',
    password: cfg['appManager.mysql.password'] || '',
    database: cfg['appManager.mysql.database'] || 'db_pusher',
    waitForConnections: true,
    connectionLimit: 5,
  });
}

function getPool() {
  if (!pool) {
    const cfg = readConfig();
    pool = createPool(cfg);
  }
  return pool;
}

/* ── JWT Middleware ── */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized — token required' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized — invalid token' });
  }
}

// Admin-only middleware
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden — admin only' });
  next();
}

/* ── Auth routes (public) ── */

// Helper: audit trail
async function audit(userId, action, target, detail) {
  try {
    const p = getPool();
    if (p) await p.query('INSERT INTO audit_logs (user_id, action, target, detail) VALUES (?, ?, ?, ?)',
      [userId, action, target || null, detail || null]);
  } catch {}
}

// POST /api/register
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password || !email)
    return res.status(400).json({ error: 'username, password, dan email wajib diisi' });
  if (username.length < 3) return res.status(400).json({ error: 'Username minimal 3 karakter' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });

  try {
    const p = getPool();
    if (!p) return res.status(503).json({ error: 'Database tidak tersedia' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await p.query(
      'INSERT INTO user (username, password, email, role) VALUES (?, ?, ?, ?)',
      [username, hash, email, 'operator']
    );
    const token = jwt.sign({ id: result.insertId, username, email, role: 'operator' }, JWT_SECRET, { expiresIn: '7d' });
    await audit(result.insertId, 'register', username, 'User baru mendaftar');
    res.status(201).json({ ok: true, token, user: { id: result.insertId, username, email, role: 'operator' } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username atau email sudah terdaftar' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username dan password wajib diisi' });

  try {
    const p = getPool();
    if (!p) return res.status(503).json({ error: 'Database tidak tersedia' });
    const [rows] = await p.query('SELECT * FROM user WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Username atau password salah' });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Username atau password salah' });

    // Check 2FA
    try {
      const [fa] = await p.query('SELECT enabled FROM user_2fa WHERE user_id = ?', [user.id]);
      if (fa.length && fa[0].enabled) {
        // Return tempToken (short-lived, only for 2FA verify)
        const tempToken = jwt.sign(
          { id: user.id, purpose: '2fa', username: user.username },
          JWT_SECRET,
          { expiresIn: '5m' }
        );
        return res.json({ ok: true, need2fa: true, tempToken, userId: user.id });
      }
    } catch {}

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role || 'operator' }, JWT_SECRET, { expiresIn: '7d' });
    await audit(user.id, 'login', username, 'Login berhasil');
    res.json({ ok: true, token, user: { id: user.id, username: user.username, email: user.email, role: user.role || 'operator' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/me
app.get('/api/me', authenticate, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// GET /api/users — admin only
app.get('/api/users', authenticate, adminOnly, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT id, username, email, role, created_at FROM user ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/role — admin only
app.patch('/api/users/:id/role', authenticate, adminOnly, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'operator'].includes(role)) return res.status(400).json({ error: 'Role harus admin atau operator' });
  try {
    const p = getPool();
    await audit(req.user.id, 'change_role', req.params.id, `Role diubah ke ${role}`);
    await p.query('UPDATE user SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ ok: true, message: `Role user #${req.params.id} diubah ke ${role}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/change-password — authenticated
app.post('/api/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'currentPassword dan newPassword wajib diisi' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'Password baru minimal 6 karakter' });

  try {
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM user WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    const match = await bcrypt.compare(currentPassword, rows[0].password);
    if (!match) return res.status(401).json({ error: 'Password saat ini salah' });
    const hash = await bcrypt.hash(newPassword, 10);
    await p.query('UPDATE user SET password = ? WHERE id = ?', [hash, req.user.id]);
    await audit(req.user.id, 'change_password', null, 'Password diubah');
    res.json({ ok: true, message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Status ── */
app.get('/api/status', async (req, res) => {
  const cfg = readConfig();
  try {
    const p = getPool();
    if (p) await p.query('SELECT 1');
    res.json({ ok: true, port: cfg.port || 6001, db: 'connected', driver: cfg['appManager.driver'] });
  } catch (err) {
    res.json({ ok: true, port: cfg.port || 6001, db: 'error', dbError: err.message, driver: cfg['appManager.driver'] });
  }
});

/* ── Config API (protected) ── */
app.get('/api/config', authenticate, (req, res) => {
  const cfg = readConfig();
  const safe = { ...cfg };
  if (safe['appManager.mysql.password']) safe['appManager.mysql.password'] = '***';
  res.json(safe);
});

app.put("/api/config", authenticate, async (req, res) => {
  try {
    const current = readConfig();
    const updated = { ...current, ...req.body };
    if (req.body["appManager.mysql.password"] === "***") {
      updated["appManager.mysql.password"] =
        current["appManager.mysql.password"];
    }
    writeConfig(updated);
    pool = null;
    await audit(
      req.user.id,
      "update_config",
      null,
      "Konfigurasi server diubah",
    );
    res.json({ ok: true, message: "Konfigurasi berhasil disimpan" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Apps API (protected, user-scoped) ── */

// GET all apps — filtered by user_id
app.get('/api/apps', authenticate, async (req, res) => {
  try {
    const p = getPool();
    if (!p) return res.json([]);
    const [rows] = await p.query('SELECT * FROM apps WHERE user_id = ? ORDER BY id ASC', [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single app
app.get('/api/apps/:id', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create app — linked to current user
app.post('/api/apps', authenticate, async (req, res) => {
  const { id, key, secret, cluster, max_connections, enable_client_messages,
          enabled, max_backend_events_per_sec, max_client_events_per_sec,
          max_read_req_per_sec, webhooks, ip_whitelist } = req.body;

  if (!id || !key || !secret) return res.status(400).json({ error: 'id, key, dan secret wajib diisi' });

  try {
    const p = getPool();
    await p.query(
      `INSERT INTO apps (id, \`key\`, secret, cluster, max_connections, enable_client_messages,
        enabled, max_backend_events_per_sec, max_client_events_per_sec, max_read_req_per_sec, webhooks, ip_whitelist, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, key, secret, cluster || 'appcluster',
       max_connections ?? -1, enable_client_messages ?? 0,
       enabled ?? 1,
       max_backend_events_per_sec ?? -1,
       max_client_events_per_sec ?? -1,
       max_read_req_per_sec ?? -1,
       webhooks || '[]',
       ip_whitelist || '[]',
       req.user.id]
    );
    await audit(req.user.id, 'create_app', id, 'Aplikasi baru dibuat');
    const [rows] = await p.query('SELECT * FROM apps WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'ID aplikasi sudah ada' });
    res.status(500).json({ error: err.message });
  }
});

// PUT update app
app.put('/api/apps/:id', authenticate, async (req, res) => {
  const { key, secret, cluster, max_connections, enable_client_messages,
          enabled, max_backend_events_per_sec, max_client_events_per_sec,
          max_read_req_per_sec, webhooks, ip_whitelist } = req.body;
  try {
    const p = getPool();
    const [existing] = await p.query('SELECT id FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!existing.length) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });

    await p.query(
      `UPDATE apps SET \`key\`=?, secret=?, cluster=?, max_connections=?,
        enable_client_messages=?, enabled=?, max_backend_events_per_sec=?,
        max_client_events_per_sec=?, max_read_req_per_sec=?, webhooks=?, ip_whitelist=?
       WHERE id=?`,
      [key, secret, cluster || 'appcluster',
       max_connections ?? -1, enable_client_messages ?? 0,
       enabled ?? 1,
       max_backend_events_per_sec ?? -1,
       max_client_events_per_sec ?? -1,
       max_read_req_per_sec ?? -1,
       webhooks || '[]',
       ip_whitelist || '[]',
       req.params.id]
    );
    const [rows] = await p.query('SELECT * FROM apps WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE app
app.delete('/api/apps/:id', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [result] = await p.query('DELETE FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    await audit(req.user.id, 'delete_app', req.params.id, 'Aplikasi dihapus');
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    res.json({ ok: true, message: `Aplikasi ${req.params.id} berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Toggle enabled ── */
app.patch('/api/apps/:id/toggle', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT enabled FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    const newStatus = rows[0].enabled ? 0 : 1;
    await p.query('UPDATE apps SET enabled = ? WHERE id = ?', [newStatus, req.params.id]);
    const action = newStatus ? 'enable_app' : 'disable_app';
    await audit(req.user.id, action, req.params.id, `App ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}`);
    res.json({ ok: true, enabled: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apps/:id/rotate-key — regenerate key & secret
app.post('/api/apps/:id/rotate-key', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT id FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    const crypto = require('crypto');
    const newKey    = crypto.randomBytes(16).toString('hex');
    const newSecret = crypto.randomBytes(24).toString('hex');
    await p.query('UPDATE apps SET `key` = ?, secret = ? WHERE id = ?', [newKey, newSecret, req.params.id]);
    await audit(req.user.id, 'rotate_key', req.params.id, 'Key & secret dirotasi');
    const [updated] = await p.query('SELECT * FROM apps WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apps/:id/duplicate — clone app with new id
app.post('/api/apps/:id/duplicate', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    const orig = rows[0];
    const crypto = require('crypto');
    const newId = orig.id + '-copy';
    await p.query(
      `INSERT INTO apps (id, \`key\`, secret, cluster, max_connections, enable_client_messages,
        enabled, max_backend_events_per_sec, max_client_events_per_sec, max_read_req_per_sec, webhooks, ip_whitelist, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, crypto.randomBytes(16).toString('hex'), crypto.randomBytes(24).toString('hex'),
       orig.cluster, orig.max_connections, orig.enable_client_messages, orig.enabled,
       orig.max_backend_events_per_sec, orig.max_client_events_per_sec, orig.max_read_req_per_sec,
       orig.webhooks, orig.ip_whitelist || '[]', req.user.id]
    );
    await audit(req.user.id, 'duplicate_app', req.params.id, `Di-duplicate ke ${newId}`);
    const [created] = await p.query('SELECT * FROM apps WHERE id = ?', [newId]);
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Duplicate sudah ada. Hapus dulu.' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apps/batch/toggle — batch enable/disable
app.post('/api/apps/batch/toggle', authenticate, async (req, res) => {
  const { ids, enabled } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'ids harus array tidak kosong' });
  try {
    const p = getPool();
    const placeholders = ids.map(() => '?').join(',');
    const [result] = await p.query(
      `UPDATE apps SET enabled = ? WHERE id IN (${placeholders}) AND user_id = ?`,
      [enabled ? 1 : 0, ...ids, req.user.id]
    );
    await audit(req.user.id, 'batch_toggle', `${ids.length} apps`, `Batch ${enabled ? 'aktifkan' : 'nonaktifkan'}`);
    res.json({ ok: true, affected: result.affectedRows, enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Notify / Trigger Event ── */
app.post('/api/notify', authenticate, async (req, res) => {
  const { appId, channels, channel, event, data, scheduleAt } = req.body;
  const chanList = channels || (channel ? [channel] : []);
  if (!appId || !chanList.length || !event) {
    return res.status(400).json({ error: 'appId, channels, dan event wajib diisi' });
  }

  try {
    let appData = null;
    const p = getPool();
    if (p) {
      const [rows] = await p.query('SELECT * FROM apps WHERE id = ? AND user_id = ?', [appId, req.user.id]);
      if (rows.length) appData = rows[0];
    }
    if (!appData) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    if (!appData.enabled) return res.status(403).json({ error: 'Aplikasi nonaktif' });

    const cfg = readConfig();
    const Pusher = require('pusher');
    const pusher = new Pusher({
      appId:  appData.id,
      key:    appData.key,
      secret: appData.secret,
      host:   '127.0.0.1',
      port:   String(cfg.port || 6001),
      useTLS: false,
      encryptionMasterKeyBase64: undefined,
    });

    const results = [];
    const doTrigger = async (ch) => {
      try {
        await pusher.trigger(ch.trim(), event, data || {});
        results.push({ channel: ch.trim(), status: 'success' });
        try { await p.query(
          'INSERT INTO event_logs (user_id, app_id, channel, event, payload, status) VALUES (?, ?, ?, ?, ?, ?)',
          [req.user.id, appId, ch.trim(), event, JSON.stringify(data || {}), 'success']
        ); } catch {}
      } catch (err) {
        results.push({ channel: ch.trim(), status: 'error', error: err.message });
        try { await p.query(
          'INSERT INTO event_logs (user_id, app_id, channel, event, payload, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [req.user.id, appId, ch.trim(), event, JSON.stringify(data || {}), 'error', err.message]
        ); } catch {}
      }
    };

    if (scheduleAt) {
      const delay = new Date(scheduleAt).getTime() - Date.now();
      if (delay > 0) {
        setTimeout(async () => {
          for (const ch of chanList) await doTrigger(ch);
        }, delay);
        res.json({ ok: true, message: `Event dijadwalkan pada ${scheduleAt}` });
        return;
      }
    }

    for (const ch of chanList) await doTrigger(ch);

    const ok = results.filter(r => r.status === 'success').length;
    const fail = results.filter(r => r.status === 'error').length;
    res.json({ ok: true, message: `${ok} channel berhasil, ${fail} gagal`, results });
  } catch (err) {
    console.error('[notify error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/event-logs — user-scoped
app.get('/api/event-logs', authenticate, async (req, res) => {
  try {
    const p = getPool();
    if (!p) return res.json([]);
    const [rows] = await p.query(
      'SELECT * FROM event_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit-logs — user's activity
app.get('/api/audit-logs', authenticate, async (req, res) => {
  try {
    const p = getPool();
    if (!p) return res.json([]);
    const [rows] = await p.query(
      'SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Templates (protected) ── */
app.get('/api/templates', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM templates WHERE user_id = ? ORDER BY name ASC', [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates', authenticate, async (req, res) => {
  const { name, channel, event, payload } = req.body;
  if (!name) return res.status(400).json({ error: 'Nama template wajib diisi' });
  try {
    const p = getPool();
    const [result] = await p.query(
      'INSERT INTO templates (user_id, name, channel, event, payload) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, name, channel || '', event || '', payload || '{}']
    );
    const [rows] = await p.query('SELECT * FROM templates WHERE id = ?', [result.insertId]);
    await audit(req.user.id, 'create_template', name, 'Template notifikasi dibuat');
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [result] = await p.query('DELETE FROM templates WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Template tidak ditemukan' });
    await audit(req.user.id, 'delete_template', String(req.params.id), 'Template dihapus');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apps/export/:format — export apps (json|csv)
app.get('/api/apps/export/:format', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM apps WHERE user_id = ?', [req.user.id]);
    const fmt = req.params.format;
    if (fmt === 'csv') {
      const headers = ['id','key','secret','cluster','max_connections','enable_client_messages','enabled','max_backend_events_per_sec','max_client_events_per_sec','max_read_req_per_sec','webhooks'];
      const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${(r[h]??'').toString().replace(/"/g,'""')}"`).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="apps-export.csv"');
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="apps-export.json"');
      res.json(rows);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── IP Whitelist ── */
app.get('/api/apps/:id/ip-whitelist', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT ip_whitelist FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    const list = rows[0].ip_whitelist ? JSON.parse(rows[0].ip_whitelist) : [];
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/apps/:id/ip-whitelist', authenticate, async (req, res) => {
  const { ips } = req.body;
  if (!Array.isArray(ips)) return res.status(400).json({ error: 'ips harus array' });
  try {
    const p = getPool();
    const [existing] = await p.query('SELECT id FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!existing.length) return res.status(404).json({ error: 'Aplikasi tidak ditemukan' });
    await p.query('UPDATE apps SET ip_whitelist = ? WHERE id = ?', [JSON.stringify(ips), req.params.id]);
    await audit(req.user.id, 'update_ip_whitelist', req.params.id, `IP whitelist: ${ips.join(', ') || 'kosong'}`);
    res.json({ ok: true, ips });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Server Metrics ── */
app.get('/api/metrics', authenticate, (req, res) => {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuUsage = cpus.map(c => {
    const total = Object.values(c.times).reduce((a,b) => a+b, 0);
    const idle = c.times.idle;
    return { model: c.model, usage: Math.round((1 - idle/total) * 100) };
  });
  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    cpus: cpuUsage,
    cpuCount: cpus.length,
    loadAvg: loadAvg.map(v => Math.round(v * 100) / 100),
    totalMem,
    freeMem,
    memUsed: totalMem - freeMem,
    memUsagePercent: Math.round((1 - freeMem/totalMem) * 100),
  });
});

/* ── Webhook Receiver & Logs ── */

// POST /api/webhook-receiver — menerima webhook dari Soketi
app.post('/api/webhook-receiver', express.raw({type:'application/json'}), async (req, res) => {
  try {
    const events = req.body;
    const p = getPool();
    if (p && Array.isArray(events)) {
      for (const ev of events) {
        await p.query(
          'INSERT INTO webhook_logs (app_id, event, channel, socket_id, user_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
          [ev.app_id || null, ev.event || ev.name || 'unknown', ev.channel || null, ev.socket_id || null,
           (ev.user_id && !isNaN(ev.user_id)) ? Number(ev.user_id) : null,
           JSON.stringify(ev) || '{}']
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[webhook error]', err.message);
    res.json({ ok: true }); // always ack
  }
});

// GET /api/webhook-logs — user-scoped
app.get('/api/webhook-logs', authenticate, async (req, res) => {
  try {
    const p = getPool();
    if (!p) return res.json([]);
    const [rows] = await p.query(
      `SELECT w.* FROM webhook_logs w
       LEFT JOIN apps a ON w.app_id = a.id
       WHERE a.user_id = ? OR w.user_id = ?
       ORDER BY w.created_at DESC LIMIT 200`,
      [req.user.id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Message Throughput ── */
app.get('/api/event-throughput', authenticate, async (req, res) => {
  try {
    const p = getPool();
    if (!p) return res.json({ avgPerSec: 0, points: [] });
    const [rows] = await p.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:00') AS min,
              COUNT(*) AS count
       FROM event_logs
       WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
       GROUP BY min ORDER BY min ASC`,
      [req.user.id]
    );
    const total = rows.reduce((s, r) => s + r.count, 0);
    const avgPerSec = rows.length > 0 ? Math.round((total / (rows.length * 60)) * 100) / 100 : 0;
    res.json({ avgPerSec, points: rows.map(r => ({ time: r.min, count: r.count })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── 2FA ── */
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

// TOTP secret generator
function generateTotpSecret() {
  return speakeasy.generateSecret({ name: 'PusherAdmin', length: 20 });
}

function verifyTotp(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token),
    window: 1,
  });
}

// POST /api/2fa/setup — generate secret (requires auth)
app.post('/api/2fa/setup', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const secret = generateTotpSecret();
    // upsert — simpan secret, belum enable
    await p.query(
      `INSERT INTO user_2fa (user_id, secret, enabled, backup_codes) VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE secret = VALUES(secret), enabled = 0`,
      [req.user.id, secret.base32, JSON.stringify([])]
    );
    const otpauth = secret.otpauth_url;
    let qrDataUrl = '';
    try { qrDataUrl = await qrcode.toDataURL(otpauth); } catch {}
    res.json({
      ok: true,
      secret: secret.base32,
      otpauth,
      qrCode: qrDataUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/2fa/enable — verify code & enable
app.post('/api/2fa/enable', authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Kode 2FA wajib diisi' });
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM user_2fa WHERE user_id = ?', [req.user.id]);
    if (!rows.length) return res.status(400).json({ error: 'Setup 2FA dulu. POST /api/2fa/setup' });
    const row = rows[0];
    const valid = verifyTotp(row.secret, code);
    if (!valid) return res.status(400).json({ error: 'Kode 2FA tidak valid' });
    await p.query('UPDATE user_2fa SET enabled = 1 WHERE user_id = ?', [req.user.id]);
    await audit(req.user.id, 'enable_2fa', null, '2FA diaktifkan');
    res.json({ ok: true, message: '2FA berhasil diaktifkan' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/2fa/disable — disable 2FA (re-auth with password)
app.post('/api/2fa/disable', authenticate, async (req, res) => {
  const { password, code } = req.body;
  try {
    const p = getPool();
    const [users] = await p.query('SELECT * FROM user WHERE id = ?', [req.user.id]);
    if (!users.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    const match = await bcrypt.compare(password || '', users[0].password);
    if (!match) return res.status(401).json({ error: 'Password salah' });

    // If code provided, verify before disabling
    if (code) {
      const [rows] = await p.query('SELECT * FROM user_2fa WHERE user_id = ?', [req.user.id]);
      if (rows.length && rows[0].enabled) {
        const valid = verifyTotp(rows[0].secret, code);
        if (!valid) return res.status(400).json({ error: 'Kode 2FA tidak valid' });
      }
    }

    await p.query('UPDATE user_2fa SET enabled = 0 WHERE user_id = ?', [req.user.id]);
    await audit(req.user.id, 'disable_2fa', null, '2FA dinonaktifkan');
    res.json({ ok: true, message: '2FA berhasil dinonaktifkan' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/2fa/status — cek status 2FA user
app.get('/api/2fa/status', authenticate, async (req, res) => {
  try {
    const p = getPool();
    const [rows] = await p.query('SELECT id, enabled, secret FROM user_2fa WHERE user_id = ?', [req.user.id]);
    if (!rows.length) return res.json({ enabled: false, setup: false });
    res.json({ enabled: !!rows[0].enabled, setup: true, hasSecret: !!rows[0].secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/2fa/verify-login — verifikasi 2FA saat login
app.post('/api/2fa/verify-login', async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) return res.status(400).json({ error: 'tempToken dan code wajib diisi' });
  try {
    const payload = jwt.verify(tempToken, JWT_SECRET);
    if (payload.purpose !== '2fa') return res.status(403).json({ error: 'Token tidak valid untuk 2FA' });
    const p = getPool();
    const [rows] = await p.query('SELECT * FROM user WHERE id = ?', [payload.id]);
    if (!rows.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    const user = rows[0];
    const [fa] = await p.query('SELECT * FROM user_2fa WHERE user_id = ?', [user.id]);
    if (!fa.length || !fa[0].enabled) return res.status(400).json({ error: '2FA tidak aktif' });
    const valid = verifyTotp(fa[0].secret, code);
    if (!valid) return res.status(401).json({ error: 'Kode 2FA tidak valid' });
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role || 'operator' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    await audit(user.id, 'login_2fa', user.username, 'Login dengan 2FA');
    res.json({ ok: true, token, user: { id: user.id, username: user.username, email: user.email, role: user.role || 'operator' } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token tidak valid atau expired' });
    }
    res.status(500).json({ error: err.message });
  }
});

/* ── Settings API (wsDomain) ── */

// GET /api/settings
app.get('/api/settings', async (req, res) => {
  try {
    const p = getPool();
    if (!p) return res.json({ wsDomain: '' });
    const [rows] = await p.query("SELECT `value` FROM `settings` WHERE `key` = 'wsDomain' LIMIT 1");
    const wsDomain = rows.length ? rows[0].value : '';
    res.json({ wsDomain });
  } catch (err) {
    res.json({ wsDomain: '' });
  }
});

// PUT /api/settings (admin only)
app.put('/api/settings', authenticate, adminOnly, async (req, res) => {
  const { wsDomain } = req.body;
  if (wsDomain === undefined) return res.status(400).json({ error: 'wsDomain wajib diisi' });
  try {
    const p = getPool();
    if (!p) return res.status(503).json({ error: 'Database tidak tersedia' });
    await p.query(
      "INSERT INTO `settings` (`key`, `value`) VALUES ('wsDomain', ?) ON DUPLICATE KEY UPDATE `value` = ?",
      [wsDomain, wsDomain]
    );
    await audit(req.user.id, 'update_settings', 'wsDomain', `WS domain diubah ke ${wsDomain}`);
    res.json({ ok: true, wsDomain });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Start ── */
const API_PORT = process.env.API_PORT || 9000;
const server = app.listen(API_PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Pusher App Manager API             ║`);
  console.log(`║   http://localhost:${API_PORT}/api       ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${API_PORT} sudah digunakan.`);
    console.error(`   Jalankan: fuser -k ${API_PORT}/tcp  lalu coba lagi.`);
    console.error(`   Atau set env: API_PORT=3091 npm run dashboard\n`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

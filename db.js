require('dotenv').config();
const path = require('node:path');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

// ==========================================
// CAMADA DE BANCO DE DADOS DUAL
// ------------------------------------------
// • Sem DATABASE_URL  -> SQLite local (database.sqlite) — modo desenvolvimento
// • Com DATABASE_URL  -> PostgreSQL na nuvem (Neon/Supabase/etc) — modo produção 24/7
//
// API exposta (compatível com o código existente):
//   db.prepare(sql).get(...) | .all(...) | .run(...)   (sempre async)
//   db.exec(sql)
//   getSettings(), updateSetting(key, value), logError({...}), generateLink(...)
//   initDb(), getBackend(), ping()
// ==========================================

const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = !!DATABASE_URL;

let db;   // backend handler
let pool; // pool do Postgres (quando aplicável)

// Converte placeholders "?" do SQLite para "$1, $2, ..." do Postgres,
// ignorando "?" que estejam dentro de strings literais (aspas simples).
function convertPlaceholders(sql) {
  let out = '';
  let i = 0;
  let n = 0;
  let inString = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // lida com aspas escapadas ('') dentro de strings
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i += 2;
        continue;
      }
      inString = !inString;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '?' && !inString) {
      n += 1;
      out += `$${n}`;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

if (isPostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ssl: DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false }
  });
  pool.on('error', (err) => {
    console.error('[pg pool error]', err && err.message ? err.message : err);
  });

  db = {
    prepare(sql) {
      const converted = convertPlaceholders(sql);
      return {
        async get(...params) {
          const r = await pool.query(converted, params);
          return r.rows[0] !== undefined ? r.rows[0] : null;
        },
        async all(...params) {
          const r = await pool.query(converted, params);
          return r.rows;
        },
        async run(...params) {
          const r = await pool.query(converted, params);
          let lastInsertRowid = null;
          if (r.rows && r.rows[0] && r.rows[0].id !== undefined) {
            lastInsertRowid = r.rows[0].id;
          }
          return { changes: r.rowCount, lastInsertRowid };
        }
      };
    },
    async exec(sql) {
      await pool.query(sql);
    }
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(__dirname, 'database.sqlite');
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        get(...params) {
          const row = stmt.get(...params);
          return row !== undefined ? row : null;
        },
        all(...params) {
          return stmt.all(...params);
        },
        run(...params) {
          const res = stmt.run(...params);
          return {
            changes: res.changes !== undefined ? Number(res.changes) : 0,
            lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null
          };
        }
      };
    },
    exec(sql) {
      sqlite.exec(sql);
      return Promise.resolve();
    }
  };
}

// ==========================================
// SCHEMA
// ==========================================

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,
    phone TEXT,
    api_key TEXT UNIQUE NOT NULL,
    credits REAL DEFAULT 0.00,
    active INTEGER DEFAULT 1,
    blocked INTEGER DEFAULT 0,
    sale_price REAL DEFAULT 15.00,
    cost_per_link REAL DEFAULT 2.99,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reseller_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    target_url TEXT NOT NULL,
    customer_name TEXT,
    customer_id TEXT,
    customer_contact TEXT,
    sale_price REAL DEFAULT 15.00,
    cost_price REAL DEFAULT 2.99,
    profit REAL DEFAULT 12.01,
    delivery_status TEXT DEFAULT 'Entregue',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reseller_id INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    amount_paid REAL NOT NULL,
    status TEXT DEFAULT 'approved',
    payment_method TEXT DEFAULT 'PIX',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    target_url TEXT NOT NULL,
    generated_by TEXT NOT NULL,
    reseller_id INTEGER,
    ip_address TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    error_type TEXT NOT NULL,
    message TEXT NOT NULL,
    ip_address TEXT,
    source TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );
`;

const POSTGRES_DDL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS admins (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resellers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,
    phone TEXT,
    api_key TEXT UNIQUE NOT NULL,
    credits DOUBLE PRECISION DEFAULT 0.00,
    active INTEGER DEFAULT 1,
    blocked INTEGER DEFAULT 0,
    sale_price DOUBLE PRECISION DEFAULT 15.00,
    cost_per_link DOUBLE PRECISION DEFAULT 2.99,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales (
    id BIGSERIAL PRIMARY KEY,
    reseller_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    target_url TEXT NOT NULL,
    customer_name TEXT,
    customer_id TEXT,
    customer_contact TEXT,
    sale_price DOUBLE PRECISION DEFAULT 15.00,
    cost_price DOUBLE PRECISION DEFAULT 2.99,
    profit DOUBLE PRECISION DEFAULT 12.01,
    delivery_status TEXT DEFAULT 'Entregue',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recharges (
    id BIGSERIAL PRIMARY KEY,
    reseller_id INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    amount_paid DOUBLE PRECISION NOT NULL,
    status TEXT DEFAULT 'approved',
    payment_method TEXT DEFAULT 'PIX',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS generations (
    id BIGSERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    target_url TEXT NOT NULL,
    generated_by TEXT NOT NULL,
    reseller_id INTEGER,
    ip_address TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS error_logs (
    id BIGSERIAL PRIMARY KEY,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    error_type TEXT NOT NULL,
    message TEXT NOT NULL,
    ip_address TEXT,
    source TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );
`;

// Colunas adicionadas em versões posteriores (migração segura)
const EXTRA_COLUMNS = {
  resellers: [
    'email TEXT',
    'password_hash TEXT',
    'phone TEXT',
    'blocked INTEGER DEFAULT 0',
    'sale_price DOUBLE PRECISION DEFAULT 15.00',
    'cost_per_link DOUBLE PRECISION DEFAULT 2.99',
    // ID de perfil do Telegram: une a conta do site com o bot (saldo único)
    'telegram_id TEXT'
  ]
};

// ==========================================
// SEEDS / VALORES PADRÃO
// ==========================================

const defaultSettings = [
  {
    key: 'target_link',
    value: 'https://www.spotify.com/br-pt/referral/0039882b4241878f638478b2751fe63a66251bd3edb728d8914a1d/?si=FpkWFBhNR_yjQLUGKgUvww&utm_source=whatsapp&locale=pt&rv=2'
  },
  { key: 'link_mode', value: 'cloaked_redirect' }, // 'cloaked_redirect', 'dynamic_query', 'token_suffix', 'template'
  { key: 'app_base_url', value: 'http://localhost:3000' },
  { key: 'redirect_type', value: 'animated_splash' }, // 'animated_splash' or 'instant_302'
  { key: 'service_name', value: 'Quantum Access Generator' },
  { key: 'token_length', value: '16' },
  { key: 'default_expiry_hours', value: '24' },
  { key: 'public_generation_enabled', value: '1' },
  { key: 'admin_cost_per_link', value: '2.99' },
  { key: 'min_recharge_amount', value: '15.00' }
];

// ==========================================
// INICIALIZAÇÃO (schema + seeds)
// ==========================================

async function initDb() {
  await db.exec(isPostgres ? POSTGRES_DDL : SQLITE_DDL);

  // Migração segura de colunas (se tabela já existia)
  for (const [table, colDefs] of Object.entries(EXTRA_COLUMNS)) {
    for (const colDef of colDefs) {
      try {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${isPostgres ? 'IF NOT EXISTS ' : ''}${colDef};`);
      } catch (e) {
        // Coluna já existe — ignorar
      }
    }
  }

  // Atualiza o custo por link para 2.99 em todos os revendedores
  try {
    await db.exec('UPDATE resellers SET cost_per_link = 2.99 WHERE cost_per_link != 2.99 OR cost_per_link IS NULL;');
  } catch (e) {}

  // Seed default settings
  const existingSettings = await db.prepare('SELECT key FROM settings').all();
  const existingKeys = new Set(existingSettings.map((r) => r.key));
  for (const s of defaultSettings) {
    if (!existingKeys.has(s.key)) {
      await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(s.key, s.value);
    }
  }

  // Seed default admin (admin / admin123)
  const countAdmins = await db.prepare('SELECT COUNT(*) as count FROM admins').get();
  if (Number(countAdmins.count) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run('admin', hash, new Date().toISOString());
    console.log('Admin padrão criado: usuário "admin", senha "admin123"');
  }

  // Seed admin Felipe (felipe / felipe123)
  const felipeAdmin = await db.prepare('SELECT id FROM admins WHERE username = ?').get('felipe');
  if (!felipeAdmin) {
    const felipeHash = bcrypt.hashSync('felipe123', 10);
    await db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run('felipe', felipeHash, new Date().toISOString());
    console.log('Admin criado: usuário "felipe", senha "felipe123"');
  }

  // Seed default demo reseller if none exists
  const countResellers = await db.prepare('SELECT COUNT(*) as count FROM resellers').get();
  if (Number(countResellers.count) === 0) {
    const demoApiKey = 'rev_key_' + crypto.randomBytes(16).toString('hex');
    const demoPasswordHash = bcrypt.hashSync('123456', 10);
    await db.prepare(`
      INSERT INTO resellers (name, email, password_hash, phone, api_key, credits, active, blocked, sale_price, cost_per_link, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, 15.00, 2.99, ?, ?)
    `).run(
      'Revendedor Demo',
      'demo@revenda.com',
      demoPasswordHash,
      '+55 11 99999-8888',
      demoApiKey,
      30.00,
      'Conta de demonstração padrão com R$ 30,00 de saldo. Senha: 123456',
      new Date().toISOString()
    );
    console.log(`Revendedor padrão criado! Email: demo@revenda.com (Senha: 123456) | Chave: ${demoApiKey}`);
  }
}

// ==========================================
// HELPERS
// ==========================================

const helpers = {
  db,

  getBackend() {
    return isPostgres ? 'postgres' : 'sqlite';
  },

  async ping() {
    await db.exec('SELECT 1');
    return true;
  },

  initDb,

  async getSettings() {
    const rows = await db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  },

  async updateSetting(key, value) {
    const existing = await db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
    if (existing) {
      await db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
    } else {
      await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }
  },

  // Exposição do DDL Postgres (usado pelo script de migração scripts/migrate-to-pg.js)
  POSTGRES_DDL,

  // Sempre resolve (nunca quebra o fluxo) — pode ser usado fire-and-forget
  async logError({ endpoint, method, statusCode, errorType, message, ip, source = 'system', details = null }) {
    try {
      const detailsStr = typeof details === 'object' && details !== null ? JSON.stringify(details) : (details || null);
      await db.prepare(`
        INSERT INTO error_logs (endpoint, method, status_code, error_type, message, ip_address, source, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        endpoint || 'unknown',
        method || 'GET',
        statusCode || 500,
        errorType || 'GeneralError',
        message || 'Erro não especificado',
        ip || '127.0.0.1',
        source,
        detailsStr,
        new Date().toISOString()
      );
    } catch (e) {
      console.error('Falha ao salvar log de erro:', e);
    }
  },

  async generateLink(generatedBy, resellerId = null, ip = '127.0.0.1') {
    const settings = await this.getSettings();
    const tokenLength = parseInt(settings.token_length || '16', 10);
    const token = crypto.randomBytes(Math.ceil(tokenLength / 2)).toString('hex').slice(0, tokenLength).toUpperCase();

    let targetUrl = '';
    let deliveredLink = '';
    const baseLink = settings.target_link || 'https://www.spotify.com/br-pt/referral/0039882b4241878f638478b2751fe63a66251bd3edb728d8914a1d/?si=FpkWFBhNR_yjQLUGKgUvww&utm_source=whatsapp&locale=pt&rv=2';
    const mode = settings.link_mode || 'cloaked_redirect';
    const baseUrl = settings.app_base_url || 'http://localhost:3000';

    // Gera parâmetros dinâmicos randômicos para anexar à URL final
    const randomSession = crypto.randomBytes(4).toString('hex');
    const randomNonce = Math.floor(100000 + Math.random() * 900000);
    const separator = baseLink.includes('?') ? '&' : '?';
    const dynamicDestinationUrl = `${baseLink}${separator}_ref_uid=${token}&_sess=${randomSession}&_v=${randomNonce}`;

    if (mode === 'cloaked_redirect') {
      // O cliente recebe um link exclusivo do sistema (ex: http://seusite.com/r/A8F19B)
      // Parecendo 100% um código único e individual gerado exclusivamente para ele!
      deliveredLink = `${baseUrl}/r/${token}`;
      targetUrl = dynamicDestinationUrl;
    } else if (mode === 'dynamic_query') {
      // Entrega o link do Spotify diretamente, mas com parâmetros randômicos anexados
      deliveredLink = dynamicDestinationUrl;
      targetUrl = dynamicDestinationUrl;
    } else if (mode === 'template') {
      const template = settings.link_template || `${baseLink}{TOKEN}`;
      targetUrl = template.replace(/{TOKEN}/g, token);
      deliveredLink = targetUrl;
    } else {
      deliveredLink = `${baseLink}${separator}token=${token}`;
      targetUrl = deliveredLink;
    }

    const expiryHours = parseInt(settings.default_expiry_hours || '24', 10);
    const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    await db.prepare(`
      INSERT INTO generations (token, target_url, generated_by, reseller_id, ip_address, created_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(token, targetUrl, generatedBy, resellerId, ip, createdAt, expiresAt);

    return {
      token,
      targetUrl: deliveredLink, // Link entregue para o cliente / bot
      finalDestination: targetUrl, // Destino real onde o redirecionador leva
      createdAt,
      expiresAt,
      generatedBy
    };
  }
};

module.exports = helpers;

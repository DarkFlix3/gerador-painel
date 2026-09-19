require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbHelpers = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_gerador_painel_2026';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// WRAPPER DE HANDLERS ASYNC
// (Express 4 não captura rejeições de Promise — este patch encaminha
//  qualquer erro de handler assíncrono para o middleware de erro final)
// ==========================================
['get', 'post', 'put', 'delete', 'patch'].forEach((method) => {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) => original(routePath, ...handlers.map((h) =>
    h.length >= 4 ? h : (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)
  ));
});

// Helper to get client IP
const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
};

// ==========================================
// MIDDLEWARES DE AUTENTICAÇÃO
// ==========================================

// 1. Admin Auth (JWT)
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado ao painel admin.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role && decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Permissão insuficiente.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Sessão administrativa expirada ou inválida.' });
  }
};

// 2. Reseller User Auth (JWT do Painel do Revendedor)
const resellerUserAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Acesso restrito a revendedores. Faça login.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'reseller') {
      return res.status(403).json({ success: false, error: 'Token inválido para área de revendedor.' });
    }

    const reseller = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE id = ?').get(decoded.id);
    if (!reseller) {
      return res.status(404).json({ success: false, error: 'Conta de revendedor não encontrada.' });
    }

    if (reseller.blocked === 1 || reseller.active !== 1) {
      return res.status(403).json({ success: false, error: 'Sua conta de revendedor está bloqueada ou pausada pelo administrador.' });
    }

    req.reseller = reseller;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Sessão de revendedor expirada. Faça login novamente.' });
  }
};

// 3. Reseller Bot API Auth (Chave de API / Header)
const resellerBotAuth = async (req, res, next) => {
  const ip = getClientIp(req);
  let apiKey = req.headers['x-api-key'];
  
  if (!apiKey && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    apiKey = req.headers.authorization.split(' ')[1];
  }

  if (!apiKey) {
    dbHelpers.logError({
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: 401,
      errorType: 'AuthError',
      message: 'Requisição de bot sem API Key no Header (Authorization: Bearer ou X-API-Key)',
      ip,
      source: 'bot_api'
    });
    return res.status(401).json({
      success: false,
      error: 'API Key não fornecida. Envie o header "Authorization: Bearer <SUA_CHAVE>" ou "X-API-Key: <SUA_CHAVE>".'
    });
  }

  const reseller = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE api_key = ?').get(apiKey);

  if (!reseller) {
    dbHelpers.logError({
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: 403,
      errorType: 'InvalidApiKey',
      message: `Tentativa de bot com chave de API inexistente: ${apiKey.substring(0, 10)}...`,
      ip,
      source: 'bot_api'
    });
    return res.status(403).json({ success: false, error: 'Chave de API inválida.' });
  }

  if (reseller.blocked === 1) {
    dbHelpers.logError({
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: 403,
      errorType: 'ResellerBlocked',
      message: `Bot bloqueado: Revendedor #${reseller.id} (${reseller.name}) foi bloqueado pelo administrador.`,
      ip,
      source: 'bot_api',
      details: { reseller_id: reseller.id, name: reseller.name }
    });
    return res.status(403).json({
      success: false,
      error: 'Acesso bloqueado: Sua conta de revendedor foi suspensa ou bloqueada pelo administrador.'
    });
  }

  if (reseller.active !== 1) {
    dbHelpers.logError({
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: 403,
      errorType: 'ResellerInactive',
      message: `Bot pausado: Revendedor #${reseller.id} (${reseller.name}) está inativo.`,
      ip,
      source: 'bot_api'
    });
    return res.status(403).json({ success: false, error: 'Conta de revendedor inativa ou pausada.' });
  }

  req.reseller = reseller;
  next();
};

// ==========================================
// ROTAS PÚBLICAS (GERADOR WEB)
// ==========================================
// ==========================================
// ROTA DO REDIRECIONADOR CAMUFLADO INTELIGENTE
// ==========================================
app.get('/r/:token', async (req, res) => {
  const token = req.params.token.toUpperCase();
  const generation = await dbHelpers.db.prepare('SELECT * FROM generations WHERE token = ?').get(token);

  if (!generation) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Link Inválido</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="/assets/style.css">
      </head>
      <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
        <div class="glass-panel p-8 max-w-md w-full text-center space-y-4">
          <div class="w-12 h-12 bg-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto text-xl font-bold">✕</div>
          <h1 class="text-xl font-bold text-white">Link Não Encontrado ou Expirado</h1>
          <p class="text-xs text-slate-400">Este link de acesso é inválido ou já atingiu o tempo limite de utilização.</p>
          <a href="/" class="inline-block px-4 py-2 bg-indigo-600 rounded-xl text-xs font-bold text-white mt-2">Voltar ao Início</a>
        </div>
      </body>
      </html>
    `);
  }

  // Verifica se está expirado
  if (generation.expires_at && new Date(generation.expires_at) < new Date()) {
    return res.status(410).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Link Expirado</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="/assets/style.css">
      </head>
      <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
        <div class="glass-panel p-8 max-w-md w-full text-center space-y-4">
          <div class="w-12 h-12 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto text-xl font-bold">⏰</div>
          <h1 class="text-xl font-bold text-white">Acesso Expirado</h1>
          <p class="text-xs text-slate-400">O período de validade desta licença expirou.</p>
          <a href="/" class="inline-block px-4 py-2 bg-indigo-600 rounded-xl text-xs font-bold text-white mt-2">Gerar Novo Acesso</a>
        </div>
      </body>
      </html>
    `);
  }

  const settings = await dbHelpers.getSettings();
  const redirectType = settings.redirect_type || 'animated_splash';
  const destination = generation.target_url;

  if (redirectType === 'instant_302') {
    return res.redirect(302, destination);
  }

  // Tela intermediária moderna de validação e redirecionamento (Splash Screen)
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR" class="dark">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Validando Acesso Individual...</title>
      <meta http-equiv="refresh" content="1;url=${destination}">
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="/assets/style.css">
    </head>
    <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4 selection:bg-indigo-500 selection:text-white">
      <div class="bg-glow">
        <div class="glow-orb-1"></div>
        <div class="glow-orb-2"></div>
      </div>

      <div class="glass-panel p-8 max-w-md w-full text-center space-y-6 relative overflow-hidden border border-emerald-500/30">
        <div class="space-y-3">
          <div class="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <svg class="w-7 h-7 text-emerald-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
            </svg>
          </div>
          <h1 class="text-xl font-black text-white">Acesso Exclusivo Liberado!</h1>
          <p class="text-xs text-slate-400">Verificando sua chave individual e conectando à sua conta...</p>
        </div>

        <div class="bg-slate-900/90 p-3.5 rounded-xl border border-white/5 space-y-2 text-xs">
          <div class="flex justify-between items-center text-slate-400">
            <span>Sua Chave Única:</span>
            <code class="font-mono text-indigo-300 font-bold bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-500/30">${token}</code>
          </div>
          <div class="flex justify-between items-center text-slate-400">
            <span>Status:</span>
            <span class="text-emerald-400 font-bold flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              Conexão Segura
            </span>
          </div>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-center gap-2 text-xs text-slate-400">
            <div class="animate-spin rounded-full h-4 w-4 border-2 border-emerald-400 border-t-transparent"></div>
            <span>Redirecionando em instantes...</span>
          </div>

          <div>
            <a href="${destination}" class="text-[11px] text-indigo-400 hover:text-indigo-300 underline">
              Clique aqui caso não seja redirecionado automaticamente
            </a>
          </div>
        </div>
      </div>

      <script>
        // Redireciona com javascript em 800ms
        setTimeout(() => {
          window.location.href = "${destination}";
        }, 800);
      </script>
    </body>
    </html>
  `);
});

app.get('/api/public/info', async (req, res) => {
  const settings = await dbHelpers.getSettings();
  const genCountRow = await dbHelpers.db.prepare('SELECT COUNT(*) as count FROM generations').get();
  const totalGenerations = Number(genCountRow ? genCountRow.count : 0);
  
  res.json({
    success: true,
    service_name: settings.service_name || 'Quantum Link Generator',
    public_enabled: settings.public_generation_enabled === '1',
    total_generated: totalGenerations
  });
});

app.post('/api/public/generate', async (req, res) => {
  const ip = getClientIp(req);
  const settings = await dbHelpers.getSettings();

  if (settings.public_generation_enabled !== '1') {
    dbHelpers.logError({
      endpoint: '/api/public/generate',
      method: 'POST',
      statusCode: 403,
      errorType: 'PublicDisabled',
      message: 'Geração pública desabilitada pelo administrador.',
      ip,
      source: 'web_ui'
    });
    return res.status(403).json({ success: false, error: 'A geração pública está temporariamente desabilitada.' });
  }

  try {
    const result = await dbHelpers.generateLink('public_web', null, ip);
    res.json({ success: true, data: result });
  } catch (err) {
    dbHelpers.logError({
      endpoint: '/api/public/generate',
      method: 'POST',
      statusCode: 500,
      errorType: 'GenerationError',
      message: err.message,
      ip,
      source: 'web_ui',
      details: err.stack
    });
    res.status(500).json({ success: false, error: 'Erro ao processar geração do link.' });
  }
});

// ==========================================
// ROTAS DO REVENDEDOR (PORTAL / LOGIN / CONTA)
// ==========================================

// Cadastro de Revendedor
app.post('/api/reseller/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  const ip = getClientIp(req);

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Nome, e-mail e senha são obrigatórios.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'A senha deve conter no mínimo 6 caracteres.' });
  }

  const existing = await dbHelpers.db.prepare('SELECT id FROM resellers WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return res.status(400).json({ success: false, error: 'Já existe um revendedor cadastrado com este e-mail.' });
  }

  const apiKey = 'rev_key_' + crypto.randomBytes(16).toString('hex');
  const passwordHash = bcrypt.hashSync(password, 10);
  const initialCredits = 0.00; // Começa com R$ 0,00 até efetuar recarga
  const now = new Date().toISOString();

  try {
    const result = await dbHelpers.db.prepare(`
      INSERT INTO resellers (name, email, password_hash, phone, api_key, credits, active, blocked, sale_price, cost_per_link, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, 15.00, 2.99, ?) RETURNING id
    `).run(
      name.trim(),
      email.trim().toLowerCase(),
      passwordHash,
      phone ? phone.trim() : null,
      apiKey,
      initialCredits,
      now
    );

    const token = jwt.sign(
      { id: result.lastInsertRowid, email: email.trim().toLowerCase(), role: 'reseller' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: 'Conta de revendedor criada com sucesso! Faça uma recarga mínima de R$ 15,00 para começar a gerar links.',
      token,
      reseller: {
        id: result.lastInsertRowid,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        api_key: apiKey,
        credits: Number(initialCredits).toFixed(2),
        balance: Number(initialCredits).toFixed(2),
        sale_price: 15.00,
        cost_per_link: 2.99
      }
    });

  } catch (err) {
    dbHelpers.logError({
      endpoint: '/api/reseller/register',
      method: 'POST',
      statusCode: 500,
      errorType: 'RegisterError',
      message: err.message,
      ip,
      source: 'web_ui'
    });
    res.status(500).json({ success: false, error: 'Erro ao registrar conta: ' + err.message });
  }
});

// Login do Revendedor
app.post('/api/reseller/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = getClientIp(req);

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Informe e-mail e senha.' });
  }

  const reseller = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE email = ?').get(email.trim().toLowerCase());
  if (!reseller || !reseller.password_hash || !bcrypt.compareSync(password, reseller.password_hash)) {
    dbHelpers.logError({
      endpoint: '/api/reseller/login',
      method: 'POST',
      statusCode: 401,
      errorType: 'FailedResellerLogin',
      message: `Login com falha para revendedor e-mail: ${email}`,
      ip,
      source: 'web_ui'
    });
    return res.status(401).json({ success: false, error: 'E-mail ou senha incorretos.' });
  }

  if (reseller.blocked === 1) {
    return res.status(403).json({ success: false, error: 'Esta conta de revendedor foi bloqueada pelo administrador.' });
  }

  const token = jwt.sign(
    { id: reseller.id, email: reseller.email, role: 'reseller' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({
    success: true,
    token,
    reseller: {
      id: reseller.id,
      name: reseller.name,
      email: reseller.email,
      api_key: reseller.api_key,
      credits: Number(reseller.credits || 0).toFixed(2),
      balance: Number(reseller.credits || 0).toFixed(2),
      sale_price: reseller.sale_price || 15.00,
      cost_per_link: reseller.cost_per_link || 2.99
    }
  });
});

// Perfil do Revendedor logado
app.get('/api/reseller/me', resellerUserAuth, (req, res) => {
  const r = req.reseller;
  res.json({
    success: true,
    reseller: {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      api_key: r.api_key,
      credits: Number(r.credits || 0).toFixed(2),
      balance: Number(r.credits || 0).toFixed(2),
      sale_price: r.sale_price || 15.00,
      cost_per_link: r.cost_per_link || 2.99,
      blocked: r.blocked === 1,
      created_at: r.created_at
    }
  });
});

// Dashboard e Gráfico do Revendedor
app.get('/api/reseller/dashboard', resellerUserAuth, async (req, res) => {
  const resellerId = req.reseller.id;

  // KPIs de Vendas
  const salesSummary = await dbHelpers.db.prepare(`
    SELECT 
      COUNT(*) as total_sales,
      COALESCE(SUM(sale_price), 0) as total_revenue,
      COALESCE(SUM(profit), 0) as total_profit
    FROM sales
    WHERE reseller_id = ?
  `).get(resellerId);

  // Vendas Hoje
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const salesToday = await dbHelpers.db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(profit), 0) as profit_today
    FROM sales
    WHERE reseller_id = ? AND created_at >= ?
  `).get(resellerId, todayStart.toISOString());

  // Gráfico: Vendas e Lucro nos últimos 7 dias
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const dailySales = await dbHelpers.db.prepare(`
    SELECT 
      substr(created_at, 1, 10) as date_day,
      COUNT(*) as count,
      COALESCE(SUM(profit), 0) as daily_profit,
      COALESCE(SUM(sale_price), 0) as daily_revenue
    FROM sales
    WHERE reseller_id = ? AND created_at >= ?
    GROUP BY date_day
    ORDER BY date_day ASC
  `).all(resellerId, sevenDaysAgo);

  // Últimas 5 vendas
  const recentSales = await dbHelpers.db.prepare(`
    SELECT id, customer_name, customer_id, sale_price, profit, target_url, token, delivery_status, created_at
    FROM sales
    WHERE reseller_id = ?
    ORDER BY id DESC
    LIMIT 5
  `).all(resellerId);

  res.json({
    success: true,
    kpis: {
      credits: Number(req.reseller.credits || 0).toFixed(2),
      balance: Number(req.reseller.credits || 0).toFixed(2),
      totalSales: Number(salesSummary.total_sales || 0),
      totalRevenue: Number(salesSummary.total_revenue).toFixed(2),
      totalProfit: Number(salesSummary.total_profit).toFixed(2),
      todaySales: Number(salesToday.count || 0),
      todayProfit: Number(salesToday.profit_today).toFixed(2),
      salePrice: Number(req.reseller.sale_price || 15.00).toFixed(2),
      costPrice: Number(req.reseller.cost_per_link || 2.99).toFixed(2)
    },
    chart: dailySales.map((r) => ({ ...r, count: Number(r.count), daily_profit: Number(r.daily_profit), daily_revenue: Number(r.daily_revenue) })),
    recentSales
  });
});

// Lista Completa de Clientes e Histórico de Vendas do Revendedor
app.get('/api/reseller/sales', resellerUserAuth, async (req, res) => {
  const resellerId = req.reseller.id;
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);

  const sales = await dbHelpers.db.prepare(`
    SELECT id, customer_name, customer_id, customer_contact, sale_price, cost_price, profit, target_url, token, delivery_status, created_at
    FROM sales
    WHERE reseller_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(resellerId, limit);

  res.json({ success: true, data: sales });
});



// Lista de Clientes Agregados do Revendedor (compras, gasto total e lucro)
app.get('/api/reseller/customers', resellerUserAuth, async (req, res) => {
  const resellerId = req.reseller.id;

  const customers = await dbHelpers.db.prepare(`
    SELECT
      customer_name,
      customer_id,
      customer_contact,
      COUNT(*) as purchase_count,
      COALESCE(SUM(sale_price), 0) as total_spent,
      COALESCE(SUM(profit), 0) as total_profit,
      MAX(created_at) as last_purchase
    FROM sales
    WHERE reseller_id = ? AND customer_name IS NOT NULL AND customer_name != ''
    GROUP BY customer_name, customer_id, customer_contact
    ORDER BY last_purchase DESC
    LIMIT 200
  `).all(resellerId);

  res.json({
    success: true,
    data: customers.map((c) => ({
      ...c,
      purchase_count: Number(c.purchase_count),
      total_spent: Number(c.total_spent).toFixed(2),
      total_profit: Number(c.total_profit).toFixed(2)
    }))
  });
});
// Atualizar Configuração de Preço de Venda do Revendedor
app.post('/api/reseller/settings', resellerUserAuth, async (req, res) => {
  const { sale_price, name, phone } = req.body;
  const resellerId = req.reseller.id;

  const parsedPrice = parseFloat(sale_price);
  if (isNaN(parsedPrice) || parsedPrice < 0) {
    return res.status(400).json({ success: false, error: 'Informe um valor de venda válido em Reais.' });
  }

  const updatedName = name && name.trim() ? name.trim() : req.reseller.name;
  const updatedPhone = phone !== undefined ? phone.trim() : req.reseller.phone;

  await dbHelpers.db.prepare(`
    UPDATE resellers 
    SET sale_price = ?, name = ?, phone = ?
    WHERE id = ?
  `).run(parsedPrice, updatedName, updatedPhone, resellerId);

  res.json({
    success: true,
    message: 'Preço de venda e dados atualizados com sucesso!',
    sale_price: parsedPrice
  });
});

// Regenerar Chave de API pelo Revendedor
app.post('/api/reseller/regenerate-key', resellerUserAuth, async (req, res) => {
  const newKey = 'rev_key_' + crypto.randomBytes(16).toString('hex');
  await dbHelpers.db.prepare('UPDATE resellers SET api_key = ? WHERE id = ?').run(newKey, req.reseller.id);

  res.json({
    success: true,
    message: 'Nova API Key gerada com sucesso! Atualize seu bot com a nova chave.',
    api_key: newKey
  });
});

// Recarregar Saldo / Créditos pelo Revendedor (Valor Mínimo: R$ 15,00)
app.post('/api/reseller/recharge', resellerUserAuth, async (req, res) => {
  const { credits, amount } = req.body;
  const settings = await dbHelpers.getSettings();
  const minAmount = parseFloat(settings.min_recharge_amount || '15.00');
  const costPerCredit = parseFloat(req.reseller.cost_per_link || 2.99);

  let amountPaid = 0;

  if (amount !== undefined && amount !== null && amount !== '') {
    amountPaid = parseFloat(amount);
  } else if (credits !== undefined) {
    amountPaid = parseFloat(credits);
  }

  if (isNaN(amountPaid) || amountPaid < minAmount) {
    return res.status(400).json({
      success: false,
      error: `O valor mínimo para recarga de saldo é de R$ ${minAmount.toFixed(2).replace('.', ',')}.`
    });
  }

  const now = new Date().toISOString();

  // Adiciona o valor em Reais diretamente ao saldo do revendedor
  await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits + ? AS NUMERIC), 2) WHERE id = ?').run(amountPaid, req.reseller.id);
  await dbHelpers.db.prepare(`
    INSERT INTO recharges (reseller_id, credits, amount_paid, status, payment_method, created_at)
    VALUES (?, ?, ?, 'approved', 'PIX', ?)
  `).run(req.reseller.id, Math.floor(amountPaid / costPerCredit), amountPaid, now);

  const updated = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(req.reseller.id);

  res.json({
    success: true,
    message: `Recarga de R$ ${amountPaid.toFixed(2).replace('.', ',')} aprovada com sucesso! Saldo adicionado à sua conta.`,
    new_balance: Number(updated.credits).toFixed(2),
    balance: Number(updated.credits).toFixed(2),
    amount_paid: amountPaid
  });
});

// Geração Manual de Link pelo Revendedor usando Saldo em Dinheiro (Desconta R$ 2,99)
app.post('/api/reseller/generate-manual', resellerUserAuth, async (req, res) => {
  const ip = getClientIp(req);
  const reseller = req.reseller;
  const costPrice = parseFloat(reseller.cost_per_link || 2.99);
  const currentCredits = parseFloat(reseller.credits || 0);

  // Checa se tem saldo suficiente para cobrir R$ 2,99
  if (currentCredits < costPrice) {
    return res.status(402).json({
      success: false,
      error: `Saldo insuficiente. Cada link custa R$ ${costPrice.toFixed(2).replace('.', ',')} e seu saldo atual é de R$ ${currentCredits.toFixed(2).replace('.', ',')}. Recarregue seu saldo no painel.`
    });
  }

  const { customer_name, customer_contact, sale_price } = req.body;
  const finalCustomerName = customer_name && customer_name.trim() ? customer_name.trim() : 'Cliente Manual (WhatsApp/Direto)';
  const finalContact = customer_contact ? String(customer_contact).trim() : 'Manual';
  const finalSalePrice = sale_price ? parseFloat(sale_price) : (reseller.sale_price || 15.00);
  const profit = Math.max(0, finalSalePrice - costPrice);

  try {
    // Desconta exatamente R$ 2,99 do saldo do revendedor
    await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits - ? AS NUMERIC), 2) WHERE id = ?').run(costPrice, reseller.id);

    // Gera o link
    const generation = await dbHelpers.generateLink(`painel_manual:${reseller.name}`, reseller.id, ip);

    // Registra a venda no histórico de clientes do revendedor
    const now = new Date().toISOString();
    const saleResult = await dbHelpers.db.prepare(`
      INSERT INTO sales (reseller_id, token, target_url, customer_name, customer_id, customer_contact, sale_price, cost_price, profit, delivery_status, created_at)
      VALUES (?, ?, ?, ?, 'manual_web', ?, ?, ?, ?, 'Entregue (Manual)', ?) RETURNING id
    `).run(
      reseller.id,
      generation.token,
      generation.targetUrl,
      finalCustomerName,
      finalContact,
      finalSalePrice,
      costPrice,
      profit,
      now
    );

    const updated = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(reseller.id);

    res.json({
      success: true,
      message: 'Link gerado com sucesso! R$ 2,99 descontado do seu saldo.',
      link: generation.targetUrl,
      token: generation.token,
      expires_at: generation.expiresAt,
      balance_remaining: Number(updated.credits).toFixed(2),
      cost_deducted: costPrice,
      profit_generated: profit,
      sale_id: saleResult.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Erro ao gerar link manualmente: ' + err.message });
  }
});

// ==========================================
// ROTA PRINCIPAL DA API PARA BOTS DE REVENDA (DESCONTA R$ 2,99 POR LINK)
// ==========================================

// Endpoint acionado pelos Bots (Telegram, Discord, etc.)
app.post('/api/v1/generate', resellerBotAuth, async (req, res) => {
  const ip = getClientIp(req);
  const reseller = req.reseller;
  const costPrice = parseFloat(reseller.cost_per_link || 2.99);
  const currentCredits = parseFloat(reseller.credits || 0);

  // 1. Checa se o Revendedor possui saldo suficiente (Mínimo R$ 2,99)
  if (currentCredits < costPrice) {
    dbHelpers.logError({
      endpoint: '/api/v1/generate',
      method: 'POST',
      statusCode: 402,
      errorType: 'OutOfBalance',
      message: `Bot falhou: Revendedor #${reseller.id} (${reseller.name}) com saldo insuficiente (Saldo: R$ ${currentCredits.toFixed(2)} - Custo: R$ ${costPrice.toFixed(2)}).`,
      ip,
      source: 'bot_api',
      details: { reseller_id: reseller.id, balance: currentCredits, cost: costPrice }
    });
    return res.status(402).json({
      success: false,
      error: `Saldo insuficiente. Cada link custa R$ ${costPrice.toFixed(2).replace('.', ',')} e seu saldo atual é de R$ ${currentCredits.toFixed(2).replace('.', ',')}. Recarregue seu saldo no painel do revendedor.`,
      balance: currentCredits.toFixed(2)
    });
  }

  // 2. Extrai dados do Cliente enviados pelo Bot
  const { customer_name, customer_id, customer_contact, sale_price } = req.body;
  
  const finalCustomerName = customer_name ? customer_name.trim() : 'Cliente Anônimo';
  const finalCustomerId = customer_id ? String(customer_id).trim() : null;
  const finalContact = customer_contact ? String(customer_contact).trim() : null;

  // Preço de venda cobrado do cliente (ou usa o padrão do revendedor)
  const finalSalePrice = sale_price ? parseFloat(sale_price) : (reseller.sale_price || 15.00);
  const profit = Math.max(0, finalSalePrice - costPrice);

  try {
    // 3. Decrementa exatamente R$ 2,99 do Saldo do Revendedor
    await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits - ? AS NUMERIC), 2) WHERE id = ?').run(costPrice, reseller.id);

    // 4. Gera o Link
    const generation = await dbHelpers.generateLink(`bot:${reseller.name}`, reseller.id, ip);

    // 5. Registra a Venda no Histórico de Clientes do Revendedor
    const now = new Date().toISOString();
    const saleResult = await dbHelpers.db.prepare(`
      INSERT INTO sales (reseller_id, token, target_url, customer_name, customer_id, customer_contact, sale_price, cost_price, profit, delivery_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Entregue', ?) RETURNING id
    `).run(
      reseller.id,
      generation.token,
      generation.targetUrl,
      finalCustomerName,
      finalCustomerId,
      finalContact,
      finalSalePrice,
      costPrice,
      profit,
      now
    );

    const updated = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(reseller.id);

    // Resposta Completa para o Bot
    res.json({
      success: true,
      message: 'Link gerado e entregue com sucesso para o cliente!',
      link: generation.targetUrl,
      token: generation.token,
      delivery_status: 'Entregue',
      customer: {
        name: finalCustomerName,
        id: finalCustomerId,
        contact: finalContact,
        sale_price: finalSalePrice
      },
      profit_generated: profit,
      cost_deducted: costPrice,
      balance_remaining: Number(updated.credits).toFixed(2),
      sale_id: saleResult.lastInsertRowid,
      created_at: now,
      expires_at: generation.expiresAt
    });

  } catch (err) {
    dbHelpers.logError({
      endpoint: '/api/v1/generate',
      method: 'POST',
      statusCode: 500,
      errorType: 'BotGenerationError',
      message: err.message,
      ip,
      source: 'bot_api',
      details: err.stack
    });
    res.status(500).json({ success: false, error: 'Falha no servidor ao gerar link para o bot.' });
  }
});

// Consulta de saldo do Revendedor
app.get('/api/v1/balance', resellerBotAuth, async (req, res) => {
  const reseller = req.reseller;
  const stats = await dbHelpers.db.prepare(`
    SELECT COUNT(*) as total_sales, COALESCE(SUM(sale_price), 0) as total_revenue
    FROM sales 
    WHERE reseller_id = ?
  `).get(reseller.id);

  res.json({
    success: true,
    reseller: reseller.name,
    credits: reseller.credits,
    active: reseller.active === 1 && reseller.blocked === 0,
    sale_price: reseller.sale_price,
    total_sales: Number(stats.total_sales || 0),
    total_revenue: Number(stats.total_revenue || 0)
  });
});

// ==========================================
// CATÁLOGO, CUPONS, PEDIDOS E PAGAMENTOS
// (Portados do painel lovelygemi e integrados com o bot de vendas)
// ==========================================

// Gera um código de pedido curto e único (ex: ORD-7K2XQ9P)
function generateOrderCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 7; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return 'ORD-' + code;
}

// Valida um cupom e calcula o desconto sobre um preço
async function validateCouponDb(code, price) {
  if (!code) return null;
  const coupon = await dbHelpers.db.prepare('SELECT * FROM coupons WHERE code = ?').get(String(code).trim().toUpperCase());
  if (!coupon) return { error: 'Cupom não encontrado.' };
  if (coupon.active !== 1) return { error: 'Este cupom está desativado.' };
  if (coupon.max_uses > 0 && Number(coupon.used_count || 0) >= Number(coupon.max_uses)) {
    return { error: 'Este cupom já atingiu o limite de usos.' };
  }
  if (coupon.valid_until && new Date(coupon.valid_until).getTime() < Date.now()) {
    return { error: 'Este cupom expirou.' };
  }
  const basePrice = parseFloat(price || 0);
  let discount = 0;
  if (coupon.discount_type === 'percent') {
    discount = Math.min(basePrice, basePrice * (parseFloat(coupon.discount_value) / 100));
  } else {
    discount = Math.min(basePrice, parseFloat(coupon.discount_value));
  }
  discount = Math.round(discount * 100) / 100;
  return { coupon, discount, total: Math.max(0, Math.round((basePrice - discount) * 100) / 100) };
}

// Entrega um pedido pago: debita o custo do revendedor, gera o link e registra a venda
async function deliverOrder(orderId) {
  const order = await dbHelpers.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return { success: false, reason: 'pedido_inexistente' };
  if (order.status === 'delivered' && order.token) return { success: true, order, alreadyDelivered: true };

  const reseller = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE id = ?').get(order.reseller_id);
  if (!reseller) return { success: false, reason: 'revendedor_inexistente' };
  if (reseller.blocked === 1 || reseller.active !== 1) return { success: false, reason: 'revendedor_bloqueado' };

  let costPrice = parseFloat(reseller.cost_per_link || 2.99);
  if (order.product_id) {
    const prodRow = await dbHelpers.db.prepare('SELECT cost_price FROM products WHERE id = ?').get(order.product_id);
    if (prodRow && prodRow.cost_price > 0) costPrice = parseFloat(prodRow.cost_price);
  }
  const currentCredits = parseFloat(reseller.credits || 0);
  if (currentCredits < costPrice) {
    return { success: false, reason: 'saldo_insuficiente', costPrice };
  }

  const ip = '127.0.0.1';
  await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits - ? AS NUMERIC), 2) WHERE id = ?').run(costPrice, reseller.id);
  const generation = await dbHelpers.generateLink(`order:${order.order_code}`, reseller.id, ip);

  await dbHelpers.db.prepare(`
    INSERT INTO sales (reseller_id, token, target_url, customer_name, customer_id, customer_contact, sale_price, cost_price, profit, delivery_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Entregue (Pedido)', ?)
  `).run(
    reseller.id,
    generation.token,
    generation.targetUrl,
    order.customer_name || 'Cliente Bot',
    order.customer_id || 'bot',
    order.customer_contact || 'Via Bot',
    order.total,
    costPrice,
    Math.max(0, Math.round((order.total - costPrice) * 100) / 100),
    new Date().toISOString()
  );

  await dbHelpers.db.prepare("UPDATE orders SET status = 'delivered', token = ?, updated_at = ? WHERE id = ?")
    .run(generation.token, new Date().toISOString(), order.id);

  return {
    success: true,
    order: {
      ...order,
      status: 'delivered',
      token: generation.token,
      link: generation.targetUrl
    },
    costPrice
  };
}

// Lista produtos ativos (catálogo do bot)
app.get('/api/v1/products', resellerBotAuth, async (req, res) => {
  const products = await dbHelpers.db.prepare(`
    SELECT id, name, description, price, emoji, sort_order
    FROM products WHERE active = 1 ORDER BY sort_order ASC, id ASC
  `).all();
  res.json({
    success: true,
    data: products.map((p) => ({
      ...p,
      id: Number(p.id),
      price: parseFloat(p.price || 0)
    }))
  });
});

// Valida um cupom de desconto
app.get('/api/v1/coupons/:code', resellerBotAuth, async (req, res) => {
  const price = parseFloat(req.query.price || '0');
  const result = await validateCouponDb(req.params.code, price);
  if (!result || result.error) {
    return res.status(400).json({ success: false, error: (result && result.error) || 'Cupom inválido.' });
  }
  res.json({
    success: true,
    code: result.coupon.code,
    discount_type: result.coupon.discount_type,
    discount_value: parseFloat(result.coupon.discount_value),
    discount: result.discount,
    total: result.total,
    valid_until: result.coupon.valid_until
  });
});

// Cria um pedido (checkout do bot). Método BALANCE = entrega instantânea.
app.post('/api/v1/orders', resellerBotAuth, async (req, res) => {
  const reseller = req.reseller;
  const ip = getClientIp(req);
  const { product_id, coupon_code, customer_name, customer_id, customer_contact, payment_method } = req.body;

  let product = null;
  if (product_id) {
    product = await dbHelpers.db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(product_id, 10));
    if (!product || product.active !== 1) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado ou indisponível.' });
    }
  }

  const unitPrice = product ? parseFloat(product.price) : parseFloat(reseller.sale_price || 15.00);
  const costPrice = product ? parseFloat(product.cost_price) : parseFloat(reseller.cost_per_link || 2.99);

  // Aplica cupom, se informado
  let discount = 0;
  let couponRow = null;
  if (coupon_code && String(coupon_code).trim()) {
    const v = await validateCouponDb(coupon_code, unitPrice);
    if (!v || v.error) {
      return res.status(400).json({ success: false, error: (v && v.error) || 'Cupom inválido.' });
    }
    discount = v.discount;
    couponRow = v.coupon;
  }
  const total = Math.max(0, Math.round((unitPrice - discount) * 100) / 100);

  const method = (payment_method || 'BALANCE').toUpperCase();
  const now = new Date().toISOString();
  const orderCode = generateOrderCode();

  // Fluxo instantâneo (saldo do revendedor)
  if (method === 'BALANCE') {
    if (parseFloat(reseller.credits || 0) < costPrice) {
      return res.status(402).json({
        success: false,
        error: `Saldo insuficiente para gerar o link. Custo: R$ ${costPrice.toFixed(2).replace('.', ',')}.`,
        code: 'NO_BALANCE'
      });
    }
    await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits - ? AS NUMERIC), 2) WHERE id = ?').run(costPrice, reseller.id);

    const generation = await dbHelpers.generateLink(`order:${orderCode}`, reseller.id, ip);
    if (couponRow) {
      await dbHelpers.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponRow.id);
    }

    const insert = await dbHelpers.db.prepare(`
      INSERT INTO orders (order_code, reseller_id, product_id, product_name, customer_name, customer_id, customer_contact, unit_price, discount, total, coupon_code, status, payment_method, token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', 'BALANCE', ?, ?, ?) RETURNING id
    `).run(
      orderCode,
      reseller.id,
      product ? product.id : null,
      product ? product.name : 'Spotify Premium 3 Meses',
      customer_name || null,
      customer_id || null,
      customer_contact || null,
      unitPrice,
      discount,
      total,
      couponRow ? couponRow.code : null,
      generation.token,
      now,
      now
    );
    const orderId = insert.lastInsertRowid;

    await dbHelpers.db.prepare(`
      INSERT INTO sales (reseller_id, token, target_url, customer_name, customer_id, customer_contact, sale_price, cost_price, profit, delivery_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Entregue (Pedido)', ?)
    `).run(
      reseller.id,
      generation.token,
      generation.targetUrl,
      customer_name || 'Cliente Bot',
      customer_id || 'bot',
      customer_contact || 'Via Bot',
      total,
      costPrice,
      Math.max(0, Math.round((total - costPrice) * 100) / 100),
      now
    );

    await dbHelpers.db.prepare(`
      INSERT INTO payments (order_id, reseller_id, provider, external_id, amount, currency, status, metadata, created_at, updated_at)
      VALUES (?, ?, 'BALANCE', ?, ?, 'BRL', 'confirmed', ?, ?, ?)
    `).run(orderId, reseller.id, orderCode, total, JSON.stringify({ method: 'instant' }), now, now);

    const updated = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(reseller.id);
    return res.json({
      success: true,
      order_code: orderCode,
      order_id: orderId ? Number(orderId) : null,
      product: product ? product.name : 'Spotify Premium 3 Meses',
      unit_price: unitPrice,
      discount,
      total,
      coupon_code: couponRow ? couponRow.code : null,
      status: 'delivered',
      token: generation.token,
      link: generation.targetUrl,
      balance_remaining: parseFloat(updated.credits)
    });
  }

  // Fluxo com pagamento externo (PIX manual via painel ou cripto NOWPayments)
  if (couponRow) {
    await dbHelpers.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponRow.id);
  }
  const insert = await dbHelpers.db.prepare(`
    INSERT INTO orders (order_code, reseller_id, product_id, product_name, customer_name, customer_id, customer_contact, unit_price, discount, total, coupon_code, status, payment_method, token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?) RETURNING id
  `).run(
    orderCode,
    reseller.id,
    product ? product.id : null,
    product ? product.name : 'Spotify Premium 3 Meses',
    customer_name || null,
    customer_id || null,
    customer_contact || null,
    unitPrice,
    discount,
    total,
    couponRow ? couponRow.code : null,
    method === 'NOWPAYMENTS' ? 'NOWPAYMENTS' : 'PIX',
    null,
    now,
    now
  );
  const orderId = insert.lastInsertRowid;

  if (method === 'NOWPAYMENTS') {
    const npKey = process.env.NOWPAYMENTS_API_KEY;
    let invoice = null;
    if (npKey) {
      try {
        const resp = await fetch('https://api.nowpayments.io/v1/invoice', {
          method: 'POST',
          headers: { 'x-api-key': npKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            price_amount: total,
            price_currency: 'BRL',
            order_id: orderCode,
            order_description: `Pedido ${orderCode}`
          })
        });
        invoice = await resp.json();
      } catch (e) {
        console.error('[nowpayments create invoice]', e && e.message ? e.message : e);
      }
    }
    const externalId = (invoice && invoice.id) ? invoice.id : null;
    const meta = JSON.stringify({ mock: !externalId, invoice: invoice || null });
    await dbHelpers.db.prepare(`
      INSERT INTO payments (order_id, reseller_id, provider, external_id, amount, currency, status, metadata, created_at, updated_at)
      VALUES (?, ?, 'NOWPAYMENTS', ?, ?, ?, 'pending', ?, ?, ?)
    `).run(orderId, reseller.id, externalId, total, 'BRL', meta, now, now);

    return res.json({
      success: true,
      order_id: Number(orderId),
      order_code: orderCode,
      total,
      status: 'pending',
      payment: {
        provider: 'NOWPAYMENTS',
        payment_url: (invoice && invoice.invoice_url) ? invoice.invoice_url : null,
        invoice_id: externalId,
        mock: !externalId
      }
    });
  }

  // PIX: instruções de pagamento (recarga manual no painel do revendedor)
  await dbHelpers.db.prepare(`
    INSERT INTO payments (order_id, reseller_id, provider, external_id, amount, currency, status, metadata, created_at, updated_at)
    VALUES (?, ?, 'PIX', ?, ?, 'BRL', 'pending', ?, ?, ?)
  `).run(orderId, reseller.id, null, total, JSON.stringify({ instructions: 'Pagar via PIX no painel do revendedor ou recarregar saldo' }), now, now);

  res.json({
    success: true,
    order_id: Number(orderId),
    order_code: orderCode,
    total,
    status: 'pending',
    payment: {
      provider: 'PIX',
      mock: true,
      instructions: 'Faça a recarga via PIX no painel do revendedor; o admin confirma e o pedido é entregue automaticamente.'
    }
  });
});

// Consulta o status de um pedido pelo código
app.get('/api/v1/orders/:order_code', resellerBotAuth, async (req, res) => {
  const order = await dbHelpers.db.prepare('SELECT * FROM orders WHERE order_code = ? AND reseller_id = ?')
    .get(String(req.params.order_code).toUpperCase(), req.reseller.id);
  if (!order) return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
  res.json({
    success: true,
    order: {
      id: Number(order.id),
      order_code: order.order_code,
      product_name: order.product_name,
      total: parseFloat(order.total),
      discount: parseFloat(order.discount),
      coupon_code: order.coupon_code,
      status: order.status,
      token: order.token,
      created_at: order.created_at
    }
  });
});

// Webhook do NOWPayments (confirma pagamento cripto e entrega o pedido)
app.post('/api/webhooks/nowpayments', async (req, res) => {
  const body = req.body || {};
  const status = String(body.payment_status || body.status || '').toLowerCase();
  const orderCode = String(body.order_id || body.orderCode || (body.metadata && body.metadata.order_code) || '').toUpperCase();

  // Protocolo de verificação de IPN (v2): responder com o hash do payment_id
  if (req.headers['x-nowpayments-sig'] && body.payment_id) {
    return res.json({ status: 1 });
  }

  if (!orderCode || !['confirmed', 'finished'].includes(status)) {
    return res.json({ status: 0 });
  }

  try {
    const order = await dbHelpers.db.prepare('SELECT * FROM orders WHERE order_code = ?').get(orderCode);
    if (!order) return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });

    await dbHelpers.db.prepare(`
      UPDATE payments SET status = 'confirmed', external_id = ?, updated_at = ?
      WHERE order_id = ? AND provider = 'NOWPAYMENTS'
    `).run(body.payment_id ? String(body.payment_id) : null, new Date().toISOString(), order.id);

    await dbHelpers.db.prepare("UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), order.id);

    const delivery = await deliverOrder(order.id);
    return res.json({
      status: 1,
      success: true,
      order_code: orderCode,
      delivered: delivery.success,
      reason: delivery.reason || null
    });
  } catch (e) {
    dbHelpers.logError({ endpoint: '/api/webhooks/nowpayments', method: 'POST', statusCode: 500, errorType: 'WebhookError', message: e && e.message ? e.message : String(e), source: 'webhook' });
    return res.status(500).json({ status: 0, success: false });
  }
});

// ---------- ADMIN: PRODUTOS ----------
app.get('/api/admin/products', adminAuth, async (req, res) => {
  const products = await dbHelpers.db.prepare('SELECT * FROM products ORDER BY sort_order ASC, id ASC').all();
  res.json({ success: true, data: products.map((p) => ({ ...p, id: Number(p.id), price: parseFloat(p.price || 0), cost_price: parseFloat(p.cost_price || 0) })) });
});

app.post('/api/admin/products', adminAuth, async (req, res) => {
  const { name, description, price, cost_price, emoji, active, sort_order } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Informe o nome do produto.' });
  const cleanPrice = Math.max(0, parseFloat(price) || 0);
  const cleanCost = Math.max(0, parseFloat(cost_price));
  const now = new Date().toISOString();
  const r = await dbHelpers.db.prepare(`
    INSERT INTO products (name, description, price, cost_price, emoji, active, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `).run(
    name.trim(),
    description ? String(description).trim() : null,
    cleanPrice,
    cleanCost,
    emoji || '🎁',
    active === false || active === 0 ? 0 : 1,
    parseInt(sort_order || '0', 10),
    now
  );
  res.json({ success: true, message: 'Produto criado com sucesso!', id: Number(r.lastInsertRowid) });
});

app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await dbHelpers.db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Produto não encontrado.' });
  const { name, description, price, cost_price, emoji, active, sort_order } = req.body;
  await dbHelpers.db.prepare(`
    UPDATE products SET name = ?, description = ?, price = ?, cost_price = ?, emoji = ?, active = ?, sort_order = ? WHERE id = ?
  `).run(
    name !== undefined ? String(name).trim() : existing.name,
    description !== undefined ? String(description).trim() : existing.description,
    price !== undefined ? Math.max(0, parseFloat(price) || 0) : existing.price,
    cost_price !== undefined ? Math.max(0, parseFloat(cost_price) || 0) : existing.cost_price,
    emoji !== undefined ? (emoji || '🎁') : existing.emoji,
    active !== undefined ? (active === false || active === 0 ? 0 : 1) : existing.active,
    sort_order !== undefined ? parseInt(sort_order || '0', 10) : existing.sort_order
  );
  res.json({ success: true, message: 'Produto atualizado com sucesso!' });
});

app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await dbHelpers.db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
  res.json({ success: true, message: 'Produto desativado com sucesso.' });
});

// ---------- ADMIN: CUPONS ----------
app.get('/api/admin/coupons', adminAuth, async (req, res) => {
  const coupons = await dbHelpers.db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
  res.json({ success: true, data: coupons.map((c) => ({ ...c, id: Number(c.id) })) });
});

app.post('/api/admin/coupons', adminAuth, async (req, res) => {
  const { code, discount_type, discount_value, max_uses, valid_until, active } = req.body;
  const cleanCode = code ? String(code).trim().toUpperCase().replace(/\s+/g, '') : '';
  if (!cleanCode) return res.status(400).json({ success: false, error: 'Informe o código do cupom.' });
  const value = parseFloat(discount_value);
  if (isNaN(value) || value <= 0) return res.status(400).json({ success: false, error: 'Valor de desconto inválido.' });
  if (discount_type === 'percent' && value > 100) return res.status(400).json({ success: false, error: 'Desconto percentual não pode passar de 100%.' });
  const dup = await dbHelpers.db.prepare('SELECT id FROM coupons WHERE code = ?').get(cleanCode);
  if (dup) return res.status(400).json({ success: false, error: 'Já existe um cupom com este código.' });
  const now = new Date().toISOString();
  const r = await dbHelpers.db.prepare(`
    INSERT INTO coupons (code, discount_type, discount_value, max_uses, used_count, valid_until, active, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?) RETURNING id
  `).run(
    cleanCode,
    discount_type === 'fixed' ? 'fixed' : 'percent',
    value,
    Math.max(0, parseInt(max_uses || '0', 10)),
    valid_until ? new Date(valid_until).toISOString() : null,
    active === false || active === 0 ? 0 : 1,
    now
  );
  res.json({ success: true, message: `Cupom ${cleanCode} criado com sucesso!`, id: Number(r.lastInsertRowid) });
});

app.put('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await dbHelpers.db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: 'Cupom não encontrado.' });
  const { code, discount_type, discount_value, max_uses, valid_until, active } = req.body;
  let cleanCode = existing.code;
  if (code !== undefined) {
    cleanCode = String(code).trim().toUpperCase().replace(/\s+/g, '');
    if (!cleanCode) return res.status(400).json({ success: false, error: 'Código inválido.' });
    const dup = await dbHelpers.db.prepare('SELECT id FROM coupons WHERE code = ? AND id != ?').get(cleanCode, id);
    if (dup) return res.status(400).json({ success: false, error: 'Código já em uso por outro cupom.' });
  }
  const value = discount_value !== undefined ? parseFloat(discount_value) : existing.discount_value;
  if (isNaN(value) || value <= 0) return res.status(400).json({ success: false, error: 'Valor de desconto inválido.' });
  await dbHelpers.db.prepare(`
    UPDATE coupons SET code = ?, discount_type = ?, discount_value = ?, max_uses = ?, valid_until = ?, active = ? WHERE id = ?
  `).run(
    cleanCode,
    discount_type !== undefined ? (discount_type === 'fixed' ? 'fixed' : 'percent') : existing.discount_type,
    value,
    max_uses !== undefined ? Math.max(0, parseInt(max_uses || '0', 10)) : existing.max_uses,
    valid_until !== undefined ? (valid_until ? new Date(valid_until).toISOString() : null) : existing.valid_until,
    active !== undefined ? (active === false || active === 0 ? 0 : 1) : existing.active
  );
  res.json({ success: true, message: 'Cupom atualizado com sucesso!' });
});

app.delete('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await dbHelpers.db.prepare('UPDATE coupons SET active = 0 WHERE id = ?').run(id);
  res.json({ success: true, message: 'Cupom desativado.' });
});

// ---------- ADMIN: PEDIDOS E PAGAMENTOS (FINANCEIRO) ----------
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  const status = req.query.status;
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 300);
  let query = `
    SELECT o.*, r.name as reseller_name
    FROM orders o
    LEFT JOIN resellers r ON r.id = o.reseller_id
  `;
  const params = [];
  if (status) {
    query += ' WHERE o.status = ?';
    params.push(status);
  }
  query += ' ORDER BY o.id DESC LIMIT ?';
  params.push(limit);
  const orders = await dbHelpers.db.prepare(query).all(...params);
  res.json({ success: true, data: orders.map((o) => ({ ...o, id: Number(o.id), total: parseFloat(o.total), unit_price: parseFloat(o.unit_price), discount: parseFloat(o.discount) })) });
});

app.post('/api/admin/orders/:id/status', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  const allowed = ['pending', 'paid', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, error: 'Status inválido.' });
  const order = await dbHelpers.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });

  await dbHelpers.db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);

  // Ao marcar como entregue sem token, tenta gerar o link automaticamente
  if (status === 'delivered' && !order.token) {
    const delivery = await deliverOrder(id);
    if (!delivery.success) {
      return res.json({
        success: true,
        message: `Pedido marcado como ${status}. Entrega automática falhou: ${delivery.reason === 'saldo_insuficiente' ? 'saldo insuficiente do revendedor' : delivery.reason}.`,
        delivery: delivery.reason
      });
    }
    return res.json({ success: true, message: 'Pedido marcado como entregue e link gerado automaticamente!', delivered: true });
  }

  res.json({ success: true, message: `Pedido #${order.order_code} atualizado para ${status}.` });
});

app.get('/api/admin/payments', adminAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 300);
  const payments = await dbHelpers.db.prepare(`
    SELECT p.*, o.order_code, o.product_name, r.name as reseller_name
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    LEFT JOIN resellers r ON r.id = p.reseller_id
    ORDER BY p.id DESC LIMIT ?
  `).all(limit);
  res.json({ success: true, data: payments.map((p) => ({ ...p, id: Number(p.id), amount: parseFloat(p.amount) })) });
});

// ---------- REVENDEDOR: PEDIDOS ----------
app.get('/api/reseller/orders', resellerUserAuth, async (req, res) => {
  const orders = await dbHelpers.db.prepare(`
    SELECT * FROM orders WHERE reseller_id = ? ORDER BY id DESC LIMIT 100
  `).all(req.reseller.id);
  res.json({ success: true, data: orders.map((o) => ({ ...o, id: Number(o.id), total: parseFloat(o.total), unit_price: parseFloat(o.unit_price), discount: parseFloat(o.discount) })) });
});

app.post('/api/reseller/orders/:id/cancel', resellerUserAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const order = await dbHelpers.db.prepare('SELECT * FROM orders WHERE id = ? AND reseller_id = ?').get(id, req.reseller.id);
  if (!order) return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
  if (order.status !== 'pending') return res.status(400).json({ success: false, error: 'Apenas pedidos pendentes podem ser cancelados.' });
  await dbHelpers.db.prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  res.json({ success: true, message: `Pedido #${order.order_code} cancelado.` });
});

// ==========================================
// ROTAS DO PAINEL ADMIN (GESTÃO GLOBAL)
// ==========================================

// Login Admin
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = getClientIp(req);

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Informe usuário e senha.' });
  }

  const admin = await dbHelpers.db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    dbHelpers.logError({
      endpoint: '/api/admin/login',
      method: 'POST',
      statusCode: 401,
      errorType: 'FailedAdminLogin',
      message: `Login admin com falha: "${username}".`,
      ip,
      source: 'admin'
    });
    return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos.' });
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    token,
    admin: { id: admin.id, username: admin.username }
  });
});

app.get('/api/admin/me', adminAuth, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// Estatísticas Globais do Admin
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const totalGenRow = await dbHelpers.db.prepare('SELECT COUNT(*) as count FROM generations').get();
  const totalGenerations = Number(totalGenRow ? totalGenRow.count : 0);
  
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  
  const todayGenRow = await dbHelpers.db.prepare(
    'SELECT COUNT(*) as count FROM generations WHERE created_at >= ?'
  ).get(todayIso);
  const todayGenerations = Number(todayGenRow ? todayGenRow.count : 0);

  // Revendedores e Vendas Totais da Plataforma
  const resellerStats = await dbHelpers.db.prepare(`
    SELECT 
      COUNT(*) as total, 
      SUM(CASE WHEN active = 1 AND blocked = 0 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked_count,
      SUM(credits) as total_credits
    FROM resellers
  `).get();

  const platformSales = await dbHelpers.db.prepare(`
    SELECT 
      COUNT(*) as total_sales,
      COALESCE(SUM(sale_price), 0) as total_gross_revenue,
      COALESCE(SUM(cost_price), 0) as total_admin_revenue
    FROM sales
  `).get();

  // Erros nas últimas 24h
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const errorsRow = await dbHelpers.db.prepare(
    'SELECT COUNT(*) as count FROM error_logs WHERE created_at >= ?'
  ).get(oneDayAgo);
  const errorsLast24h = Number(errorsRow ? errorsRow.count : 0);

  // Gráfico: Gerações nos últimos 7 dias
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const rawGenerationsTimeline = await dbHelpers.db.prepare(`
    SELECT substr(created_at, 1, 10) as date_day, COUNT(*) as count
    FROM generations
    WHERE created_at >= ?
    GROUP BY date_day
    ORDER BY date_day ASC
  `).all(sevenDaysAgo);

  const rawErrorsTimeline = await dbHelpers.db.prepare(`
    SELECT substr(created_at, 1, 10) as date_day, COUNT(*) as count
    FROM error_logs
    WHERE created_at >= ?
    GROUP BY date_day
    ORDER BY date_day ASC
  `).all(sevenDaysAgo);

  // Gráfico: Vendas por Revendedor
  const resellerBreakdown = await dbHelpers.db.prepare(`
    SELECT 
      r.name as label,
      COUNT(s.id) as count
    FROM resellers r
    JOIN sales s ON s.reseller_id = r.id
    GROUP BY r.name
    ORDER BY count DESC
    LIMIT 6
  `).all();

  res.json({
    success: true,
    kpis: {
      totalGenerations,
      todayGenerations,
      totalResellers: Number(resellerStats.total || 0),
      activeResellers: Number(resellerStats.active || 0),
      blockedResellers: Number(resellerStats.blocked_count || 0),
      circulatingCredits: Number(resellerStats.total_credits || 0),
      platformSalesCount: Number(platformSales.total_sales || 0),
      platformGrossRevenue: Number(platformSales.total_gross_revenue || 0).toFixed(2),
      errorsLast24h
    },
    charts: {
      generationsTimeline: rawGenerationsTimeline.map((r) => ({ ...r, count: Number(r.count) })),
      errorsTimeline: rawErrorsTimeline.map((r) => ({ ...r, count: Number(r.count) })),
      resellerBreakdown: resellerBreakdown.map((r) => ({ ...r, count: Number(r.count) }))
    }
  });
});

// Listagem de Todos os Revendedores no Painel Admin (Com Vendas e Faturamento)
app.get('/api/admin/resellers', adminAuth, async (req, res) => {
  const resellers = await dbHelpers.db.prepare(`
    SELECT 
      r.id, r.name, r.email, r.phone, r.api_key, r.credits, r.active, r.blocked, 
      r.sale_price, r.cost_per_link, r.notes, r.created_at,
      COUNT(s.id) as total_links_sold,
      COALESCE(SUM(s.sale_price), 0) as total_revenue_sold,
      COALESCE(SUM(s.profit), 0) as total_profit_earned
    FROM resellers r
    LEFT JOIN sales s ON s.reseller_id = r.id
    GROUP BY r.id
    ORDER BY r.id DESC
  `).all();

  res.json({
    success: true,
    data: resellers.map((r) => ({
      ...r,
      id: Number(r.id),
      credits: Number(r.credits || 0),
      total_links_sold: Number(r.total_links_sold || 0),
      total_revenue_sold: Number(r.total_revenue_sold || 0),
      total_profit_earned: Number(r.total_profit_earned || 0)
    }))
  });
});

// Bloquear ou Desbloquear Revendedor Instantaneamente
app.post('/api/admin/resellers/:id/toggle-block', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reseller = await dbHelpers.db.prepare('SELECT id, name, blocked FROM resellers WHERE id = ?').get(id);

  if (!reseller) {
    return res.status(404).json({ success: false, error: 'Revendedor não encontrado.' });
  }

  const newBlockedState = reseller.blocked === 1 ? 0 : 1;
  await dbHelpers.db.prepare('UPDATE resellers SET blocked = ? WHERE id = ?').run(newBlockedState, id);

  res.json({
    success: true,
    message: newBlockedState === 1 
      ? `Revendedor "${reseller.name}" foi BLOQUEADO com sucesso! O bot dele foi suspenso.` 
      : `Revendedor "${reseller.name}" foi DESBLOQUEADO e o bot já pode operar.`,
    blocked: newBlockedState === 1
  });
});

// Adicionar / Ajustar Saldo do Revendedor pelo Admin (em Reais)
app.post('/api/admin/resellers/:id/credits', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { credits, mode } = req.body; // mode: 'add' or 'set'

  const reseller = await dbHelpers.db.prepare('SELECT id, name, credits FROM resellers WHERE id = ?').get(id);
  if (!reseller) {
    return res.status(404).json({ success: false, error: 'Revendedor não encontrado.' });
  }

  const parsedCredits = parseFloat(credits);
  if (isNaN(parsedCredits)) {
    return res.status(400).json({ success: false, error: 'Valor de saldo inválido.' });
  }

  let finalCredits = parsedCredits;
  if (mode === 'add') {
    finalCredits = parseFloat(reseller.credits || 0) + parsedCredits;
  }

  finalCredits = Math.max(0, parseFloat(finalCredits.toFixed(2)));

  await dbHelpers.db.prepare('UPDATE resellers SET credits = ? WHERE id = ?').run(finalCredits, id);

  res.json({
    success: true,
    message: `Saldo de ${reseller.name} atualizado para R$ ${finalCredits.toFixed(2).replace('.', ',')}!`,
    credits: finalCredits,
    balance: finalCredits.toFixed(2)
  });
});

// Excluir Revendedor
app.delete('/api/admin/resellers/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await dbHelpers.db.prepare('DELETE FROM sales WHERE reseller_id = ?').run(id);
  await dbHelpers.db.prepare('DELETE FROM recharges WHERE reseller_id = ?').run(id);
  await dbHelpers.db.prepare('DELETE FROM resellers WHERE id = ?').run(id);

  res.json({ success: true, message: 'Revendedor e seus registros foram removidos com sucesso.' });
});

// Relatório Global de Vendas de Todos os Revendedores
app.get('/api/admin/all-sales', adminAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
  const q = (req.query.q || '').toString().trim();

  let sql = `
    SELECT 
      s.id, s.token, s.target_url, s.customer_name, s.customer_id, s.customer_contact, 
      s.sale_price, s.cost_price, s.profit, s.delivery_status, s.created_at,
      r.name as reseller_name, r.email as reseller_email
    FROM sales s
    JOIN resellers r ON s.reseller_id = r.id
  `;
  const params = [];
  if (q) {
    // Escapa metas LIKE (% _ !) e usa ESCAPE '!' (compatível com SQLite e PostgreSQL)
    const term = q.replace(/([%_!])/g, '!$1');
    const like = `%${term}%`;
    sql += ` WHERE LOWER(s.token) LIKE LOWER(?) ESCAPE '!'
        OR LOWER(s.customer_name) LIKE LOWER(?) ESCAPE '!'
        OR LOWER(s.customer_id) LIKE LOWER(?) ESCAPE '!'
        OR LOWER(s.customer_contact) LIKE LOWER(?) ESCAPE '!'
        OR LOWER(r.name) LIKE LOWER(?) ESCAPE '!'
        OR LOWER(r.email) LIKE LOWER(?) ESCAPE '!'`;
    params.push(like, like, like, like, like, like);
  }
  sql += ` ORDER BY s.id DESC
    LIMIT ?`;
  params.push(limit);

  const sales = await dbHelpers.db.prepare(sql).all(...params);

  res.json({ success: true, data: sales });
});

// Clientes Globais (agrupados a partir das vendas) com busca por ID, nome ou contato
app.get('/api/admin/customers', adminAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
  const q = (req.query.q || '').toString().trim();

  let sql = `
    SELECT
      s.customer_id,
      s.customer_name,
      s.customer_contact,
      COUNT(*) AS purchase_count,
      SUM(COALESCE(s.sale_price, 0)) AS total_spent,
      MAX(s.created_at) AS last_purchase
    FROM sales s
  `;
  const params = [];
  if (q) {
    const term = q.replace(/([%_!])/g, '!$1');
    const like = `%${term}%`;
    sql += ` WHERE LOWER(s.customer_name) LIKE LOWER(?) ESCAPE '!'
        OR LOWER(s.customer_id) LIKE LOWER(?) ESCAPE '!'
        OR LOWER(s.customer_contact) LIKE LOWER(?) ESCAPE '!'`;
    params.push(like, like, like);
  }
  sql += ` GROUP BY s.customer_id, s.customer_name, s.customer_contact
    ORDER BY last_purchase DESC
    LIMIT ?`;
  params.push(limit);

  const customers = await dbHelpers.db.prepare(sql).all(...params);

  res.json({ success: true, data: customers });
});

// Logs de Erros
app.get('/api/admin/logs', adminAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 200);
  const source = req.query.source;

  let query = 'SELECT * FROM error_logs';
  const params = [];

  if (source) {
    query += ' WHERE source = ?';
    params.push(source);
  }

  query += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const logs = await dbHelpers.db.prepare(query).all(...params);
  res.json({ success: true, data: logs });
});

app.delete('/api/admin/logs', adminAuth, async (req, res) => {
  await dbHelpers.db.prepare('DELETE FROM error_logs').run();
  res.json({ success: true, message: 'Todos os logs de erro foram limpos com sucesso.' });
});

// Configurações Globais
app.get('/api/admin/settings', adminAuth, async (req, res) => {
  res.json({ success: true, data: await dbHelpers.getSettings() });
});

app.post('/api/admin/settings', adminAuth, async (req, res) => {
  const { 
    target_link, 
    link_mode, 
    link_template, 
    app_base_url, 
    redirect_type, 
    service_name, 
    token_length, 
    default_expiry_hours, 
    public_generation_enabled 
  } = req.body;

  if (target_link !== undefined) await dbHelpers.updateSetting('target_link', target_link.trim());
  if (link_mode !== undefined) await dbHelpers.updateSetting('link_mode', link_mode);
  if (link_template !== undefined) await dbHelpers.updateSetting('link_template', link_template.trim());
  if (app_base_url !== undefined) await dbHelpers.updateSetting('app_base_url', app_base_url.trim());
  if (redirect_type !== undefined) await dbHelpers.updateSetting('redirect_type', redirect_type);
  if (service_name !== undefined) await dbHelpers.updateSetting('service_name', service_name.trim());
  if (token_length !== undefined) await dbHelpers.updateSetting('token_length', token_length.toString());
  if (default_expiry_hours !== undefined) await dbHelpers.updateSetting('default_expiry_hours', default_expiry_hours.toString());
  if (public_generation_enabled !== undefined) await dbHelpers.updateSetting('public_generation_enabled', public_generation_enabled ? '1' : '0');

  res.json({ success: true, message: 'Configurações atualizadas com sucesso!', data: await dbHelpers.getSettings() });
});

// ==========================================
// HEALTH CHECK (usado pelo monitoramento 24/7 e pelo keep-alive do bot)
// ==========================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', backend: dbHelpers.getBackend(), uptime: process.uptime(), time: new Date().toISOString() });
});

// ==========================================
// MIDDLEWARE DE ERRO GLOBAL (sempre o último)
// ==========================================
app.use((err, req, res, next) => {
  console.error('[server error]', err && err.message ? err.message : err);
  dbHelpers.logError({
    endpoint: req.originalUrl,
    method: req.method,
    statusCode: 500,
    errorType: 'ServerError',
    message: err && err.message ? err.message : String(err),
    ip: getClientIp(req),
    source: 'server',
    details: err && err.stack ? err.stack : null
  });
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ success: false, error: 'Erro interno do servidor. Tente novamente em instantes.' });
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// (aguarda o banco de dados ficar pronto antes de escutar)
// ==========================================
dbHelpers.initDb()
  .then(async () => {
    // Nuvem 24/7 (Render): garante que os links gerados usem a URL pública do serviço
    const autoBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
    if (autoBaseUrl) {
      const settings = await dbHelpers.getSettings();
      const currentBase = (settings.app_base_url || '').replace(/\/+$/, '');
      if (currentBase !== autoBaseUrl) {
        await dbHelpers.updateSetting('app_base_url', autoBaseUrl);
        console.log(`🔗 app_base_url ajustado automaticamente para: ${autoBaseUrl}`);
      }
    }
    app.listen(PORT, () => {
      console.log(`===================================================`);
      console.log(`🚀 Quantum Link Generator rodando na porta ${PORT}`);
      console.log(`🔗 Gerador Público:       http://localhost:${PORT}`);
      console.log(`💼 Portal do Revendedor:  http://localhost:${PORT}/revendedor.html`);
      console.log(`🛡️  Painel Admin:           http://localhost:${PORT}/admin.html`);
      console.log(`🤖 API para Bots:          http://localhost:${PORT}/api/v1/generate`);
      console.log(`🗄️  Banco de dados:         ${dbHelpers.getBackend()}`);
      console.log(`===================================================`);
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar o banco de dados:', err);
    process.exit(1);
  });

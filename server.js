require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbHelpers = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_gerador_painel_2026';

// ==========================================
// BOT DE ALERTAS DE VENDAS (TELEGRAM)
// Usa um SEGUNDO bot (criado no @BotFather) para notificar cada nova compra.
// Se NOTIFIER_BOT_TOKEN estiver vazio, usa o token do bot principal.
// ==========================================
const NOTIFIER_BOT_TOKEN = process.env.NOTIFIER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const NOTIFY_CHAT_ID = process.env.NOTIFY_CHAT_ID || '';

// ==========================================
// MERCADO PAGO (recarga automática de saldo)
// ------------------------------------------
// MERCADOPAGO_ACCESS_TOKEN: Access Token da aplicação (Desenvolvedores -> Apps)
// MERCADOPAGO_WEBHOOK_SECRET: Secret do webhook (opcional, válida a assinatura X-Signature)
// ==========================================
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN 
  || process.env.MP_ACCESS_TOKEN 
  || process.env.MERCADO_PAGO_ACCESS_TOKEN 
  || process.env.MERCADOPAGO_TOKEN 
  || '';
const MERCADOPAGO_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET 
  || process.env.MP_WEBHOOK_SECRET 
  || '';
const MP_API_BASE = 'https://api.mercadopago.com';

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

// Helper: escapa HTML para uso com parse_mode HTML do Telegram
const escHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// Helper: identifica o usuário que comprou e marca o @ do Telegram da pessoa
const customerLabel = (name, id, contact) => {
  const c = String(contact || '').trim();
  const n = String(name || '').trim();
  const rawId = String(id || '').replace(/^tg_/, '').trim();
  const numFromContact = c.replace(/^@?ID:\s*/i, '').replace(/^tg_/i, '').trim();
  const effectiveId = (/^\d+$/.test(rawId) ? rawId : null) || (/^\d+$/.test(numFromContact) ? numFromContact : null);

  // 1) Se já tem @ no contact (ex: "@edu_coffe")
  if (c.startsWith('@') && !/^@ID:\s*/i.test(c)) {
    return escHtml(c);
  }

  // 2) Se o contact é um username Telegram direto (sem espaços, sem "ID:")
  if (c && !c.includes(' ') && !/^ID:/i.test(c) && /^[a-zA-Z0-9_]{3,32}$/.test(c)) {
    return '@' + escHtml(c);
  }

  // 3) Se o nome veio com @
  if (n.startsWith('@')) {
    return escHtml(n);
  }

  // 4) Se temos ID numérico do Telegram (ex.: 123456789), cria menção interativa com @ no Telegram
  if (effectiveId) {
    const displayName = n && n !== 'Cliente Anônimo' && n !== 'Cliente Telegram' && !/^ID:/i.test(n) ? n : 'cliente';
    return `<a href="tg://user?id=${effectiveId}">@${escHtml(displayName)}</a>`;
  }

  // 5) Se temos apenas o nome
  if (n && n !== 'Cliente Anônimo' && n !== 'Cliente Telegram' && !/^ID:/i.test(n)) {
    const clean = n.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    return clean ? `@${escHtml(clean)}` : `@${escHtml(n)}`;
  }

  return '@cliente';
};

const formatMoneyBr = (value) => {
  const n = parseFloat(value || 0);
  return 'R$ ' + n.toFixed(2).replace('.', ',');
};

// Mascara telefone/ID para a notificação (ex.: 7740000084 -> 774***84)
const maskUserId = (value) => {
  const s = String(value == null ? '' : value).replace(/\D/g, '');
  if (s.length <= 5) return s || '—';
  return s.slice(0, 3) + '***' + s.slice(-2);
};

// Custo do produto definido pelo ADMIN (settings.admin_cost_per_link) — com cache
let _adminCostCache = null;
async function getAdminCost() {
  if (_adminCostCache != null) return _adminCostCache;
  try {
    const s = await dbHelpers.getSettings();
    _adminCostCache = parseFloat(s.admin_cost_per_link || 2.99);
  } catch (e) {
    _adminCostCache = 2.99;
  }
  return _adminCostCache;
}

async function telegramGet(token, method) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`);
  return r.json();
}

async function telegramPost(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

// Envia mensagem pelo bot de alertas e loga o resultado
async function sendTelegramAlert(text, chatId, orderNumber) {
  const resp = await fetch(`https://api.telegram.org/bot${NOTIFIER_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram sendMessage falhou (HTTP ${resp.status}): ${body.slice(0, 300)}`);
  }
  console.log(`🔔 Alerta enviado: pedido ${orderNumber || 'INIT'}`);
}

// Retorna todos os IDs de chat que devem receber alertas (NOTIFY_CHAT_ID + inscritos no bot)
async function getNotificationChatIds() {
  const ids = new Set();
  if (NOTIFY_CHAT_ID && String(NOTIFY_CHAT_ID).trim()) {
    ids.add(String(NOTIFY_CHAT_ID).trim());
  }
  const adminChatId = (process.env.NOTIFY_ADMIN_CHAT_ID || '').trim();
  if (adminChatId) ids.add(adminChatId);

  try {
    const subs = await dbHelpers.getNotificationSubscribers();
    for (const s of subs) {
      if (s && String(s).trim()) ids.add(String(s).trim());
    }
  } catch (e) {
    console.warn('Erro ao carregar inscritos de notificação:', e.message);
  }
  return Array.from(ids);
}

// Monta o feed das últimas notificações registradas para exibir no bot
async function getRecentNotificationsFeed() {
  try {
    const txs = await dbHelpers.db.prepare(`
      SELECT customer_name, customer_contact, customer_id, type, description, product_name, amount, created_at, order_number
      FROM financial_transactions
      ORDER BY id DESC
      LIMIT 5
    `).all();

    if (!txs || txs.length === 0) {
      return '<i>Nenhuma notificação recente registrada no momento.</i>';
    }

    const items = txs.map((t, idx) => {
      const isDeposit = t.type === 'deposit';
      const title = isDeposit ? '💳 Recarga PIX Aprovada!' : '🎉 Nova Compra!';
      const prod = t.product_name || (isDeposit ? 'Depósito de Saldo' : 'Spotify Premium');
      const val = formatMoneyBr(Math.abs(Number(t.amount || 0)));
      const client = customerLabel(t.customer_name, t.customer_id, t.customer_contact);
      const date = t.created_at ? new Date(t.created_at).toLocaleString('pt-BR') : '';
      const order = t.order_number ? `\n🔖 Nº do Pedido: <code>${escHtml(t.order_number)}</code>` : '';

      return (
        `<b>${idx + 1}. ${title}</b>\n` +
        `▪️ Serviço: ${escHtml(prod)}\n` +
        `👤 Cliente: ${client}\n` +
        `📈 Valor: <b>${val}</b>` +
        order +
        (date ? `\n🕒 ${date}` : '')
      );
    });

    return items.join('\n\n━━━━━━━━━━━━━━━\n\n');
  } catch (e) {
    return '<i>Erro ao carregar notificações recentes.</i>';
  }
}

// Instância e inicializador do bot de notificações (Dark Vendas) para novos inscritos
let notifierBotInstance = null;
function initNotifierBotListener() {
  if (!NOTIFIER_BOT_TOKEN) return;
  // Se for token diferente do bot de vendas, inicia polling para o bot de notificações
  if (NOTIFIER_BOT_TOKEN !== process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const TelegramBot = require('node-telegram-bot-api');
      notifierBotInstance = new TelegramBot(NOTIFIER_BOT_TOKEN, { polling: true });

      notifierBotInstance.on('polling_error', (e) => {
        console.warn('[notifierBot polling_error]:', e && e.message ? e.message : e);
      });

      const sendWelcome = async (msg) => {
        const chatId = msg.chat.id;
        await dbHelpers.addNotificationSubscriber({
          chatId,
          firstName: msg.from && msg.from.first_name,
          username: msg.from && msg.from.username
        });
        const recent = await getRecentNotificationsFeed();
        const text =
          `🔔 <b>DARK VENDAS — NOTIFICAÇÕES EM TEMPO REAL</b>\n\n` +
          `✅ <b>Inscrição Ativada com Sucesso!</b>\n` +
          `Você agora receberá aqui em tempo real cada nova compra e recarga aprovada!\n\n` +
          `━━━━━━━━━━━━━━━\n` +
          `📊 <b>ÚLTIMAS NOTIFICAÇÕES:</b>\n` +
          `━━━━━━━━━━━━━━━\n\n` +
          recent;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Atualizar Notificações', callback_data: 'refresh_feed' }]
            ]
          }
        };
        await notifierBotInstance.sendMessage(chatId, text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
      };

      notifierBotInstance.onText(/\/start|\/notificacoes|\/vendas/, sendWelcome);
      notifierBotInstance.on('message', async (msg) => {
        if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/notificacoes') || msg.text.startsWith('/vendas'))) return;
        await sendWelcome(msg);
      });

      notifierBotInstance.on('callback_query', async (query) => {
        notifierBotInstance.answerCallbackQuery(query.id).catch(() => {});
        if (query.data === 'refresh_feed') {
          const recent = await getRecentNotificationsFeed();
          const text =
            `🔔 <b>DARK VENDAS — NOTIFICAÇÕES EM TEMPO REAL</b>\n\n` +
            `✅ <b>Inscrição Ativa!</b> Alertas em tempo real ativados.\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📊 <b>ÚLTIMAS NOTIFICAÇÕES (Atualizado):</b>\n` +
            `━━━━━━━━━━━━━━━\n\n` +
            recent;
          const keyboard = {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Atualizar Notificações', callback_data: 'refresh_feed' }]
              ]
            }
          };
          await notifierBotInstance.editMessageText(text, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            ...keyboard
          }).catch(() => {});
        }
      });

      console.log('🤖 Bot de Notificações (Dark Vendas) ouvindo mensagens via polling.');
    } catch (err) {
      console.error('Falha ao inicializar notifierBotInstance:', err.message);
    }
  }
}

// Lê a logo da marca embutida no repositório (assets/bot-logo.jpg)
function readLocalLogo() {
  try {
    const p = path.join(__dirname, 'assets', 'bot-logo.jpg');
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      if (buf && buf.length > 1000) return buf;
    }
  } catch (e) { /* sem logo local */ }
  return null;
}

// Aplica uma foto de perfil (InputProfilePhoto static) em um bot do Telegram
async function setBotProfilePhoto(token, photoBuf) {
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://bot_photo' }));
  form.append('bot_photo', new Blob([photoBuf], { type: 'image/jpeg' }), 'bot_photo.jpg');
  const r = await fetch(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, { method: 'POST', body: form });
  return r.json();
}

// Aplica a logo + copia bio do bot de vendas (TELEGRAM_BOT_TOKEN) nos dois bots
async function syncTelegramProfile() {
  const salesToken = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!NOTIFIER_BOT_TOKEN || !salesToken) return;
  try {
    const me = await telegramGet(salesToken, 'getMe');
    const username = me.ok && me.result && me.result.username ? me.result.username : '';
    const handle = username ? '@' + username : '';

    // NOTA: NUNCA sobrescreve nome, bio ou descrição dos bots no startup.
    // As informações configuradas no Telegram (@BotFather ou próprio bot) são preservadas.

    // Foto da MARCA → aplicada no bot de vendas E no bot de alertas
    let photoBuf = readLocalLogo();
    // 1) Fallback: endpoint público de userpic do bot de vendas (funciona para bots)
    if (!photoBuf && username) {
      try {
        const upRes = await fetch(`https://t.me/i/userpic/320/${username}.jpg`);
        if (upRes.ok) {
          const buf = await upRes.arrayBuffer();
          if (buf && buf.byteLength >= 2000) photoBuf = buf;
        }
      } catch (e) { /* tenta fallback */ }
    }
    // 2) Fallback: getUserProfilePhotos (só funciona para usuários, não bots)
    if (!photoBuf) {
      try {
        const up = await telegramPost(salesToken, 'getUserProfilePhotos', { limit: 1 });
        if (up.ok && up.result && up.result.photos && up.result.photos.length > 0) {
          const largest = up.result.photos[0][up.result.photos[0].length - 1];
          const f = await telegramPost(salesToken, 'getFile', { file_id: largest.file_id });
          if (f.ok && f.result.file_path) {
            photoBuf = await fetch(`https://api.telegram.org/file/bot${salesToken}/${f.result.file_path}`).then((r) => r.arrayBuffer());
          }
        }
      } catch (e) { /* sem foto */ }
    }
    if (photoBuf) {
      const targets = [];
      if (salesToken) targets.push({ token: salesToken, label: 'bot de vendas' });
      if (NOTIFIER_BOT_TOKEN && NOTIFIER_BOT_TOKEN !== salesToken) targets.push({ token: NOTIFIER_BOT_TOKEN, label: 'bot de alertas' });
      for (const t of targets) {
        try {
          const setJson = await setBotProfilePhoto(t.token, photoBuf);
          if (setJson.ok) console.log(`🖼️ Foto do ${t.label} atualizada com a logo da marca.`);
          else console.warn(`⚠️ setMyProfilePhoto (${t.label}):`, setJson.description);
        } catch (e) {
          console.warn(`⚠️ setMyProfilePhoto (${t.label}) falhou:`, e.message);
        }
      }
    }
    console.log('🖼️ Foto e bio dos bots sincronizadas.');
  } catch (err) {
    console.error('syncTelegramProfile falhou:', err.message);
  }
}

// Próximo número de pedido (usado nas mensagens de falha quando a venda
// ainda não foi gravada — ex.: estorno automático após falha na entrega)
async function nextOrderNumber() {
  try {
    const row = await dbHelpers.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sales').get();
    return row && row.next_id ? Number(row.next_id) : 0;
  } catch (e) {
    return 0;
  }
}

// Estorno automático: devolve o custo debitado ao saldo do revendedor quando
// a entrega falha. Idempotente por construção (o chamador controla quem estorna).
async function autoRefund(resellerId, amount, extra = {}) {
  await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits + ? AS NUMERIC), 2) WHERE id = ?').run(amount, resellerId);
  dbHelpers.logError({
    endpoint: extra.endpoint || '/api/v1/generate',
    method: extra.method || 'POST',
    statusCode: extra.statusCode || 409,
    errorType: extra.errorType || 'DeliveryFailedRefund',
    message: extra.message || `Estorno automático de R$ ${Number(amount).toFixed(2)} para o revendedor #${resellerId}.`,
    ip: extra.ip || '127.0.0.1',
    source: extra.source || 'server',
    details: extra.details ? { ...extra.details, refunded: true, refund_amount: amount } : { refunded: true, refund_amount: amount }
  }).catch(() => {});
}

// ==========================================
// DEDUPLICAÇÃO E TRAVA DE CONCORRÊNCIA PARA RECARGAS E NOTIFICAÇÕES
// ==========================================
const _activeProcessingPayments = new Set();
const _rechargeNotifiedKeys = new Set();

// Envia alerta de nova venda para o bot de notificações do dono e para os inscritos
// Notifica no bot de alertas quando um revendedor recarrega o saldo (Garantia de envio único)
async function notifyRecharge({ reseller, amountPaid, method = 'PIX', paymentId = null, externalReference = null, customerName = null, customerContact = null, telegramId = null }) {
  if (!NOTIFIER_BOT_TOKEN) return;
  if (typeof fetch !== 'function') return;

  const recipients = await getNotificationChatIds();
  if (recipients.length === 0) return;

  // Deduplicação estrita: se a mesma recarga foi notificada nos últimos 5 minutos, bloqueia envio duplicado
  const dedupKey = (paymentId && `pid_${paymentId}`) || (externalReference && `ref_${externalReference}`) || null;
  if (dedupKey) {
    if (_rechargeNotifiedKeys.has(dedupKey)) {
      console.log(`[notifyRecharge] Notificação duplicada bloqueada para chave: ${dedupKey}`);
      return;
    }
    _rechargeNotifiedKeys.add(dedupKey);
    setTimeout(() => _rechargeNotifiedKeys.delete(dedupKey), 300000); // 5 minutos
  }

  // Prioriza o @ do Telegram do cliente / revendedor
  const tgId = telegramId || (reseller && reseller.telegram_id) || null;
  const cContact = customerContact || (reseller && reseller.phone) || null;
  const cName = customerName || (reseller && reseller.name) || null;
  const clientTag = customerLabel(cName, tgId, cContact);
  const methodLabel = `Depósito via ${escHtml(method)}${String(method).toLowerCase().includes('binance') ? ' 🟡' : ''}`;

  const lines = [
    '<b>💳 Novos créditos adicionados!</b>',
    '',
    `👤 Cliente: ${clientTag}`,
    `💵 Valor: ${formatMoneyBr(amountPaid)}`,
    `💳 Método: ${methodLabel}`
  ];

  for (const cid of recipients) {
    await sendTelegramAlert(lines.join('\n'), cid, 'RECHARGE-' + (dedupKey || Date.now())).catch((err) => {
      console.warn(`[notifyRecharge] falha ao enviar para chat ${cid}:`, err.message);
    });
  }
}

// ==========================================
// MERCADO PAGO — HELPERS
// ==========================================

// Obtém o Access Token efetivo do Mercado Pago (configuração do painel tem prioridade sobre o .env)
async function getEffectiveMpAccessToken() {
  try {
    const s = await dbHelpers.getSettings();
    if (s.payment_gateway_active === '0') {
      const err = new Error('O gateway de pagamentos está desativado pelo administrador.');
      err.paymentDisabled = true;
      throw err;
    }
    if (s.payment_mp_access_token && s.payment_mp_access_token.trim()) {
      return s.payment_mp_access_token.trim();
    }
  } catch (e) {
    if (e.paymentDisabled) throw e;
  }
  return MERCADOPAGO_ACCESS_TOKEN;
}

// Chama a API do Mercado Pago com o Access Token (fetch global do Node 22)
async function mpFetch(path, { method = 'GET', body = null, idempotencyKey = null } = {}) {
  const token = await getEffectiveMpAccessToken();
  if (!token) {
    const err = new Error('Access Token do Mercado Pago não configurado. Configure no painel admin ou no .env');
    err.mpNotConfigured = true;
    throw err;
  }
  const headers = {
    Authorization: `Bearer ${token}`
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${MP_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Mercado Pago API erro ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// Cria a preferência de pagamento (Checkout Pro) e registra no banco como pendente.
// Retorna o link de pagamento (init_point) — em credenciais de teste, sandbox_init_point.
async function mpCreatePreference({ resellerId, amount }) {
  const externalReference = `mp_recharge_${resellerId}_${crypto.randomBytes(6).toString('hex')}`;
  const baseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
  const roundedAmount = Math.round(parseFloat(amount) * 100) / 100;

  const notificationUrl = (baseUrl && baseUrl.startsWith('https://')) ? `${baseUrl}/api/v1/mp/webhook` : undefined;

  const pref = await mpFetch('/checkout/preferences', {
    method: 'POST',
    idempotencyKey: externalReference,
    body: {
      items: [{
        title: 'Recarga de saldo — revendedor',
        quantity: 1,
        unit_price: roundedAmount,
        currency_id: 'BRL'
      }],
      external_reference: externalReference,
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      back_urls: {
        success: `${baseUrl}/#mp_ok`,
        pending: `${baseUrl}/#mp_pending`,
        failure: `${baseUrl}/#mp_fail`
      },
      auto_return: 'approved',
      // Saldo é crédito à vista — sem parcelamento
      payment_methods: { installments: 1 }
    }
  });

  const now = new Date().toISOString();
  await dbHelpers.db.prepare(`
    INSERT INTO mp_payments (payment_id, preference_id, external_reference, reseller_id, amount, status, payment_method, processed, created_at, updated_at)
    VALUES (NULL, ?, ?, ?, ?, 'pending', 'Mercado Pago', 0, ?, ?)
  `).run(pref.id, externalReference, resellerId, roundedAmount, now, now);

  return {
    init_point: pref.init_point,
    sandbox_init_point: pref.sandbox_init_point,
    preference_id: pref.id,
    external_reference: externalReference,
    amount: roundedAmount
  };
}

// Monta a data de expiração do PIX no formato ISO 8601 com offset do Brasil (-03:00)
function mpPixExpiration(minutes) {
  const ttl = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  // Converte para o horário de Brasília (UTC-3) e formata com offset explícito
  const br = new Date(Date.now() + ttl * 60 * 1000 - 3 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${br.getUTCFullYear()}-${p(br.getUTCMonth() + 1)}-${p(br.getUTCDate())}T${p(br.getUTCHours())}:${p(br.getUTCMinutes())}:${p(br.getUTCSeconds())}.000-03:00`;
}

// Cria uma cobrança PIX (pagamento imediato, sem redirecionamento) e registra no banco como pendente.
// Retorna o QR Code (imagem base64 para o Telegram), o código copia-e-cola e o link do comprovante.
// Usada pelo bot do Telegram (pagamento direto no chat) e pelo painel web.
async function mpCreatePixPayment({ resellerId, amount, reseller, telegramId, customerName, customerContact }) {
  const externalReference = `mp_recharge_${resellerId}_${crypto.randomBytes(6).toString('hex')}`;
  const baseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
  const roundedAmount = Math.round(parseFloat(amount) * 100) / 100;
  const expirationMinutes = parseInt(process.env.MP_PIX_EXPIRATION_MINUTES || '30', 10);

  // O Mercado Pago exige o campo payer.email na API para gerar o PIX.
  // Para que NENHUM cliente precise de e-mail, o sistema usa um e-mail genérico válido.
  const payerEmail = (reseller && reseller.email && reseller.email.includes('@') && !reseller.email.endsWith('.local') && !reseller.email.endsWith('.telegram') && !reseller.email.endsWith('.internal') && reseller.email.includes('.'))
    ? reseller.email
    : 'pagamento.darkflix@gmail.com';
  const payerName = 'Cliente';

  const notificationUrl = (baseUrl && baseUrl.startsWith('https://')) ? `${baseUrl}/api/v1/mp/webhook` : undefined;

  const payment = await mpFetch('/v1/payments', {
    method: 'POST',
    idempotencyKey: externalReference,
    body: {
      transaction_amount: roundedAmount,
      description: `Recarga de saldo - ${(reseller && reseller.name) || 'DarkFlix'}`,
      payment_method_id: 'pix',
      external_reference: externalReference,
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      date_of_expiration: mpPixExpiration(expirationMinutes),
      payer: {
        email: payerEmail,
        first_name: payerName
      }
    }
  });

  const txData = (payment.point_of_interaction && payment.point_of_interaction.transaction_data) || {};

  const now = new Date().toISOString();
  await dbHelpers.db.prepare(`
    INSERT INTO mp_payments (payment_id, preference_id, external_reference, reseller_id, amount, status, payment_method, processed, telegram_id, customer_name, customer_contact, created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, ?, 'PIX', 0, ?, ?, ?, ?, ?)
  `).run(
    String(payment.id),
    externalReference,
    resellerId,
    roundedAmount,
    payment.status || 'pending',
    telegramId || null,
    customerName || null,
    customerContact || null,
    now,
    now
  );

  return {
    payment_id: String(payment.id),
    status: payment.status || 'pending',
    external_reference: externalReference,
    amount: roundedAmount,
    expires_at: payment.date_of_expiration || null,
    expiration_minutes: expirationMinutes,
    qr_code: txData.qr_code || null,
    qr_code_base64: txData.qr_code_base64 || null,
    ticket_url: txData.ticket_url || null
  };
}

// Valida a assinatura X-Signature do webhook (ativa apenas se MERCADOPAGO_WEBHOOK_SECRET estiver configurado)
function verifyMpSignature(req) {
  if (!MERCADOPAGO_WEBHOOK_SECRET) return true;
  const xSig = req.headers['x-signature'] || '';
  const xReqId = req.headers['x-request-id'] || '';
  const ts = (xSig.match(/ts=(\d+)/) || [])[1];
  const v1 = (xSig.match(/v1=([a-f0-9]+)/) || [])[1];
  const dataId = req.body && req.body.data ? req.body.data.id : '';
  if (!ts || !v1 || !dataId) return false;
  const manifest = `id:${dataId};request-id:${xReqId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(v1, 'hex'));
  } catch (e) {
    return false;
  }
}

// Processa um pagamento aprovado do Mercado Pago (fonte da verdade: consulta à API).
// Idempotente e Concorrência-Safe: se o payment_id já foi processado ou está em processamento, não credita de novo.
async function mpProcessApprovedPayment(paymentId) {
  const pIdStr = String(paymentId);
  if (_activeProcessingPayments.has(pIdStr)) {
    console.log(`[mpProcessApprovedPayment] Processamento concorrente já em andamento para paymentId=${pIdStr}. Ignorando.`);
    return { ok: true, alreadyProcessed: true };
  }
  _activeProcessingPayments.add(pIdStr);

  try {
    const payment = await mpFetch(`/v1/payments/${paymentId}`);
    const ref = String(payment.external_reference || '');

    // Só aceita pagamentos aprovados com referência de recarga do sistema
    if (payment.status !== 'approved') {
      return { ok: false, reason: `pagamento não aprovado (${payment.status || 'unknown'})` };
    }
    if (!ref.startsWith('mp_recharge_')) {
      return { ok: false, reason: 'external_reference inválida' };
    }

    // Idempotência por payment_id
    const byPaymentId = await dbHelpers.db.prepare('SELECT * FROM mp_payments WHERE payment_id = ?').get(pIdStr);
    if (byPaymentId && Number(byPaymentId.processed) === 1) {
      return { ok: true, alreadyProcessed: true };
    }

    const record = await dbHelpers.db.prepare('SELECT * FROM mp_payments WHERE external_reference = ?').get(ref);
    if (!record) {
      return { ok: false, reason: 'preferência de recarga não encontrada' };
    }
    if (Number(record.processed) === 1) {
      return { ok: true, alreadyProcessed: true };
    }

    // Valor pago deve bater com o valor da preferência (centavos)
    const expected = Math.round(Number(record.amount) * 100);
    const paid = Math.round(Number(payment.transaction_amount) * 100);
    if (expected !== paid) {
      return { ok: false, reason: `valor divergente (esperado ${expected}, pago ${paid})` };
    }

    const reseller = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE id = ?').get(record.reseller_id);
    if (!reseller) {
      return { ok: false, reason: 'revendedor não encontrado' };
    }

    const amount = Number(record.amount);
    const now = new Date().toISOString();

    // Rótulo do método: PIX (pagamento direto) ou Checkout Pro (link)
    const isPix = String(payment.payment_method_id || '').toLowerCase() === 'pix';
    const methodLabel = isPix ? 'Mercado Pago PIX' : 'Mercado Pago';

    // ATOMIC CLAIM: Apenas uma execução consegue alterar processed de 0 para 1
    const claim = await dbHelpers.db.prepare(
      'UPDATE mp_payments SET processed = 1, payment_id = ?, status = ?, payment_method = ?, updated_at = ? WHERE id = ? AND (processed = 0 OR processed IS NULL)'
    ).run(pIdStr, 'approved', methodLabel, now, record.id);

    if (!claim || claim.changes === 0) {
      console.log(`[mpProcessApprovedPayment] Claim atômico recusado (já processado concorrentemente) para paymentId=${pIdStr}`);
      return { ok: true, alreadyProcessed: true };
    }

    // Credita o saldo (R$) e registra a recarga como aprovada
    await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits + ? AS NUMERIC), 2) WHERE id = ?')
      .run(amount, record.reseller_id);
    await dbHelpers.db.prepare(`
      INSERT INTO recharges (reseller_id, credits, amount_paid, status, payment_method, created_at)
      VALUES (?, ?, ?, 'approved', ?, ?)
    `).run(record.reseller_id, Math.floor(amount / parseFloat(reseller.cost_per_link || 2.99)), amount, methodLabel, now);

    // Se houver telegram_id associado a esse pagamento, credita a carteira do cliente e lança no extrato
    let customer = null;
    if (record.telegram_id) {
      const cleanTg = String(record.telegram_id).replace(/^tg_/, '').trim();
      try {
        customer = await dbHelpers.db.prepare('SELECT id, name, username, balance FROM customers WHERE telegram_id = ? OR telegram_id = ?').get(cleanTg, 'tg_' + cleanTg);
        if (customer) {
          const cur = parseFloat(customer.balance || 0);
          const upd = Math.round((cur + amount) * 100) / 100;
          await dbHelpers.db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(upd.toFixed(2), customer.id);
          await dbHelpers.recordFinancialTransaction({
            customerId: cleanTg,
            customerName: customer.name || record.customer_name,
            customerContact: customer.username ? '@' + customer.username : record.customer_contact,
            type: 'deposit',
            description: 'Depósito PIX aprovado (Bot DarkFlix)',
            orderNumber: ref,
            amount: amount,
            balanceBefore: cur,
            balanceAfter: upd
          });
        }
      } catch (e) {
        console.error('Falha ao creditar cliente na recarga:', e.message);
      }
    }

    // Alerta no bot do dono com chave de deduplicação
    notifyRecharge({
      reseller,
      amountPaid: amount,
      method: methodLabel,
      paymentId: pIdStr,
      externalReference: ref,
      customerName: (customer && customer.name) || record.customer_name,
      customerContact: (customer && customer.username ? '@' + customer.username : null) || record.customer_contact,
      telegramId: record.telegram_id
    }).catch((e) => console.error('notifyRecharge (MP) falhou:', e.message));

    return { ok: true, alreadyProcessed: false, amount, reseller: reseller.name };
  } finally {
    // Mantém a trava por 2 minutos para evitar disparos repetidos de webhooks atrasados
    setTimeout(() => {
      _activeProcessingPayments.delete(pIdStr);
    }, 120000);
  }
}

async function notifyNewSale(opts = {}) {
  const {
    service = 'Spotify Premium',
    customerName,
    customerId,
    customerContact,
    plan = '3 Meses (Acesso Individual)',
    orderNumber,
    qty = 1,
    salePrice,
    costPrice,
    profit,
    resellerName,
    balanceRemaining,
    startup = false
  } = opts;

  if (!NOTIFIER_BOT_TOKEN) return;
  if (typeof fetch !== 'function') return; // Node < 18 sem fetch global

  const recipients = await getNotificationChatIds();
  if (recipients.length === 0) return;

  if (startup) {
    const lines = [
      '✅ <b>Sistema de Alertas de Vendas ativo!</b>',
      '',
      '🟢 Notificações de novas compras habilitadas.',
      `🕒 ${new Date().toLocaleString('pt-BR')}`
    ];
    for (const cid of recipients) {
      await sendTelegramAlert(lines.join('\n'), cid, 'INIT').catch(() => {});
    }
    return;
  }

  // Mensagem pública: sem revendedor, sem custo, sem lucro — o usuário que comprou é marcado pelo nome
  const base = [
    '🎉 Nova Compra!',
    '',
    `▪️ Serviço: ${escHtml(service)}`,
    `👤 Cliente: ${customerLabel(customerName, customerId, customerContact)}`,
    `🛍️ Plano: ${escHtml(plan)}`,
    `🔖 Nº do Pedido: ${escHtml(orderNumber)}`,
    `   Qtd.: ${qty}`,
    `📈 Total da Compra: ${salePrice != null && salePrice > 0 ? formatMoneyBr(salePrice) : 'Grátis'}`
  ];
  const stamp = `🕒 ${new Date().toLocaleString('pt-BR')}`;
  const publicLines = [...base, stamp];

  // Versão do admin: sem revendedor (lucro NUNCA aparece)
  const adminLines = [
    ...base,
    balanceRemaining != null ? `💰 Saldo Restante: ${formatMoneyBr(balanceRemaining)}` : null,
    stamp
  ].filter(Boolean);

  const adminChatId = (process.env.NOTIFY_ADMIN_CHAT_ID || '').trim();

  for (const cid of recipients) {
    const isDedicatedAdmin = adminChatId && cid === adminChatId;
    const msg = isDedicatedAdmin ? adminLines.join('\n') : publicLines.join('\n');
    await sendTelegramAlert(msg, cid, orderNumber).catch((err) => {
      console.warn(`[notifyNewSale] falha ao enviar para chat ${cid}:`, err.message);
    });
  }
}

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
// -------------------------------------------------
// botKeyAuth: valida SOMENTE a chave de API e carrega o revendedor dono da
// chave. NÃO exige vínculo de Telegram — usado no "Minhas Compras" do bot,
// onde o cliente final não possui conta de revendedor vinculada.
// resellerBotAuth: botKeyAuth + vínculo opcional pelo header X-Telegram-Id.
// -------------------------------------------------
const botKeyAuth = async (req, res, next) => {
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

  let reseller = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE api_key = ?').get(apiKey);

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

  req.reseller = reseller;
  next();
};

const resellerBotAuth = async (req, res, next) => {
  // 1) Valida apenas a chave de API (em caso de falha, botKeyAuth já respondeu)
  let keyValid = false;
  await botKeyAuth(req, res, () => { keyValid = true; });
  if (!keyValid) return;

  // ==========================================
  // CONTA DO USUÁRIO NO TELEGRAM (Auto-provisionamento)
  // ------------------------------------------
  // Cada usuário do bot do Telegram tem sua própria conta e saldo individual.
  // Se for o primeiro acesso, cria automaticamente o cadastro no banco.
  // ==========================================
  const tgId = (req.headers['x-telegram-id'] || '').toString().trim();
  if (tgId) {
    const cleanTg = tgId.replace(/^tg_/, '');
    const tgUsername = (req.headers['x-telegram-username'] || '').toString().trim();
    const tgName = (req.headers['x-telegram-name'] || '').toString().trim();

    let byTg = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE telegram_id = ? OR telegram_id = ?').get(cleanTg, 'tg_' + cleanTg);
    if (!byTg) {
      let byCust = await dbHelpers.db.prepare('SELECT * FROM customers WHERE telegram_id = ? OR telegram_id = ?').get(cleanTg, 'tg_' + cleanTg);
      if (!byCust) {
        try {
          byCust = await dbHelpers.upsertCustomer({
            telegramId: cleanTg,
            username: tgUsername || null,
            name: tgName || `Cliente ${cleanTg}`
          });
        } catch (custErr) {
          console.error('[resellerBotAuth] erro ao auto-cadastrar customer:', custErr.message);
        }
      }

      const autoName = tgName || (byCust && byCust.name) || (tgUsername ? '@' + tgUsername : 'Cliente ' + cleanTg);
      const autoKey = 'cust_' + crypto.randomBytes(8).toString('hex');
      const initialBalance = byCust ? parseFloat(byCust.balance || 0) : 0;
      const isBlocked = byCust ? (byCust.blocked || 0) : 0;
      const now = new Date().toISOString();

      try {
        const ins = await dbHelpers.db.prepare(`
          INSERT INTO resellers (name, email, credits, active, blocked, telegram_id, api_key, sale_price, created_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, 2.99, ?) RETURNING id
        `).run(autoName, `cliente_${cleanTg}@gmail.com`, initialBalance, isBlocked, cleanTg, autoKey, now);
        const newId = ins.lastInsertRowid || (ins.rows && ins.rows[0] && ins.rows[0].id);
        if (newId) {
          byTg = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE id = ?').get(newId);
        }
      } catch (insErr) {
        console.error('[resellerBotAuth] erro ao auto-criar reseller:', insErr.message);
      }
      if (!byTg) {
        byTg = await dbHelpers.db.prepare('SELECT * FROM resellers WHERE telegram_id = ? OR telegram_id = ?').get(cleanTg, 'tg_' + cleanTg);
      }
    }

    if (!byTg) {
      // Fallback: se não conseguiu criar registro isolado, usa a conta principal da chave
      byTg = req.reseller;
    }

    if (byTg && (byTg.blocked === 1 || byTg.active !== 1)) {
      return res.status(403).json({ success: false, error: 'A conta vinculada a este perfil está bloqueada ou inativa.' });
    }
    if (byTg) {
      req.reseller = byTg;
    }
  }

  if (req.reseller.blocked === 1) {
    dbHelpers.logError({
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: 403,
      errorType: 'ResellerBlocked',
      message: `Bot bloqueado: Revendedor #${req.reseller.id} (${req.reseller.name}) foi bloqueado pelo administrador.`,
      ip,
      source: 'bot_api',
      details: { reseller_id: req.reseller.id, name: req.reseller.name }
    });
    return res.status(403).json({
      success: false,
      error: 'Acesso bloqueado: Sua conta de revendedor foi suspensa ou bloqueada pelo administrador.'
    });
  }

  if (req.reseller.active !== 1) {
    dbHelpers.logError({
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: 403,
      errorType: 'ResellerInactive',
      message: `Bot pausado: Revendedor #${req.reseller.id} (${req.reseller.name}) está inativo.`,
      ip,
      source: 'bot_api'
    });
    return res.status(403).json({ success: false, error: 'Conta de revendedor inativa ou pausada.' });
  }

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
      <meta http-equiv="refresh" content="10;url=${destination}">
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
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            <span>Acesso pronto! Clique no botão abaixo para liberar.</span>
          </div>

          <a href="${destination}" target="_blank" class="block w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg shadow-emerald-600/30 transition-all text-center">
            🚀 ACESSAR AGORA
          </a>
          <p class="text-[10px] text-slate-500">O redirecionamento automático acontece em instantes, caso prefira.</p>
        </div>
      </div>

      <script>
        // Redireciona com javascript em 10s (apenas fallback — o botão acima é a ação principal)
        setTimeout(() => {
          window.location.href = "${destination}";
        }, 10000);
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

    // Alerta de geração via site público
    notifyNewSale({
      service: 'Spotify Premium',
      customerName: 'Visitante (Site Gerador)',
      customerId: ip,
      plan: '3 Meses (Acesso Individual)',
      orderNumber: result.token,
      qty: 1,
      salePrice: 0,
      resellerName: null
    }).catch((err) => console.error('notifyNewSale (public) falhou:', err.message));

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
      telegram_id: r.telegram_id || null,
      blocked: r.blocked === 1,
      created_at: r.created_at
    }
  });
});

// Vincular/atualizar o ID de perfil do Telegram à conta de revendedor
// (o mesmo ID usado no bot: /me mostra o ID; saldo do site e do bot ficam juntos)
app.post('/api/reseller/telegram-link', resellerUserAuth, async (req, res) => {
  const tg = (req.body && req.body.telegram_id ? String(req.body.telegram_id).trim() : '').replace(/[^0-9]/g, '');

  if (tg.length < 4 || tg.length > 15) {
    return res.status(400).json({ success: false, error: 'ID de Telegram inválido. Envie /me no bot para copiar seu ID de perfil (somente números).' });
  }

  const exists = await dbHelpers.db.prepare('SELECT id FROM resellers WHERE telegram_id = ?').get(tg);
  if (exists && Number(exists.id) !== Number(req.reseller.id)) {
    return res.status(409).json({ success: false, error: 'Este ID de Telegram já está vinculado a outra conta de revendedor.' });
  }

  await dbHelpers.db.prepare('UPDATE resellers SET telegram_id = ? WHERE id = ?').run(tg, req.reseller.id);
  res.json({ success: true, message: 'Perfil do Telegram vinculado com sucesso! Seu saldo do site agora também aparece no bot via /saldo.', telegram_id: tg });
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
  const { credits, amount, payment_method } = req.body;
  const paymentMethod = String(payment_method || 'PIX').trim() || 'PIX';
  const settings = await dbHelpers.getSettings();
  const minAmount = parseFloat(settings.min_recharge_amount || '5.00');
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
    VALUES (?, ?, ?, 'approved', ?, ?)
  `).run(req.reseller.id, Math.floor(amountPaid / costPerCredit), amountPaid, paymentMethod, now);

  // Notifica a recarga no bot de alertas (formato: Novos créditos adicionados!)
  notifyRecharge({ reseller: req.reseller, amountPaid, method: paymentMethod, externalReference: `manual_${req.reseller.id}_${Date.now()}` })
    .catch((err) => console.error('notifyRecharge falhou:', err.message));

  const updated = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(req.reseller.id);

  res.json({
    success: true,
    message: `Recarga de R$ ${amountPaid.toFixed(2).replace('.', ',')} aprovada com sucesso! Saldo adicionado à sua conta.`,
    new_balance: Number(updated.credits).toFixed(2),
    balance: Number(updated.credits).toFixed(2),
    amount_paid: amountPaid
  });
});

// ==========================================
// MERCADO PAGO — ROTAS
// ==========================================

// Cria preferência de pagamento (Painel do Revendedor — sessão JWT)
app.post('/api/reseller/mp/create-preference', resellerUserAuth, async (req, res) => {
  const { amount } = req.body;
  const settings = await dbHelpers.getSettings();
  const minAmount = parseFloat(settings.min_recharge_amount || '5.00');
  const amountValue = parseFloat(amount);

  if (isNaN(amountValue) || amountValue < minAmount) {
    return res.status(400).json({
      success: false,
      error: `O valor mínimo para recarga via Mercado Pago é de R$ ${minAmount.toFixed(2).replace('.', ',')}.`
    });
  }

  try {
    const pref = await mpCreatePreference({ resellerId: req.reseller.id, amount: amountValue });
    res.json({ success: true, ...pref, message: 'Preferência de pagamento criada. Abra o link para pagar.' });
  } catch (err) {
    dbHelpers.logError({
      endpoint: '/api/reseller/mp/create-preference',
      method: 'POST',
      statusCode: 500,
      errorType: 'MpPreferenceError',
      message: err.message || String(err),
      ip: getClientIp(req),
      source: 'server',
      details: err.details || null
    });
    res.status(err.mpNotConfigured ? 503 : 502).json({
      success: false,
      error: err.mpNotConfigured
        ? 'Mercado Pago não configurado. O administrador precisa definir MERCADOPAGO_ACCESS_TOKEN no servidor.'
        : `Falha ao criar o pagamento no Mercado Pago: ${err.message}`
    });
  }
});

// Cria preferência de pagamento (Bot do Telegram — API key + X-Telegram-Id)
app.post('/api/v1/mp/create-preference', resellerBotAuth, async (req, res) => {
  const { amount } = req.body;
  const settings = await dbHelpers.getSettings();
  const minAmount = parseFloat(settings.min_recharge_amount || '5.00');
  const amountValue = parseFloat(amount);

  if (isNaN(amountValue) || amountValue < minAmount) {
    return res.status(400).json({
      success: false,
      error: `O valor mínimo para recarga via Mercado Pago é de R$ ${minAmount.toFixed(2).replace('.', ',')}.`
    });
  }

  try {
    const pref = await mpCreatePreference({ resellerId: req.reseller.id, amount: amountValue });
    res.json({ success: true, ...pref, message: 'Preferência de pagamento criada. Abra o link para pagar.' });
  } catch (err) {
    res.status(err.mpNotConfigured ? 503 : 502).json({
      success: false,
      error: err.mpNotConfigured
        ? 'Mercado Pago não configurado no servidor.'
        : `Falha ao criar o pagamento no Mercado Pago: ${err.message}`
    });
  }
});

// ==========================================
// MERCADO PAGO — PIX DIRETO (QR Code + copia-e-cola)
// ------------------------------------------
// Gera a cobrança PIX sem redirecionamento: o QR e o código copia-e-cola
// são exibidos dentro do próprio bot do Telegram.
// ==========================================

// Valida o valor de recarga e devolve o número já arredondado (ou lança erro tratado)
async function parseRechargeAmount(rawAmount) {
  const settings = await dbHelpers.getSettings();
  const minAmount = parseFloat(settings.min_recharge_amount || '5.00');
  const amountValue = parseFloat(String(rawAmount || '').replace(',', '.').trim());
  if (isNaN(amountValue) || amountValue < minAmount) {
    return { error: `O valor mínimo para recarga é de R$ ${minAmount.toFixed(2).replace('.', ',')}.` };
  }
  if (amountValue > 5000) {
    return { error: 'O valor máximo para uma recarga é de R$ 5.000,00.' };
  }
  return { amount: Math.round(amountValue * 100) / 100 };
}

// PIX direto — Painel do Revendedor (sessão JWT)
app.post('/api/reseller/mp/create-pix', resellerUserAuth, async (req, res) => {
  const parsed = await parseRechargeAmount(req.body && req.body.amount);
  if (parsed.error) {
    return res.status(400).json({ success: false, error: parsed.error });
  }
  try {
    const pix = await mpCreatePixPayment({ resellerId: req.reseller.id, amount: parsed.amount, reseller: req.reseller });
    res.json({ success: true, ...pix });
  } catch (err) {
    dbHelpers.logError({
      endpoint: '/api/reseller/mp/create-pix',
      method: 'POST',
      statusCode: 502,
      errorType: 'MpPixError',
      message: err.message || String(err),
      ip: getClientIp(req),
      source: 'server',
      details: err.details || null
    });
    res.status(err.mpNotConfigured ? 503 : 502).json({
      success: false,
      error: err.mpNotConfigured
        ? 'Mercado Pago não configurado. Configure as credenciais no painel admin.'
        : `Falha ao gerar o PIX: ${err.message}`
    });
  }
});

// PIX direto — Bot do Telegram (API Key + X-Telegram-Id)
app.post('/api/v1/mp/create-pix', resellerBotAuth, async (req, res) => {
  const parsed = await parseRechargeAmount(req.body && req.body.amount);
  if (parsed.error) {
    return res.status(400).json({ success: false, error: parsed.error });
  }
  try {
    const tgId = (req.headers['x-telegram-id'] || (req.body && req.body.telegram_id) || '').toString().trim();
    const tgName = (req.headers['x-telegram-name'] || (req.body && req.body.customer_name) || '').toString().trim();
    const tgUser = (req.headers['x-telegram-username'] || (req.body && req.body.customer_contact) || '').toString().trim();
    const pix = await mpCreatePixPayment({
      resellerId: req.reseller.id,
      amount: parsed.amount,
      reseller: req.reseller,
      telegramId: tgId || req.reseller.telegram_id || null,
      customerName: tgName || req.reseller.name || null,
      customerContact: tgUser || null
    });
    res.json({ success: true, ...pix });
  } catch (err) {
    dbHelpers.logError({
      endpoint: '/api/v1/mp/create-pix',
      method: 'POST',
      statusCode: 502,
      errorType: 'MpPixError',
      message: err.message || String(err),
      ip: getClientIp(req),
      source: 'server',
      details: err.details || null
    });
    res.status(err.mpNotConfigured ? 503 : 502).json({
      success: false,
      error: err.mpNotConfigured
        ? 'Mercado Pago não configurado no servidor. Configure as credenciais no painel admin.'
        : `Falha ao gerar o PIX: ${err.message}`
    });
  }
});

// Consulta o status de um pagamento PIX pelo external_reference (polling do bot/painel).
// Se o webhook já creditou, processed = 1 e o saldo atual é devolvido.
app.get('/api/v1/mp/payment-status', resellerBotAuth, async (req, res) => {
  const ref = String(req.query.external_reference || '').trim();
  if (!ref) {
    return res.status(400).json({ success: false, error: 'Informe external_reference.' });
  }

  const record = await dbHelpers.db.prepare('SELECT * FROM mp_payments WHERE external_reference = ?')
    .get(ref);
  if (!record) {
    return res.status(404).json({ success: false, error: 'Cobrança não encontrada.' });
  }

  let status = record.status;
  let processed = Number(record.processed) === 1;

  // Se o webhook ainda não chegou, consulta o MP na hora (fonte da verdade).
  // Isso cobre webhook atrasado/não configurado: o crédito acontece assim que o usuário checa.
  const effectiveMpToken = await getEffectiveMpAccessToken().catch(() => null);
  if (!processed && effectiveMpToken && record.payment_id) {
    try {
      const result = await mpProcessApprovedPayment(record.payment_id);
      if (result.ok && !result.alreadyProcessed) {
        processed = true;
        status = 'approved';
      } else if (!result.ok && result.reason && result.reason.includes('não aprovado')) {
        const payment = await mpFetch(`/v1/payments/${record.payment_id}`);
        status = payment.status || status;
        await dbHelpers.db.prepare('UPDATE mp_payments SET status = ?, updated_at = ? WHERE id = ?')
          .run(status, new Date().toISOString(), record.id);
      }
    } catch (e) {
      console.error('[mp-status] verificação falhou:', e.message);
    }
  }

  const reseller = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(record.reseller_id || req.reseller.id);
  res.json({
    success: true,
    external_reference: ref,
    status,
    processed,
    amount: Number(record.amount),
    balance: reseller ? parseFloat(reseller.credits).toFixed(2) : null
  });
});

// Webhook do Mercado Pago (público — o MP chama ao receber um pagamento)
app.post('/api/v1/mp/webhook', async (req, res) => {
  // Sempre responde 200 para o MP não reenviar em loop
  try {
    if (!verifyMpSignature(req)) {
      return res.status(401).json({ success: false, error: 'Assinatura inválida.' });
    }

    // O Mercado Pago entrega o mesmo evento de formas diferentes:
    //  - Webhook (JSON):   { type: 'payment', data: { id: '123' } }
    //  - IPN (query):      ?topic=payment&id=123
    //  - Alguns casos:     { action: 'payment.updated', data: { id: '123' } }
    const body = req.body || {};
    const type = body.type || body.topic || req.query.type || req.query.topic || '';
    const data = body.data || {};
    const paymentId = data.id
      || req.query['data.id']
      || req.query.id
      || (body.resource ? String(body.resource).split('/').pop() : '');

    // Ignora tópicos que não sejam de pagamento (ex.: merchant_order)
    if (!paymentId || (type && type !== 'payment')) {
      return res.json({ success: true, ignored: true });
    }

    const result = await mpProcessApprovedPayment(paymentId);
    console.log(`[mp-webhook] payment ${paymentId}: ${result.ok ? 'processado' : 'ignorado'} (${result.reason || (result.alreadyProcessed ? 'já processado' : 'ok')})`);

    if (!result.ok && result.reason) {
      dbHelpers.logError({
        endpoint: '/api/v1/mp/webhook',
        method: 'POST',
        statusCode: 200,
        errorType: 'MpWebhookIgnored',
        message: `Pagamento ${paymentId} ignorado: ${result.reason}`,
        ip: getClientIp(req),
        source: 'mercado_pago'
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[mp-webhook] erro:', err.message);
    dbHelpers.logError({
      endpoint: '/api/v1/mp/webhook',
      method: 'POST',
      statusCode: 500,
      errorType: 'MpWebhookError',
      message: err.message || String(err),
      ip: getClientIp(req),
      source: 'mercado_pago'
    });
    res.json({ success: true, error: err.message }); // 200 mesmo assim (evita loop de reenvio)
  }
});

// Lista os pagamentos Mercado Pago do revendedor (polling do painel enquanto espera o pagamento)
app.get('/api/reseller/mp/payments', resellerUserAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
  const payments = await dbHelpers.db.prepare(`
    SELECT id, external_reference, amount, status, payment_method, processed, created_at, updated_at
    FROM mp_payments
    WHERE reseller_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(req.reseller.id, limit);
  res.json({ success: true, data: payments });
});

// Geração Manual de Link pelo Revendedor usando Saldo em Dinheiro (Desconta R$ 2,99)

// ==========================================
// CATALOGO DE PRODUTOS E CUPONS (portado do painel lovelygemi)
// - Produtos: catalogo com custo e preco fixo ou margem % sobre o custo
// - Cupons: percentual ou valor fixo, com limite de usos e validade
// - Integrado nos fluxos: painel manual do revendedor e API de bots (/api/v1/generate)
// ==========================================

function roundMoney(v) {
  return Math.round(v * 100) / 100;
}

// Resolve produto do catalogo + cupom + preco final para um pedido.
// Body aceito: { product_id, coupon_code, sale_price }
async function resolveOrderPricing(req, reseller) {
  const body = (req && req.body) || {};
  const result = {
    error: null,
    product: null,
    productId: null,
    productName: null,
    coupon: null,
    couponId: null,
    couponCode: null,
    costPrice: parseFloat(reseller.cost_per_link || 2.99),
    baseSalePrice: null,
    discount: 0,
    finalSalePrice: null,
    productStock: null,
    productHasItems: false,
    productItemCount: 0
  };

  // 1. Produto do catalogo (opcional)
  if (body.product_id !== undefined && body.product_id !== null && String(body.product_id).trim() !== '') {
    const pid = parseInt(body.product_id, 10);
    if (isNaN(pid)) {
      return { ...result, error: 'ID de produto invalido.' };
    }
    const product = await dbHelpers.db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if (!product || !Number(product.active)) {
      return { ...result, error: 'Produto nao encontrado ou inativo.' };
    }
    result.product = product;
    result.productId = Number(product.id);
    result.productName = product.name;
    result.costPrice = parseFloat(product.cost_price || 0);
    // Destino do link de ativação (target_url do produto, se definido)
    result.productTargetUrl = product.target_url ? String(product.target_url).trim() : null;
    result.productStock = (product.stock === null || product.stock === undefined) ? null : Number(product.stock);
    try {
      const itemRow = await dbHelpers.db.prepare('SELECT COUNT(*) AS c FROM product_items WHERE product_id = ? AND status = \'available\'').get(result.productId);
      result.productItemCount = Number(itemRow ? itemRow.c : 0);
      result.productHasItems = result.productItemCount > 0;
    } catch (itemErr) {
      // Tabela product_items ainda nao existe (DB antigo) — segue sem itens
      result.productItemCount = 0;
      result.productHasItems = false;
    }
    if (result.productStock !== null && result.productStock <= 0 && !result.productHasItems) {
      return { ...result, error: 'Produto esgotado no momento. Tente novamente mais tarde.' };
    }
  } else {
    result.productTargetUrl = null;
  }

  // 2. Preco-base de venda
  let baseSalePrice;
  if (result.product) {
    const priceType = result.product.price_type || 'fixed';
    const priceValue = parseFloat(result.product.price_value || 0);
    if (priceType === 'margin') {
      baseSalePrice = roundMoney(result.costPrice * (1 + priceValue / 100));
    } else {
      baseSalePrice = roundMoney(priceValue);
    }
  } else {
    const bodyPrice = (body.sale_price !== undefined && body.sale_price !== null && String(body.sale_price).trim() !== '')
      ? parseFloat(body.sale_price)
      : NaN;
    baseSalePrice = (!isNaN(bodyPrice) && bodyPrice > 0)
      ? roundMoney(bodyPrice)
      : roundMoney(parseFloat(reseller.sale_price || 15.00));
  }
  result.baseSalePrice = baseSalePrice;

  // 3. Cupom (opcional)
  if (body.coupon_code !== undefined && body.coupon_code !== null && String(body.coupon_code).trim() !== '') {
    const code = String(body.coupon_code).trim().toUpperCase();
    const coupon = await dbHelpers.db.prepare('SELECT * FROM coupons WHERE code = ?').get(code);
    if (!coupon || !Number(coupon.active)) {
      return { ...result, error: 'Cupom "' + code + '" invalido ou inativo.' };
    }
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
      return { ...result, error: 'Cupom "' + code + '" expirado.' };
    }
    const usedCount = Number(coupon.used_count || 0);
    const maxUses = Number(coupon.max_uses || 0);
    if (maxUses > 0 && usedCount >= maxUses) {
      return { ...result, error: 'Cupom "' + code + '" atingiu o limite de usos.' };
    }
    const value = parseFloat(coupon.value || 0);
    let discount = 0;
    if ((coupon.type || 'percent') === 'percent') {
      discount = roundMoney(baseSalePrice * (value / 100));
    } else {
      discount = roundMoney(value);
    }
    discount = Math.min(discount, baseSalePrice);
    result.coupon = coupon;
    result.couponId = coupon.id ? Number(coupon.id) : null;
    result.couponCode = coupon.code;
    result.discount = discount;
  }

  result.finalSalePrice = roundMoney(Math.max(0, result.baseSalePrice - result.discount));
  return result;
}

// Incrementa o contador de usos do cupom (fire-and-forget, nunca quebra o fluxo)
async function consumeCoupon(couponId) {
  if (!couponId) return;
  try {
    await dbHelpers.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponId);
  } catch (e) {
    console.error('[consumeCoupon] falhou:', e.message);
  }
}

// ---------- PRODUTOS: PAINEL ADMIN ----------

app.get('/api/admin/products', adminAuth, async (req, res) => {
  const products = await dbHelpers.db.prepare('SELECT * FROM products ORDER BY sort_order ASC, id ASC').all();
  const itemsCount = new Map();
  try {
    const itemRows = await dbHelpers.db.prepare('SELECT product_id, COUNT(*) AS c FROM product_items WHERE status = \'available\' GROUP BY product_id').all();
    for (const r of itemRows) {
      itemsCount.set(Number(r.product_id), Number(r.c));
    }
  } catch (itemErr) { /* tabela product_items ausente — segue sem itens */ }
  res.json({
    success: true,
    data: products.map((p) => ({
      ...p,
      id: Number(p.id),
      emoji: p.emoji || '🎁',
      cost_price: Number(p.cost_price || 0),
      price_value: Number(p.price_value || 0),
      active: Number(p.active || 0),
      sort_order: Number(p.sort_order || 0),
      stock: (p.stock === null || p.stock === undefined) ? null : Number(p.stock),
      item_count: itemsCount.get(Number(p.id)) || 0
    }))
  });
});

app.post('/api/admin/products', adminAuth, async (req, res) => {
  const { name, description, emoji, target_url, cost_price, price_type, price_value, active, sort_order, stock: stockInput } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'Informe o nome do produto.' });
  }
  const cost = parseFloat(cost_price);
  if (isNaN(cost) || cost < 0) {
    return res.status(400).json({ success: false, error: 'Custo do produto invalido.' });
  }
  const type = price_type === 'margin' ? 'margin' : 'fixed';
  const price = parseFloat(price_value);
  if (isNaN(price) || price < 0) {
    return res.status(400).json({ success: false, error: type === 'margin' ? 'Margem invalida.' : 'Preco de venda invalido.' });
  }

  let stock = null;
  if (stockInput !== undefined && stockInput !== null && String(stockInput).trim() !== '') {
    stock = parseInt(stockInput, 10);
    if (isNaN(stock) || stock < 0) {
      return res.status(400).json({ success: false, error: 'Estoque invalido.' });
    }
  }

  const result = await dbHelpers.db.prepare(`
    INSERT INTO products (name, description, emoji, target_url, cost_price, price_type, price_value, active, sort_order, stock, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name).trim(),
    description ? String(description).trim() : null,
    (emoji && String(emoji).trim()) ? String(emoji).trim() : '🎁',
    target_url ? String(target_url).trim() : null,
    cost,
    type,
    price,
    (active === 0 || active === '0' || active === false) ? 0 : 1,
    parseInt(sort_order, 10) || 0,
    stock,
    new Date().toISOString()
  );

  const product = await dbHelpers.db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, message: 'Produto criado com sucesso!', data: product });
});


app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = await dbHelpers.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Produto nao encontrado.' });
  }

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : product.name;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Informe o nome do produto.' });
  }
  const description = body.description !== undefined ? (body.description ? String(body.description).trim() : null) : product.description;
  const emoji = body.emoji !== undefined ? ((body.emoji && String(body.emoji).trim()) ? String(body.emoji).trim() : '🎁') : (product.emoji || '🎁');
  const targetUrl = body.target_url !== undefined ? (body.target_url ? String(body.target_url).trim() : null) : product.target_url;
  const cost = body.cost_price !== undefined ? parseFloat(body.cost_price) : parseFloat(product.cost_price || 0);
  if (isNaN(cost) || cost < 0) {
    return res.status(400).json({ success: false, error: 'Custo do produto invalido.' });
  }
  const type = body.price_type !== undefined ? (body.price_type === 'margin' ? 'margin' : 'fixed') : (product.price_type || 'fixed');
  const price = body.price_value !== undefined ? parseFloat(body.price_value) : parseFloat(product.price_value || 0);
  if (isNaN(price) || price < 0) {
    return res.status(400).json({ success: false, error: type === 'margin' ? 'Margem invalida.' : 'Preco de venda invalido.' });
  }
  const active = body.active !== undefined ? ((body.active === 0 || body.active === '0' || body.active === false) ? 0 : 1) : Number(product.active || 0);
  const sortOrder = body.sort_order !== undefined ? (parseInt(body.sort_order, 10) || 0) : Number(product.sort_order || 0);
  let stock = (product.stock === null || product.stock === undefined) ? null : Number(product.stock);
  if (body.stock !== undefined && body.stock !== null && String(body.stock).trim() !== '') {
    stock = parseInt(body.stock, 10);
    if (isNaN(stock) || stock < 0) {
      return res.status(400).json({ success: false, error: 'Estoque invalido.' });
    }
  }

  await dbHelpers.db.prepare(`
    UPDATE products SET name = ?, description = ?, emoji = ?, target_url = ?, cost_price = ?, price_type = ?, price_value = ?, active = ?, sort_order = ?, stock = ?
    WHERE id = ?
  `).run(name, description, emoji, targetUrl, cost, type, price, active, sortOrder, stock, id);

  const updated = await dbHelpers.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ success: true, message: 'Produto atualizado com sucesso!', data: updated });
});

app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = await dbHelpers.db.prepare('SELECT id, name FROM products WHERE id = ?').get(id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Produto nao encontrado.' });
  }
  await dbHelpers.db.prepare('DELETE FROM products WHERE id = ?').run(id);
  try {
    await dbHelpers.db.prepare('DELETE FROM product_items WHERE product_id = ?').run(id);
  } catch (itemErr) { /* tabela product_items ausente */ }
  res.json({ success: true, message: 'Produto "' + product.name + '" removido com sucesso! (historico de vendas preservado)' });
});

// Reordenar produtos (drag/drop ou setas)
app.post('/api/admin/products/reorder', adminAuth, async (req, res) => {
  const { order } = req.body; // array de IDs na ordem desejada
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ success: false, error: 'Envie { order: [id1, id2, ...] }' });
  }
  try {
    for (let i = 0; i < order.length; i++) {
      await dbHelpers.db.prepare('UPDATE products SET sort_order = ? WHERE id = ?').run(i, parseInt(order[i], 10));
    }
    res.json({ success: true, message: 'Ordem dos produtos atualizada!' });
  } catch (err) {
    console.error('Erro ao reordenar produtos:', err);
    res.status(500).json({ success: false, error: 'Erro ao reordenar produtos.' });
  }
});

// ==========================================
// ITENS DE ESTOQUE (contas / links do produto)
// ------------------------------------------
// Cada item equivale a 1 unidade vendável. Ao adicionar/remover itens,
// o estoque do produto é sincronizado: stock = COUNT(itens disponíveis).
// ==========================================

// Lista os itens disponíveis de um produto
app.get('/api/admin/products/:id/items', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = await dbHelpers.db.prepare('SELECT id, name FROM products WHERE id = ?').get(id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Produto nao encontrado.' });
  }
  const items = await dbHelpers.db.prepare('SELECT * FROM product_items WHERE product_id = ? AND status = \'available\' ORDER BY id ASC').all(id);
  res.json({
    success: true,
    data: items.map((it) => ({
      id: Number(it.id),
      type: it.type || 'account',
      login: it.login,
      password: it.password,
      content: it.content,
      status: it.status,
      created_at: it.created_at
    }))
  });
});

// Adiciona itens: contas ("login:senha" ou "login|senha", 1 por linha) e/ou links (1 por linha)
app.post('/api/admin/products/:id/items', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { type, lines } = req.body || {};
  const product = await dbHelpers.db.prepare('SELECT id, name FROM products WHERE id = ?').get(id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Produto nao encontrado.' });
  }
  const itemType = type === 'link' ? 'link' : 'account';
  const rawLines = Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/);
  const parsed = [];
  const errors = [];
  let lineNo = 0;
  for (const raw of rawLines) {
    lineNo++;
    const line = String(raw || '').trim();
    if (!line) continue;
    if (line.length > 4000) {
      errors.push('Linha ' + lineNo + ': muito longa (max 4000 chars).');
      continue;
    }
    if (itemType === 'link') {
      parsed.push({ type: 'link', login: null, password: null, content: line });
    } else {
      let sepIdx = line.indexOf(':');
      if (sepIdx === -1) sepIdx = line.indexOf('|');
      if (sepIdx <= 0 || sepIdx === line.length - 1) {
        errors.push('Linha ' + lineNo + ': formato invalido. Use login:senha (ou login|senha).');
        continue;
      }
      parsed.push({
        type: 'account',
        login: line.slice(0, sepIdx).trim(),
        password: line.slice(sepIdx + 1).trim(),
        content: null
      });
    }
  }
  if (parsed.length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum item valido para adicionar.' });
  }
  if (parsed.length > 1000) {
    return res.status(400).json({ success: false, error: 'Maximo de 1000 itens por envio.' });
  }
  const now = new Date().toISOString();
  const insert = dbHelpers.db.prepare('INSERT INTO product_items (product_id, type, login, password, content, status, created_at) VALUES (?, ?, ?, ?, ?, \'available\', ?)');
  for (const it of parsed) {
    await insert.run(id, it.type, it.login, it.password, it.content, now);
  }
  // Sincroniza estoque: stock = total de itens disponíveis
  const countRow = await dbHelpers.db.prepare('SELECT COUNT(*) AS c FROM product_items WHERE product_id = ? AND status = \'available\'').get(id);
  const stock = Number(countRow ? countRow.c : 0);
  await dbHelpers.db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, id);
  res.json({
    success: true,
    added: parsed.length,
    errors,
    stock,
    message: parsed.length + ' item(ns) adicionado(s) ao estoque de "' + product.name + '". Estoque agora: ' + stock
  });
});

// Remove um item disponível (conta/link) do estoque
app.delete('/api/admin/products/:id/items/:itemId', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  const product = await dbHelpers.db.prepare('SELECT id, name FROM products WHERE id = ?').get(id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Produto nao encontrado.' });
  }
  const item = await dbHelpers.db.prepare('SELECT id, status FROM product_items WHERE id = ? AND product_id = ?').get(itemId, id);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Item nao encontrado.' });
  }
  if (item.status !== 'available') {
    return res.status(400).json({ success: false, error: 'Este item ja foi vendido e nao pode ser removido.' });
  }
  await dbHelpers.db.prepare('DELETE FROM product_items WHERE id = ?').run(itemId);
  // Recalcula o estoque após remover o item
  const countRow = await dbHelpers.db.prepare('SELECT COUNT(*) AS c FROM product_items WHERE product_id = ? AND status = \'available\'').get(id);
  const stock = Number(countRow ? countRow.c : 0);
  await dbHelpers.db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, id);
  res.json({ success: true, message: 'Item removido do estoque.', stock });
});

// ---------- CUPONS: PAINEL ADMIN ----------

app.get('/api/admin/coupons', adminAuth, async (req, res) => {
  const coupons = await dbHelpers.db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
  res.json({
    success: true,
    data: coupons.map((c) => ({
      ...c,
      id: Number(c.id),
      value: Number(c.value || 0),
      max_uses: Number(c.max_uses || 0),
      used_count: Number(c.used_count || 0),
      active: Number(c.active || 0)
    }))
  });
});

app.post('/api/admin/coupons', adminAuth, async (req, res) => {
  const { code, type, value, max_uses, expires_at, active } = req.body || {};

  if (!code || !String(code).trim()) {
    return res.status(400).json({ success: false, error: 'Informe o codigo do cupom.' });
  }
  const finalCode = String(code).trim().toUpperCase();
  const couponType = type === 'fixed' ? 'fixed' : 'percent';
  const couponValue = parseFloat(value);
  if (isNaN(couponValue) || couponValue <= 0) {
    return res.status(400).json({ success: false, error: 'Valor do cupom invalido.' });
  }
  if (couponType === 'percent' && couponValue > 100) {
    return res.status(400).json({ success: false, error: 'Cupom percentual nao pode ser maior que 100%.' });
  }
  const maxUses = max_uses !== undefined && max_uses !== null && String(max_uses).trim() !== '' ? parseInt(max_uses, 10) : 0;
  if (isNaN(maxUses) || maxUses < 0) {
    return res.status(400).json({ success: false, error: 'Limite de usos invalido.' });
  }
  const existing = await dbHelpers.db.prepare('SELECT id FROM coupons WHERE code = ?').get(finalCode);
  if (existing) {
    return res.status(409).json({ success: false, error: 'Ja existe um cupom com o codigo "' + finalCode + '".' });
  }

  const result = await dbHelpers.db.prepare(`
    INSERT INTO coupons (code, type, value, max_uses, used_count, expires_at, active, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    finalCode,
    couponType,
    couponValue,
    maxUses,
    expires_at ? String(expires_at).trim() : null,
    (active === 0 || active === '0' || active === false) ? 0 : 1,
    new Date().toISOString()
  );

  const coupon = await dbHelpers.db.prepare('SELECT * FROM coupons WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, message: 'Cupom "' + finalCode + '" criado com sucesso!', data: coupon });
});


app.put('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const coupon = await dbHelpers.db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  if (!coupon) {
    return res.status(404).json({ success: false, error: 'Cupom nao encontrado.' });
  }

  const body = req.body || {};
  const couponType = body.type !== undefined ? (body.type === 'fixed' ? 'fixed' : 'percent') : (coupon.type || 'percent');
  const couponValue = body.value !== undefined ? parseFloat(body.value) : parseFloat(coupon.value || 0);
  if (isNaN(couponValue) || couponValue <= 0) {
    return res.status(400).json({ success: false, error: 'Valor do cupom invalido.' });
  }
  if (couponType === 'percent' && couponValue > 100) {
    return res.status(400).json({ success: false, error: 'Cupom percentual nao pode ser maior que 100%.' });
  }
  const maxUses = body.max_uses !== undefined ? (parseInt(body.max_uses, 10) || 0) : Number(coupon.max_uses || 0);
  const expiresAt = body.expires_at !== undefined ? (body.expires_at ? String(body.expires_at).trim() : null) : coupon.expires_at;
  const active = body.active !== undefined ? ((body.active === 0 || body.active === '0' || body.active === false) ? 0 : 1) : Number(coupon.active || 0);

  await dbHelpers.db.prepare(`
    UPDATE coupons SET type = ?, value = ?, max_uses = ?, expires_at = ?, active = ?
    WHERE id = ?
  `).run(couponType, couponValue, maxUses, expiresAt, active, id);

  const updated = await dbHelpers.db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  res.json({ success: true, message: 'Cupom atualizado com sucesso!', data: updated });
});

app.delete('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const coupon = await dbHelpers.db.prepare('SELECT id, code FROM coupons WHERE id = ?').get(id);
  if (!coupon) {
    return res.status(404).json({ success: false, error: 'Cupom nao encontrado.' });
  }
  await dbHelpers.db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
  res.json({ success: true, message: 'Cupom "' + coupon.code + '" removido com sucesso! (historico de vendas preservado)' });
});

// ---------- CATALOGO: PORTAL DO REVENDEDOR ----------

app.get('/api/reseller/products', resellerUserAuth, async (req, res) => {
  const products = await dbHelpers.db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort_order ASC, id ASC').all();
  res.json({
    success: true,
    data: products.map((p) => {
      const cost = Number(p.cost_price || 0);
      const priceType = p.price_type || 'fixed';
      const priceValue = Number(p.price_value || 0);
      const salePrice = priceType === 'margin' ? roundMoney(cost * (1 + priceValue / 100)) : roundMoney(priceValue);
      return {
        id: Number(p.id),
        name: p.name,
        description: p.description,
        price_type: priceType,
        sale_price: salePrice,
        stock: (p.stock === null || p.stock === undefined) ? null : Number(p.stock)
      };
    })
  });
});

// Validar cupom sem gerar pedido (usado pelo painel e disponivel para bots)
app.post('/api/reseller/validate-coupon', resellerUserAuth, async (req, res) => {
  const body = req.body || {};
  const fakeReq = { body: { ...body } };
  const pricing = await resolveOrderPricing(fakeReq, req.reseller);
  if (pricing.error) {
    return res.status(400).json({ success: false, error: pricing.error });
  }
  res.json({
    success: true,
    data: {
      product: pricing.productName,
      base_price: pricing.baseSalePrice,
      discount: pricing.discount,
      final_price: pricing.finalSalePrice,
      coupon_code: pricing.couponCode
    }
  });
});

// ---------- CATALOGO: API PARA BOTS ----------

app.get('/api/v1/products', resellerBotAuth, async (req, res) => {
  const products = await dbHelpers.db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort_order ASC, id ASC').all();
  res.json({
    success: true,
    data: products.map((p) => {
      const cost = Number(p.cost_price || 0);
      const priceType = p.price_type || 'fixed';
      const priceValue = Number(p.price_value || 0);
      const salePrice = priceType === 'margin' ? roundMoney(cost * (1 + priceValue / 100)) : roundMoney(priceValue);
      return {
        id: Number(p.id),
        name: p.name,
        description: p.description,
        emoji: (p.emoji && String(p.emoji).trim()) ? String(p.emoji).trim() : '🎁',
        price_type: priceType,
        sale_price: salePrice,
        stock: (p.stock === null || p.stock === undefined) ? null : Number(p.stock)
      };
    })
  });
});

// Validar cupom via API de bots (X-API-Key) sem gerar pedido
app.post('/api/v1/validate-coupon', resellerBotAuth, async (req, res) => {
  const body = req.body || {};
  const fakeReq = { body: { ...body } };
  const pricing = await resolveOrderPricing(fakeReq, req.reseller);
  if (pricing.error) {
    return res.status(400).json({ success: false, error: pricing.error });
  }
  res.json({
    success: true,
    data: {
      product: pricing.productName,
      product_id: pricing.productId,
      base_price: pricing.baseSalePrice,
      discount: pricing.discount,
      final_price: pricing.finalSalePrice,
      coupon_code: pricing.couponCode
    }
  });
});

app.post('/api/reseller/generate-manual', resellerUserAuth, async (req, res) => {
  const ip = getClientIp(req);
  const reseller = req.reseller;

  // Resolve produto do catálogo + cupom antes de debitar o saldo
  const pricing = await resolveOrderPricing(req, reseller);
  if (pricing.error) {
    return res.status(400).json({ success: false, error: pricing.error });
  }
  const costPrice = pricing.costPrice;
  const currentCredits = parseFloat(reseller.credits || 0);

  // Checa se tem saldo suficiente para cobrir o custo do produto
  if (currentCredits < costPrice) {
    return res.status(402).json({
      success: false,
      error: `Saldo insuficiente. Este produto custa R$ ${costPrice.toFixed(2).replace('.', ',')} e seu saldo atual é de R$ ${currentCredits.toFixed(2).replace('.', ',')}. Recarregue seu saldo no painel.`
    });
  }

  const { customer_name, customer_contact } = req.body;
  const finalCustomerName = customer_name && customer_name.trim() ? customer_name.trim() : 'Cliente Manual (WhatsApp/Direto)';
  const finalContact = customer_contact ? String(customer_contact).trim() : 'Manual';
  const finalSalePrice = pricing.finalSalePrice;
  const profit = Math.max(0, finalSalePrice - costPrice);

  let debited = false;
  let stockDecremented = false;
  let itemConsumed = null;
  let deliveredItem = null;
  let outOfStock = false;
  let stockRemaining = null;
  try {
    // 0a. Consome 1 item do estoque (conta/link) de forma atomica, se o produto tiver itens
    if (pricing.productHasItems && pricing.productId) {
      // Retry loop: outra venda pode ter consumido o item entre o SELECT e o UPDATE
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = await dbHelpers.db.prepare('SELECT id, type, login, password, content FROM product_items WHERE product_id = ? AND status = \'available\' ORDER BY id ASC LIMIT 1').get(pricing.productId);
        if (!candidate) break;
        const consumeRes = await dbHelpers.db.prepare('UPDATE product_items SET status = \'sold\', sold_at = ? WHERE id = ? AND status = \'available\'').run(new Date().toISOString(), candidate.id);
        if (Number(consumeRes.changes) === 1) {
          itemConsumed = candidate;
          break;
        }
      }
      if (!itemConsumed) {
        outOfStock = true;
        throw Object.assign(new Error('Produto esgotado no momento. Tente novamente mais tarde.'), { code: 'OUT_OF_STOCK' });
      }
    }

    // 0b. Decrementa o estoque do produto (apenas quando ha controle de estoque definido)
    if (pricing.productStock !== null && pricing.productId) {
      const stockRes = await dbHelpers.db.prepare('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0').run(pricing.productId);
      if (Number(stockRes.changes) === 0) {
        outOfStock = true;
        throw Object.assign(new Error('Produto esgotado no momento. Tente novamente mais tarde.'), { code: 'OUT_OF_STOCK' });
      }
      stockDecremented = true;
      stockRemaining = Math.max(0, Number(pricing.productStock) - 1);
    }

    // Desconta exatamente R$ 2,99 do saldo do revendedor
    await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits - ? AS NUMERIC), 2) WHERE id = ?').run(costPrice, reseller.id);
    debited = true; // débito concluído — falhas daqui pra frente disparam estorno automático

    // Gera o link
    const generation = await dbHelpers.generateLink(`painel_manual:${reseller.name}`, reseller.id, ip, pricing.productTargetUrl);

    // Registra a venda no histórico de clientes do revendedor
    const now = new Date().toISOString();
    const saleResult = await dbHelpers.db.prepare(`
      INSERT INTO sales (reseller_id, token, target_url, customer_name, customer_id, customer_contact, product, sale_price, cost_price, profit, delivery_status, product_id, coupon_id, discount, created_at)
      VALUES (?, ?, ?, ?, 'manual_web', ?, ?, ?, ?, ?, 'Entregue (Manual)', ?, ?, ?, ?) RETURNING id
    `).run(
      reseller.id,
      generation.token,
      generation.targetUrl,
      finalCustomerName,
      finalContact,
      pricing.productName || 'Spotify Premium',
      finalSalePrice,
      costPrice,
      profit,
      pricing.productId,
      pricing.couponId,
      pricing.discount,
      now
    );
    // Consome o cupom (incrementa o contador de usos)
    await consumeCoupon(pricing.couponId);

    // 5b. Atualiza a ficha do cliente (pedidos, total gasto, último acesso). Fire-and-forget: nunca quebra a venda.
    if (finalCustomerId) {
      try {
        await dbHelpers.recordCustomerSale({
          telegramId: finalCustomerId,
          username: finalContact,
          name: finalCustomerName,
          salePrice: finalSalePrice
        });
      } catch (custErr) {
        console.error('recordCustomerSale falhou (não afeta a venda):', custErr.message);
      }
    }

    // Vincula o item consumido a venda (historico/estorno) e monta a entrega
    if (itemConsumed) {
      await dbHelpers.db.prepare('UPDATE product_items SET sale_id = ? WHERE id = ?').run(saleResult.lastInsertRowid, itemConsumed.id);
      deliveredItem = {
        id: Number(itemConsumed.id),
        type: itemConsumed.type === 'link' ? 'link' : 'account',
        login: itemConsumed.login || null,
        password: itemConsumed.password || null,
        content: itemConsumed.content || null
      };
    }

    const updated = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(reseller.id);

    // Alerta de venda manual (painel do revendedor)
    notifyNewSale({
      service: pricing.productName || 'Spotify Premium',
      customerName: finalCustomerName,
      customerId: reseller.name,
      customerContact: finalContact,
      plan: '3 Meses (Acesso Individual)',
      orderNumber: generation.token,
      qty: 1,
      salePrice: finalSalePrice,
      costPrice,
      profit,
      resellerName: reseller.name,
      balanceRemaining: updated.credits
    }).catch((err) => console.error('notifyNewSale (manual) falhou:', err.message));

    res.json({
      success: true,
      message: 'Link gerado com sucesso! R$ 2,99 descontado do seu saldo.',
      link: generation.targetUrl,
      token: generation.token,
      expires_at: generation.expiresAt,
      balance_remaining: Number(updated.credits).toFixed(2),
      cost_deducted: costPrice,
      profit_generated: profit,
      product: pricing.productName || 'Spotify Premium',
      base_price: pricing.baseSalePrice,
      discount: pricing.discount,
      coupon_code: pricing.couponCode,
      sale_id: saleResult.lastInsertRowid,
      stock_remaining: stockRemaining,
      delivered_item: deliveredItem
    });
  } catch (err) {
    const orderNumber = await nextOrderNumber();
    const reason = (err && err.message) || 'Falha na entrega do produto.';

    // Restaura o estoque do produto se a venda falhou apos o decremento
    if (stockDecremented) {
      await dbHelpers.db.prepare('UPDATE products SET stock = stock + 1 WHERE id = ?').run(pricing.productId);
    }

    // Devolve o item consumido se a venda falhou apos o consumo
    if (itemConsumed) {
      try {
        await dbHelpers.db.prepare('UPDATE product_items SET status = \'available\', sale_id = NULL, sold_at = NULL WHERE id = ? AND status = \'sold\'').run(itemConsumed.id);
      } catch (itemRestoreErr) {
        console.error('[generate-manual] restauracao do item falhou:', itemRestoreErr.message);
      }
    }

    // ESTORNO AUTOMÁTICO: devolve o valor debitado ao saldo do revendedor
    if (debited) {
      try {
        await autoRefund(reseller.id, costPrice, {
          endpoint: '/api/reseller/generate-manual',
          method: 'POST',
          errorType: 'DeliveryFailedRefund',
          message: `Falha na entrega manual (${reason}). Estorno automático de R$ ${costPrice.toFixed(2).replace('.', ',')} para o revendedor #${reseller.id} (pedido #${orderNumber}).`,
          ip,
          source: 'reseller_panel',
          details: { reseller_id: reseller.id, order_number: orderNumber, product: pricing.productName || 'Spotify Premium', amount: finalSalePrice, error: reason }
        });
      } catch (refundErr) {
        console.error('[generate-manual] estorno automático falhou:', refundErr.message);
      }
    }

    res.status(debited || outOfStock ? 409 : 500).json({
      success: false,
      error: outOfStock ? reason : 'Erro ao gerar link manualmente: ' + reason,
      refunded: debited,
      refund_amount: debited ? Number(costPrice).toFixed(2) : '0.00',
      order_number: orderNumber || null,
      product: pricing.productName || 'Spotify Premium',
      out_of_stock: outOfStock,
      amount: Number(finalSalePrice).toFixed(2),
      reason
    });
  }
});

// ==========================================
// ROTA PRINCIPAL DA API PARA BOTS DE REVENDA (DESCONTA R$ 2,99 POR LINK)
// ==========================================

// Endpoint acionado pelos Bots (Telegram, Discord, etc.)
app.post('/api/v1/generate', resellerBotAuth, async (req, res) => {
  const ip = getClientIp(req);
  const reseller = req.reseller;

  // 0. Resolve produto do catálogo + cupom antes de debitar o saldo
  const pricing = await resolveOrderPricing(req, reseller);
  if (pricing.error) {
    return res.status(400).json({ success: false, error: pricing.error });
  }
  const costPrice = pricing.costPrice;
  const currentCredits = parseFloat(reseller.credits || 0);

  // 1. Checa se o Revendedor possui saldo suficiente (custo do produto)
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
  const { customer_name, customer_id, customer_contact } = req.body;
  
  const finalCustomerName = customer_name ? customer_name.trim() : 'Cliente Anônimo';
  const finalCustomerId = customer_id ? String(customer_id).trim() : null;
  const finalContact = customer_contact ? String(customer_contact).trim() : null;
  const finalProduct = pricing.productName || (req.body && req.body.product ? String(req.body.product).trim() : '') || 'Spotify Premium';

  // 2b. Checa se o cliente está bloqueado (checkout interrompido ANTES de qualquer débito/consumo)
  const blockedQuery = [];
  const blockedParams = [];
  const blockedId = finalCustomerId ? String(finalCustomerId).replace(/^tg_/, '') : null;
  const blockedUsername = finalContact ? String(finalContact).replace(/^@/, '') : null;
  if (blockedId) {
    blockedQuery.push('telegram_id = ?');
    blockedParams.push(blockedId);
  }
  if (blockedUsername) {
    blockedQuery.push('LOWER(username) = LOWER(?)');
    blockedParams.push(blockedUsername);
  }
  if (blockedQuery.length > 0) {
    const whereConditions = blockedQuery.map((q) => `(${q})`).join(' OR ');
    const blockedCustomer = await dbHelpers.db.prepare(`
      SELECT telegram_id, username, name, blocked, blocked_reason, blocked_at
      FROM customers
      WHERE (${whereConditions}) AND blocked = 1
      LIMIT 1
    `).get(...blockedParams);
    if (blockedCustomer && Number(blockedCustomer.blocked) === 1) {
      const reason = blockedCustomer.blocked_reason || 'Cliente bloqueado pelo administrador.';
      dbHelpers.logError({
        endpoint: '/api/v1/generate',
        method: 'POST',
        statusCode: 403,
        errorType: 'CustomerBlocked',
        message: `Cliente bloqueado tentou gerar link (${blockedCustomer.name || blockedCustomer.username || blockedCustomer.telegram_id}): ${reason}`,
        ip,
        source: 'bot_api',
        details: { telegram_id: blockedCustomer.telegram_id, blocked_at: blockedCustomer.blocked_at }
      });
      return res.status(403).json({
        success: false,
        error: 'CUSTOMER_BLOCKED',
        message: reason,
        reason
      });
    }
  }

  // Preço de venda final (produto do catálogo + cupom aplicado, com fallback para o preço do revendedor)
  const finalSalePrice = pricing.finalSalePrice;
  const profit = Math.max(0, finalSalePrice - costPrice);

  // 2c. Atualiza a ficha do cliente (last_seen/cadastro) no painel administrativo
  const custRawId = finalCustomerId ? String(finalCustomerId).replace(/^tg_/, '') : null;
  const custUsername = finalContact ? String(finalContact).replace(/^@/, '').trim().toLowerCase() : null;
  if (custRawId) {
    try {
      await dbHelpers.upsertCustomer({
        telegramId: custRawId,
        username: custUsername || null,
        name: finalCustomerName === 'Cliente Anônimo' ? null : finalCustomerName
      });
    } catch (upsertErr) {
      console.error('[generate] upsert da ficha do cliente falhou:', upsertErr.message);
    }
  }

  let debited = false;
  let stockDecremented = false;
  let itemConsumed = null;
  let deliveredItem = null;
  let outOfStock = false;
  let stockRemaining = null;
  try {
    // 3a. Consome 1 item do estoque (conta/link) de forma atomica, se o produto tiver itens
    if (pricing.productHasItems && pricing.productId) {
      // Retry loop: outra venda pode ter consumido o item entre o SELECT e o UPDATE
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = await dbHelpers.db.prepare('SELECT id, type, login, password, content FROM product_items WHERE product_id = ? AND status = \'available\' ORDER BY id ASC LIMIT 1').get(pricing.productId);
        if (!candidate) break;
        const consumeRes = await dbHelpers.db.prepare('UPDATE product_items SET status = \'sold\', sold_at = ? WHERE id = ? AND status = \'available\'').run(new Date().toISOString(), candidate.id);
        if (Number(consumeRes.changes) === 1) {
          itemConsumed = candidate;
          break;
        }
      }
      if (!itemConsumed) {
        outOfStock = true;
        throw Object.assign(new Error('Produto esgotado no momento. Tente novamente mais tarde.'), { code: 'OUT_OF_STOCK' });
      }
    }

    // 3b. Decrementa o estoque do produto (apenas quando ha controle de estoque definido)
    if (pricing.productStock !== null && pricing.productId) {
      const stockRes = await dbHelpers.db.prepare('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0').run(pricing.productId);
      if (Number(stockRes.changes) === 0) {
        outOfStock = true;
        throw Object.assign(new Error('Produto esgotado no momento. Tente novamente mais tarde.'), { code: 'OUT_OF_STOCK' });
      }
      stockDecremented = true;
      stockRemaining = Math.max(0, Number(pricing.productStock) - 1);
    }

    // 3. Decrementa exatamente R$ 2,99 do Saldo do Revendedor
    await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits - ? AS NUMERIC), 2) WHERE id = ?').run(costPrice, reseller.id);
    debited = true; // débito concluído — falhas daqui pra frente disparam estorno automático


    // 4. Gera o Link
    const generation = await dbHelpers.generateLink(`bot:${reseller.name}`, reseller.id, ip, pricing.productTargetUrl);

    // 5. Registra a Venda no Histórico de Clientes do Revendedor
    const now = new Date().toISOString();
    const saleResult = await dbHelpers.db.prepare(`
      INSERT INTO sales (reseller_id, token, target_url, customer_name, customer_id, customer_contact, product, sale_price, cost_price, profit, delivery_status, product_id, coupon_id, discount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Entregue', ?, ?, ?, ?) RETURNING id
    `).run(
      reseller.id,
      generation.token,
      generation.targetUrl,
      finalCustomerName,
      finalCustomerId,
      finalContact,
      finalProduct,
      finalSalePrice,
      costPrice,
      profit,
      pricing.productId,
      pricing.couponId,
      pricing.discount,
      now
    );
    // Consome o cupom (incrementa o contador de usos)
    await consumeCoupon(pricing.couponId);

    // Vincula o item consumido a venda (historico/estorno) e monta a entrega
    if (itemConsumed) {
      await dbHelpers.db.prepare('UPDATE product_items SET sale_id = ? WHERE id = ?').run(saleResult.lastInsertRowid, itemConsumed.id);
      deliveredItem = {
        id: Number(itemConsumed.id),
        type: itemConsumed.type === 'link' ? 'link' : 'account',
        login: itemConsumed.login || null,
        password: itemConsumed.password || null,
        content: itemConsumed.content || null
      };
    }

    const updated = await dbHelpers.db.prepare('SELECT credits FROM resellers WHERE id = ?').get(reseller.id);

    // Registra a transação de compra no livro financeiro
    const balBefore = Math.round((Number(updated.credits || 0) + Number(costPrice)) * 100) / 100;
    const balAfter = Math.round(Number(updated.credits || 0) * 100) / 100;
    await dbHelpers.recordFinancialTransaction({
      customerId: finalCustomerId,
      customerName: finalCustomerName,
      customerContact: finalContact,
      type: 'purchase',
      description: `Compra de ${finalProduct}`,
      orderNumber: generation.token,
      productName: finalProduct,
      amount: -costPrice,
      balanceBefore: balBefore,
      balanceAfter: balAfter
    });

    // Alerta de venda via bot (principal fonte de compras)
    notifyNewSale({
      service: finalProduct,
      customerName: finalCustomerName,
      customerId: finalCustomerId,
      customerContact: finalContact,
      plan: String((req.body && (req.body.plan || req.body.product)) || finalProduct).trim(),
      orderNumber: generation.token,
      qty: 1,
      salePrice: finalSalePrice,
      costPrice,
      profit,
      resellerName: reseller.name,
      balanceRemaining: updated.credits
    }).catch((err) => console.error('notifyNewSale (v1) falhou:', err.message));

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
      product: finalProduct,
      emoji: (pricing.product && pricing.product.emoji) || '🎁',
      base_price: pricing.baseSalePrice,
      discount: pricing.discount,
      coupon_code: pricing.couponCode,
      balance_remaining: Number(updated.credits).toFixed(2),
      stock_remaining: stockRemaining,
      sale_id: saleResult.lastInsertRowid,
      created_at: now,
      expires_at: generation.expiresAt,
      delivered_item: deliveredItem
    });

  } catch (err) {
    const orderNumber = await nextOrderNumber();
    const reason = (err && err.message) || 'Falha na entrega do produto.';

    // Restaura o estoque do produto se a venda falhou apos o decremento
    if (stockDecremented) {
      await dbHelpers.db.prepare('UPDATE products SET stock = stock + 1 WHERE id = ?').run(pricing.productId);
    }

    // Devolve o item consumido se a venda falhou apos o consumo
    if (itemConsumed) {
      try {
        await dbHelpers.db.prepare('UPDATE product_items SET status = \'available\', sale_id = NULL, sold_at = NULL WHERE id = ? AND status = \'sold\'').run(itemConsumed.id);
      } catch (itemRestoreErr) {
        console.error('[generate] restauracao do item falhou:', itemRestoreErr.message);
      }
    }

    // ESTORNO AUTOMÁTICO: se o saldo já foi debitado e a entrega falhou,
    // devolve o valor para o saldo do revendedor na hora.
    if (debited) {
      try {
        await autoRefund(reseller.id, costPrice, {
          endpoint: '/api/v1/generate',
          method: 'POST',
          errorType: 'DeliveryFailedRefund',
          message: `Falha na entrega (${reason}). Estorno automático de R$ ${costPrice.toFixed(2).replace('.', ',')} para o revendedor #${reseller.id} (pedido #${orderNumber}).`,
          ip,
          source: 'bot_api',
          details: { reseller_id: reseller.id, order_number: orderNumber, product: finalProduct, amount: finalSalePrice, error: reason }
        });
      } catch (refundErr) {
        console.error('[generate] estorno automático falhou:', refundErr.message);
      }
    }

    dbHelpers.logError({
      endpoint: '/api/v1/generate',
      method: 'POST',
      statusCode: debited || outOfStock ? 409 : 500,
      errorType: 'BotGenerationError',
      message: err.message,
      ip,
      source: 'bot_api',
      details: { stack: err.stack, refunded: debited, order_number: orderNumber }
    });

    res.status(debited || outOfStock ? 409 : 500).json({
      success: false,
      error: reason,
      refunded: debited,                      // true: estorno já foi feito pelo servidor
      refund_amount: debited ? Number(costPrice).toFixed(2) : '0.00',
      order_number: orderNumber || null,
      product: finalProduct,
      out_of_stock: outOfStock,
      amount: Number(finalSalePrice).toFixed(2),
      reason
    });
  }
});

// ==========================================
// ESTORNO DE PEDIDO (falha de entrega reportada pelo bot/fornecedor)
// - Devolve o custo debitado ao saldo do revendedor
// - Idempotente: pedido já estornado não é estornado de novo
// ==========================================
app.post('/api/v1/refund', resellerBotAuth, async (req, res) => {
  const ip = getClientIp(req);
  const reseller = req.reseller;
  const { token, reason } = req.body || {};

  if (!token) {
    return res.status(400).json({ success: false, error: 'O token do pedido é obrigatório para o estorno.' });
  }

  const sale = await dbHelpers.db.prepare('SELECT * FROM sales WHERE token = ?').get(String(token).trim());
  if (!sale) {
    return res.status(404).json({ success: false, error: 'Pedido não encontrado. Confira o token informado.' });
  }

  const alreadyFailed = String(sale.delivery_status || '').toLowerCase().includes('falhou');
  const costPrice = parseFloat(sale.cost_price != null ? sale.cost_price : (reseller.cost_per_link || 2.99));
  const failReason = (reason && String(reason).trim()) || 'Falha na entrega do produto.';
  const newStatus = `Falhou (${failReason})`;

  if (alreadyFailed) {
    // Já estornado anteriormente — resposta idempotente (sem debitar nada de novo)
    return res.json({
      success: true,
      already_refunded: true,
      message: 'Este pedido já foi estornado anteriormente.',
      order_number: sale.id,
      product: sale.product || 'Spotify Premium',
      amount: Number(sale.sale_price || 0).toFixed(2),
      refund_amount: Number(costPrice).toFixed(2),
      reason: failReason,
      refunded: false
    });
  }

  // Estorno: devolve o custo ao saldo do revendedor (autoRefund já credita e loga)
  await autoRefund(reseller.id, costPrice, {
    endpoint: '/api/v1/refund',
    method: 'POST',
    errorType: 'SaleRefunded',
    message: `Estorno do pedido #${sale.id} (${sale.product || 'Spotify Premium'}) — R$ ${costPrice.toFixed(2).replace('.', ',')} devolvidos ao saldo do revendedor #${reseller.id}. Motivo: ${failReason}`,
    ip,
    source: 'bot_api',
    details: { sale_id: sale.id, token: sale.token, reseller_id: reseller.id, refund_amount: costPrice, reason: failReason, delivery_status: newStatus }
  });
  await dbHelpers.db.prepare('UPDATE sales SET delivery_status = ? WHERE id = ?').run(newStatus, sale.id);

  const curReseller = await dbHelpers.db.prepare('SELECT credits, telegram_id FROM resellers WHERE id = ?').get(reseller.id);
  const balAfter = Math.round(Number(curReseller ? curReseller.credits : 0) * 100) / 100;
  const balBefore = Math.max(0, Math.round((balAfter - costPrice) * 100) / 100);
  await dbHelpers.recordFinancialTransaction({
    customerId: sale.customer_id || (curReseller ? curReseller.telegram_id : null),
    customerName: sale.customer_name,
    customerContact: sale.customer_contact,
    type: 'refund',
    description: `Reembolso: ${failReason}`,
    orderNumber: sale.token || String(sale.id),
    productName: sale.product,
    amount: costPrice,
    balanceBefore: balBefore,
    balanceAfter: balAfter
  });

  res.json({
    success: true,
    refunded: true,
    message: 'Estorno concluído — o valor voltou para o saldo do revendedor.',
    order_number: sale.id,
    product: sale.product || 'Spotify Premium',
    amount: Number(sale.sale_price || 0).toFixed(2),
    refund_amount: Number(costPrice).toFixed(2),
    reason: failReason,
    delivery_status: newStatus
  });
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
    reseller_id: reseller.id,
    telegram_id: reseller.telegram_id || null,
    credits: reseller.credits,
    active: reseller.active === 1 && reseller.blocked === 0,
    sale_price: reseller.sale_price,
    total_sales: Number(stats.total_sales || 0),
    total_revenue: Number(stats.total_revenue || 0)
  });
});

// ==========================================
// MINHAS COMPRAS (cliente final do bot)
// ------------------------------------------
// Consulta as compras do comprador final identificado pelo Telegram:
// headers X-Telegram-Id (id numérico) e/ou X-Telegram-Username (@usuario).
// Agrupa por produto e devolve os itens entregues para o bot gerar o .txt.
// Colunas existentes numa tabela (compatibilidade com bancos antigos).
// Bancos legados guardavam a entrega em sales.delivered_item/stock_type e as
// contas em products.stock_type ('contas'), sem a tabela product_items.
async function getTableColumns(table) {
  try {
    if (dbHelpers.getBackend() === 'postgres') {
      const rows = await dbHelpers.db.prepare(
        'SELECT column_name FROM information_schema.columns WHERE table_name = ?'
      ).all(table);
      return new Set(rows.map((r) => r.column_name));
    }
    const rows = await dbHelpers.db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(rows.map((r) => r.name));
  } catch (e) {
    return new Set();
  }
}

// ==========================================
app.get('/api/v1/my-purchases', botKeyAuth, async (req, res) => {
  try {
    const tgId = (req.headers['x-telegram-id'] || '').toString().trim();
    const tgUsername = (req.headers['x-telegram-username'] || '').toString().trim().replace(/^@/, '').toLowerCase();

    if (!tgId && !tgUsername) {
      return res.status(400).json({ success: false, error: 'Identificação do cliente não fornecida. Envie o header X-Telegram-Id e/ou X-Telegram-Username.' });
    }

    const clauses = [];
    const params = [];
    if (tgId) {
      clauses.push('customer_id = ?');
      params.push('tg_' + tgId);
      clauses.push('customer_id = ?');
      params.push(tgId);
    }
    if (tgUsername) {
      clauses.push('LOWER(customer_contact) = LOWER(?)');
      params.push('@' + tgUsername);
    }

    const where = clauses.map((c) => `(${c})`).join(' OR ');

    // Compatibilidade com bancos antigos: nem todo banco tem product_items nem
    // as colunas legadas de entrega. Monta o SELECT conforme o que existir.
    const salesCols = await getTableColumns('sales');
    const productCols = await getTableColumns('products');
    const hasProductItems = (await getTableColumns('product_items')).size > 0;

    const piJoin = hasProductItems ? 'LEFT JOIN product_items pi ON pi.sale_id = s.id' : '';
    const piCols = hasProductItems
      ? 'pi.type AS item_type, pi.login AS account_login, pi.password AS account_password, pi.content AS item_content'
      : 'NULL AS item_type, NULL AS account_login, NULL AS account_password, NULL AS item_content';

    const legacyCols = [];
    if (salesCols.has('delivered_item')) legacyCols.push('s.delivered_item AS legacy_delivered_item');
    if (salesCols.has('stock_type')) legacyCols.push('s.stock_type AS legacy_stock_type');

    const productJoin = (salesCols.has('product_id') && productCols.has('stock_type'))
      ? 'LEFT JOIN products p ON p.id = s.product_id'
      : '';
    if (productJoin) legacyCols.push('p.stock_type AS product_stock_type');

    const extraCols = legacyCols.length ? ',\n             ' + legacyCols.join(',\n             ') : '';

    const rows = await dbHelpers.db.prepare(`
      SELECT s.id, s.token, s.target_url, s.product, s.sale_price, s.delivery_status, s.created_at,
             ${piCols}${extraCols}
      FROM sales s
      ${piJoin}
      ${productJoin}
      WHERE ${where}
      ORDER BY s.created_at DESC
    `).all(...params);

    // Agrupa por produto (coluna product com fallback para o produto padrão)
    const byProduct = {};
    for (const row of rows) {
      const product = (row.product && String(row.product).trim()) || 'Spotify Premium';
      if (!byProduct[product]) byProduct[product] = [];
      byProduct[product].push({
        id: row.id,
        token: row.token,
        link: row.target_url,
        sale_price: row.sale_price,
        delivery_status: row.delivery_status,
        created_at: row.created_at,
        item_type: row.item_type || null,
        account_login: row.account_login || null,
        account_password: row.account_password || null,
        item_content: row.item_content || null,
        // Compatibilidade: itens entregues no modelo antigo (login/senha em
        // sales.delivered_item) e o tipo do produto (products.stock_type = 'contas').
        delivered_item: row.legacy_delivered_item != null ? String(row.legacy_delivered_item) : null,
        stock_type: row.product_stock_type || row.legacy_stock_type || null
      });
    }

    const purchases = Object.entries(byProduct)
      .map(([product, items]) => ({ product, total: items.length, items }))
      .sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      customer_id: tgId ? 'tg_' + tgId : null,
      customer_contact: tgUsername ? '@' + tgUsername : null,
      purchases
    });
  } catch (err) {
    dbHelpers.logError({
      endpoint: '/api/v1/my-purchases',
      method: 'GET',
      statusCode: 500,
      errorType: 'QueryError',
      message: err.message,
      source: 'bot_api',
      details: err.stack
    });
    res.status(500).json({ success: false, error: 'Erro interno ao consultar suas compras.' });
  }
});

// ==========================================
// PING DO CLIENTE (bot) — consulta se o cliente está bloqueado
// ------------------------------------------
// Chamado pelo bot quando o usuário final dá /start: registra/atualiza a
// ficha do cliente (last_seen) e informa se ele está bloqueado. Fail-open:
// qualquer erro de backend NUNCA impede o usuário de comprar.
// ==========================================
app.post('/api/v1/customer-ping', botKeyAuth, async (req, res) => {
  try {
    const tgId = (req.headers['x-telegram-id'] || '').toString().trim();
    const tgUsername = (req.headers['x-telegram-username'] || '').toString().trim();
    const tgName = (req.headers['x-telegram-name'] || '').toString().trim();

    if (!tgId && !tgUsername) {
      return res.status(400).json({ success: false, error: 'Identificação do cliente não fornecida. Envie o header X-Telegram-Id e/ou X-Telegram-Username.' });
    }

    // Registra/atualiza a ficha do cliente (fire-and-forget, nunca quebra o fluxo)
    if (tgId) {
      try {
        await dbHelpers.upsertCustomer({ telegramId: tgId, username: tgUsername, name: tgName });
      } catch (upsertErr) {
        console.error('customer-ping upsert falhou:', upsertErr.message);
      }
    }

    const clauses = [];
    const params = [];
    if (tgId) {
      clauses.push('telegram_id = ?');
      params.push(tgId.replace(/^tg_/, ''));
    }
    if (tgUsername) {
      clauses.push('LOWER(username) = LOWER(?)');
      params.push(tgUsername.replace(/^@/, ''));
    }
    const where = clauses.map((c) => `(${c})`).join(' OR ');
    const customer = await dbHelpers.db.prepare(`
      SELECT telegram_id, username, name, blocked, blocked_reason, blocked_at
      FROM customers
      WHERE ${where}
      LIMIT 1
    `).get(...params);

    const isBlocked = customer ? Number(customer.blocked) === 1 : false;
    res.json({
      success: true,
      customer_id: tgId ? 'tg_' + tgId.replace(/^tg_/, '') : null,
      customer_contact: tgUsername ? '@' + tgUsername.replace(/^@/, '') : null,
      blocked: isBlocked,
      blocked_reason: isBlocked ? (customer.blocked_reason || null) : null
    });
  } catch (err) {
    // Fail-open: erro interno nunca bloqueia o cliente
    console.error('customer-ping erro (fail-open):', err.message);
    res.json({ success: true, blocked: false, blocked_reason: null });
  }
});

// ==========================================
// SALDO DO CLIENTE (bot) — saldo da conta do comprador final
// ------------------------------------------
// O saldo do cliente é a "carteira" do usuário final: o produto só é
// liberado se houver saldo suficiente (ver /api/v1/generate -> CUSTOMER_BALANCE_INSUFFICIENT).
// O administrador adiciona saldo pelo painel (POST /api/admin/customers/:id/balance).
// ==========================================
app.get('/api/v1/customer/balance', botKeyAuth, async (req, res) => {
  try {
    const tgId = (req.headers['x-telegram-id'] || '').toString().trim().replace(/^tg_/, '');
    const tgUsername = (req.headers['x-telegram-username'] || '').toString().trim().replace(/^@/, '');
    const tgName = (req.headers['x-telegram-name'] || '').toString().trim();

    if (!tgId && !tgUsername) {
      return res.status(400).json({ success: false, error: 'Identificação do cliente não fornecida. Envie o header X-Telegram-Id e/ou X-Telegram-Username.' });
    }

    // Cria/atualiza a ficha (como no customer-ping) para nunca falhar por falta de registro
    if (tgId) {
      try {
        await dbHelpers.upsertCustomer({ telegramId: tgId, username: tgUsername || null, name: tgName || null });
      } catch (upsertErr) {
        console.error('customer/balance upsert falhou:', upsertErr.message);
      }
    }

    const clauses = [];
    const params = [];
    if (tgId) {
      clauses.push('telegram_id = ?');
      params.push(tgId);
    }
    if (tgUsername) {
      clauses.push('LOWER(username) = LOWER(?)');
      params.push(tgUsername);
    }
    const where = clauses.map((c) => `(${c})`).join(' OR ');
    const customer = await dbHelpers.db.prepare(`
      SELECT telegram_id, username, name, balance, orders_count, total_spent, blocked, blocked_reason
      FROM customers
      WHERE ${where}
      LIMIT 1
    `).get(...params);

    if (!customer) {
      return res.json({ success: true, balance: 0, name: tgName || null, username: tgUsername || null, orders_count: 0, total_spent: 0, blocked: false });
    }

    res.json({
      success: true,
      customer_id: customer.telegram_id ? 'tg_' + customer.telegram_id : null,
      customer_contact: customer.username ? '@' + customer.username : null,
      name: customer.name || null,
      username: customer.username || null,
      balance: Number(customer.balance || 0),
      orders_count: Number(customer.orders_count || 0),
      total_spent: Number(customer.total_spent || 0),
      blocked: Number(customer.blocked) === 1,
      blocked_reason: Number(customer.blocked) === 1 ? (customer.blocked_reason || null) : null
    });
  } catch (err) {
    console.error('customer/balance erro:', err.message);
    res.status(500).json({ success: false, error: 'Erro interno ao consultar seu saldo.' });
  }
});

// ==========================================
// API KEY PRÓPRIA DO REVENDEDOR (para bots próprios)
// ------------------------------------------
// Cada revendedor tem a PRÓPRIA api_key. Estes endpoints entregam a chave
// da conta vinculada ao Telegram ID (menu "Minha API" no bot principal),
// para o revendedor criar o próprio bot e entregar o produto automaticamente
// via POST /api/v1/generate com o header X-API-Key: <chave dele>.
// ==========================================

// Consulta a própria chave de API + endereço da API
app.get('/api/v1/my-api', resellerBotAuth, async (req, res) => {
  const reseller = req.reseller;
  const apiBase = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  res.json({
    success: true,
    reseller: reseller.name,
    reseller_id: reseller.id,
    api_key: reseller.api_key,
    api_base_url: apiBase,
    generate_endpoint: `${apiBase}/api/v1/generate`,
    sale_price: reseller.sale_price,
    cost_per_link: reseller.cost_per_link
  });
});

// Renova a própria chave de API (a chave antiga é invalidada imediatamente)
app.post('/api/v1/my-api/rotate', resellerBotAuth, async (req, res) => {
  const reseller = req.reseller;
  const newKey = 'rev_key_' + crypto.randomBytes(16).toString('hex');
  await dbHelpers.db.prepare('UPDATE resellers SET api_key = ? WHERE id = ?').run(newKey, reseller.id);
  res.json({
    success: true,
    message: 'Chave de API renovada com sucesso! A chave antiga foi invalidada e os bots que a usavam precisam ser atualizados.',
    api_key: newKey
  });
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

// Estatísticas Globais do Admin (Visão Geral)
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthIso = monthStart.toISOString();

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // 1. Faturamento Hoje & Pedidos Hoje
    const todaySalesRow = await dbHelpers.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(sale_price), 0) as revenue
      FROM sales WHERE created_at >= ?
    `).get(todayIso);
    const revenueToday = Number(todaySalesRow ? todaySalesRow.revenue : 0);
    const ordersToday = Number(todaySalesRow ? todaySalesRow.count : 0);

    // 2. Faturamento no Mês & Total Geral
    const monthSalesRow = await dbHelpers.db.prepare(`
      SELECT COALESCE(SUM(sale_price), 0) as revenue
      FROM sales WHERE created_at >= ?
    `).get(monthIso);
    const revenueMonth = Number(monthSalesRow ? monthSalesRow.revenue : 0);

    const totalSalesRow = await dbHelpers.db.prepare(`
      SELECT COUNT(*) as total_orders, COALESCE(SUM(sale_price), 0) as total_revenue, COALESCE(SUM(profit), 0) as total_profit
      FROM sales
    `).get();
    const totalRevenue = Number(totalSalesRow ? totalSalesRow.total_revenue : 0);
    const accumulatedProfit = Number(totalSalesRow ? totalSalesRow.total_profit : 0);
    const totalOrders = Number(totalSalesRow ? totalSalesRow.total_orders : 0);

    // 3. Saldo dos Clientes & Usuários
    const customersStatsRow = await dbHelpers.db.prepare(`
      SELECT 
        COUNT(*) as total_customers,
        COALESCE(SUM(balance), 0) as total_balance,
        SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked_count
      FROM customers
    `).get();
    const customersBalance = Number(customersStatsRow ? customersStatsRow.total_balance : 0);
    const totalCustomers = Number(customersStatsRow ? customersStatsRow.total_customers : 0);
    const blockedCustomers = Number(customersStatsRow ? customersStatsRow.blocked_count : 0);

    // 4. Clientes Ativos (7D)
    const active7dRow = await dbHelpers.db.prepare(`
      SELECT COUNT(*) as count
      FROM customers
      WHERE last_seen >= ?
    `).get(sevenDaysAgo);
    const activeCustomers7d = Number(active7dRow ? active7dRow.count : 0);

    // 5. Pedidos Pendentes (30D)
    const pending30dRow = await dbHelpers.db.prepare(`
      SELECT COUNT(*) as count
      FROM sales
      WHERE created_at >= ? AND (delivery_status LIKE '%pend%' OR delivery_status LIKE '%erro%' OR delivery_status LIKE '%falh%')
    `).get(thirtyDaysAgo);
    const pendingOrders30d = Number(pending30dRow ? pending30dRow.count : 0);

    // 6. Depósitos no Mês
    let depositsMonth = 0;
    try {
      const finDepRow = await dbHelpers.db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM financial_transactions
        WHERE type = 'deposit' AND created_at >= ?
      `).get(monthIso);
      depositsMonth = Number(finDepRow ? finDepRow.total : 0);
    } catch (e) {}

    // 7. Produtos Ativos no Catálogo
    const prodCountRow = await dbHelpers.db.prepare('SELECT COUNT(*) as count FROM products WHERE active = 1').get();
    const activeProducts = Number(prodCountRow ? prodCountRow.count : 0);

    // 8. Gráficos de 30 Dias (Timeline contínua)
    const sales30d = await dbHelpers.db.prepare(`
      SELECT 
        substr(created_at, 1, 10) as date_day,
        COUNT(*) as count,
        COALESCE(SUM(sale_price), 0) as revenue,
        COALESCE(SUM(profit), 0) as profit
      FROM sales
      WHERE created_at >= ?
      GROUP BY date_day
      ORDER BY date_day ASC
    `).all(thirtyDaysAgo);

    const salesByDay = {};
    (sales30d || []).forEach(r => {
      salesByDay[r.date_day] = {
        count: Number(r.count || 0),
        revenue: Number(r.revenue || 0),
        profit: Number(r.profit || 0)
      };
    });

    const timeline30d = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dayStr = d.toISOString().slice(0, 10);
      const data = salesByDay[dayStr] || { count: 0, revenue: 0, profit: 0 };
      timeline30d.push({
        date_day: dayStr,
        count: data.count,
        revenue: data.revenue,
        profit: data.profit
      });
    }

    // 9. Painéis Inferiores: Últimos Pedidos & Movimentações
    const recentOrders = await dbHelpers.db.prepare(`
      SELECT id, token, product, customer_name, customer_contact, sale_price, delivery_status, created_at
      FROM sales
      ORDER BY id DESC
      LIMIT 8
    `).all();

    let recentMovements = [];
    try {
      recentMovements = await dbHelpers.db.prepare(`
        SELECT id, customer_name, customer_contact, type, description, order_number, product_name, amount, created_at
        FROM financial_transactions
        ORDER BY id DESC
        LIMIT 8
      `).all();
    } catch (e) {}

    // Resellers stats legado
    const resellerStats = await dbHelpers.db.prepare(`
      SELECT 
        COUNT(*) as total, 
        SUM(CASE WHEN active = 1 AND blocked = 0 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked_count,
        SUM(credits) as total_credits
      FROM resellers
    `).get();

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

    const errorsRow = await dbHelpers.db.prepare(
      'SELECT COUNT(*) as count FROM error_logs WHERE created_at >= ?'
    ).get(twentyFourHoursAgo);
    const errorsLast24h = Number(errorsRow ? errorsRow.count : 0);

    res.json({
      success: true,
      kpis: {
        // 8 Novos KPIs principais
        revenueToday,
        ordersToday,
        revenueMonth,
        totalRevenue,
        accumulatedProfit,
        customersBalance,
        totalCustomers,
        activeCustomers7d,
        blockedCustomers,
        totalOrders,
        pendingOrders30d,
        depositsMonth,
        activeProducts,
        // Legado
        totalGenerations: totalOrders,
        todayGenerations: ordersToday,
        totalResellers: Number(resellerStats ? resellerStats.total : 0),
        activeResellers: Number(resellerStats ? resellerStats.active : 0),
        blockedResellers: Number(resellerStats ? resellerStats.blocked_count : 0),
        circulatingCredits: Number(resellerStats ? resellerStats.total_credits : 0),
        platformSalesCount: totalOrders,
        platformGrossRevenue: totalRevenue.toFixed(2),
        errorsLast24h
      },
      charts: {
        timeline30d,
        generationsTimeline: timeline30d.slice(-7),
        resellerBreakdown: resellerBreakdown.map((r) => ({ ...r, count: Number(r.count) }))
      },
      recentOrders: (recentOrders || []).map(o => ({
        id: o.id,
        token: o.token,
        product: o.product || 'Produto',
        customer_name: o.customer_name || 'Cliente',
        customer_contact: o.customer_contact || '',
        sale_price: Number(o.sale_price || 0),
        delivery_status: o.delivery_status || 'Entregue',
        created_at: o.created_at
      })),
      recentMovements: (recentMovements || []).map(m => ({
        id: m.id,
        customer_name: m.customer_name || 'Cliente',
        customer_contact: m.customer_contact || '',
        type: m.type,
        description: m.description,
        order_number: m.order_number,
        product_name: m.product_name,
        amount: Number(m.amount || 0),
        created_at: m.created_at
      }))
    });

  } catch (err) {
    console.error('Erro em /api/admin/stats:', err);
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar estatísticas.' });
  }
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
  const search = (req.query.search || '').toString().trim();

  let where = '';
  const params = [];
  if (search) {
    const cleanSearch = search.replace(/^[@tg_]+/, '').trim();
    where = ' WHERE (s.customer_contact LIKE ? OR s.customer_contact LIKE ? OR s.customer_id LIKE ? OR s.customer_id LIKE ? OR s.token LIKE ? OR CAST(s.id AS TEXT) = ? OR s.customer_name LIKE ? OR s.product LIKE ?)';
    const likeRaw = `%${search}%`;
    const likeClean = `%${cleanSearch}%`;
    params.push(likeRaw, likeClean, likeRaw, likeClean, likeRaw, cleanSearch, likeRaw, likeRaw);
  }

  // Compatibilidade com bancos legados que ainda não têm a tabela product_items.
  const hasProductItems = (await getTableColumns('product_items')).size > 0;
  const sales = await dbHelpers.db.prepare(`
    SELECT 
      s.id, s.token, s.target_url, s.customer_name, s.customer_id, s.customer_contact, 
      s.product, s.product_id, s.coupon_id, s.discount,
      s.sale_price, s.cost_price, s.profit, s.delivery_status, s.created_at,
      r.name as reseller_name, r.email as reseller_email,
      ${hasProductItems ? 'pi.type AS delivered_type, pi.login AS delivered_login, pi.password AS delivered_password, pi.content AS delivered_content' : 'NULL AS delivered_type, NULL AS delivered_login, NULL AS delivered_password, NULL AS delivered_content'}
    FROM sales s
    JOIN resellers r ON s.reseller_id = r.id
    ${hasProductItems ? 'LEFT JOIN product_items pi ON pi.sale_id = s.id' : ''}
    ${where}
    ORDER BY s.id DESC
    LIMIT ?
  `).all(...params, limit);

  res.json({ success: true, data: sales });
});

// ==========================================
// CLIENTES (gestão dos usuários finais do bot)
// ------------------------------------------
// Lista com busca, bloqueio/desbloqueio (bloqueados NÃO conseguem gerar
// link no checkout), histórico de compras e exclusão da ficha.
// ==========================================

// Lista clientes (opções: ?search=, ?limit=, ?offset=)
app.get('/api/admin/customers', adminAuth, async (req, res) => {
  const search = (req.query.search || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  let where = '';
  const params = [];
  if (search) {
    const cleanSearch = search.replace(/^[@tg_]+/, '').trim();
    where = ' WHERE (telegram_id LIKE ? OR telegram_id LIKE ? OR LOWER(username) LIKE LOWER(?) OR LOWER(username) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?))';
    const likeRaw = `%${search}%`;
    const likeClean = `%${cleanSearch}%`;
    params.push(likeRaw, likeClean, likeRaw, likeClean, likeRaw);
  }

  const customers = await dbHelpers.db.prepare(`
    SELECT id, telegram_id, username, name, first_seen, last_seen, orders_count, total_spent, balance, blocked, blocked_reason, blocked_at, notes, created_at
    FROM customers${where}
    ORDER BY last_seen DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = await dbHelpers.db.prepare(`SELECT COUNT(*) AS count FROM customers${where}`).get(...params);
  const totalBlocked = await dbHelpers.db.prepare('SELECT COUNT(*) AS count FROM customers WHERE blocked = 1').get();
  const totalRevenue = await dbHelpers.db.prepare('SELECT COALESCE(SUM(total_spent), 0) AS revenue FROM customers').get();

  res.json({
    success: true,
    data: customers,
    total: Number(total.count),
    total_blocked: Number(totalBlocked.count),
    total_revenue: Number(totalRevenue.revenue) || 0,
    limit,
    offset
  });
});

// Bloqueia / desbloqueia um cliente (motivo opcional no corpo: { reason })
app.post('/api/admin/customers/:id/toggle-block', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const customer = await dbHelpers.db.prepare('SELECT id, telegram_id, blocked FROM customers WHERE id = ?').get(id);
  if (!customer) {
    return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
  }

  const willBlock = Number(customer.blocked) === 1 ? 0 : 1;
  const reason = willBlock === 1 ? ((req.body && req.body.reason ? String(req.body.reason).trim() : '') || null) : null;
  const blockedAt = willBlock === 1 ? new Date().toISOString() : null;
  await dbHelpers.db.prepare('UPDATE customers SET blocked = ?, blocked_reason = ?, blocked_at = ? WHERE id = ?').run(willBlock, reason, blockedAt, id);

  res.json({
    success: true,
    blocked: willBlock === 1,
    blocked_reason: reason,
    message: willBlock === 1 ? 'Cliente bloqueado com sucesso.' : 'Cliente desbloqueado com sucesso.'
  });
});

// Adiciona (valor positivo) ou remove (valor negativo) saldo da conta do cliente final.
// O saldo é a carteira do comprador: sem saldo suficiente o produto não é liberado no bot.
app.post('/api/admin/customers/:id/balance', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const amount = Math.round((parseFloat(req.body && req.body.amount) || 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ success: false, error: 'Informe um valor de saldo válido (diferente de zero).' });
  }

  const customer = await dbHelpers.db.prepare('SELECT id, telegram_id, username, name, balance, blocked FROM customers WHERE id = ?').get(id);
  if (!customer) {
    return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
  }

  const current = parseFloat(customer.balance || 0);
  const updated = Math.max(0, Math.round((current + amount) * 100) / 100);
  await dbHelpers.db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(updated.toFixed(2), id);

  // Sincroniza saldo com a tabela resellers se houver conta vinculada a esse telegram_id
  if (customer.telegram_id) {
    const cleanTg = String(customer.telegram_id).replace(/^tg_/, '').trim();
    try {
      const existingReseller = await dbHelpers.db.prepare('SELECT id FROM resellers WHERE telegram_id = ? OR telegram_id = ?').get(cleanTg, 'tg_' + cleanTg);
      if (existingReseller) {
        await dbHelpers.db.prepare('UPDATE resellers SET credits = ? WHERE id = ?').run(updated.toFixed(2), existingReseller.id);
      } else {
        const autoName = customer.name || (customer.username ? '@' + customer.username : 'Cliente ' + cleanTg);
        const autoKey = 'cust_' + Math.random().toString(36).substring(2, 14);
        await dbHelpers.db.prepare(`
          INSERT INTO resellers (name, email, credits, active, blocked, telegram_id, api_key, sale_price)
          VALUES (?, ?, ?, 1, ?, ?, ?, 2.99)
        `).run(autoName, `${cleanTg}@bot.telegram`, updated.toFixed(2), customer.blocked || 0, cleanTg, autoKey);
      }
    } catch (e) {
      console.warn('Erro ao sincronizar saldo com reseller:', e && e.message ? e.message : e);
    }
  }

  const label = customer.name || (customer.username ? '@' + customer.username : ('ID ' + (customer.telegram_id || id)));

  // Registra movimentação no livro financeiro
  await dbHelpers.recordFinancialTransaction({
    customerId: customer.telegram_id || customer.id,
    customerName: customer.name,
    customerContact: customer.username ? '@' + customer.username : null,
    type: amount > 0 ? 'deposit' : 'refund',
    description: amount > 0 ? 'Depósito manual (Painel Admin)' : 'Retirada manual (Painel Admin)',
    amount: amount,
    balanceBefore: current,
    balanceAfter: updated
  });

  res.json({
    success: true,
    message: amount > 0
      ? `R$ ${amount.toFixed(2).replace('.', ',')} adicionado ao saldo de ${label}. Novo saldo: R$ ${updated.toFixed(2).replace('.', ',')}.`
      : `R$ ${Math.abs(amount).toFixed(2).replace('.', ',')} retirado do saldo de ${label}. Novo saldo: R$ ${updated.toFixed(2).replace('.', ',')}.`,
    balance: Number(updated.toFixed(2)),
    amount
  });
});

// Compras de um cliente (cruza as vendas antigas: 'tg_<id>', '<id>' e @username)
app.get('/api/admin/customers/:id/purchases', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const customer = await dbHelpers.db.prepare('SELECT id, telegram_id, username FROM customers WHERE id = ?').get(id);
  if (!customer) {
    return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
  }

  const clauses = [];
  const params = [];
  if (customer.telegram_id) {
    clauses.push('customer_id = ?', 'customer_id = ?');
    params.push('tg_' + customer.telegram_id, customer.telegram_id);
  }
  if (customer.username) {
    clauses.push('LOWER(customer_contact) = LOWER(?)');
    params.push('@' + customer.username);
  }
  if (clauses.length === 0) {
    return res.json({ success: true, data: [], total_spent: 0 });
  }
  const where = clauses.map((c) => `(${c})`).join(' OR ');

  // Compatibilidade com bancos legados que ainda não têm a tabela product_items.
  const hasProductItemsCp = (await getTableColumns('product_items')).size > 0;
  const purchases = await dbHelpers.db.prepare(`
    SELECT s.id, s.token, s.product, s.sale_price, s.delivery_status, s.created_at, s.customer_contact, r.name AS reseller_name,
           ${hasProductItemsCp ? 'pi.type AS item_type, pi.login AS account_login, pi.password AS account_password, pi.content AS item_content' : 'NULL AS item_type, NULL AS account_login, NULL AS account_password, NULL AS item_content'}
    FROM sales s
    JOIN resellers r ON s.reseller_id = r.id
    ${hasProductItemsCp ? 'LEFT JOIN product_items pi ON pi.sale_id = s.id' : ''}
    WHERE ${where}
    ORDER BY s.created_at DESC
  `).all(...params);

  const totalSpent = purchases.reduce((acc, p) => acc + (parseFloat(p.sale_price) || 0), 0);
  res.json({ success: true, data: purchases, total_spent: Number(totalSpent.toFixed(2)) });
});

// Remove a ficha de um cliente (não apaga o histórico de vendas)
app.delete('/api/admin/customers/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await dbHelpers.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  if (Number(result.changes) === 0) {
    return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
  }
  res.json({ success: true, message: 'Cliente removido com sucesso.' });
});

// ==========================================
// CONTROLE DO BOT DARKFLIX (STATUS, AVISOS & BROADCAST)
// ==========================================

function resolveNotifyBotUrl(settings) {
  let link = (settings && settings.bot_notify_link ? String(settings.bot_notify_link).trim() : '') || (process.env.NOTIFIER_BOT_LINK || '').trim();
  if (link) {
    if (link.startsWith('@')) return 'https://t.me/' + link.slice(1);
    if (!link.startsWith('http')) return 'https://t.me/' + link.replace(/^\/+/, '');
    return link;
  }
  const username = (settings && settings.bot_notify_username ? String(settings.bot_notify_username).trim() : '') || (process.env.NOTIFIER_BOT_USERNAME || '').trim();
  if (username) {
    return 'https://t.me/' + username.replace(/^@/, '');
  }
  return '';
}

// Consulta pública de status do bot (para bot.js ou checagem rápida)
app.get('/api/v1/bot-status', async (req, res) => {
  try {
    const settings = await dbHelpers.getSettings();
    res.json({
      success: true,
      status: settings.bot_status || 'active', // 'active', 'maintenance', 'offline'
      maintenance_message: settings.maintenance_message || '⚠️ Estamos realizando uma manutenção preventiva no sistema. Em breve o bot estará de volta ao normal!',
      announcement: settings.bot_announcement || '',
      start_message: settings.bot_start_message || '',
      sales_name: settings.bot_sales_name || 'DarkFlix',
      notify_bot_url: resolveNotifyBotUrl(settings)
    });
  } catch (e) {
    res.json({ success: true, status: 'active', maintenance_message: '', announcement: '', start_message: '', sales_name: 'DarkFlix', notify_bot_url: '' });
  }
});

// Consulta pública do feed recente de notificações (vendas e recargas)
app.get('/api/v1/notifications/feed', async (req, res) => {
  try {
    const feed = await getRecentNotificationsFeed();
    res.json({ success: true, feed });
  } catch (e) {
    res.status(500).json({ success: false, error: e && e.message ? e.message : 'Erro interno' });
  }
});

// Inscreve um chat nas notificações em tempo real
app.post('/api/v1/notifications/subscribe', express.json(), async (req, res) => {
  try {
    const { chat_id, first_name, username } = req.body || {};
    if (!chat_id) return res.status(400).json({ success: false, error: 'chat_id é obrigatório' });
    await dbHelpers.addNotificationSubscriber({ chatId: chat_id, firstName: first_name, username });
    const feed = await getRecentNotificationsFeed();
    res.json({ success: true, feed });
  } catch (e) {
    res.status(500).json({ success: false, error: e && e.message ? e.message : 'Erro interno' });
  }
});

// Admin atualiza o status, mensagem de manutenção e aviso fixo
app.post('/api/admin/bot/status', adminAuth, async (req, res) => {
  try {
    const { status, maintenance_message, announcement, notify_all } = req.body || {};
    if (status && ['active', 'maintenance', 'offline'].includes(status)) {
      await dbHelpers.updateSetting('bot_status', status);
    }
    if (maintenance_message !== undefined) {
      await dbHelpers.updateSetting('maintenance_message', String(maintenance_message).trim());
    }
    if (announcement !== undefined) {
      await dbHelpers.updateSetting('bot_announcement', String(announcement).trim());
    }

    let broadcastResult = null;
    // Se solicitou notificar todos os clientes ao ativar modo manutenção
    if (notify_all && status === 'maintenance') {
      const salesToken = process.env.TELEGRAM_BOT_TOKEN;
      if (salesToken) {
        const msg = (maintenance_message && String(maintenance_message).trim())
          || '⚠️ <b>DarkFlix — Manutenção</b>\n\nEstamos realizando uma manutenção preventiva no sistema. Em breve o bot estará de volta ao normal!';
        const rows = await dbHelpers.db.prepare(`
          SELECT DISTINCT telegram_id FROM customers WHERE telegram_id IS NOT NULL AND telegram_id != '' AND blocked = 0
        `).all();
        let sent = 0;
        for (const r of rows) {
          const cleanId = String(r.telegram_id).replace(/^tg_/, '').trim();
          try {
            await fetch(`https://api.telegram.org/bot${salesToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: cleanId, text: msg, parse_mode: 'HTML' })
            });
            sent++;
          } catch (e) {}
        }
        broadcastResult = { sent, total: rows.length };
      }
    }

    res.json({
      success: true,
      message: 'Configurações do bot atualizadas com sucesso.',
      status: status || 'active',
      broadcast: broadcastResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao atualizar status do bot.' });
  }
});

// Broadcast de mensagem para todos os clientes do bot
app.post('/api/admin/bot/broadcast', adminAuth, async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, error: 'A mensagem de aviso não pode ser vazia.' });
    }

    const salesToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!salesToken) {
      return res.status(400).json({ success: false, error: 'TELEGRAM_BOT_TOKEN não configurado no servidor.' });
    }

    const rows = await dbHelpers.db.prepare(`
      SELECT DISTINCT telegram_id FROM customers WHERE telegram_id IS NOT NULL AND telegram_id != '' AND blocked = 0
    `).all();

    let sent = 0;
    let failed = 0;
    const cleanMsg = String(message).trim();

    for (const r of rows) {
      const cleanId = String(r.telegram_id).replace(/^tg_/, '').trim();
      try {
        const resp = await fetch(`https://api.telegram.org/bot${salesToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cleanId, text: cleanMsg, parse_mode: 'HTML' })
        });
        if (resp.ok) sent++;
        else failed++;
      } catch (e) {
        failed++;
      }
    }

    res.json({
      success: true,
      message: `Aviso enviado com sucesso para ${sent} cliente(s).${failed > 0 ? ` (${failed} falhas)` : ''}`,
      total: rows.length,
      sent,
      failed
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao enviar broadcast.' });
  }
});

// ==========================================
// CONFIGURAÇÃO DOS BOTS (PERFIL, COMANDOS & START)
// ==========================================

// Consulta dados dos perfis de ambos os bots, comandos e mensagem inicial em TEMPO REAL
app.get('/api/admin/bot/profiles', adminAuth, async (req, res) => {
  try {
    const settings = await dbHelpers.getSettings();
    const salesToken = process.env.TELEGRAM_BOT_TOKEN;
    const notifyToken = process.env.NOTIFIER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

    let salesName = settings.bot_sales_name || 'DarkFlix';
    let salesBio = settings.bot_sales_bio || '';
    let notifyName = settings.bot_notify_name || 'Dark Vendas';
    let notifyBio = settings.bot_notify_bio || '';

    // Sincronização em TEMPO REAL diretamente da API do Telegram (bot de vendas)
    if (salesToken) {
      try {
        const [meRes, descRes, shortDescRes] = await Promise.all([
          telegramGet(salesToken, 'getMyName'),
          telegramGet(salesToken, 'getMyDescription'),
          telegramGet(salesToken, 'getMyShortDescription')
        ]);
        if (meRes && meRes.ok && meRes.result && meRes.result.name) {
          salesName = meRes.result.name;
        }
        if (descRes && descRes.ok && descRes.result && descRes.result.description && descRes.result.description.trim()) {
          salesBio = descRes.result.description;
        } else if (shortDescRes && shortDescRes.ok && shortDescRes.result && shortDescRes.result.short_description) {
          salesBio = shortDescRes.result.short_description;
        }
      } catch (e) {}
    }

    // Sincronização em TEMPO REAL (bot de notificações se tiver token próprio)
    if (process.env.NOTIFIER_BOT_TOKEN && process.env.NOTIFIER_BOT_TOKEN !== salesToken) {
      try {
        const [meRes, descRes, getMeRes] = await Promise.all([
          telegramGet(process.env.NOTIFIER_BOT_TOKEN, 'getMyName'),
          telegramGet(process.env.NOTIFIER_BOT_TOKEN, 'getMyDescription'),
          telegramGet(process.env.NOTIFIER_BOT_TOKEN, 'getMe')
        ]);
        if (meRes && meRes.ok && meRes.result && meRes.result.name) {
          notifyName = meRes.result.name;
        }
        if (descRes && descRes.ok && descRes.result && descRes.result.description && descRes.result.description.trim()) {
          notifyBio = descRes.result.description;
        }
        // Auto-detecta username do bot notificador e salva como link
        if (getMeRes && getMeRes.ok && getMeRes.result && getMeRes.result.username) {
          const detectedLink = 'https://t.me/' + getMeRes.result.username;
          if (!settings.bot_notify_link || settings.bot_notify_link !== detectedLink) {
            await dbHelpers.updateSetting('bot_notify_link', detectedLink).catch(() => {});
            console.log('🔗 Link do bot de notificações detectado:', detectedLink);
          }
        }
      } catch (e) {}
    }

    // Atualiza o banco de dados caso haja divergência
    if (salesBio && salesBio !== settings.bot_sales_bio) {
      await dbHelpers.updateSetting('bot_sales_bio', salesBio).catch(() => {});
    }
    if (salesName && salesName !== settings.bot_sales_name) {
      await dbHelpers.updateSetting('bot_sales_name', salesName).catch(() => {});
    }
    if (notifyBio && notifyBio !== settings.bot_notify_bio) {
      await dbHelpers.updateSetting('bot_notify_bio', notifyBio).catch(() => {});
    }
    if (notifyName && notifyName !== settings.bot_notify_name) {
      await dbHelpers.updateSetting('bot_notify_name', notifyName).catch(() => {});
    }

    let commands = [];
    try {
      if (salesToken) {
        const liveCmds = await telegramGet(salesToken, 'getMyCommands');
        if (liveCmds && liveCmds.ok && Array.isArray(liveCmds.result) && liveCmds.result.length > 0) {
          commands = liveCmds.result;
        }
      }
      if (commands.length === 0 && settings.bot_commands) {
        commands = JSON.parse(settings.bot_commands);
      }
    } catch (e) {
      commands = [];
    }

    const defaultRealStart =
      `👋 Olá, <b>{nome}</b>! Seja muito bem-vindo(a) ao <b>DarkFlix</b>!\n\n` +
      `⚡ <b>Entrega 100% Automática e Instantânea</b>\n` +
      `🎧 Receba seu link exclusivo na hora direto aqui no chat.\n` +
      `💰 Preço Especial: <b>R$ 15,00</b>`;

    let startMessage = settings.bot_start_message || defaultRealStart;
    if (!startMessage || startMessage.includes('Aqui você encontra os melhores planos, canais')) {
      startMessage = defaultRealStart;
      await dbHelpers.updateSetting('bot_start_message', defaultRealStart).catch(() => {});
    }

    res.json({
      success: true,
      data: {
        bot_sales_name: salesName,
        bot_sales_bio: salesBio,
        bot_notify_name: notifyName,
        bot_notify_bio: notifyBio,
        bot_notify_link: settings.bot_notify_link || '',
        bot_commands: commands,
        bot_start_message: startMessage,
        tokens: {
          sales_configured: !!process.env.TELEGRAM_BOT_TOKEN,
          notify_configured: !!(process.env.NOTIFIER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN)
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao consultar perfis dos bots.' });
  }
});

// Atualiza nomes e bios dos dois bots no banco e sincroniza com o Telegram
app.post('/api/admin/bot/profiles', adminAuth, async (req, res) => {
  try {
    const { bot_sales_name, bot_sales_bio, bot_notify_name, bot_notify_bio } = req.body || {};
    const salesToken = process.env.TELEGRAM_BOT_TOKEN;
    const notifyToken = process.env.NOTIFIER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

    const results = { sales: { name: false, bio: false }, notify: { name: false, bio: false } };

    if (bot_sales_name !== undefined) {
      const cleanName = String(bot_sales_name).trim();
      await dbHelpers.updateSetting('bot_sales_name', cleanName);
      if (salesToken && cleanName) {
        try {
          const resp = await fetch(`https://api.telegram.org/bot${salesToken}/setMyName`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: cleanName })
          });
          const d = await resp.json();
          results.sales.name = !!d.ok;
        } catch (e) {}
      }
    }

    if (bot_sales_bio !== undefined) {
      const cleanBio = String(bot_sales_bio).trim();
      await dbHelpers.updateSetting('bot_sales_bio', cleanBio);
      if (salesToken) {
        try {
          await fetch(`https://api.telegram.org/bot${salesToken}/setMyDescription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: cleanBio })
          });
          await fetch(`https://api.telegram.org/bot${salesToken}/setMyShortDescription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ short_description: cleanBio.slice(0, 120) })
          });
          results.sales.bio = true;
        } catch (e) {}
      }
    }

    if (bot_notify_name !== undefined) {
      const cleanName = String(bot_notify_name).trim();
      await dbHelpers.updateSetting('bot_notify_name', cleanName);
      if (notifyToken && cleanName) {
        try {
          const resp = await fetch(`https://api.telegram.org/bot${notifyToken}/setMyName`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: cleanName })
          });
          const d = await resp.json();
          results.notify.name = !!d.ok;
        } catch (e) {}
      }
    }

    if (bot_notify_bio !== undefined) {
      const cleanBio = String(bot_notify_bio).trim();
      await dbHelpers.updateSetting('bot_notify_bio', cleanBio);
      if (notifyToken) {
        try {
          await fetch(`https://api.telegram.org/bot${notifyToken}/setMyDescription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: cleanBio })
          });
          await fetch(`https://api.telegram.org/bot${notifyToken}/setMyShortDescription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ short_description: cleanBio.slice(0, 120) })
          });
          results.notify.bio = true;
        } catch (e) {}
      }
    }

    if (req.body && req.body.bot_notify_link !== undefined) {
      let cleanLink = String(req.body.bot_notify_link).trim();
      if (cleanLink && cleanLink.startsWith('@')) {
        cleanLink = 'https://t.me/' + cleanLink.slice(1);
      } else if (cleanLink && !cleanLink.startsWith('http')) {
        cleanLink = 'https://t.me/' + cleanLink.replace(/^\/+/, '');
      }
      await dbHelpers.updateSetting('bot_notify_link', cleanLink);
    }

    res.json({
      success: true,
      message: 'Perfis dos bots atualizados com sucesso e sincronizados com o Telegram.',
      results
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao atualizar perfis dos bots.' });
  }
});

// Atualiza comandos do bot DarkFlix e envia setMyCommands para o Telegram
app.post('/api/admin/bot/commands', adminAuth, async (req, res) => {
  try {
    const { commands } = req.body || {};
    if (!Array.isArray(commands)) {
      return res.status(400).json({ success: false, error: 'Lista de comandos inválida.' });
    }

    // Sanitiza comandos (apenas a-z, 0-9 e _)
    const cleanCommands = commands
      .filter((c) => c && c.command)
      .map((c) => ({
        command: String(c.command).replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_]/g, '').trim(),
        description: String(c.description || '').trim() || 'Comando'
      }))
      .filter((c) => c.command.length >= 1 && c.command.length <= 32);

    await dbHelpers.updateSetting('bot_commands', JSON.stringify(cleanCommands));

    const salesToken = process.env.TELEGRAM_BOT_TOKEN;
    let tgSynced = false;
    let tgError = null;

    if (salesToken) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${salesToken}/setMyCommands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commands: cleanCommands })
        });
        const d = await resp.json();
        tgSynced = !!d.ok;
        if (!d.ok) tgError = d.description;
      } catch (e) {
        tgError = e.message;
      }
    }

    res.json({
      success: true,
      message: tgSynced
        ? 'Comandos salvos e sincronizados com o Telegram com sucesso!'
        : 'Comandos salvos no banco de dados com sucesso.',
      commands: cleanCommands,
      tg_synced: tgSynced,
      tg_error: tgError
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao salvar comandos do bot.' });
  }
});

// Atualiza mensagem inicial (/start)
app.post('/api/admin/bot/start-message', adminAuth, async (req, res) => {
  try {
    const { start_message } = req.body || {};
    if (start_message === undefined) {
      return res.status(400).json({ success: false, error: 'start_message não informado.' });
    }
    await dbHelpers.updateSetting('bot_start_message', String(start_message).trim());
    res.json({ success: true, message: 'Mensagem inicial (/start) atualizada com sucesso!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao atualizar mensagem inicial.' });
  }
});

// ==========================================
// CONFIGURAÇÃO DA API DE PAGAMENTO
// ==========================================

// Consulta configuração atual de gateway de pagamento com status em TEMPO REAL
app.get('/api/admin/payment-config', adminAuth, async (req, res) => {
  try {
    const settings = await dbHelpers.getSettings();
    const active = settings.payment_gateway_active !== '0';
    const type = settings.payment_gateway_type || 'mercadopago';
    const rawToken = settings.payment_mp_access_token || '';
    const rawPublicKey = settings.payment_mp_public_key || '';

    const effectiveToken = (rawToken && rawToken.trim()) || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    const effectivePublicKey = (rawPublicKey && rawPublicKey.trim()) || process.env.MERCADOPAGO_PUBLIC_KEY || '';

    let realtimeStatus = {
      connected: false,
      status: effectiveToken ? 'pending' : 'not_configured',
      message: effectiveToken ? 'Credencial presente, verificando conexão...' : 'Nenhum Access Token configurado no momento.'
    };

    if (effectiveToken) {
      try {
        const mpRes = await fetch('https://api.mercadopago.com/v1/users/me', {
          headers: { Authorization: `Bearer ${effectiveToken}` },
          signal: AbortSignal.timeout(4000)
        });
        const mpData = await mpRes.json().catch(() => ({}));
        if (mpRes.ok && mpData && mpData.id) {
          const isTest = effectiveToken.startsWith('TEST-');
          const owner = mpData.nickname || [mpData.first_name, mpData.last_name].filter(Boolean).join(' ') || mpData.email || 'Conta Mercado Pago';
          realtimeStatus = {
            connected: true,
            status: 'active',
            account_id: mpData.id,
            nickname: owner,
            email: mpData.email || '',
            site_id: mpData.site_id || 'MLB',
            mode: isTest ? 'Sandbox / Teste' : 'Produção',
            message: `🟢 Conectado em tempo real: ${owner} (${isTest ? 'Sandbox' : 'Produção'})`
          };
        } else {
          realtimeStatus = {
            connected: false,
            status: 'error',
            message: `🔴 Token rejeitado pelo Mercado Pago: ${mpData.message || ('HTTP ' + mpRes.status)}`
          };
        }
      } catch (e) {
        realtimeStatus = {
          connected: false,
          status: 'timeout',
          message: `⚠️ Falha ao verificar conexão com o Mercado Pago: ${e.message}`
        };
      }
    }

    const maskedToken = effectiveToken
      ? (effectiveToken.length > 10 ? `${effectiveToken.slice(0, 7)}...${effectiveToken.slice(-4)}` : '••••••••')
      : '';

    res.json({
      success: true,
      data: {
        active,
        gateway_type: type,
        mp_access_token: effectiveToken,
        mp_access_token_masked: maskedToken,
        has_custom_token: !!(rawToken && rawToken.trim()),
        mp_public_key: effectivePublicKey,
        env_configured: !!process.env.MERCADOPAGO_ACCESS_TOKEN,
        realtime_status: realtimeStatus
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar configurações de pagamento.' });
  }
});

// Teste em tempo real de credencial Mercado Pago fornecida no painel
app.post('/api/admin/payment-config/test', adminAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    const settings = await dbHelpers.getSettings();
    const effectiveToken = String(token || settings.payment_mp_access_token || process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();

    if (!effectiveToken) {
      return res.status(400).json({ success: false, error: 'Nenhum Access Token informado para teste.' });
    }

    const mpRes = await fetch('https://api.mercadopago.com/v1/users/me', {
      headers: { Authorization: `Bearer ${effectiveToken}` },
      signal: AbortSignal.timeout(5000)
    });
    const mpData = await mpRes.json().catch(() => ({}));
    if (mpRes.ok && mpData && mpData.id) {
      const isTest = effectiveToken.startsWith('TEST-');
      const owner = mpData.nickname || [mpData.first_name, mpData.last_name].filter(Boolean).join(' ') || mpData.email || 'Conta Mercado Pago';
      return res.json({
        success: true,
        connected: true,
        data: {
          account_id: mpData.id,
          nickname: owner,
          email: mpData.email || '',
          mode: isTest ? 'Sandbox / Teste' : 'Produção'
        },
        message: `Conexão validada em tempo real com sucesso! Conta: ${owner} (${isTest ? 'Sandbox' : 'Produção'}).`
      });
    } else {
      return res.status(400).json({
        success: false,
        connected: false,
        error: mpData.message || `Token rejeitado pelo Mercado Pago (HTTP ${mpRes.status}). Verifique as credenciais.`
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Falha de conexão com os servidores do Mercado Pago: ' + err.message });
  }
});

// Atualiza configuração de pagamento (ativação, tipo, credenciais)
app.post('/api/admin/payment-config', adminAuth, async (req, res) => {
  try {
    const { active, gateway_type, mp_access_token, mp_public_key } = req.body || {};

    if (active !== undefined) {
      await dbHelpers.updateSetting('payment_gateway_active', active ? '1' : '0');
    }
    if (gateway_type !== undefined) {
      await dbHelpers.updateSetting('payment_gateway_type', String(gateway_type).trim().toLowerCase());
    }
    if (mp_access_token !== undefined) {
      const cleanToken = String(mp_access_token).trim();
      await dbHelpers.updateSetting('payment_mp_access_token', cleanToken);
    }
    if (mp_public_key !== undefined) {
      await dbHelpers.updateSetting('payment_mp_public_key', String(mp_public_key).trim());
    }

    res.json({
      success: true,
      message: 'Configurações da API de pagamento salvas com sucesso!'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao salvar configurações de pagamento.' });
  }
});

// ==========================================
// FINANCEIRO: DEPÓSITOS PIX
// ==========================================

// Lista todos os depósitos PIX gerados e status de compensação
app.get('/api/admin/pix-deposits', adminAuth, async (req, res) => {
  try {
    const payments = await dbHelpers.db.prepare(`
      SELECT p.id, p.payment_id, p.external_reference, p.amount, p.status, p.payment_method, p.processed,
             p.telegram_id, p.customer_name, p.customer_contact, p.created_at, p.updated_at,
             r.name AS reseller_name
      FROM mp_payments p
      LEFT JOIN resellers r ON r.id = p.reseller_id
      ORDER BY p.id DESC
      LIMIT 150
    `).all();

    const data = payments.map((p) => {
      const isApproved = p.status === 'approved' || Number(p.processed) === 1;
      let clientDisplay = p.customer_name || (p.customer_contact ? p.customer_contact : (p.telegram_id ? `ID: ${p.telegram_id}` : (p.reseller_name || 'Cliente Bot')));
      return {
        id: p.id,
        date: p.created_at,
        client: clientDisplay,
        telegram_id: p.telegram_id || null,
        amount: Number(p.amount),
        status: isApproved ? 'approved' : (p.status || 'pending'),
        credited: isApproved,
        payment_method: p.payment_method || 'PIX',
        external_reference: p.external_reference
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao consultar depósitos PIX.' });
  }
});

// Aprova manualmente um depósito PIX e credita a conta do cliente imediatamente
app.post('/api/admin/pix-deposits/:id/approve', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const payment = await dbHelpers.db.prepare('SELECT * FROM mp_payments WHERE id = ?').get(id);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Depósito PIX não encontrado.' });
    }
    if (Number(payment.processed) === 1 && payment.status === 'approved') {
      return res.json({ success: true, message: 'Este pagamento já foi aprovado e creditado anteriormente.' });
    }

    const amount = Number(payment.amount);
    const now = new Date().toISOString();

    // Atualiza status do mp_payments para approved
    await dbHelpers.db.prepare("UPDATE mp_payments SET status = 'approved', processed = 1, updated_at = ? WHERE id = ?").run(now, id);

    // Atualiza saldo do revendedor
    if (payment.reseller_id) {
      await dbHelpers.db.prepare('UPDATE resellers SET credits = ROUND(CAST(credits + ? AS NUMERIC), 2) WHERE id = ?').run(amount, payment.reseller_id);
      await dbHelpers.db.prepare(`
        INSERT INTO recharges (reseller_id, credits, amount_paid, status, payment_method, created_at)
        VALUES (?, ?, ?, 'approved', 'PIX Manual (Admin)', ?)
      `).run(payment.reseller_id, Math.floor(amount / 2.99), amount, now);
    }

    // Se houver telegram_id, credita o saldo do cliente na tabela customers e registra no extrato
    let clientCredited = false;
    let newCustomerBalance = null;
    if (payment.telegram_id) {
      const cleanTg = String(payment.telegram_id).replace(/^tg_/, '').trim();
      const customer = await dbHelpers.db.prepare('SELECT id, name, username, balance FROM customers WHERE telegram_id = ? OR telegram_id = ?').get(cleanTg, 'tg_' + cleanTg);
      if (customer) {
        const cur = parseFloat(customer.balance || 0);
        const upd = Math.round((cur + amount) * 100) / 100;
        await dbHelpers.db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(upd.toFixed(2), customer.id);
        await dbHelpers.recordFinancialTransaction({
          customerId: cleanTg,
          customerName: customer.name || payment.customer_name,
          customerContact: customer.username ? '@' + customer.username : payment.customer_contact,
          type: 'deposit',
          description: 'Aprovação manual de PIX (Painel Admin)',
          orderNumber: payment.external_reference || `PIX-${id}`,
          amount: amount,
          balanceBefore: cur,
          balanceAfter: upd
        });
        clientCredited = true;
        newCustomerBalance = upd;
      }
    }

    res.json({
      success: true,
      message: `Depósito PIX de R$ ${amount.toFixed(2).replace('.', ',')} aprovado com sucesso! Saldo creditado.`,
      client_credited: clientCredited,
      new_balance: newCustomerBalance
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao aprovar depósito PIX manualmente.' });
  }
});

// ==========================================
// MÓDULO FINANCEIRO (EXTRATO DE MOVIMENTAÇÕES)
// ==========================================
app.get('/api/admin/financial-transactions', adminAuth, async (req, res) => {
  try {
    const search = (req.query.search || '').toString().trim();
    const type = (req.query.type || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 300);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    // Auto-popula vendas prévias caso a tabela esteja vazia (primeira execução)
    const countCheck = await dbHelpers.db.prepare('SELECT COUNT(*) AS count FROM financial_transactions').get();
    if (Number(countCheck.count) === 0) {
      try {
        const sales = await dbHelpers.db.prepare('SELECT * FROM sales ORDER BY id ASC').all();
        for (const s of sales) {
          const cost = parseFloat(s.cost_price != null ? s.cost_price : 2.99);
          await dbHelpers.recordFinancialTransaction({
            customerId: s.customer_id,
            customerName: s.customer_name,
            customerContact: s.customer_contact,
            type: String(s.delivery_status || '').toLowerCase().includes('falhou') ? 'refund' : 'purchase',
            description: `Compra: ${s.product || 'Produto'}`,
            orderNumber: s.token || String(s.id),
            productName: s.product || 'Produto',
            amount: -cost,
            balanceBefore: cost,
            balanceAfter: 0
          });
        }
      } catch (e) {}
    }

    const clauses = [];
    const params = [];

    if (type) {
      clauses.push('type = ?');
      params.push(type);
    }

    if (search) {
      const cleanSearch = search.replace(/^[@tg_]+/, '').trim();
      clauses.push('(customer_contact LIKE ? OR customer_contact LIKE ? OR customer_id LIKE ? OR customer_id LIKE ? OR customer_name LIKE ? OR order_number LIKE ? OR description LIKE ? OR product_name LIKE ?)');
      const likeRaw = `%${search}%`;
      const likeClean = `%${cleanSearch}%`;
      params.push(likeRaw, likeClean, likeRaw, likeClean, likeRaw, likeRaw, likeRaw, likeRaw);
    }

    const where = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';

    const transactions = await dbHelpers.db.prepare(`
      SELECT id, customer_id, customer_name, customer_contact, type, description, order_number, product_name, amount, balance_before, balance_after, created_at
      FROM financial_transactions${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const totalRow = await dbHelpers.db.prepare(`SELECT COUNT(*) AS count FROM financial_transactions${where}`).get(...params);

    // Métricas dos KPIs
    const depositsRow = await dbHelpers.db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM financial_transactions WHERE type = 'deposit'").get();
    const purchasesRow = await dbHelpers.db.prepare("SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM financial_transactions WHERE type = 'purchase'").get();
    const refundsRow = await dbHelpers.db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM financial_transactions WHERE type = 'refund'").get();
    const walletsRow = await dbHelpers.db.prepare("SELECT COALESCE(SUM(balance), 0) AS total FROM customers").get();

    res.json({
      success: true,
      data: transactions,
      total: Number(totalRow.count || 0),
      kpi: {
        total_deposits: Number(depositsRow.total || 0),
        total_purchases: Number(purchasesRow.total || 0),
        total_refunds: Number(refundsRow.total || 0),
        total_in_wallets: Number(walletsRow.total || 0)
      },
      kpis: {
        totalDeposits: Number(depositsRow.total || 0).toFixed(2),
        totalPurchases: Number(purchasesRow.total || 0).toFixed(2),
        totalRefunds: Number(refundsRow.total || 0).toFixed(2),
        totalInWallets: Number(walletsRow.total || 0).toFixed(2)
      },
      limit,
      offset
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar transações financeiras.' });
  }
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
      // Inicia polling e atendimento do bot de alertas (Dark Vendas) para novos inscritos
      initNotifierBotListener();

      // Copia foto + bio do bot de vendas para o bot de alertas (uma vez por boot)
      syncTelegramProfile();

      // Ping de ativação do sistema de alertas (assim que o servidor subir)
      if (NOTIFIER_BOT_TOKEN && NOTIFY_CHAT_ID) {
        notifyNewSale({ startup: true }).catch((err) => console.error('Ping de ativação de alertas falhou:', err.message));
      } else {
        console.log('🔕 Alertas de venda desativados — defina NOTIFIER_BOT_TOKEN e NOTIFY_CHAT_ID.');
      }
      console.log(`🚀 Quantum Link Generator rodando na porta ${PORT}`);
      console.log(`🔗 Gerador Público:       http://localhost:${PORT}`);
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

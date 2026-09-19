require('dotenv').config();
// Remove deprecation warnings/throws da lib ao enviar Buffer de arquivos
// (exige filename/contentType explícitos, que já enviamos no sendDocument)
process.env.NTBA_FIX_350 = '1';
const TelegramBot = require('node-telegram-bot-api');

// Configurações do Bot
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// No Render, se API_BASE_URL não for definida, usa a URL pública automática do serviço
const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
// URL pública exibida ao cliente nos botões inline (Telegram exige HTTPS)
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || API_BASE_URL).replace(/\/+$/, '');
const RESELLER_API_KEY = process.env.RESELLER_API_KEY;
const DEFAULT_SALE_PRICE = parseFloat(process.env.DEFAULT_SALE_PRICE || '15.00');
const SUPPORT_USER = process.env.SUPPORT_USER || '@seu_suporte';
// Intervalo (em minutos) do keep-alive que pinga a própria API para evitar que
// o serviço gratuito do Render "durma" por inatividade. 0 desliga o ping.
const KEEP_ALIVE_MINUTES = parseInt(process.env.KEEP_ALIVE_INTERVAL_MINUTES || '5', 10);

if (!BOT_TOKEN) {
  console.error('\n❌ ERRO: O TELEGRAM_BOT_TOKEN não foi configurado!');
  console.log('👉 Crie um arquivo .env na raiz com:');
  console.log('   TELEGRAM_BOT_TOKEN=seu_token_aqui');
  console.log('   RESELLER_API_KEY=sua_api_key_aqui');
  console.log('   API_BASE_URL=http://localhost:3000\n');
  process.exit(1);
}

if (!RESELLER_API_KEY) {
  console.error('\n⚠️ AVISO: RESELLER_API_KEY não configurada no .env!');
  console.log('👉 Pegue sua API Key no painel do revendedor (ex: http://localhost:3000/revendedor.html)\n');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// O bot NUNCA pode morrer por causa de um envio que falhou (ex: URL de botão inválida)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.message ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.message ? err.message : err);
});
bot.on('polling_error', (err) => {
  console.error('[polling_error]', err && err.message ? err.message : err);
});

// Escapa caracteres especiais de nomes/usuários antes de inserir em HTML do Telegram
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Teclado padrão das telas de informação: botão Voltar ao Menu
function backToMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
      ]
    }
  };
}

// Consulta o saldo da conta vinculada ao ID do Telegram (mesmo endpoint do /saldo)
async function fetchBalance(user) {
  if (!RESELLER_API_KEY) {
    return { status: 0, data: { success: false, error: 'Chave de revendedor não configurada.' } };
  }
  const headers = { 'X-API-Key': RESELLER_API_KEY };
  if (user && user.id) headers['X-Telegram-Id'] = String(user.id);
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/balance`, { headers, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { success: false, error: e && e.message ? e.message : 'Erro de conexão' } };
  }
}

// Envia o Menu Principal (boas-vindas + saldo). Se messageId for informado,
// EDITA a mensagem atual no lugar (vira o menu) em vez de enviar outra.
async function sendMainMenu(chatId, messageId, user) {
  const firstName = user && user.first_name ? escapeHtml(user.first_name) : 'Cliente';

  const welcomeText =
    `👋 Olá, <b>${firstName}</b>! Seja muito bem-vindo(a) ao nosso <b>Gerador Automático de Acesso Spotify Premium 3 MESES</b>!

` +
    `⚡ <b>Entrega 100% Automática e Instantânea</b>
` +
    `🎧 Receba seu link exclusivo na hora direto aqui no chat.
` +
    `💰 Preço Especial: <b>R$ ${DEFAULT_SALE_PRICE.toFixed(2).replace('.', ',')}</b>

`;

  // Busca o saldo e monta a linha de saldo (erro de consulta nunca bloqueia o menu)
  let balanceLine = '💰 <b>Saldo:</b> indisponível no momento';
  try {
    const { data } = await fetchBalance(user);
    if (data) {
      if (data.needs_link) {
        balanceLine = '🔗 <b>Perfil não vinculado</b> — use <code>/saldo</code> para vincular seu ID de perfil';
      } else if (data.success) {
        const balance = parseFloat(data.credits != null ? data.credits : (data.balance || 0));
        balanceLine = `💰 <b>Seu Saldo:</b> R$ ${balance.toFixed(2).replace('.', ',')}`;
      }
    }
  } catch (e) { /* mantém a linha padrão */ }

  const mainText = welcomeText + balanceLine + `

Selecione uma das opções abaixo para começar:`;
  const keyboard = getMainKeyboard();

  if (messageId) {
    bot.editMessageText(mainText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup
    }).catch((e) => {
      // Conteúdo já igual: sucesso sem ação
      if (e && e.message && String(e.message).includes('message is not modified')) return null;
      // Falha real (mensagem é foto/QR ou antiga demais): apaga e envia o menu limpo
      bot.deleteMessage(chatId, messageId).catch(() => {});
      return bot.sendMessage(chatId, mainText, { parse_mode: 'HTML', ...keyboard }).catch(() => null);
    });
  } else {
    bot.sendMessage(chatId, mainText, { parse_mode: 'HTML', ...keyboard }).catch(() => null);
  }
}
// Mostra o ID de Perfil da pessoa (id único no bot e no site do gerador)
function sendProfileId(chatId, user, messageId) {
  const firstName = escapeHtml(user.first_name || 'Cliente');
  const username = user.username ? '@' + escapeHtml(user.username) : '—';
  const profileId = String(user.id);

  const text =
    `🆔 <b>SEU ID DE PERFIL</b>\n\n` +
    `👤 <b>Nome:</b> ${firstName}\n` +
    `📛 <b>Username:</b> ${username}\n` +
    `🆔 <b>Seu ID de Perfil:</b> <code>${profileId}</code>\n\n` +
    `Este ID é o seu identificador único no bot e no site do gerador.\n` +
    `💡 <b>Para vincular seu saldo:</b>\n` +
    `1️⃣ Abra o painel: ${PUBLIC_BASE_URL}/revendedor.html\n` +
    `2️⃣ Entre na aba <b>Meu Perfil</b>\n` +
    `3️⃣ Cole seu ID de Perfil e salve.\n\n` +
    `Depois de vinculado, o comando /saldo mostra o saldo da SUA conta.\n\n` +
    `📦 Toque em <b>Minhas Compras</b> para baixar um arquivo <b>.txt</b> com todos os acessos que você já recebeu.`;

  const profileKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📦 Minhas Compras', callback_data: 'my_purchases' }],
        [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
      ]
    }
  };

  sendOrEdit(chatId, messageId, text, { parse_mode: 'HTML', ...profileKeyboard });
}

// Envio seguro: se o botão (URL) for rejeitado pelo Telegram, entrega o texto sem botões
function safeSend(chatId, text, options) {
  const opts = options || {};
  return bot.sendMessage(chatId, text, opts).catch((err) => {
    console.error('[send fail]', err && err.message ? err.message : err);
    if (opts.reply_markup) {
      const fallback = Object.assign({}, opts);
      delete fallback.reply_markup;
      return bot.sendMessage(chatId, text, fallback).catch((e2) => {
        console.error('[send fail (sem botão)]', e2 && e2.message ? e2.message : e2);
      });
    }
  });
}

// Keep-alive: enquanto o bot roda, ele pinga o /health da própria API a cada
// KEEP_ALIVE_MINUTES. No Render, requisições recebidas contam como atividade e
// impedem o spin-down do serviço gratuito (24/7 sem UptimeRobot).
function startKeepAlive() {
  if (!KEEP_ALIVE_MINUTES || KEEP_ALIVE_MINUTES <= 0) {
    console.log('⏸️  Keep-alive desabilitado (KEEP_ALIVE_INTERVAL_MINUTES=0).');
    return;
  }
  const ping = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      console.log(`[keep-alive] ${new Date().toISOString()} -> /health OK (${API_BASE_URL})`);
    } catch (err) {
      console.error('[keep-alive] falha ao pingar API:', err && err.message ? err.message : err);
    }
  };
  ping(); // ping imediato ao subir
  setInterval(ping, KEEP_ALIVE_MINUTES * 60 * 1000);
  console.log(`🔁 Keep-alive ativo: ping em /health a cada ${KEEP_ALIVE_MINUTES} min.`);
}

console.log('===================================================');
console.log('🤖 Bot do Telegram de Vendas Conectado com Sucesso!');
console.log(`🌐 Conectado à API em: ${API_BASE_URL}`);
console.log(`🔑 Chave do Revendedor: ${RESELLER_API_KEY ? RESELLER_API_KEY.substring(0, 14) + '...' : 'NÃO DEFINIDA'}`);
console.log('===================================================');

// Menu Principal
function getMainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🛒 Produtos', callback_data: 'catalog' }
        ],
        [
          { text: 'ℹ️ Como Funciona', callback_data: 'how_it_works' },
          { text: '💬 Suporte', callback_data: 'support' }
        ],
        [
          { text: '📜 Política da Loja', callback_data: 'store_policy' }
        ],
        [
          { text: '💳 Meu Saldo & Vendas (Revendedor)', callback_data: 'check_balance' }
        ],
        [
          { text: '💰 Recarregar Saldo via PIX', callback_data: 'mp_recharge_menu' }
        ],
        [
          { text: '🔑 Minha API (Revendedor)', callback_data: 'my_api' }
        ],
        [
          { text: '🆔 Meu ID de Perfil', callback_data: 'my_id' }
        ]
      ]
    }
  };
}

// Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log('[recv] /start de', chatId, msg.from && msg.from.first_name);
  sendMainMenu(chatId, null, msg.from);
});

// Comando /comprar
bot.onText(/\/comprar/, async (msg) => {
  await showCatalog(msg.chat.id, null);
});

// Comando /saldo (saldo da conta vinculada ao ID de perfil)
bot.onText(/\/saldo/, async (msg) => {
  await handleCheckBalance(msg.chat.id, msg.from);
});

// Comando /recarga [valor] — gera link de pagamento Mercado Pago para recarregar saldo
bot.onText(/\/recarga(?:\s+(\d+(?:[.,]\d{1,2})?))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const rawAmount = match[1];
  if (rawAmount) {
    const amount = parseFloat(rawAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '⚠️ Valor inválido. Use assim: <code>/recarga 30</code>', { parse_mode: 'HTML', ...backToMenuKeyboard() });
    }
    await handleMpRecharge(chatId, msg.from, amount);
  } else {
    await sendMpRechargeMenu(chatId);
  }
});

// Comando /me (e alias /perfil) — mostra o ID de perfil da pessoa
bot.onText(/\/(me|perfil|id)/, (msg) => {
  console.log('[recv] /me de', msg.chat.id, msg.from && msg.from.first_name);
  sendProfileId(msg.chat.id, msg.from);
});

// Comando /ajuda
bot.onText(/\/ajuda/, (msg) => {
  sendHelpMessage(msg.chat.id);
});

// ----------------------------------------------------------------
// RECARGA DE SALDO VIA MERCADO PAGO
// ----------------------------------------------------------------

// Menu de valores rápidos para recarga
async function sendMpRechargeMenu(chatId, messageId) {
  const text =
    `💰 <b>RECARGA DE SALDO — PIX NA HORA</b>\n\n` +
    `Escolha um valor e o <b>QR Code PIX + código copia-e-cola</b> aparecem aqui mesmo no chat.\n\n` +
    `⚡ O saldo é creditado <b>automaticamente</b> assim que o pagamento for confirmado.\n\n` +
    `💡 Ou use o comando <code>/recarga 50</code> com um valor personalizado (mínimo R$ 15,00).`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💳 R$ 15,00', callback_data: 'mp_recharge_15' }],
        [{ text: '💳 R$ 30,00', callback_data: 'mp_recharge_30' }],
        [{ text: '💳 R$ 50,00', callback_data: 'mp_recharge_50' }],
        [{ text: '💳 R$ 100,00', callback_data: 'mp_recharge_100' }],
        [{ text: '🌐 Recarregar no Painel Web', url: `${PUBLIC_BASE_URL}/revendedor.html` }],
        [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
      ]
    }
  };

  if (messageId) {
    bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...keyboard })
      .catch(() => bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...keyboard }));
  } else {
    bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...keyboard });
  }
}

// Formata um número como moeda brasileira (R$ 30,00)
function brl(value) {
  return 'R$ ' + Number(value).toFixed(2).replace('.', ',');
}

// Cache em memória das cobranças PIX geradas nesta sessão do bot.
// Usado pelos botões "Copiar código" e "Verificar" sem precisar reconsultar a API.
const pixCache = new Map();

// Última mensagem de PIX (QR/foto) enviada por chat — garante que só exista UMA cobrança na tela
const lastPixMsg = new Map();

// Cria a cobrança PIX no Mercado Pago e exibe o QR Code + copia-e-cola
// DIRETO no chat do Telegram (o pagamento é feito sem sair do bot).
async function handleMpRecharge(chatId, user, amount, messageId) {
  if (!RESELLER_API_KEY) {
    return sendOrEdit(chatId, messageId, '⚠️ <b>Bot em Manutenção:</b> chave de revendedor não configurada.', { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }

  const amountValue = Math.round(parseFloat(amount) * 100) / 100;
  if (isNaN(amountValue) || amountValue < 15) {
    return sendOrEdit(chatId, messageId, '⚠️ O valor mínimo para recarga é <b>R$ 15,00</b>.', { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }

  // Indicador de processamento: em CLIQUE no menu, a própria mensagem clicada vira o
  // "Gerando..."; fora de clique (ex.: /recarga 30), envia mensagem nova e apaga depois.
  const waitingText = `⏳ Gerando cobrança PIX de <b>${brl(amountValue)}</b>...`;
  let waitingMsg = null;
  if (messageId) {
    await bot.editMessageText(waitingText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
  } else {
    waitingMsg = await bot.sendMessage(chatId, waitingText).catch(() => null);
  }
  const dropWaiting = () => { if (waitingMsg) bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {}); };

  try {
    const headers = { 'X-API-Key': RESELLER_API_KEY, 'Content-Type': 'application/json' };
    if (user && user.id) headers['X-Telegram-Id'] = String(user.id);

    const res = await fetch(`${API_BASE_URL}/api/v1/mp/create-pix`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: amountValue })
    });
    const data = await res.json();

    if (!data.success || !data.qr_code) {
      const errMsg = (data && data.error) || 'Erro desconhecido';
      dropWaiting();
      return sendOrEdit(chatId, messageId,
        `❌ <b>ERRO AO GERAR O PIX</b>\n\n${escapeHtml(errMsg)}\n\n` +
        `💡 Se o problema persistir, recarregue pelo painel web: ${PUBLIC_BASE_URL}/revendedor.html`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    }

    pixCache.set(data.external_reference, { code: data.qr_code, amount: amountValue, payment_id: data.payment_id });

    const expiresTxt = data.expiration_minutes ? `${data.expiration_minutes} minutos` : '30 minutos';
    const caption =
      `⚡ <b>RECARGA VIA PIX</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💵 <b>Valor:</b> ${brl(amountValue)}\n` +
      `⏳ <b>Válido por:</b> ${expiresTxt}\n` +
      `🧾 <b>Referência:</b> <code>${escapeHtml(data.external_reference)}</code>\n` +
      `━━━━━━━━━━━━━━━\n\n` +
      `📱 <b>Como pagar:</b>\n` +
      `1️⃣ Abra o app do seu banco\n` +
      `2️⃣ Escolha <b>PIX → Ler QR Code</b> (ou PIX Copia e Cola)\n` +
      `3️⃣ Aponte para o QR Code abaixo (ou use o botão de copiar)\n\n` +
      `⚡ O saldo entra <b>automaticamente</b> assim que o pagamento for confirmado.`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Copiar código PIX (Copia e Cola)', callback_data: `mp_pix_code_${data.external_reference}` }],
          [{ text: '🔄 Já Paguei / Verificar Saldo', callback_data: `mp_pix_check_${data.external_reference}` }],
          [{ text: '📊 Ver Meu Saldo', callback_data: 'check_balance' }],
          [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
        ]
      }
    };

    dropWaiting();

    // Envia o QR Code como FOTO (o app do banco lê direto da tela)
    // Mantém apenas 1 mensagem na conversa: apaga QR anterior e a mensagem clicada ("Gerando...")
    const prevPixMsg = lastPixMsg.get(chatId);
    if (prevPixMsg && prevPixMsg !== messageId) bot.deleteMessage(chatId, prevPixMsg).catch(() => {});
    let sentPix = null;
    if (data.qr_code_base64) {
      sentPix = await bot.sendPhoto(
        chatId,
        Buffer.from(data.qr_code_base64, 'base64'),
        { caption, parse_mode: 'HTML', ...keyboard },
        { filename: 'pix-qrcode.png', contentType: 'image/png' }
      ).catch(async (e) => {
        console.error('[recarga] envio do QR falhou:', e && e.message ? e.message : e);
        sentPix = await bot.sendMessage(chatId,
          `${caption}\n\n🔑 <b>PIX Copia e Cola:</b>\n<code>${escapeHtml(data.qr_code)}</code>`,
          { parse_mode: 'HTML', ...keyboard }
        ).catch(() => null);
      });
    } else {
      sentPix = await bot.sendMessage(chatId,
        `${caption}\n\n🔑 <b>PIX Copia e Cola:</b>\n<code>${escapeHtml(data.qr_code)}</code>`,
        { parse_mode: 'HTML', ...keyboard }
      ).catch(() => null);
    }
    if (sentPix) {
      lastPixMsg.set(chatId, sentPix.message_id);
      if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
    }
  } catch (e) {
    console.error('[recarga] falha:', e && e.message ? e.message : e);
    dropWaiting();
    sendOrEdit(chatId, messageId, `❌ <b>Erro de Conexão:</b> não foi possível gerar o PIX (${API_BASE_URL}).`, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }
}

// Envia o código PIX copia-e-cola em bloco <code> (tocar para copiar no Telegram)
async function sendPixCopyPaste(chatId, externalReference, messageId) {
  const cached = pixCache.get(externalReference);
  if (!cached || !cached.code) {
    return sendOrEdit(chatId, messageId,
      '⚠️ <b>Código PIX expirado nesta conversa.</b>\n\nGere uma nova cobrança em <b>Recarregar Saldo</b> para receber um novo QR Code.',
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  }

  const text =
    `🔑 <b>PIX COPIA E COLA</b>\n` +
    `💵 Valor: ${brl(cached.amount)}\n\n` +
    `👇 Toque no código abaixo para <b>copiar</b>, depois cole no app do seu banco em <b>PIX → Copia e Cola</b>:`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Já Paguei / Verificar Saldo', callback_data: `mp_pix_check_${externalReference}` }],
        [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
      ]
    }
  };

  return sendOrEdit(chatId, messageId, `${text}\n\n<code>${escapeHtml(cached.code)}</code>`, { parse_mode: 'HTML', ...keyboard });
}

// Consulta o status da cobrança PIX e informa o revendedor (com crédito automático)
async function checkPixStatus(chatId, user, externalReference, messageId) {
  const cached = pixCache.get(externalReference);
  try {
    const headers = { 'X-API-Key': RESELLER_API_KEY };
    if (user && user.id) headers['X-Telegram-Id'] = String(user.id);

    const res = await fetch(`${API_BASE_URL}/api/v1/mp/payment-status?external_reference=${encodeURIComponent(externalReference)}`, { headers });
    const data = await res.json();

    if (!data.success) {
      return sendOrEdit(chatId, messageId, `❌ ${escapeHtml((data && data.error) || 'Não foi possível consultar o pagamento.')}`, { parse_mode: 'HTML', ...backToMenuKeyboard() });
    }

    const amountTxt = brl(cached ? cached.amount : data.amount);

    if (data.processed || data.status === 'approved') {
      const okText =
        `🎉 <b>PAGAMENTO CONFIRMADO!</b>\n\n` +
        `✅ Recebemos seu PIX de <b>${amountTxt}</b>.\n` +
        `💰 <b>Saldo atual:</b> <b>${brl(data.balance)}</b>\n\n` +
        `O crédito já está disponível para gerar seus links!`;
      const okKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Produtos', callback_data: 'catalog' }],
            [{ text: '📊 Ver Meu Saldo', callback_data: 'check_balance' }],
            [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
          ]
        }
      };
      return sendOrEdit(chatId, messageId, okText, { parse_mode: 'HTML', ...okKeyboard });
    }

    const statusLabel = {
      pending: '⏳ Aguardando pagamento',
      in_process: '⏳ Em processamento',
      authorized: '⏳ Autorizado (aguardando confirmação)',
      rejected: '❌ Recusado',
      cancelled: '❌ Cancelado',
      expired: '⌛ Expirado'
    }[data.status] || `⏳ ${data.status}`;

    const waitText =
      `<b>STATUS DA COBRANÇA PIX</b>\n\n` +
      `💵 Valor: <b>${amountTxt}</b>\n` +
      `📌 Situação: <b>${statusLabel}</b>\n\n` +
      (data.status === 'rejected' || data.status === 'cancelled' || data.status === 'expired'
        ? `Gere uma nova cobrança em <b>Recarregar Saldo</b>.`
        : `Assim que o pagamento for identificado, o saldo entra <b>automaticamente</b>.\nSe você acabou de pagar, aguarde alguns segundos e toque em <b>Já Paguei</b> novamente.`);

    const waitKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Já Paguei / Verificar Saldo', callback_data: `mp_pix_check_${externalReference}` }],
          [{ text: '📋 Ver código PIX', callback_data: `mp_pix_code_${externalReference}` }],
          [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
        ]
      }
    };

    return sendOrEdit(chatId, messageId, waitText, { parse_mode: 'HTML', ...waitKeyboard });
  } catch (e) {
    console.error('[recarga] status falhou:', e && e.message ? e.message : e);
    sendOrEdit(chatId, messageId, '❌ Não foi possível consultar o pagamento agora. Tente novamente em instantes.', { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }
}

// Comando /api — mostra a chave de API do revendedor para bots próprios
bot.onText(/\/(api|minhaapi|apikey)/, async (msg) => {
  await handleMyApi(msg.chat.id, msg.from);
});

// Resposta a Botões Inline
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  bot.answerCallbackQuery(query.id);

  if (action === 'buy_now' || action === 'catalog') {
    await showCatalog(chatId, query.message.message_id);
  } else if (action && action.startsWith('prod_')) {
    const pid = parseInt(action.slice('prod_'.length), 10);
    if (!isNaN(pid)) await showProductDetail(chatId, query.message.message_id, pid);
  } else if (action && action.startsWith('buy_prod_')) {
    const pid = parseInt(action.slice('buy_prod_'.length), 10);
    if (!isNaN(pid)) await buyProduct(chatId, query.from, query.message.message_id, pid);
  } else if (action && action.startsWith('coupon_prod_')) {
    const pid = parseInt(action.slice('coupon_prod_'.length), 10);
    if (!isNaN(pid)) await askCouponCode(chatId, query.message.message_id, pid);
  } else if (action === 'confirm_coupon_buy') {
    await confirmCouponBuy(chatId, query.from, query.message.message_id);
  } else if (action === 'cancel_coupon') {
    couponPending.delete(String(chatId));
    await showCatalog(chatId, query.message.message_id);
  } else if (action === 'check_balance') {
    await handleCheckBalance(chatId, query.from, query.message.message_id);
  } else if (action === 'mp_recharge_menu') {
    await sendMpRechargeMenu(chatId, query.message.message_id);
  } else if (action && action.startsWith('mp_recharge_') && !action.includes('menu')) {
    const rawValue = action.slice('mp_recharge_'.length);
    const amount = parseFloat(rawValue.replace(',', '.'));
    if (!isNaN(amount) && amount > 0) {
      await handleMpRecharge(chatId, query.from, amount, query.message.message_id);
    }
  } else if (action && action.startsWith('mp_pix_code_')) {
    // Botão "Copiar código PIX" — reenvia o copia-e-cola em bloco copiável
    await sendPixCopyPaste(chatId, action.slice('mp_pix_code_'.length), query.message.message_id);
  } else if (action && action.startsWith('mp_pix_check_')) {
    // Botão "Já Paguei" — consulta o status e credita se o MP já aprovou
    await checkPixStatus(chatId, query.from, action.slice('mp_pix_check_'.length), query.message.message_id);
  } else if (action === 'my_id') {
    sendProfileId(chatId, query.from, query.message.message_id);
  } else if (action === 'my_api') {
    await handleMyApi(chatId, query.from, query.message.message_id);
  } else if (action === 'my_api_rotate') {
    await handleMyApiRotate(chatId, query.from, query.message.message_id);
  } else if (action === 'my_purchases') {
    await handleMyPurchases(chatId, query.from, query.message.message_id);
  } else if (action && action.startsWith('my_purchases_prod_')) {
    const idx = parseInt(action.slice('my_purchases_prod_'.length), 10);
    if (!isNaN(idx)) await handleMyPurchasesProductTxt(chatId, query.from, idx, query.message.message_id);
  } else if (action === 'how_it_works') {
    sendHelpMessage(chatId, query.message.message_id);
  } else if (action === 'support') {
    sendOrEdit(chatId, query.message.message_id, 
      `📞 <b>Atendimento & Suporte:</b>\n\nPrecisa de ajuda ou teve alguma dúvida?\nFale com nosso suporte oficial: ${SUPPORT_USER}`, 
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  } else if (action === 'store_policy') {
    sendOrEdit(chatId, query.message.message_id, 
      `📄 <b>POLÍTICAS DA LOJA</b>\n━━━━━━━━━━━━━━━\n` +
      `⚡️ <b>Entrega</b> — automática, direto no chat após a confirmação.\n` +
      `🛡 <b>Falhas</b> — se o fornecedor não entregar, o valor volta para o seu saldo automaticamente.\n` +
      `💳 <b>Saldo</b> — créditos são para uso na loja e não são reembolsáveis em dinheiro.\n` +
      `🚫 <b>Uso indevido</b> — fraude ou chargeback resulta em bloqueio permanente.\n` +
      `⚠️ <b>Garantia</b> — Os serviços ofertados não possuem garantia.\n` +
      `⚠️ <b>Valores</b> — Os valores dos produtos podem sofrer variações conforme a disponibilidade no mercado.\n` +
      `━━━━━━━━━━━━━━━\n\n` +
      `Dúvidas? Fale com o suporte para qualquer dúvida.`, 
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  } else if (action === 'back_to_menu') {
    // Edita a mensagem atual virando o menu principal (sem duplicar no chat)
    await sendMainMenu(chatId, query.message.message_id, query.from);
  }
});

// ==========================================
// CATÁLOGO DE PRODUTOS (consome /api/v1/products)
// ==========================================
let productsCache = { at: 0, items: [] };
async function fetchProducts() {
  const now = Date.now();
  if (productsCache.items.length && now - productsCache.at < 60000) return productsCache.items;
  const res = await fetch(`${API_BASE_URL}/api/v1/products`, {
    headers: { 'X-API-Key': RESELLER_API_KEY },
    signal: AbortSignal.timeout(8000)
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error((data && data.error) || 'Falha ao carregar catálogo.');
  productsCache = { at: now, items: data.data || [] };
  return productsCache.items;
}

// Menu do catálogo — lista os produtos com o preço vindo do servidor
async function showCatalog(chatId, messageId) {
  if (!RESELLER_API_KEY) {
    return sendOrEdit(chatId, messageId, '⚠️ <b>Bot em Manutenção:</b> A chave de revendedor não foi configurada pelo administrador no arquivo .env.', { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }
  const loadingText = '🛒 <i>Carregando catálogo de produtos...</i>';
  if (messageId) await bot.editMessageText(loadingText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
  try {
    const products = await fetchProducts();
    let text, keyboard;
    if (!products.length) {
      text = '🛒 <b>PRODUTOS</b>\n\n⚠️ Nenhum produto disponível no momento. Tente novamente mais tarde.';
      keyboard = { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Principal', callback_data: 'back_to_menu' }]] } };
    } else {
      text = '🛒 <b>PRODUTOS</b>\n\nEscolha o produto desejado:';
      const rows = products.map((p) => {
        let suffix = '';
        if (isSoldOut(p)) suffix = ' — ❌ ESGOTADO';
        else if (p.stock !== null && p.stock !== undefined) suffix = ` (${Number(p.stock)})`;
        return [{ text: `${productIcon(p.name)} ${p.name} — ${brl(p.sale_price)}${suffix}`, callback_data: `prod_${p.id}` }];
      });
      rows.push([{ text: '🏠 Menu Principal', callback_data: 'back_to_menu' }]);
      keyboard = { reply_markup: { inline_keyboard: rows } };
    }
    sendOrEdit(chatId, messageId, text, { parse_mode: 'HTML', ...keyboard });
  } catch (err) {
    sendOrEdit(chatId, messageId, `❌ <b>Erro de Conexão:</b> não foi possível carregar o catálogo (${API_BASE_URL}). Verifique se o servidor está rodando!`, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }
}

// Detalhe de um produto — comprar direto ou com cupom
async function showProductDetail(chatId, messageId, pid) {
  try {
    let products = await fetchProducts();
    let p = products.find((x) => x.id === pid);
    if (!p) {
      productsCache = { at: 0, items: [] };
      products = await fetchProducts();
      p = products.find((x) => x.id === pid);
    }
    if (!p) throw new Error('Produto não encontrado ou inativo.');
    const desc = p.description && String(p.description).trim() ? `\n${escapeHtml(p.description)}` : '';
    const stockLine = (p.stock === null || p.stock === undefined) ? '' : `📦 <b>Estoque:</b> ${isSoldOut(p) ? 'Esgotado ❌' : Number(p.stock) + ' restante(s)'}\n`;
    const text =
      `🛒 <b>${escapeHtml(p.name)}</b>${desc}\n\n` +
      `${stockLine}` +
      `💵 <b>Preço:</b> ${brl(p.sale_price)}\n` +
      `⚡ Entrega automática e imediata após a confirmação.`;
    const buyButton = isSoldOut(p)
      ? [{ text: '🔙 Voltar ao catálogo', callback_data: 'catalog' }]
      : [{ text: `✅ Comprar agora — ${brl(p.sale_price)}`, callback_data: `buy_prod_${p.id}` }];
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          buyButton,
          [{ text: '🎟 Tenho cupom de desconto', callback_data: `coupon_prod_${p.id}` }],
          [{ text: '🏠 Menu Principal', callback_data: 'back_to_menu' }]
        ]
      }
    };
    sendOrEdit(chatId, messageId, text, { parse_mode: 'HTML', ...keyboard });
  } catch (err) {
    sendOrEdit(chatId, messageId, `❌ <b>Erro:</b> ${err.message}`, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }
}

// Compra direta de um produto do catálogo (sem cupom)
async function buyProduct(chatId, user, messageId, pid) {
  let productName;
  try {
    const products = await fetchProducts();
    const p = products.find((x) => x.id === pid);
    if (p) productName = p.name;
  } catch (e) { /* segue com nome genérico */ }
  await handlePurchase(chatId, user, messageId, { productId: pid, productName });
}

// ==========================================
// CUPONS DE DESCONTO (consome /api/v1/validate-coupon)
// ==========================================
const couponPending = new Map(); // String(chatId) -> { productId, productName, couponCode, menuMessageId }

// Pede o código do cupom; depois o botão "confirm_coupon_buy" efetiva a compra
async function askCouponCode(chatId, menuMessageId, pid) {
  try {
    const products = await fetchProducts();
    const p = products.find((x) => x.id === pid);
    if (!p) throw new Error('Produto não encontrado ou inativo.');
    couponPending.set(String(chatId), { productId: pid, productName: p.name, couponCode: null, menuMessageId });
    const text =
      `🎟 <b>CUPOM DE DESCONTO</b>\n\n` +
      `Produto: <b>${escapeHtml(p.name)}</b> — ${brl(p.sale_price)}\n\n` +
      `Envie o <b>código do cupom</b> como mensagem neste chat:\n\n` +
      `<i>Ex.:</i> <code>BEMVINDO10</code>`;
    const keyboard = { reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancel_coupon' }]] } };
    sendOrEdit(chatId, menuMessageId, text, { parse_mode: 'HTML', ...keyboard });
  } catch (err) {
    sendOrEdit(chatId, menuMessageId, `❌ <b>Erro:</b> ${err.message}`, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }
}

// Captura o código digitado enquanto o cliente está no fluxo de cupom
bot.on('message', async (msg) => {
  const key = String(msg.chat.id);
  const pending = couponPending.get(key);
  if (!pending || pending.couponCode) return;
  if (!msg.text || msg.text.trim() === '' || msg.text.startsWith('/')) return;
  const code = msg.text.trim();
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/validate-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': RESELLER_API_KEY },
      body: JSON.stringify({ product_id: pending.productId, coupon_code: code }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    if (res.status === 200 && data.success && data.data) {
      const d = data.data;
      couponPending.set(key, { ...pending, couponCode: code });
      const text =
        `🎟 <b>CUPOM VÁLIDO!</b>\n\n` +
        `Produto: <b>${escapeHtml(d.product || pending.productName)}</b>\n` +
        `Preço normal: ${brl(d.base_price != null ? d.base_price : 0)}\n` +
        `Desconto: −${brl(d.discount != null ? d.discount : 0)} (<code>${escapeHtml(code)}</code>)\n` +
        `━━━━━━━━━━━━━━━\n` +
        `💰 <b>Total: ${brl(d.final_price != null ? d.final_price : 0)}</b>`;
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: `✅ Confirmar compra — ${brl(d.final_price != null ? d.final_price : 0)}`, callback_data: 'confirm_coupon_buy' }],
            [{ text: '❌ Cancelar', callback_data: 'cancel_coupon' }]
          ]
        }
      };
      sendOrEdit(msg.chat.id, pending.menuMessageId, text, { parse_mode: 'HTML', ...keyboard });
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    } else {
      const reason = (data && data.error) || 'Cupom inválido, expirado ou sem usos disponíveis.';
      const text =
        `❌ <b>Cupom inválido:</b> ${escapeHtml(reason)}\n\n` +
        `Envie outro código ou toque em <b>Cancelar</b>.`;
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancel_coupon' }]] } };
      sendOrEdit(msg.chat.id, pending.menuMessageId, text, { parse_mode: 'HTML', ...keyboard });
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }
  } catch (err) {
    sendOrEdit(msg.chat.id, pending.menuMessageId,
      `❌ <b>Erro de Conexão:</b> não foi possível validar o cupom (${API_BASE_URL}). Verifique se o servidor está rodando!`,
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  }
});

// Confirma a compra com o cupom já validado
async function confirmCouponBuy(chatId, user, messageId) {
  const pending = couponPending.get(String(chatId));
  couponPending.delete(String(chatId));
  if (!pending || !pending.couponCode) {
    return showCatalog(chatId, messageId);
  }
  await handlePurchase(chatId, user, messageId, {
    productId: pending.productId,
    productName: pending.productName,
    couponCode: pending.couponCode
  });
}

// Função de Processar Compra e Gerar Link na API
async function handlePurchase(chatId, user, messageId, opts) {
  opts = opts || {};
  if (!RESELLER_API_KEY) {
    return sendOrEdit(chatId, messageId, '⚠️ <b>Bot em Manutenção:</b> A chave de revendedor não foi configurada pelo administrador no arquivo .env.', { parse_mode: 'HTML' });
  }

  // Notificação de processamento: quando veio de um CLIQUE no menu (messageId),
  // a própria mensagem clicada vira o "processando" e depois vira a entrega —
  // zero mensagens novas no chat. Fora de clique (ex.: /comprar), envia nova.
  const loadingText = '⚡ <i>Processando seu pedido e gerando seu link exclusivo... Aguarde 2 segundos...</i>';
  let loadingMsg = null;
  if (messageId) {
    await bot.editMessageText(loadingText, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => {});
  } else {
    loadingMsg = await bot.sendMessage(chatId, loadingText, { parse_mode: 'HTML' }).catch(() => null);
  }

  const customerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Cliente Telegram';
  const customerId = 'tg_' + user.id;
  const customerContact = user.username ? ('@' + user.username) : ('ID: ' + user.id);

  try {
    const payload = {
      customer_name: customerName,
      customer_id: customerId,
      customer_contact: customerContact,
      sale_price: DEFAULT_SALE_PRICE
    };
    if (opts.productId) payload.product_id = opts.productId;
    if (opts.productName) payload.product = opts.productName;
    if (opts.couponCode) payload.coupon_code = opts.couponCode;

    const response = await fetch(`${API_BASE_URL}/api/v1/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': RESELLER_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // Apaga a mensagem de carregando (quando foi enviada como mensagem nova)
    if (loadingMsg) bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

    if (response.status === 200 && data.success) {
      // SUCESSO! Link gerado e saldo debitado em R$ 2,99
      console.log('[venda] link gerado:', data.token, 'saldo restante:', data.balance_remaining);
      const productLabel = data.product || opts.productName || 'Spotify Premium';
      const discountInfo = (data.discount && data.discount > 0)
        ? `🎟 <b>Cupom aplicado:</b> <code>${escapeHtml(data.coupon_code || '')}</code> (− ${brl(data.discount)})\n`
        : '';
      let deliveryText, linkKeyboard;
      if (data.delivered_item) {
        // Entrega de item do estoque (conta ou link cadastrado no painel)
        const item = data.delivered_item;
        const detailBlock = item.type === 'link'
          ? `🔗 <b>Seu Link:</b>\n👉 ${escapeHtml(item.content)}\n\n`
          : `🔑 <b>Login:</b> <code>${escapeHtml(item.login || '')}</code>\n` +
            `🔒 <b>Senha:</b> <code>${escapeHtml(item.password || '')}</code>\n\n`;
        deliveryText = 
          `🎉 <b>PAGAMENTO CONFIRMADO & ACESSO LIBERADO!</b>\n\n` +
          `🎧 <b>Produto:</b> ${escapeHtml(productLabel)}\n` +
          `👤 <b>Cliente:</b> ${customerName}\n` +
          `${discountInfo}` +
          `📦 <b>Sua entrega:</b>\n` +
          `${detailBlock}` +
          `💡 <b>Atenção:</b> guarde esses dados com segurança. Eles são entregues apenas uma vez e não podem ser recuperados novamente.\n\n` +
          `<i>Obrigado por comprar conosco!</i>`;
        const urlRow = item.type === 'link'
          ? [{ text: '🚀 ABRIR MEU LINK AGORA', url: item.content }]
          : [];
        linkKeyboard = {
          reply_markup: {
            inline_keyboard: [
              ...(urlRow.length ? [urlRow] : []),
              [
                { text: '🔄 Outro Produto', callback_data: 'catalog' },
                { text: '🏠 Menu Principal', callback_data: 'back_to_menu' }
              ]
            ]
          }
        };
      } else {
        deliveryText = 
          `🎉 <b>PAGAMENTO CONFIRMADO & ACESSO LIBERADO!</b>\n\n` +
          `🎧 <b>Produto:</b> ${escapeHtml(productLabel)}\n` +
          `👤 <b>Cliente:</b> ${customerName}\n` +
          `${discountInfo}` +
          `🔑 <b>Sua Chave Única:</b> <code>${data.token}</code>\n` +
          `⏳ <b>Validade do Link:</b> 24 horas\n\n` +
          `🔗 <b>Seu Link Individual:</b>\n` +
          `👉 ${data.link}\n\n` +
          `💡 <b>Como Ativar:</b>\n` +
          `1. Clique no botão azul abaixo para abrir seu link exclusivo.\n` +
          `2. Siga as instruções da nossa tela segura para ativar seu <b>${escapeHtml(productLabel)}</b>!\n\n` +
          `<i>Obrigado por comprar conosco!</i>`;

        linkKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚀 ABRIR MEU ACESSO AGORA', url: data.link }
              ],
              [
                { text: '🔄 Outro Produto', callback_data: 'catalog' },
                { text: '🏠 Menu Principal', callback_data: 'back_to_menu' }
              ]
            ]
          }
        };
      }

      sendOrEdit(chatId, messageId, deliveryText, { parse_mode: 'HTML', ...linkKeyboard });

    } else if (response.status === 402) {
      // Saldo Insuficiente (custo do produto)
      const outOfBalanceMsg = (data && data.error) || 'O saldo do revendedor na central está abaixo do custo do produto.';
      sendOrEdit(chatId, messageId, 
        `⚠️ <b>Saldo Insuficiente!</b>\n\n` +
        `${escapeHtml(outOfBalanceMsg)}\n\n` +
        `💼 <b>Acesse para recarregar:</b> ${PUBLIC_BASE_URL}/revendedor.html`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    } else if (response.status === 409) {
      // Produto esgotado ou conflito de estoque (venda simultanea)
      const outOfStockMsg = (data && data.error) || 'Produto esgotado no momento. Tente novamente mais tarde.';
      sendOrEdit(chatId, messageId,
        `⚠️ <b>Estoque Esgotado!</b>\n\n` +
        `${escapeHtml(outOfStockMsg)}`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    } else if (response.status === 403) {
      // Conta Bloqueada
      sendOrEdit(chatId, messageId, 
        '🚫 <b>Acesso Suspenso:</b> A conta deste revendedor foi temporariamente suspensa pelo administrador da plataforma.',
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    } else {
      // Outro Erro
      const otherErrMsg = data.error || 'Erro interno no servidor. Tente novamente em instantes.';
      if (/esgot/i.test(otherErrMsg)) {
        sendOrEdit(chatId, messageId,
          `⚠️ <b>Estoque Esgotado!</b>\n\n` +
          `${escapeHtml(otherErrMsg)}`,
          { parse_mode: 'HTML', ...backToMenuKeyboard() }
        );
      } else {
        sendOrEdit(chatId, messageId, 
          `❌ <b>Falha ao gerar link:</b> ${otherErrMsg}`,
          { parse_mode: 'HTML', ...backToMenuKeyboard() }
        );
      }
    }

  } catch (err) {
    if (loadingMsg) bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    sendOrEdit(chatId, messageId,
      `❌ <b>Erro de Conexão:</b> Não foi possível conectar ao servidor da API (${API_BASE_URL}). Verifique se o servidor está rodando!`,
      { parse_mode: 'HTML' }
    );
  }
}

// Função de Consultar Saldo e Métricas (da conta vinculada ao ID de perfil)
async function handleCheckBalance(chatId, user, messageId) {
  if (!RESELLER_API_KEY) {
    return sendOrEdit(chatId, messageId, '⚠️ Chave de revendedor não configurada.', { parse_mode: 'HTML' });
  }

  try {
    // Envia o X-Telegram-Id para o servidor consultar o saldo da conta
    // vinculada àquele ID de perfil (site + bot ficam juntos pelo mesmo ID).
    const headers = { 'X-API-Key': RESELLER_API_KEY };
    if (user && user.id) headers['X-Telegram-Id'] = String(user.id);

    const res = await fetch(`${API_BASE_URL}/api/v1/balance`, { headers });
    const data = await res.json();

    if (res.status === 404 && data.needs_link) {
      return sendOrEdit(chatId, messageId,
        `🔗 <b>Perfil ainda não vinculado!</b>\n\n` +
        `${data.error || ''}\n\n` +
        `👉 Abra o painel do revendedor, cole seu ID na aba <b>Meu Perfil</b> e tente /saldo novamente.`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    }

    if (data.success) {
      const balance = parseFloat(data.credits != null ? data.credits : (data.balance || 0));
      const costPerLink = parseFloat(data.cost_per_link || 2.99);
      const possibleLinks = Math.floor(balance / costPerLink);
      const linkedId = data.telegram_id ? `<code>${data.telegram_id}</code>` : 'não vinculado';

      const balanceText = 
        `📊 <b>PAINEL DO REVENDEDOR (METRICS)</b>\n\n` +
        `👤 <b>Revendedor:</b> ${escapeHtml(data.reseller)}\n` +
        `🆔 <b>ID de Perfil:</b> ${linkedId}\n` +
        `💰 <b>Saldo Atual em Reais:</b> R$ ${balance.toFixed(2).replace('.', ',')}\n` +
        `🏷️ <b>Custo por Link:</b> R$ ${costPerLink.toFixed(2).replace('.', ',')}\n` +
        `📦 <b>Capacidade de Venda:</b> ${possibleLinks} links restantes\n\n` +
        `📈 <b>Total de Vendas Realizadas:</b> ${data.total_sales} vendas\n` +
        `💵 <b>Faturamento Total:</b> R$ ${parseFloat(data.total_revenue || 0).toFixed(2).replace('.', ',')}\n` +
        `🟢 <b>Status da Conta:</b> ${data.active ? 'Ativa & Operando' : 'Bloqueada / Pausada'}\n\n` +
        `💳 <i>Para adicionar mais saldo, faça uma recarga a partir de R$ 15,00 no painel web.</i>`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 Abrir Painel Completo no Navegador', url: `${PUBLIC_BASE_URL}/revendedor.html` }],
            [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
          ]
        }
      };

      sendOrEdit(chatId, messageId, balanceText, { parse_mode: 'HTML', ...options });
    } else {
      sendOrEdit(chatId, messageId, '❌ Erro ao consultar saldo: ' + (data.error || 'Chave inválida.'));
    }
  } catch (e) {
    sendOrEdit(chatId, messageId, '❌ Não foi possível conectar ao servidor para obter o saldo.');
  }
}

// Função: mostra a API Key própria do revendedor (para criar bots próprios)
async function handleMyApi(chatId, user, messageId) {
  if (!RESELLER_API_KEY) {
    return sendOrEdit(chatId, messageId, '⚠️ Chave de revendedor não configurada.', { parse_mode: 'HTML' });
  }

  try {
    const headers = { 'X-API-Key': RESELLER_API_KEY };
    if (user && user.id) headers['X-Telegram-Id'] = String(user.id);

    const res = await fetch(`${API_BASE_URL}/api/v1/my-api`, { headers });
    const data = await res.json();

    if (res.status === 404 && data.needs_link) {
      return sendOrEdit(chatId, messageId,
        `🔗 <b>Perfil ainda não vinculado!</b>\n\n` +
        `${data.error || ''}\n\n` +
        `👉 Abra o painel do revendedor, cole seu ID na aba <b>Meu Perfil</b> e tente /api novamente.`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    }

    if (data.success && data.api_key) {
      const apiText =
        `🔑 <b>MINHA API DE REVENDEDOR</b>\n\n` +
        `👤 <b>Conta:</b> ${escapeHtml(data.reseller)}\n\n` +
        `🔐 <b>Sua API Key (use só você!):</b>\n<code>${data.api_key}</code>\n\n` +
        `📍 <b>URL da API (endpoint de entrega):</b>\n<code>${data.generate_endpoint || API_BASE_URL + '/api/v1/generate'}</code>\n\n` +
        `🤖 <b>Como usar no SEU bot:</b>\n` +
        `1. Crie seu bot no @BotFather e pegue o token dele.\n` +
        `2. No seu bot, quando o pagamento for confirmado, chame a URL acima com o header: X-API-Key: ${data.api_key}\n` +
        `3. Envie no corpo (JSON): customer_name (nome do cliente), customer_id (id dele), customer_contact (@username dele) e sale_price (valor cobrado).\n` +
        `4. O link do produto é entregue automaticamente na resposta (campo "link").\n\n` +
        `💡 <b>Importante:</b> o saldo é debitado da SUA conta. Mantenha esta chave em segredo e não compartilhe.`;

      const apiKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 Abrir Painel do Revendedor', url: `${PUBLIC_BASE_URL}/revendedor.html` }],
            [{ text: '🔄 Renovar Chave (invalida a atual)', callback_data: 'my_api_rotate' }],
            [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
          ]
        }
      };

      sendOrEdit(chatId, messageId, apiText, { parse_mode: 'HTML', ...apiKeyboard });
    } else {
      sendOrEdit(chatId, messageId, '❌ Erro ao consultar sua API: ' + (data.error || 'Chave inválida.'));
    }
  } catch (e) {
    sendOrEdit(chatId, messageId, '❌ Não foi possível conectar ao servidor para obter sua API.');
  }
}

// Função: renova a API Key do revendedor (a antiga é invalidada)
async function handleMyApiRotate(chatId, user, messageId) {
  if (!RESELLER_API_KEY) {
    return sendOrEdit(chatId, messageId, '⚠️ Chave de revendedor não configurada.', { parse_mode: 'HTML' });
  }

  try {
    const headers = { 'X-API-Key': RESELLER_API_KEY };
    if (user && user.id) headers['X-Telegram-Id'] = String(user.id);

    const res = await fetch(`${API_BASE_URL}/api/v1/my-api/rotate`, {
      method: 'POST',
      headers
    });
    const data = await res.json();

    if (res.status === 404 && data.needs_link) {
      return sendOrEdit(chatId, messageId,
        `🔗 <b>Perfil ainda não vinculado!</b>\n\n` +
        `${data.error || ''}\n\n` +
        `👉 Abra o painel do revendedor, cole seu ID na aba <b>Meu Perfil</b> e tente novamente.`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    }

    if (data.success && data.api_key) {
      const rotatedText =
        `🔄 <b>CHAVE DE API RENOVADA!</b>\n\n` +
        `✅ A chave antiga foi <b>invalidada</b>.\n\n` +
        `🔐 <b>Sua NOVA API Key:</b>\n<code>${data.api_key}</code>\n\n` +
        `⚠️ Atualize a chave nos bots que usavam a antiga, senão eles param de entregar.`;

      const rotatedKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Ver Minha API Completa', callback_data: 'my_api' }],
            [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
          ]
        }
      };

      sendOrEdit(chatId, messageId, rotatedText, { parse_mode: 'HTML', ...rotatedKeyboard });
    } else {
      sendOrEdit(chatId, messageId, '❌ Erro ao renovar chave: ' + (data.error || 'Tente novamente.'));
    }
  } catch (e) {
    sendOrEdit(chatId, messageId, '❌ Não foi possível conectar ao servidor para renovar a chave.');
  }
}

// ==========================================
// MINHAS COMPRAS (cliente final)
// ------------------------------------------
// Lista os produtos que a pessoa comprou e entrega um arquivo .txt com
// os acessos já entregues daquele produto.
// ==========================================

// Consulta as compras na API usando o ID/username do Telegram
async function fetchMyPurchases(user) {
  const headers = { 'X-API-Key': RESELLER_API_KEY };
  if (user && user.id) headers['X-Telegram-Id'] = String(user.id);
  if (user && user.username) headers['X-Telegram-Username'] = user.username;
  const res = await fetch(`${API_BASE_URL}/api/v1/my-purchases`, { headers });
  return { status: res.status, data: await res.json() };
}

// Ícone sugestivo por produto (fallback genérico)
function isSoldOut(p) {
  return p && p.stock !== null && p.stock !== undefined && Number(p.stock) <= 0;
}

function productIcon(product) {
  const p = String(product || '').toLowerCase();
  if (p.includes('spotify')) return '🎧';
  if (p.includes('netflix')) return '🎬';
  if (p.includes('gemin')) return '🤖';
  if (p.includes('disney')) return '🏰';
  if (p.includes('prime')) return '📺';
  if (p.includes('apple')) return '🍎';
  return '📦';
}

// Formata a data ISO (UTC) para pt-BR no fuso de Brasília
function formatPurchaseDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch (e) {
    return String(iso || '');
  }
}

// Envia/edita uma mensagem EDITANDO a atual quando possível (sem poluir o chat).
// Se messageId for informado, tenta reutilizar a mensagem atual: se a edição falhar
// (ex.: a mensagem é uma foto ou o texto ficou idêntico), envia nova com fallback
// seguro (safeSend remove o teclado se o Telegram rejeitar o botão).
function sendOrEdit(chatId, messageId, text, options) {
  const opts = options || {};
  const isNotModified = (e) => e && e.message && String(e.message).includes('message is not modified');
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...opts })
      .catch((e) => {
        if (isNotModified(e)) return null; // já está com esse conteúdo: sucesso
        // Mensagem com mídia (foto do QR PIX): edita a LEGENDA mantendo a foto
        return bot.editMessageCaption(chatId, messageId, text, { parse_mode: 'HTML', ...opts })
          .catch((e2) => {
            if (isNotModified(e2)) return null;
            return safeSend(chatId, text, opts);
          });
      });
  }
  return safeSend(chatId, text, opts);
}

// Tela: lista os produtos comprados (botões) para escolher e baixar o .txt
async function handleMyPurchases(chatId, user, messageId) {
  if (!RESELLER_API_KEY) {
    return sendOrEdit(chatId, messageId, '⚠️ <b>Bot em Manutenção:</b> chave de revendedor não configurada.', { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }

  try {
    const { status, data } = await fetchMyPurchases(user);
    if (!data || !data.success) {
      const errMsg = (data && data.error) || 'Não foi possível consultar suas compras.';
      return sendOrEdit(chatId, messageId, `❌ <b>Erro:</b> ${escapeHtml(errMsg)}`, backToMenuKeyboard());
    }

    const purchases = data.purchases || [];
    if (purchases.length === 0) {
      const emptyText =
        `📦 <b>MINHAS COMPRAS</b>\n\n` +
        `Você ainda não possui compras registradas neste bot.\n\n` +
        `🛒 Toque em <b>Comprar</b> no menu principal para fazer seu primeiro pedido!`;
      return sendOrEdit(chatId, messageId, emptyText, backToMenuKeyboard());
    }

    const title =
      `📦 <b>MINHAS COMPRAS</b>\n\n` +
      `Selecione um produto para baixar o <b>.txt</b> com os acessos que já foram entregues:`;

    const keyboard = purchases.map((p, i) => [
      { text: `${productIcon(p.product)} ${p.product} (${p.total})`, callback_data: `my_purchases_prod_${i}` }
    ]);
    keyboard.push([{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]);

    sendOrEdit(chatId, messageId, title, { reply_markup: { inline_keyboard: keyboard } });
  } catch (e) {
    console.error('[minhas compras] falha:', e && e.message ? e.message : e);
    sendOrEdit(chatId, messageId, `❌ <b>Erro de Conexão:</b> não foi possível consultar suas compras (${API_BASE_URL}).`, backToMenuKeyboard());
  }
}

// Tela: envia o arquivo .txt do produto escolhido com os acessos entregues
async function handleMyPurchasesProductTxt(chatId, user, index, messageId) {
  try {
    const { status, data } = await fetchMyPurchases(user);
    if (!data || !data.success || !data.purchases || !data.purchases[index]) {
      return sendOrEdit(chatId, messageId, '❌ <b>Produto não encontrado.</b> Toque em Minhas Compras novamente.', { parse_mode: 'HTML', ...backToMenuKeyboard() });
    }

    const product = data.purchases[index];
    const delivered = product.items.filter((it) => String(it.delivery_status || '').toLowerCase().startsWith('entregue'));
    const listed = delivered.length > 0 ? delivered : product.items;

    const lines = [];
    lines.push('==================================================');
    lines.push(`  MINHAS COMPRAS - ${String(product.product).toUpperCase()}`);
    lines.push(`  Cliente: ${data.customer_contact || data.customer_id || 'Cliente'}`);
    lines.push(`  Total de itens: ${product.total}`);
    lines.push(`  Gerado em: ${new Date().toLocaleString('pt-BR')}`);
    lines.push('==================================================');
    lines.push('');

    if (listed.length === 0) {
      lines.push('Nenhum item entregue encontrado para este produto.');
    } else {
      listed.forEach((item, idx) => {
        lines.push(`----------------------------------------------`);
        lines.push(`#${idx + 1} | Pedido: ${item.token}`);
        lines.push(`Link: ${item.link}`);
        lines.push(`Status: ${item.delivery_status}`);
        lines.push(`Data: ${formatPurchaseDate(item.created_at)}`);
      });
    }
    lines.push('');
    lines.push('==================================================');
    lines.push('Obrigado por comprar conosco!');

    const content = lines.join('\n');
    const slug = String(product.product).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'produto';
    const fileName = `minhas-compras-${slug}.txt`;

    const caption =
      `📦 <b>${product.product}</b> - ${product.total} item(ns)\n\n` +
      `📄 Arquivo .txt com os acessos já entregues.`;

    // IMPORTANTE: filename/contentType vão no 4º argumento (fileOptions).
    // Sem contentType, a lib tenta detectar o tipo do Buffer com file-type,
    // que NÃO reconhece texto puro e lança 'Unsupported Buffer file-type'.
    await bot.sendDocument(chatId, Buffer.from(content, 'utf-8'), {
      caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📦 Voltar às Minhas Compras', callback_data: 'my_purchases' }],
          [{ text: '⬅️ Voltar ao Menu', callback_data: 'back_to_menu' }]
        ]
      }
    }, {
      filename: fileName,
      contentType: 'text/plain'
    }).catch(async (err) => {
      console.error('[txt] falha ao enviar arquivo:', err && err.message ? err.message : err);
      // Fallback: entrega o conteúdo como mensagem de texto comum
      await bot.sendMessage(chatId, '❌ Envio de arquivo falhou — seguem os acessos em texto:\n\n' + content.slice(0, 3800), { ...backToMenuKeyboard() }).catch(() => {});
    });
  } catch (e) {
    console.error('[minhas compras txt] falha:', e && e.message ? e.message : e);
    sendOrEdit(chatId, messageId, `❌ <b>Erro de Conexão:</b> não foi possível gerar o arquivo (${API_BASE_URL}).`, { parse_mode: 'HTML', ...backToMenuKeyboard() });
  }
}

startKeepAlive();

// Mensagem de Ajuda
function sendHelpMessage(chatId, messageId) {
  const helpText = 
    `ℹ️ <b>COMO FUNCIONA O GERADOR:</b>\n\n` +
    `1. Cada link é gerado <b>individualmente e de forma única</b> para você.\n` +
    `2. O link possui tecnologia de camuflagem inteligente para garantir sua ativação sem conflitos.\n` +
    `3. Ao abrir o link, você cai na nossa tela de validação segura e é redirecionado instantaneamente para sua conta do Spotify Premium <b>3 meses</b>.\n\n` +
    `Dúvidas? Fale com nosso suporte: ${SUPPORT_USER}`;

  sendOrEdit(chatId, messageId, helpText, { parse_mode: 'HTML', ...backToMenuKeyboard() });
}

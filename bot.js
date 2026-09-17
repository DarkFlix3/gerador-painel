require('dotenv').config();
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

// Envia o Menu Principal — se messageId for informado, EDITA a mensagem atual
// no lugar (vira o menu) em vez de enviar outra, para não poluir o chat.
function sendMainMenu(chatId, messageId) {
  const mainText = `🏠 <b>Menu Principal</b>\n\nSelecione uma das opções abaixo:`;
  if (messageId) {
    bot.editMessageText(mainText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard().reply_markup
    }).catch(() => {
      // Fallback: se não conseguir editar (mensagem antiga demais etc.),
      // apaga a antiga e envia o menu limpo
      bot.deleteMessage(chatId, messageId).catch(() => {});
      bot.sendMessage(chatId, mainText, { parse_mode: 'HTML', ...getMainKeyboard() });
    });
  } else {
    bot.sendMessage(chatId, mainText, { parse_mode: 'HTML', ...getMainKeyboard() });
  }
}

// Mostra o ID de Perfil da pessoa (id único no bot e no site do gerador)
function sendProfileId(chatId, user) {
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
    `Depois de vinculado, o comando /saldo mostra o saldo da SUA conta.`;

  bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...backToMenuKeyboard() });
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
          { text: '🛒 Comprar Spotify 3 Meses (R$ ' + DEFAULT_SALE_PRICE.toFixed(2).replace('.', ',') + ')', callback_data: 'buy_now' }
        ],
        [
          { text: 'ℹ️ Como Funciona', callback_data: 'how_it_works' },
          { text: '💬 Suporte', callback_data: 'support' }
        ],
        [
          { text: '💳 Meu Saldo & Vendas (Revendedor)', callback_data: 'check_balance' }
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
  const firstName = msg.from.first_name || 'Cliente';

  const welcomeText = 
    `👋 Olá, <b>${firstName}</b>! Seja muito bem-vindo(a) ao nosso <b>Gerador Automático de Acesso Spotify Premium 3 MESES</b>!\n\n` +
    `⚡ <b>Entrega 100% Automática e Instantânea</b>\n` +
    `🎧 Receba seu link exclusivo na hora direto aqui no chat.\n` +
    `💰 Preço Especial: <b>R$ ${DEFAULT_SALE_PRICE.toFixed(2).replace('.', ',')}</b>\n\n` +
    `Selecione uma das opções abaixo para começar:`;

  bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', ...getMainKeyboard() });
});

// Comando /comprar
bot.onText(/\/comprar/, async (msg) => {
  await handlePurchase(msg.chat.id, msg.from);
});

// Comando /saldo (saldo da conta vinculada ao ID de perfil)
bot.onText(/\/saldo/, async (msg) => {
  await handleCheckBalance(msg.chat.id, msg.from);
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

// Comando /api — mostra a chave de API do revendedor para bots próprios
bot.onText(/\/(api|minhaapi|apikey)/, async (msg) => {
  await handleMyApi(msg.chat.id, msg.from);
});

// Resposta a Botões Inline
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  bot.answerCallbackQuery(query.id);

  if (action === 'buy_now') {
    await handlePurchase(chatId, query.from);
  } else if (action === 'check_balance') {
    await handleCheckBalance(chatId, query.from);
  } else if (action === 'my_id') {
    sendProfileId(chatId, query.from);
  } else if (action === 'my_api') {
    await handleMyApi(chatId, query.from);
  } else if (action === 'my_api_rotate') {
    await handleMyApiRotate(chatId, query.from);
  } else if (action === 'how_it_works') {
    sendHelpMessage(chatId);
  } else if (action === 'support') {
    bot.sendMessage(chatId, 
      `📞 <b>Atendimento & Suporte:</b>\n\nPrecisa de ajuda ou teve alguma dúvida?\nFale com nosso suporte oficial: ${SUPPORT_USER}`, 
      { parse_mode: 'HTML', ...backToMenuKeyboard() }
    );
  } else if (action === 'back_to_menu') {
    // Edita a mensagem atual virando o menu principal (sem duplicar no chat)
    sendMainMenu(chatId, query.message.message_id);
  }
});

// Função de Processar Compra e Gerar Link na API
async function handlePurchase(chatId, user) {
  if (!RESELLER_API_KEY) {
    return bot.sendMessage(chatId, 
      '⚠️ <b>Bot em Manutenção:</b> A chave de revendedor não foi configurada pelo administrador no arquivo .env.',
      { parse_mode: 'HTML' }
    );
  }

  // Notificação de processamento
  const loadingMsg = await bot.sendMessage(chatId, '⚡ <i>Processando seu pedido e gerando seu link exclusivo... Aguarde 2 segundos...</i>', { parse_mode: 'HTML' });

  const customerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Cliente Telegram';
  const customerId = 'tg_' + user.id;
  const customerContact = user.username ? ('@' + user.username) : ('ID: ' + user.id);

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': RESELLER_API_KEY
      },
      body: JSON.stringify({
        customer_name: customerName,
        customer_id: customerId,
        customer_contact: customerContact,
        sale_price: DEFAULT_SALE_PRICE
      })
    });

    const data = await response.json();

    // Apaga a mensagem de carregando
    bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

    if (response.status === 200 && data.success) {
      // SUCESSO! Link gerado e saldo debitado em R$ 2,99
      console.log('[venda] link gerado:', data.token, 'saldo restante:', data.balance_remaining);
      const deliveryText = 
        `🎉 <b>PAGAMENTO CONFIRMADO & ACESSO LIBERADO!</b>\n\n` +
        `🎧 <b>Produto:</b> Spotify Premium 3 Meses (Acesso Individual)\n` +
        `👤 <b>Cliente:</b> ${customerName}\n` +
        `🔑 <b>Sua Chave Única:</b> <code>${data.token}</code>\n` +
        `⏳ <b>Validade do Link:</b> 24 horas\n\n` +
        `🔗 <b>Seu Link Individual:</b>\n` +
        `👉 ${data.link}\n\n` +
        `💡 <b>Como Ativar:</b>\n` +
        `1. Clique no botão azul abaixo para abrir seu link exclusivo.\n` +
        `2. Conecte sua conta do Spotify e aproveite seus <b>3 meses</b> de Premium sem anúncios!\n\n` +
        `<i>Obrigado por comprar conosco!</i>`;

      const linkKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 ABRIR MEU ACESSO AGORA', url: data.link }
            ],
            [
              { text: '🔄 Comprar Outro Link', callback_data: 'buy_now' },
              { text: '🏠 Menu Principal', callback_data: 'back_to_menu' }
            ]
          ]
        }
      };

      safeSend(chatId, deliveryText, { parse_mode: 'HTML', ...linkKeyboard });

    } else if (response.status === 402) {
      // Saldo Insuficiente (< R$ 2,99)
      bot.sendMessage(chatId, 
        `⚠️ <b>Estoque Temporariamente Esgotado!</b>\n\n` +
        `O saldo do revendedor na central está abaixo de R$ 2,99.\n` +
        `Por favor, recarregue seu saldo no painel do revendedor para que o bot continue entregando links.\n\n` +
        `💼 <b>Acesse para recarregar:</b> ${PUBLIC_BASE_URL}/revendedor.html`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    } else if (response.status === 403) {
      // Conta Bloqueada
      bot.sendMessage(chatId, 
        '🚫 <b>Acesso Suspenso:</b> A conta deste revendedor foi temporariamente suspensa pelo administrador da plataforma.',
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    } else {
      // Outro Erro
      bot.sendMessage(chatId, 
        `❌ <b>Falha ao gerar link:</b> ${data.error || 'Erro interno no servidor. Tente novamente em instantes.'}`,
        { parse_mode: 'HTML', ...backToMenuKeyboard() }
      );
    }

  } catch (err) {
    bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    bot.sendMessage(chatId, 
      `❌ <b>Erro de Conexão:</b> Não foi possível conectar ao servidor da API (${API_BASE_URL}). Verifique se o servidor está rodando!`,
      { parse_mode: 'HTML' }
    );
  }
}

// Função de Consultar Saldo e Métricas (da conta vinculada ao ID de perfil)
async function handleCheckBalance(chatId, user) {
  if (!RESELLER_API_KEY) {
    return bot.sendMessage(chatId, '⚠️ Chave de revendedor não configurada.', { parse_mode: 'HTML' });
  }

  try {
    // Envia o X-Telegram-Id para o servidor consultar o saldo da conta
    // vinculada àquele ID de perfil (site + bot ficam juntos pelo mesmo ID).
    const headers = { 'X-API-Key': RESELLER_API_KEY };
    if (user && user.id) headers['X-Telegram-Id'] = String(user.id);

    const res = await fetch(`${API_BASE_URL}/api/v1/balance`, { headers });
    const data = await res.json();

    if (res.status === 404 && data.needs_link) {
      return bot.sendMessage(chatId,
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

      safeSend(chatId, balanceText, { parse_mode: 'HTML', ...options });
    } else {
      bot.sendMessage(chatId, '❌ Erro ao consultar saldo: ' + (data.error || 'Chave inválida.'));
    }
  } catch (e) {
    bot.sendMessage(chatId, '❌ Não foi possível conectar ao servidor para obter o saldo.');
  }
}

// Função: mostra a API Key própria do revendedor (para criar bots próprios)
async function handleMyApi(chatId, user) {
  if (!RESELLER_API_KEY) {
    return bot.sendMessage(chatId, '⚠️ Chave de revendedor não configurada.', { parse_mode: 'HTML' });
  }

  try {
    const headers = { 'X-API-Key': RESELLER_API_KEY };
    if (user && user.id) headers['X-Telegram-Id'] = String(user.id);

    const res = await fetch(`${API_BASE_URL}/api/v1/my-api`, { headers });
    const data = await res.json();

    if (res.status === 404 && data.needs_link) {
      return bot.sendMessage(chatId,
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

      safeSend(chatId, apiText, { parse_mode: 'HTML', ...apiKeyboard });
    } else {
      bot.sendMessage(chatId, '❌ Erro ao consultar sua API: ' + (data.error || 'Chave inválida.'));
    }
  } catch (e) {
    bot.sendMessage(chatId, '❌ Não foi possível conectar ao servidor para obter sua API.');
  }
}

// Função: renova a API Key do revendedor (a antiga é invalidada)
async function handleMyApiRotate(chatId, user) {
  if (!RESELLER_API_KEY) {
    return bot.sendMessage(chatId, '⚠️ Chave de revendedor não configurada.', { parse_mode: 'HTML' });
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
      return bot.sendMessage(chatId,
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

      safeSend(chatId, rotatedText, { parse_mode: 'HTML', ...rotatedKeyboard });
    } else {
      bot.sendMessage(chatId, '❌ Erro ao renovar chave: ' + (data.error || 'Tente novamente.'));
    }
  } catch (e) {
    bot.sendMessage(chatId, '❌ Não foi possível conectar ao servidor para renovar a chave.');
  }
}

startKeepAlive();

// Mensagem de Ajuda
function sendHelpMessage(chatId) {
  const helpText = 
    `ℹ️ <b>COMO FUNCIONA O GERADOR:</b>\n\n` +
    `1. Cada link é gerado <b>individualmente e de forma única</b> para você.\n` +
    `2. O link possui tecnologia de camuflagem inteligente para garantir sua ativação sem conflitos.\n` +
    `3. Ao abrir o link, você cai na nossa tela de validação segura e é redirecionado instantaneamente para sua conta do Spotify Premium <b>3 meses</b>.\n\n` +
    `Dúvidas? Fale com nosso suporte: ${SUPPORT_USER}`;

  bot.sendMessage(chatId, helpText, { parse_mode: 'HTML', ...backToMenuKeyboard() });
}

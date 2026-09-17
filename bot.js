require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// Configurações do Bot
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const RESELLER_API_KEY = process.env.RESELLER_API_KEY;
const DEFAULT_SALE_PRICE = parseFloat(process.env.DEFAULT_SALE_PRICE || '15.00');
const SUPPORT_USER = process.env.SUPPORT_USER || '@seu_suporte';

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
          { text: '🛒 Comprar Acesso Agora (R$ ' + DEFAULT_SALE_PRICE.toFixed(2).replace('.', ',') + ')', callback_data: 'buy_now' }
        ],
        [
          { text: 'ℹ️ Como Funciona', callback_data: 'how_it_works' },
          { text: '💬 Suporte', callback_data: 'support' }
        ],
        [
          { text: '💳 Meu Saldo & Vendas (Revendedor)', callback_data: 'check_balance' }
        ]
      ]
    }
  };
}

// Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Cliente';

  const welcomeText = 
    `👋 Olá, <b>${firstName}</b>! Seja muito bem-vindo(a) ao nosso <b>Gerador Automático de Acesso Spotify Premium</b>!\n\n` +
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

// Comando /saldo (para o revendedor)
bot.onText(/\/saldo/, async (msg) => {
  await handleCheckBalance(msg.chat.id);
});

// Comando /ajuda
bot.onText(/\/ajuda/, (msg) => {
  sendHelpMessage(msg.chat.id);
});

// Resposta a Botões Inline
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  bot.answerCallbackQuery(query.id);

  if (action === 'buy_now') {
    await handlePurchase(chatId, query.from);
  } else if (action === 'check_balance') {
    await handleCheckBalance(chatId);
  } else if (action === 'how_it_works') {
    sendHelpMessage(chatId);
  } else if (action === 'support') {
    bot.sendMessage(chatId, 
      `📞 <b>Atendimento & Suporte:</b>\n\nPrecisa de ajuda ou teve alguma dúvida?\nFale com nosso suporte oficial: ${SUPPORT_USER}`, 
      { parse_mode: 'HTML' }
    );
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
      const deliveryText = 
        `🎉 <b>PAGAMENTO CONFIRMADO & ACESSO LIBERADO!</b>\n\n` +
        `🎧 <b>Produto:</b> Acesso Individual Spotify Premium\n` +
        `👤 <b>Cliente:</b> ${customerName}\n` +
        `🔑 <b>Sua Chave Única:</b> <code>${data.token}</code>\n` +
        `⏳ <b>Validade do Link:</b> 24 horas\n\n` +
        `🔗 <b>Seu Link Individual Camuflado:</b>\n` +
        `👉 ${data.link}\n\n` +
        `💡 <b>Como Ativar:</b>\n` +
        `1. Clique no botão azul abaixo para abrir seu link exclusivo.\n` +
        `2. Conecte sua conta do Spotify e aproveite suas músicas sem anúncios!\n\n` +
        `<i>Obrigado por comprar conosco!</i>`;

      const linkKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 ABRIR MEU ACESSO AGORA', url: data.link }
            ],
            [
              { text: '🔄 Comprar Outro Link', callback_data: 'buy_now' }
            ]
          ]
        }
      };

      bot.sendMessage(chatId, deliveryText, { parse_mode: 'HTML', ...linkKeyboard });

    } else if (response.status === 402) {
      // Saldo Insuficiente (< R$ 2,99)
      bot.sendMessage(chatId, 
        `⚠️ <b>Estoque Temporariamente Esgotado!</b>\n\n` +
        `O saldo do revendedor na central está abaixo de R$ 2,99.\n` +
        `Por favor, recarregue seu saldo no painel do revendedor para que o bot continue entregando links.\n\n` +
        `💼 <b>Acesse para recarregar:</b> ${API_BASE_URL}/revendedor.html`,
        { parse_mode: 'HTML' }
      );
    } else if (response.status === 403) {
      // Conta Bloqueada
      bot.sendMessage(chatId, 
        '🚫 <b>Acesso Suspenso:</b> A conta deste revendedor foi temporariamente suspensa pelo administrador da plataforma.',
        { parse_mode: 'HTML' }
      );
    } else {
      // Outro Erro
      bot.sendMessage(chatId, 
        `❌ <b>Falha ao gerar link:</b> ${data.error || 'Erro interno no servidor. Tente novamente em instantes.'}`,
        { parse_mode: 'HTML' }
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

// Função de Consultar Saldo e Métricas do Revendedor
async function handleCheckBalance(chatId) {
  if (!RESELLER_API_KEY) {
    return bot.sendMessage(chatId, '⚠️ Chave de revendedor não configurada.', { parse_mode: 'HTML' });
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/balance`, {
      headers: { 'X-API-Key': RESELLER_API_KEY }
    });
    const data = await res.json();

    if (data.success) {
      const balance = parseFloat(data.balance || 0);
      const costPerLink = parseFloat(data.cost_per_link || 2.99);
      const possibleLinks = Math.floor(balance / costPerLink);

      const balanceText = 
        `📊 <b>PAINEL DO REVENDEDOR (METRICS)</b>\n\n` +
        `👤 <b>Revendedor:</b> ${data.reseller}\n` +
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
            [{ text: '🌐 Abrir Painel Completo no Navegador', url: `${API_BASE_URL}/revendedor.html` }]
          ]
        }
      };

      bot.sendMessage(chatId, balanceText, { parse_mode: 'HTML', ...options });
    } else {
      bot.sendMessage(chatId, '❌ Erro ao consultar saldo: ' + (data.error || 'Chave inválida.'));
    }
  } catch (e) {
    bot.sendMessage(chatId, '❌ Não foi possível conectar ao servidor para obter o saldo.');
  }
}

// Mensagem de Ajuda
function sendHelpMessage(chatId) {
  const helpText = 
    `ℹ️ <b>COMO FUNCIONA O GERADOR:</b>\n\n` +
    `1. Cada link é gerado <b>individualmente e de forma única</b> para você.\n` +
    `2. O link possui tecnologia de camuflagem inteligente para garantir sua ativação sem conflitos.\n` +
    `3. Ao abrir o link, você cai na nossa tela de validação segura e é redirecionado instantaneamente para sua conta do Spotify Premium.\n\n` +
    `Dúvidas? Fale com nosso suporte: ${SUPPORT_USER}`;

  bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
}

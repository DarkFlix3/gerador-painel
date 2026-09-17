import os
import telebot
import requests
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton

# Configurações
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "SEU_BOT_TOKEN_AQUI")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:3000")
RESELLER_API_KEY = os.getenv("RESELLER_API_KEY", "rev_key_sua_chave_aqui")
DEFAULT_SALE_PRICE = float(os.getenv("DEFAULT_SALE_PRICE", "15.00"))

bot = telebot.TeleBot(BOT_TOKEN)

def get_main_keyboard():
    markup = InlineKeyboardMarkup()
    markup.row(InlineKeyboardButton(f"🛒 Comprar Acesso (R$ {DEFAULT_SALE_PRICE:.2f})", callback_data="buy_now"))
    markup.row(InlineKeyboardButton("ℹ️ Como Funciona", callback_data="how_it_works"), InlineKeyboardButton("💳 Meu Saldo", callback_data="check_balance"))
    return markup

@bot.message_handler(commands=['start'])
def handle_start(message):
    nome = message.from_user.first_name or "Cliente"
    texto = (
        f"👋 Olá, <b>{nome}</b>! Bem-vindo ao <b>Gerador Automático de Spotify Premium</b>!\n\n"
        f"⚡ <b>Entrega Instantânea:</b> Link liberado na hora.\n"
        f"💰 Preço: <b>R$ {DEFAULT_SALE_PRICE:.2f}</b>\n\n"
        f"Clique no botão abaixo para comprar seu acesso:"
    )
    bot.send_message(message.chat.id, texto, parse_mode="HTML", reply_markup=get_main_keyboard())

@bot.callback_query_handler(func=lambda call: True)
def handle_query(call):
    chat_id = call.message.chat.id
    if call.data == "buy_now":
        process_purchase(chat_id, call.from_user)
    elif call.data == "check_balance":
        check_balance(chat_id)
    elif call.data == "how_it_works":
        bot.send_message(chat_id, "ℹ️ Cada link é gerado exclusivamente para você e direciona com segurança ao Spotify!")

def process_purchase(chat_id, user):
    headers = {"X-API-Key": RESELLER_API_KEY, "Content-Type": "application/json"}
    payload = {
        "customer_name": user.first_name,
        "customer_id": f"tg_{user.id}",
        "customer_contact": f"@{user.username}" if user.username else str(user.id),
        "sale_price": DEFAULT_SALE_PRICE
    }
    
    try:
        res = requests.post(f"{API_BASE_URL}/api/v1/generate", json=payload, headers=headers)
        data = res.json()
        
        if res.status_code == 200 and data.get("success"):
            link = data["link"]
            markup = InlineKeyboardMarkup()
            markup.row(InlineKeyboardButton("🚀 ABRIR MEU LINK AGORA", url=link))
            
            texto = (
                f"🎉 <b>ACESSO LIBERADO COM SUCESSO!</b>\n\n"
                f"🔑 <b>Chave:</b> <code>{data['token']}</code>\n"
                f"🔗 <b>Link:</b> {link}\n\n"
                f"<i>Clique no botão abaixo para ativar:</i>"
            )
            bot.send_message(chat_id, texto, parse_mode="HTML", reply_markup=markup)
        elif res.status_code == 402:
            bot.send_message(chat_id, "⚠️ Saldo insuficiente na central (necessário R$ 2,99). Recarregue no painel!")
        else:
            bot.send_message(chat_id, f"❌ Erro: {data.get('error', 'Falha ao gerar link')}")
    except Exception as e:
        bot.send_message(chat_id, f"❌ Erro de conexão com a API: {str(e)}")

def check_balance(chat_id):
    headers = {"X-API-Key": RESELLER_API_KEY}
    try:
        res = requests.get(f"{API_BASE_URL}/api/v1/balance", headers=headers)
        data = res.json()
        if data.get("success"):
            texto = (
                f"📊 <b>SALDO DO REVENDEDOR:</b>\n\n"
                f"💰 <b>Saldo:</b> R$ {float(data.get('balance', 0)):.2f}\n"
                f"🏷️ <b>Custo/Link:</b> R$ 2,99\n"
                f"📈 <b>Vendas Totais:</b> {data.get('total_sales', 0)}\n"
            )
            bot.send_message(chat_id, texto, parse_mode="HTML")
    except:
        bot.send_message(chat_id, "❌ Falha ao obter saldo da API.")

if __name__ == "__main__":
    print("🤖 Bot Telegram em Python iniciado...")
    bot.infinity_polling()

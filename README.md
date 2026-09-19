# 🚀 Quantum Link Generator & Painel Multi-Tenant de Revenda

Sistema completo de geração de links camuflados, portal individual para revendedores com cálculo automático de lucro e histórico de clientes, saldo em dinheiro real (R$), recargas flexíveis via PIX, painel administrativo master e API REST para integração com bots (Telegram, Discord, WhatsApp).

---

## 🌟 Principais Funcionalidades

### 1. 🔗 Gerador de Links com Camuflagem Inteligente
- **Link Alvo Pré-Configurado:** Preserva parâmetros de rastreamento do link de indicação do Spotify (`si=...`, `utm_source=whatsapp`, etc.).
- **URL Exclusiva para Cada Cliente:** Cada comprador recebe um link de aparência única (ex: `http://localhost:3000/r/A8F19B`), impedindo que percebam que todos recebem a mesma indicação original.
- **Tela de Validação (Splash Screen):** Tela com contagem regressiva e injeção dinâmica de parâmetros de sessão e nonces randômicos.
- **Gerador Web Público:** Interface cyberpunk/glassmorphism com gerador de QR Code instantâneo e botão de cópia com 1 clique.

---

### 2. 🛡️ Painel Administrativo Master (`/admin.html`)
- **Gestão de Revendedores:** Tabela com todos os revendedores, saldo em R$, links vendidos e faturamento total gerado.
- **Bloqueio Instantâneo:** Suspenda ou reative qualquer revendedor com 1 clique. Bots de revendedores bloqueados são suspensos imediatamente.
- **Ajuste de Saldo:** O administrador pode adicionar ou alterar saldo em Reais para qualquer parceiro.
- **Monitoramento e Logs:** Gráficos de volume de acessos e monitoramento de logs de erros em tempo real.

---

## 🔑 Contas Administrativas Padrão

| Administrador | Usuário | Senha | Nível |
| :--- | :--- | :--- | :--- |
| **Admin Principal** | `admin` | `admin123` | Acesso Master |
| **Admin Felipe** | `felipe` | `felipe123` | Acesso Master |
*(Revendedores e suas chaves de API são gerenciados exclusivamente pelo administrador no Painel Admin)*

---

## 🛠️ Como Executar o Projeto

### Requisitos:
- **Node.js 22+** ou **24+** (utiliza o módulo nativo `node:sqlite`).

### Passo a Passo:
1. Clone o repositório:
```bash
git clone <URL_DO_REPOSITORIO>
cd gerador-painel
```

2. Instale as dependências:
```bash
npm install
```

3. Inicie o servidor:
```bash
npm start
```

4. Acesse no navegador:
- **Gerador Público:** [http://localhost:3000](http://localhost:3000)
- **Painel Administrativo:** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

---

## 🤖 Bot do Telegram Oficial de Vendas Automáticas

O projeto já inclui um bot pronto tanto em **Node.js** (`bot.js`) quanto em **Python** (`bot_telegram.py`). Ele atende seus clientes 24h por dia, gera os links automaticamente chamando a API, debita os R$ 2,99 do saldo do revendedor e entrega o link camuflado no chat com botão de 1 clique.

### ⚙️ Como Configurar o Bot:

1. **Crie seu bot no Telegram:**
   - Abra o Telegram e procure por `@BotFather`.
   - Digite `/newbot` e siga as instruções para escolher nome e username.
   - Copie o **Token de Acesso HTTP** fornecido pelo BotFather.

2. **Crie seu arquivo de configuração `.env`:**
   - Copie o arquivo `.env.example` para `.env`:
     ```bash
     cp .env.example .env
     ```
   - Preencha os campos com suas credenciais:
     ```env
     TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
     API_BASE_URL=http://localhost:3000
     RESELLER_API_KEY=rev_key_SUA_CHAVE_AQUI
     DEFAULT_SALE_PRICE=15.00
     SUPPORT_USER=@seu_telegram
     ```
   *(Sua `RESELLER_API_KEY` pode ser obtida com o administrador da plataforma)*.

3. **Inicie o Bot (Node.js):**
   ```bash
   npm run bot
   ```
   *Ou se preferir rodar em Python:*
   ```bash
   pip install pyTelegramBotAPI requests
   python bot_telegram.py
   ```

4. **Comandos disponíveis no Bot:**
   - `/start` - Apresentação, valores e teclado com botões interativos.
   - `🛒 Comprar Acesso` - Gera o link instantâneo para o cliente e registra no painel.
   - `/saldo` - Consulta saldo restante, custo por link e total de vendas do revendedor.
   - `ℹ️ Como Funciona` - Explicação didática sobre a ativação do Spotify.

---

## 🌐 Integração via API REST (Para Desenvolvedores / Outros Bots)

Caso queira integrar com seu próprio sistema, bot de Discord ou gateway de pagamento:

### Endpoint da API:
`POST http://localhost:3000/api/v1/generate`

#### Headers Necessários:
```http
Content-Type: application/json
X-API-Key: rev_key_SUA_CHAVE_AQUI
```
*(ou `Authorization: Bearer rev_key_SUA_CHAVE_AQUI`)*

#### Payload de Exemplo (JSON):
```json
{
  "customer_name": "João da Silva",
  "customer_id": "tg_9928172",
  "customer_contact": "@joaosilva_vip",
  "sale_price": 15.00
}
```

#### Resposta de Sucesso (`HTTP 200`):
```json
{
  "success": true,
  "message": "Link gerado e entregue com sucesso para o cliente!",
  "link": "http://localhost:3000/r/A7F9C2B814",
  "token": "A7F9C2B814",
  "delivery_status": "Entregue",
  "profit_generated": 12.01,
  "cost_deducted": 2.99,
  "balance_remaining": "12.01"
}
```


// Mock Backend Adapter for GitHub Pages Static Hosting
// Intercepts /api/* requests only when running on GitHub Pages (github.io)
(function() {
  const isGithubPages = window.location.hostname.includes('github.io');
  if (!isGithubPages) return; // Em localhost ou servidor próprio, usa o backend Node.js nativo

  console.log('⚡ Modo GitHub Pages Ativado: Usando Camada de Armazenamento Local Inteligente (LocalStorage)');

  const STORAGE_KEYS = {
    SETTINGS: 'quantum_mock_settings',
    RESELLERS: 'quantum_mock_resellers',
    SALES: 'quantum_mock_sales',
    GENERATIONS: 'quantum_mock_generations',
    LOGS: 'quantum_mock_logs'
  };

  // Inicializa dados padrão no localStorage se não existirem
  function initMockData() {
    if (!localStorage.getItem(STORAGE_KEYS.RESELLERS)) {
      const defaultResellers = [
        {
          id: 1,
          name: 'Revendedor Demo',
          email: 'demo@revenda.com',
          password: '123456',
          phone: '+55 11 99999-8888',
          api_key: 'rev_key_9a7b2c5e4d1f8a0b3c6e9d2f5a8b1c4e',
          credits: 30.00,
          active: 1,
          blocked: 0,
          sale_price: 15.00,
          cost_per_link: 2.99,
          notes: 'Conta de demonstração padrão com R$ 30,00 de saldo.',
          created_at: new Date(Date.now() - 3 * 86400000).toISOString()
        }
      ];
      localStorage.setItem(STORAGE_KEYS.RESELLERS, JSON.stringify(defaultResellers));
    }

    if (!localStorage.getItem(STORAGE_KEYS.SALES)) {
      const defaultSales = [
        {
          id: 1,
          reseller_id: 1,
          token: 'SP-88A92B1F',
          target_url: 'https://darkflix3.github.io/gerador-painel/r.html?token=SP-88A92B1F',
          customer_name: 'Gabriel Martins',
          customer_id: 'tg_88921',
          customer_contact: '@gabriel_vip',
          sale_price: 15.00,
          cost_price: 2.99,
          profit: 12.01,
          delivery_status: 'Entregue',
          created_at: new Date(Date.now() - 3600000 * 2).toISOString()
        },
        {
          id: 2,
          reseller_id: 1,
          token: 'SP-44C10D7E',
          target_url: 'https://darkflix3.github.io/gerador-painel/r.html?token=SP-44C10D7E',
          customer_name: 'Lucas Ferreira',
          customer_id: 'tg_77192',
          customer_contact: '@lucas_ferr',
          sale_price: 15.00,
          cost_price: 2.99,
          profit: 12.01,
          delivery_status: 'Entregue',
          created_at: new Date(Date.now() - 3600000 * 5).toISOString()
        }
      ];
      localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(defaultSales));
    }

    if (!localStorage.getItem(STORAGE_KEYS.LOGS)) {
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify([]));
    }
  }

  initMockData();

  function getResellers() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.RESELLERS) || '[]');
  }
  function saveResellers(data) {
    localStorage.setItem(STORAGE_KEYS.RESELLERS, JSON.stringify(data));
  }
  function getSales() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.SALES) || '[]');
  }
  function saveSales(data) {
    localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(data));
  }
  function getLogs() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
  }

  function mockResponse(status, data) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Intercepta window.fetch para rotas /api/*
  const originalFetch = window.fetch;
  window.fetch = async function(url, options = {}) {
    const urlStr = typeof url === 'string' ? url : (url.url || '');
    const method = (options.method || 'GET').toUpperCase();
    let body = {};
    if (options.body && typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch(e) {}
    }

    // Apenas intercepta se for uma chamada de /api/
    if (urlStr.includes('/api/')) {
      const cleanUrl = urlStr.replace(/^https?:\/\/[^\/]+/, '');

      // 1. INFO PÚBLICA
      if (cleanUrl.startsWith('/api/public/info')) {
        const sales = getSales();
        return mockResponse(200, {
          success: true,
          service_name: 'Quantum Access Generator',
          public_enabled: true,
          total_generated: 1482 + sales.length
        });
      }

      // 2. GERAÇÃO PÚBLICA
      if (cleanUrl.startsWith('/api/public/generate') && method === 'POST') {
        const randBytes = new Uint8Array(8);
        crypto.getRandomValues(randBytes);
        const token = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const basePath = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
        const originUrl = window.location.origin + basePath;
        const targetUrl = `${originUrl}/r.html?token=${token}`;

        return mockResponse(200, {
          success: true,
          data: {
            token,
            targetUrl,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          }
        });
      }

      // 3. LOGIN ADMIN (admin / admin123 ou felipe / felipe123)
      if (cleanUrl.startsWith('/api/admin/login') && method === 'POST') {
        const { username, password } = body;
        if ((username === 'admin' && password === 'admin123') || (username === 'felipe' && password === 'felipe123')) {
          localStorage.setItem('quantum_mock_current_admin', username);
          return mockResponse(200, {
            success: true,
            token: 'mock_jwt_token_' + username,
            admin: { id: username === 'admin' ? 1 : 2, username }
          });
        }
        return mockResponse(401, { success: false, error: 'Usuário ou senha incorretos.' });
      }

      // 4. ADMIN ME
      if (cleanUrl.startsWith('/api/admin/me')) {
        const u = localStorage.getItem('quantum_mock_current_admin') || 'admin';
        return mockResponse(200, { success: true, admin: { id: 1, username: u } });
      }

      // 5. ADMIN STATS
      if (cleanUrl.startsWith('/api/admin/stats')) {
        const resellers = getResellers();
        const sales = getSales();
        const totalRev = sales.reduce((acc, s) => acc + (s.sale_price || 0), 0);
        const totalCredits = resellers.reduce((acc, r) => acc + (parseFloat(r.credits) || 0), 0);

        const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const timeline = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000);
          timeline.push({ date_day: d.toISOString().slice(0, 10), count: Math.floor(10 + Math.random() * 25) });
        }

        return mockResponse(200, {
          success: true,
          kpis: {
            totalGenerations: 1482 + sales.length,
            todayGenerations: 48,
            totalResellers: resellers.length,
            activeResellers: resellers.filter(r => r.active && !r.blocked).length,
            blockedResellers: resellers.filter(r => r.blocked).length,
            circulatingCredits: totalCredits.toFixed(2),
            platformSalesCount: sales.length,
            platformGrossRevenue: totalRev.toFixed(2),
            errorsLast24h: 0
          },
          charts: {
            generationsTimeline: timeline,
            errorsTimeline: [],
            resellerBreakdown: resellers.map(r => ({ label: r.name, count: sales.filter(s => s.reseller_id === r.id).length }))
          }
        });
      }

      // 6. ADMIN RESELLERS LIST
      if (cleanUrl.startsWith('/api/admin/resellers') && method === 'GET') {
        const resellers = getResellers();
        const sales = getSales();
        const data = resellers.map(r => {
          const rSales = sales.filter(s => s.reseller_id === r.id);
          const rev = rSales.reduce((a, s) => a + (s.sale_price || 0), 0);
          const prof = rSales.reduce((a, s) => a + (s.profit || 0), 0);
          return {
            ...r,
            total_links_sold: rSales.length,
            total_revenue_sold: rev.toFixed(2),
            total_profit_earned: prof.toFixed(2)
          };
        });
        return mockResponse(200, { success: true, data });
      }

      // 7. ADMIN TOGGLE BLOCK
      if (cleanUrl.match(/\/api\/admin\/resellers\/(\d+)\/toggle-block/) && method === 'POST') {
        const id = parseInt(cleanUrl.match(/\/api\/admin\/resellers\/(\d+)\/toggle-block/)[1], 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id);
        if (!r) return mockResponse(404, { success: false, error: 'Revendedor não encontrado' });
        r.blocked = r.blocked === 1 ? 0 : 1;
        saveResellers(resellers);
        return mockResponse(200, {
          success: true,
          blocked: r.blocked === 1,
          message: r.blocked === 1 ? `Revendedor "${r.name}" bloqueado com sucesso!` : `Revendedor "${r.name}" desbloqueado com sucesso!`
        });
      }

      // 8. ADMIN CREDITS ADJUST
      if (cleanUrl.match(/\/api\/admin\/resellers\/(\d+)\/credits/) && method === 'POST') {
        const id = parseInt(cleanUrl.match(/\/api\/admin\/resellers\/(\d+)\/credits/)[1], 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id);
        if (!r) return mockResponse(404, { success: false, error: 'Revendedor não encontrado' });
        const val = parseFloat(body.credits);
        if (body.mode === 'add') {
          r.credits = parseFloat((parseFloat(r.credits || 0) + val).toFixed(2));
        } else {
          r.credits = parseFloat(val.toFixed(2));
        }
        saveResellers(resellers);
        return mockResponse(200, {
          success: true,
          credits: r.credits,
          balance: Number(r.credits).toFixed(2),
          message: `Saldo de ${r.name} atualizado para R$ ${Number(r.credits).toFixed(2).replace('.', ',')}!`
        });
      }

      // 9. ADMIN ALL SALES
      if (cleanUrl.startsWith('/api/admin/all-sales')) {
        const sales = getSales();
        const resellers = getResellers();
        const data = sales.map(s => {
          const r = resellers.find(x => x.id === s.reseller_id) || { name: 'Demo', email: 'demo@revenda.com' };
          return { ...s, reseller_name: r.name, reseller_email: r.email };
        });
        return mockResponse(200, { success: true, data });
      }

      // 10. ADMIN LOGS
      if (cleanUrl.startsWith('/api/admin/logs')) {
        return mockResponse(200, { success: true, data: getLogs() });
      }

      // 11. LOGIN REVENDEDOR
      if (cleanUrl.startsWith('/api/reseller/login') && method === 'POST') {
        const { email, password } = body;
        const resellers = getResellers();
        const r = resellers.find(x => x.email.toLowerCase() === email.trim().toLowerCase() && x.password === password);
        if (!r) {
          return mockResponse(401, { success: false, error: 'E-mail ou senha incorretos.' });
        }
        if (r.blocked === 1) {
          return mockResponse(403, { success: false, error: 'Esta conta foi suspensa ou bloqueada pelo administrador.' });
        }
        localStorage.setItem('quantum_mock_logged_reseller_id', r.id);
        return mockResponse(200, {
          success: true,
          token: 'mock_reseller_token_' + r.id,
          reseller: {
            id: r.id,
            name: r.name,
            email: r.email,
            api_key: r.api_key,
            credits: Number(r.credits || 0).toFixed(2),
            balance: Number(r.credits || 0).toFixed(2),
            sale_price: r.sale_price || 15.00,
            cost_per_link: r.cost_per_link || 2.99
          }
        });
      }

      // 12. CADASTRO REVENDEDOR
      if (cleanUrl.startsWith('/api/reseller/register') && method === 'POST') {
        const { name, email, password, phone } = body;
        if (!name || !email || !password) {
          return mockResponse(400, { success: false, error: 'Nome, e-mail e senha são obrigatórios.' });
        }
        const resellers = getResellers();
        if (resellers.find(x => x.email.toLowerCase() === email.trim().toLowerCase())) {
          return mockResponse(400, { success: false, error: 'Já existe uma conta com este e-mail.' });
        }

        const randKey = 'rev_key_' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
        const newR = {
          id: Date.now(),
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          phone: phone || '',
          api_key: randKey,
          credits: 0.00,
          active: 1,
          blocked: 0,
          sale_price: 15.00,
          cost_per_link: 2.99,
          notes: '',
          created_at: new Date().toISOString()
        };
        resellers.push(newR);
        saveResellers(resellers);
        localStorage.setItem('quantum_mock_logged_reseller_id', newR.id);

        return mockResponse(200, {
          success: true,
          message: 'Conta criada com sucesso! Faça uma recarga mínima de R$ 15,00 para começar a gerar links.',
          token: 'mock_reseller_token_' + newR.id,
          reseller: {
            id: newR.id,
            name: newR.name,
            email: newR.email,
            api_key: newR.api_key,
            credits: '0.00',
            balance: '0.00',
            sale_price: 15.00,
            cost_per_link: 2.99
          }
        });
      }

      // 13. REVENDEDOR ME
      if (cleanUrl.startsWith('/api/reseller/me')) {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id) || resellers[0];
        return mockResponse(200, {
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
      }

      // 14. REVENDEDOR DASHBOARD
      if (cleanUrl.startsWith('/api/reseller/dashboard')) {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id) || resellers[0];
        const sales = getSales().filter(s => s.reseller_id === r.id);
        const totalRev = sales.reduce((a, s) => a + (s.sale_price || 0), 0);
        const totalProf = sales.reduce((a, s) => a + (s.profit || 0), 0);

        const timeline = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          const daySales = sales.filter(s => s.created_at.slice(0, 10) === d);
          timeline.push({
            date_day: d,
            count: daySales.length,
            daily_profit: daySales.reduce((a, s) => a + (s.profit || 0), 0),
            daily_revenue: daySales.reduce((a, s) => a + (s.sale_price || 0), 0)
          });
        }

        return mockResponse(200, {
          success: true,
          kpis: {
            credits: Number(r.credits || 0).toFixed(2),
            balance: Number(r.credits || 0).toFixed(2),
            totalSales: sales.length,
            totalRevenue: totalRev.toFixed(2),
            totalProfit: totalProf.toFixed(2),
            todaySales: sales.length,
            todayProfit: totalProf.toFixed(2),
            salePrice: Number(r.sale_price || 15.00).toFixed(2),
            costPrice: Number(r.cost_per_link || 2.99).toFixed(2)
          },
          chart: timeline,
          recentSales: sales.slice(0, 5)
        });
      }

      // 15. REVENDEDOR SALES
      if (cleanUrl.startsWith('/api/reseller/sales')) {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const sales = getSales().filter(s => s.reseller_id === id);
        return mockResponse(200, { success: true, data: sales });
      }

      // 16. RECARGA REVENDEDOR
      if (cleanUrl.startsWith('/api/reseller/recharge') && method === 'POST') {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id) || resellers[0];
        const val = parseFloat(body.amount || body.credits);
        if (isNaN(val) || val < 15.00) {
          return mockResponse(400, { success: false, error: 'O valor mínimo para recarga de saldo é de R$ 15,00.' });
        }
        r.credits = parseFloat((parseFloat(r.credits || 0) + val).toFixed(2));
        saveResellers(resellers);
        return mockResponse(200, {
          success: true,
          message: `Recarga de R$ ${val.toFixed(2).replace('.', ',')} aprovada com sucesso! Saldo adicionado à sua conta.`,
          new_balance: Number(r.credits).toFixed(2),
          balance: Number(r.credits).toFixed(2),
          amount_paid: val
        });
      }

      // 17. GERAÇÃO MANUAL REVENDEDOR (-R$ 2,99)
      if (cleanUrl.startsWith('/api/reseller/generate-manual') && method === 'POST') {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id) || resellers[0];
        const costPrice = parseFloat(r.cost_per_link || 2.99);
        const currentCredits = parseFloat(r.credits || 0);

        if (currentCredits < costPrice) {
          return mockResponse(402, {
            success: false,
            error: `Saldo insuficiente. Cada link custa R$ ${costPrice.toFixed(2).replace('.', ',')} e seu saldo atual é de R$ ${currentCredits.toFixed(2).replace('.', ',')}. Recarregue seu saldo no painel.`
          });
        }

        r.credits = parseFloat((currentCredits - costPrice).toFixed(2));
        saveResellers(resellers);

        const randBytes = new Uint8Array(8);
        crypto.getRandomValues(randBytes);
        const token = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const basePath = window.location.pathname.replace(/\/revendedor\.html$/, '').replace(/\/$/, '');
        const originUrl = window.location.origin + basePath;
        const targetUrl = `${originUrl}/r.html?token=${token}`;

        const finalSalePrice = body.sale_price ? parseFloat(body.sale_price) : (r.sale_price || 15.00);
        const profit = Math.max(0, parseFloat((finalSalePrice - costPrice).toFixed(2)));

        const sales = getSales();
        const newSale = {
          id: Date.now(),
          reseller_id: r.id,
          token,
          target_url: targetUrl,
          customer_name: body.customer_name || 'Cliente Manual',
          customer_id: 'manual_web',
          customer_contact: body.customer_contact || 'Manual',
          sale_price: finalSalePrice,
          cost_price: costPrice,
          profit,
          delivery_status: 'Entregue (Manual)',
          created_at: new Date().toISOString()
        };
        sales.unshift(newSale);
        saveSales(sales);

        return mockResponse(200, {
          success: true,
          message: 'Link gerado com sucesso! R$ 2,99 descontado do seu saldo.',
          link: targetUrl,
          token,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          balance_remaining: Number(r.credits).toFixed(2),
          cost_deducted: costPrice,
          profit_generated: profit,
          sale_id: newSale.id
        });
      }

      // 18. ATUALIZAR PREÇO DE VENDA DO REVENDEDOR
      if (cleanUrl.startsWith('/api/reseller/settings') && method === 'POST') {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id) || resellers[0];
        if (body.sale_price) r.sale_price = parseFloat(body.sale_price);
        if (body.name) r.name = body.name.trim();
        if (body.phone) r.phone = body.phone.trim();
        saveResellers(resellers);
        return mockResponse(200, {
          success: true,
          message: 'Preço de venda e dados atualizados com sucesso!',
          sale_price: r.sale_price
        });
      }

      // 19. REGENERAR API KEY
      if (cleanUrl.startsWith('/api/reseller/regenerate-key') && method === 'POST') {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const resellers = getResellers();
        const r = resellers.find(x => x.id === id) || resellers[0];
        r.api_key = 'rev_key_' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
        saveResellers(resellers);
        return mockResponse(200, {
          success: true,
          message: 'Nova API Key gerada com sucesso!',
          api_key: r.api_key
        });
      }
    }

    // Caso não seja /api/, executa o fetch normal
    return originalFetch.apply(this, arguments);
  };
})();

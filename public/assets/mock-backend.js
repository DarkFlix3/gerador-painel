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
    LOGS: 'quantum_mock_logs',
    PRODUCTS: 'quantum_mock_products',
    COUPONS: 'quantum_mock_coupons',
    ORDERS: 'quantum_mock_orders',
    PAYMENTS: 'quantum_mock_payments',
    CUSTOMERS: 'quantum_mock_customers'
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
          delivered_type: 'account',
          delivered_login: 'gabriel.martins@email.com',
          delivered_password: 'Spotify@2026#gab',
          delivered_content: null,
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
          delivered_type: 'link',
          delivered_login: null,
          delivered_password: null,
          delivered_content: 'https://open.spotify.com/intl-pt/album/3pdr5eXXla4JphZqUcSPjp',
          created_at: new Date(Date.now() - 3600000 * 5).toISOString()
        }
      ];
      localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(defaultSales));
    }

    if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
      const defaultProducts = [
        {
          id: 1,
          name: 'Acesso Premium Spotify (12 Meses)',
          description: 'Acesso VIP ao grupo premium com link individual.',
          price: 15.00,
          cost_price: 2.99,
          emoji: '🎵',
          active: 1,
          sort_order: 1,
          created_at: new Date(Date.now() - 30 * 86400000).toISOString()
        }
      ];
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(defaultProducts));
    }

    if (!localStorage.getItem(STORAGE_KEYS.COUPONS)) {
      const defaultCoupons = [
        {
          id: 1,
          code: 'BEMVINDO10',
          discount_type: 'percent',
          discount_value: 10,
          max_uses: 50,
          used_count: 3,
          valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
          active: 1,
          created_at: new Date(Date.now() - 20 * 86400000).toISOString()
        }
      ];
      localStorage.setItem(STORAGE_KEYS.COUPONS, JSON.stringify(defaultCoupons));
    }

    if (!localStorage.getItem(STORAGE_KEYS.ORDERS)) {
      const now = Date.now();
      const defaultOrders = [
        {
          id: 1,
          order_code: 'PED-1001',
          reseller_id: 1,
          product_id: 1,
          product_name: 'Acesso Premium Spotify (12 Meses)',
          customer_name: 'Gabriel Martins',
          customer_id: 'tg_88921',
          customer_contact: '@gabriel_vip',
          unit_price: 15.00,
          discount: 0,
          total: 15.00,
          coupon_code: null,
          status: 'delivered',
          payment_method: 'BALANCE',
          payment_id: null,
          token: 'SP-88A92B1F',
          created_at: new Date(now - 3600000 * 2).toISOString(),
          updated_at: new Date(now - 3600000).toISOString()
        },
        {
          id: 2,
          order_code: 'PED-1002',
          reseller_id: 1,
          product_id: 1,
          product_name: 'Acesso Premium Spotify (12 Meses)',
          customer_name: 'Lucas Ferreira',
          customer_id: 'tg_77192',
          customer_contact: '@lucas_ferr',
          unit_price: 15.00,
          discount: 1.50,
          total: 13.50,
          coupon_code: 'BEMVINDO10',
          status: 'pending',
          payment_method: 'PIX',
          payment_id: null,
          token: null,
          created_at: new Date(now - 3600000).toISOString(),
          updated_at: null
        }
      ];
      localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(defaultOrders));
    }

    if (!localStorage.getItem(STORAGE_KEYS.PAYMENTS)) {
      const defaultPayments = [
        {
          id: 1,
          order_id: 2,
          reseller_id: 1,
          provider: 'PIX',
          external_id: null,
          amount: 13.50,
          currency: 'BRL',
          status: 'pending',
          metadata: null,
          created_at: new Date(Date.now() - 3600000).toISOString(),
          updated_at: null
        }
      ];
      localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(defaultPayments));
    }

    if (!localStorage.getItem(STORAGE_KEYS.CUSTOMERS)) {
      const now = Date.now();
      const defaultCustomers = [
        {
          id: 1,
          telegram_id: '88921',
          username: 'gabriel_vip',
          name: 'Gabriel Martins',
          first_seen: new Date(now - 2 * 86400000).toISOString(),
          last_seen: new Date(now - 1800000).toISOString(),
          orders_count: 3,
          total_spent: 45.00,
          blocked: 0,
          blocked_reason: null,
          blocked_at: null,
          notes: 'Cliente recorrente (3 compras).',
          created_at: new Date(now - 2 * 86400000).toISOString()
        },
        {
          id: 2,
          telegram_id: '77192',
          username: 'lucas_ferr',
          name: 'Lucas Ferreira',
          first_seen: new Date(now - 86400000).toISOString(),
          last_seen: new Date(now - 5 * 3600000).toISOString(),
          orders_count: 1,
          total_spent: 13.50,
          blocked: 0,
          blocked_reason: null,
          blocked_at: null,
          notes: null,
          created_at: new Date(now - 86400000).toISOString()
        },
        {
          id: 3,
          telegram_id: '77112',
          username: 'stephanie_a',
          name: 'Stephanie Alves',
          first_seen: new Date(now - 3 * 86400000).toISOString(),
          last_seen: new Date(now - 86400000).toISOString(),
          orders_count: 2,
          total_spent: 30.00,
          blocked: 1,
          blocked_reason: 'Chargeback na compra anterior.',
          blocked_at: new Date(now - 12 * 3600000).toISOString(),
          notes: null,
          created_at: new Date(now - 3 * 86400000).toISOString()
        }
      ];
      localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(defaultCustomers));
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
  function getCustomers() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS) || '[]');
  }
  function saveCustomers(data) {
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(data));
  }
  function getLogs() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
  }
  function getProducts() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
  }
  function saveProducts(data) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(data));
  }
  function getCoupons() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.COUPONS) || '[]');
  }
  function saveCoupons(data) {
    localStorage.setItem(STORAGE_KEYS.COUPONS, JSON.stringify(data));
  }
  function getOrders() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.ORDERS) || '[]');
  }
  function saveOrders(data) {
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(data));
  }
  function getPayments() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
  }
  function savePayments(data) {
    localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(data));
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
          public_enabled: false,
          total_generated: 1482 + sales.length
        });
      }

      // 2. GERAÇÃO PÚBLICA (desabilitada - links são gerados apenas pelos revendedores)
      if (cleanUrl.startsWith('/api/public/generate') && method === 'POST') {
        return mockResponse(403, { success: false, error: 'A geração pública está temporariamente desabilitada.' });
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
        const customers = getCustomers();
        const totalRev = sales.reduce((acc, s) => acc + (s.sale_price || 0), 0);
        const totalProfit = sales.reduce((acc, s) => acc + (s.profit || 0), 0);
        const totalCredits = resellers.reduce((acc, r) => acc + (parseFloat(r.credits) || 0), 0);
        const customersBal = customers.reduce((acc, c) => acc + (parseFloat(c.balance) || 0), 0);

        const timeline30d = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000);
          timeline30d.push({
            date_day: d.toISOString().slice(0, 10),
            count: 0,
            revenue: 0,
            profit: 0
          });
        }

        return mockResponse(200, {
          success: true,
          kpis: {
            revenueToday: 0,
            ordersToday: 0,
            revenueMonth: totalRev,
            totalRevenue: totalRev,
            accumulatedProfit: totalProfit,
            customersBalance: customersBal,
            totalCustomers: customers.length,
            activeCustomers7d: customers.filter(c => !c.blocked).length,
            blockedCustomers: customers.filter(c => c.blocked).length,
            totalOrders: sales.length,
            pendingOrders30d: 0,
            depositsMonth: 0,
            activeProducts: getProducts().filter(p => p.active).length,
            // Legado
            totalGenerations: sales.length,
            todayGenerations: 0,
            totalResellers: resellers.length,
            activeResellers: resellers.filter(r => r.active && !r.blocked).length,
            blockedResellers: resellers.filter(r => r.blocked).length,
            circulatingCredits: totalCredits.toFixed(2),
            platformSalesCount: sales.length,
            platformGrossRevenue: totalRev.toFixed(2),
            errorsLast24h: 0
          },
          charts: {
            timeline30d,
            generationsTimeline: timeline30d.slice(-7),
            errorsTimeline: [],
            resellerBreakdown: resellers.map(r => ({ label: r.name, count: sales.filter(s => s.reseller_id === r.id).length }))
          },
          recentOrders: sales.slice(0, 8).map(s => ({
            id: s.id,
            token: s.token,
            product: s.product || 'Produto',
            customer_name: s.customer_name || 'Cliente',
            customer_contact: s.customer_contact || '',
            sale_price: Number(s.sale_price || 0),
            delivery_status: s.delivery_status || 'Entregue',
            created_at: s.created_at
          })),
          recentMovements: []
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
        const urlObj = new URL(cleanUrl, window.location.origin);
        const search = (urlObj.searchParams.get('search') || '').trim().toLowerCase();
        const sales = getSales();
        const resellers = getResellers();
        let data = sales.map(s => {
          const r = resellers.find(x => x.id === s.reseller_id) || { name: 'Demo', email: 'demo@revenda.com' };
          return { ...s, reseller_name: r.name, reseller_email: r.email };
        });
        if (search) {
          data = data.filter(s =>
            String(s.customer_contact || '').toLowerCase().includes(search) ||
            String(s.customer_id || '').toLowerCase().includes(search) ||
            String(s.customer_name || '').toLowerCase().includes(search) ||
            String(s.token || '').toLowerCase().includes(search) ||
            String(s.id || '').toLowerCase().includes(search) ||
            String(s.product || '').toLowerCase().includes(search)
          );
        }
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

      // 20. ADMIN: PRODUTOS
      if (cleanUrl.startsWith('/api/admin/products')) {
        if (method === 'POST') {
          if (!body.name || !String(body.name).trim()) {
            return mockResponse(400, { success: false, error: 'Informe o nome do produto.' });
          }
          const products = getProducts();
          const np = {
            id: Date.now(),
            name: String(body.name).trim(),
            description: body.description || null,
            price: Math.max(0, parseFloat(body.price) || 0),
            cost_price: Math.max(0, parseFloat(body.cost_price) || 0),
            emoji: body.emoji || '🎁',
            active: body.active === false || body.active === 0 ? 0 : 1,
            sort_order: parseInt(body.sort_order || '0', 10),
            created_at: new Date().toISOString()
          };
          products.unshift(np);
          saveProducts(products);
          return mockResponse(200, { success: true, message: 'Produto criado com sucesso!', id: np.id });
        }
        const prodIdMatch = cleanUrl.match(/\/api\/admin\/products\/(\d+)/);
        if (prodIdMatch) {
          const pid = parseInt(prodIdMatch[1], 10);
          const products = getProducts();
          const p = products.find(x => x.id === pid);
          if (!p) return mockResponse(404, { success: false, error: 'Produto não encontrado.' });
          if (method === 'PUT') {
            if (body.name !== undefined && body.name !== '') p.name = String(body.name).trim();
            if (body.description !== undefined) p.description = body.description || null;
            if (body.price !== undefined) p.price = Math.max(0, parseFloat(body.price) || 0);
            if (body.cost_price !== undefined) p.cost_price = Math.max(0, parseFloat(body.cost_price) || 0);
            if (body.emoji !== undefined) p.emoji = body.emoji || '🎁';
            if (body.active !== undefined) p.active = (body.active === false || body.active === 0) ? 0 : 1;
            if (body.sort_order !== undefined) p.sort_order = parseInt(body.sort_order || '0', 10);
            saveProducts(products);
            return mockResponse(200, { success: true, message: 'Produto atualizado com sucesso!' });
          }
          if (method === 'DELETE') {
            p.active = 0;
            saveProducts(products);
            return mockResponse(200, { success: true, message: 'Produto desativado com sucesso.' });
          }
        }
        const productsSorted = getProducts().sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || (a.id - b.id));
        return mockResponse(200, { success: true, data: productsSorted });
      }

      // 21. ADMIN: CUPONS
      if (cleanUrl.startsWith('/api/admin/coupons')) {
        if (method === 'POST') {
          const cleanCode = body.code ? String(body.code).trim().toUpperCase().replace(/\s+/g, '') : '';
          if (!cleanCode) return mockResponse(400, { success: false, error: 'Informe o código do cupom.' });
          const value = parseFloat(body.discount_value);
          if (isNaN(value) || value <= 0) return mockResponse(400, { success: false, error: 'Valor de desconto inválido.' });
          if (body.discount_type !== 'fixed' && value > 100) return mockResponse(400, { success: false, error: 'Desconto percentual não pode passar de 100%.' });
          const coupons = getCoupons();
          if (coupons.find(x => x.code === cleanCode)) return mockResponse(400, { success: false, error: 'Já existe um cupom com este código.' });
          const nc = {
            id: Date.now(),
            code: cleanCode,
            discount_type: body.discount_type === 'fixed' ? 'fixed' : 'percent',
            discount_value: value,
            max_uses: Math.max(0, parseInt(body.max_uses || '0', 10)),
            used_count: 0,
            valid_until: body.valid_until ? new Date(body.valid_until).toISOString() : null,
            active: body.active === false || body.active === 0 ? 0 : 1,
            created_at: new Date().toISOString()
          };
          coupons.unshift(nc);
          saveCoupons(coupons);
          return mockResponse(200, { success: true, message: 'Cupom ' + cleanCode + ' criado com sucesso!', id: nc.id });
        }
        const coupIdMatch = cleanUrl.match(/\/api\/admin\/coupons\/(\d+)/);
        if (coupIdMatch) {
          const cid = parseInt(coupIdMatch[1], 10);
          const coupons = getCoupons();
          const c = coupons.find(x => x.id === cid);
          if (!c) return mockResponse(404, { success: false, error: 'Cupom não encontrado.' });
          if (method === 'PUT') {
            if (body.discount_type !== undefined) c.discount_type = body.discount_type === 'fixed' ? 'fixed' : 'percent';
            if (body.discount_value !== undefined) {
              const nv = parseFloat(body.discount_value);
              if (isNaN(nv) || nv <= 0) return mockResponse(400, { success: false, error: 'Valor de desconto inválido.' });
              c.discount_value = nv;
            }
            if (body.max_uses !== undefined) c.max_uses = Math.max(0, parseInt(body.max_uses || '0', 10));
            if (body.valid_until !== undefined) c.valid_until = body.valid_until ? new Date(body.valid_until).toISOString() : null;
            if (body.active !== undefined) c.active = (body.active === false || body.active === 0) ? 0 : 1;
            saveCoupons(coupons);
            return mockResponse(200, { success: true, message: 'Cupom atualizado com sucesso!' });
          }
          if (method === 'DELETE') {
            c.active = 0;
            saveCoupons(coupons);
            return mockResponse(200, { success: true, message: 'Cupom desativado.' });
          }
        }
        return mockResponse(200, { success: true, data: getCoupons() });
      }

      // 21b. ADMIN: CLIENTES DO BOT
      if (cleanUrl.startsWith('/api/admin/customers')) {
        const match = cleanUrl.match(/\/api\/admin\/customers\/(\d+)\/(toggle-block|purchases|balance)/);
        const listOnly = /\/api\/admin\/customers(\?.*)?$/.test(cleanUrl);
        if (match && match[2] === 'balance' && method === 'POST') {
          const list = getCustomers();
          const c = list.find(x => Number(x.id) === Number(match[1]));
          if (!c) return mockResponse(404, { success: false, error: 'Cliente não encontrado.' });
          const amount = Math.round((parseFloat(body && body.amount) || 0) * 100) / 100;
          const current = parseFloat(c.balance || 0);
          const updated = Math.max(0, Math.round((current + amount) * 100) / 100);
          c.balance = updated;
          saveCustomers(list);
          const label = c.name || (c.username ? '@' + c.username : ('ID ' + (c.telegram_id || c.id)));
          return mockResponse(200, {
            success: true,
            message: amount > 0
              ? `R$ ${amount.toFixed(2).replace('.', ',')} adicionado ao saldo de ${label}. Novo saldo: R$ ${updated.toFixed(2).replace('.', ',')}.`
              : `R$ ${Math.abs(amount).toFixed(2).replace('.', ',')} retirado do saldo de ${label}. Novo saldo: R$ ${updated.toFixed(2).replace('.', ',')}.`,
            balance: updated,
            amount
          });
        }
        if (match && match[2] === 'toggle-block' && method === 'POST') {
          const list = getCustomers();
          const c = list.find(x => Number(x.id) === Number(match[1]));
          if (!c) return mockResponse(404, { success: false, error: 'Cliente não encontrado.' });
          const willBlock = Number(c.blocked) === 1 ? 0 : 1;
          c.blocked = willBlock;
          c.blocked_reason = willBlock === 1 ? (body.reason ? String(body.reason).trim() : null) : null;
          c.blocked_at = willBlock === 1 ? new Date().toISOString() : null;
          saveCustomers(list);
          return mockResponse(200, {
            success: true,
            blocked: willBlock === 1,
            blocked_reason: c.blocked_reason,
            message: willBlock === 1 ? 'Cliente bloqueado com sucesso.' : 'Cliente desbloqueado com sucesso.'
          });
        }
        if (match && method === 'GET') {
          const c = getCustomers().find(x => Number(x.id) === Number(match[1]));
          if (!c) return mockResponse(404, { success: false, error: 'Cliente não encontrado.' });
          const sales = getSales().filter(s =>
            (c.telegram_id && (s.customer_id === 'tg_' + c.telegram_id || s.customer_id === c.telegram_id)) ||
            (c.username && String(s.customer_contact || '').toLowerCase() === '@' + String(c.username).toLowerCase())
          );
          const purchases = sales.map(s => ({
            id: s.id,
            token: s.token,
            product: s.product || 'Link gerado',
            sale_price: parseFloat(s.sale_price || 0),
            delivery_status: s.delivery_status || 'Entregue',
            created_at: s.created_at,
            customer_contact: s.customer_contact || null,
            reseller_name: 'Revendedor Demo',
            item_type: s.delivered_type || null,
            account_login: s.delivered_login || null,
            account_password: s.delivered_password || null,
            item_content: s.delivered_content || null
          })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          return mockResponse(200, {
            success: true,
            data: purchases,
            total_spent: Number(purchases.reduce((acc, p) => acc + p.sale_price, 0).toFixed(2))
          });
        }
        if (method === 'DELETE') {
          const m2 = cleanUrl.match(/\/api\/admin\/customers\/(\d+)/);
          if (m2) {
            const list = getCustomers();
            const idx = list.findIndex(x => Number(x.id) === Number(m2[1]));
            if (idx === -1) return mockResponse(404, { success: false, error: 'Cliente não encontrado.' });
            list.splice(idx, 1);
            saveCustomers(list);
            return mockResponse(200, { success: true, message: 'Cliente removido com sucesso.' });
          }
        }
        if (listOnly && method === 'GET') {
          const url = new URL(cleanUrl, window.location.origin);
          const search = (url.searchParams.get('search') || '').trim().toLowerCase();
          let list = getCustomers().slice();
          if (search) {
            list = list.filter(c =>
              String(c.name || '').toLowerCase().includes(search) ||
              String(c.username || '').toLowerCase().includes(search) ||
              String(c.telegram_id || '').toLowerCase().includes(search)
            );
          }
          list.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
          const total_blocked = getCustomers().filter(c => Number(c.blocked) === 1).length;
          const total_revenue = getCustomers().reduce((acc, c) => acc + parseFloat(c.total_spent || 0), 0);
          return mockResponse(200, {
            success: true,
            data: list,
            total: list.length,
            total_blocked: total_blocked,
            total_revenue: Number(total_revenue.toFixed(2)),
            limit: 200,
            offset: 0
          });
        }
      }

      // 22. ADMIN: PEDIDOS
      if (cleanUrl.startsWith('/api/admin/orders')) {
        const statusMatch = cleanUrl.match(/\/api\/admin\/orders\/(\d+)\/status/);
        if (statusMatch && method === 'POST') {
          const orderId = parseInt(statusMatch[1], 10);
          const orders = getOrders();
          const o = orders.find(x => x.id === orderId);
          if (!o) return mockResponse(404, { success: false, error: 'Pedido não encontrado.' });
          if (!['pending', 'paid', 'delivered', 'cancelled'].includes(body.status)) {
            return mockResponse(400, { success: false, error: 'Status inválido.' });
          }
          o.status = body.status;
          o.updated_at = new Date().toISOString();
          if (o.status === 'delivered' && !o.token) {
            o.token = 'SP-' + Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
          }
          saveOrders(orders);
          return mockResponse(200, {
            success: true,
            message: 'Pedido #' + o.order_code + ' atualizado para ' + o.status + '.',
            delivered: o.status === 'delivered'
          });
        }
        const resellers = getResellers();
        const ordersList = getOrders().map(o => ({
          ...o,
          reseller_name: (resellers.find(r => r.id === o.reseller_id) || {}).name || null
        }));
        return mockResponse(200, { success: true, data: ordersList });
      }

      // 23. ADMIN: PAGAMENTOS
      if (cleanUrl.startsWith('/api/admin/payments')) {
        const orders = getOrders();
        const resellers = getResellers();
        const paymentsList = getPayments().map(p => {
          const relOrder = orders.find(o => o.id === p.order_id) || {};
          return {
            ...p,
            order_code: relOrder.order_code || null,
            product_name: relOrder.product_name || null,
            reseller_name: (resellers.find(r => r.id === p.reseller_id) || {}).name || null
          };
        });
        return mockResponse(200, { success: true, data: paymentsList });
      }

      // 24. REVENDEDOR: PEDIDOS + CANCELAMENTO
      if (cleanUrl.startsWith('/api/reseller/orders')) {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const cancelMatch = cleanUrl.match(/\/api\/reseller\/orders\/(\d+)\/cancel/);
        if (cancelMatch && method === 'POST') {
          const orderId = parseInt(cancelMatch[1], 10);
          const orders = getOrders();
          const o = orders.find(x => x.id === orderId && x.reseller_id === id);
          if (!o) return mockResponse(404, { success: false, error: 'Pedido não encontrado.' });
          if (o.status !== 'pending') return mockResponse(400, { success: false, error: 'Apenas pedidos pendentes podem ser cancelados.' });
          o.status = 'cancelled';
          o.updated_at = new Date().toISOString();
          saveOrders(orders);
          return mockResponse(200, { success: true, message: 'Pedido #' + o.order_code + ' cancelado.' });
        }
        return mockResponse(200, { success: true, data: getOrders().filter(o => o.reseller_id === id) });
      }

      // 25. REVENDEDOR: CLIENTES AGRUPADOS
      if (cleanUrl.startsWith('/api/reseller/customers')) {
        const id = parseInt(localStorage.getItem('quantum_mock_logged_reseller_id') || '1', 10);
        const sales = getSales().filter(s => s.reseller_id === id && s.customer_name);
        const grouped = {};
        sales.forEach(s => {
          const key = (s.customer_id || '') + '|' + (s.customer_contact || '');
          if (!grouped[key]) {
            grouped[key] = {
              customer_name: s.customer_name,
              customer_id: s.customer_id || null,
              customer_contact: s.customer_contact || null,
              purchase_count: 0,
              total_spent: 0,
              total_profit: 0,
              last_purchase: null
            };
          }
          grouped[key].purchase_count += 1;
          grouped[key].total_spent += parseFloat(s.sale_price || 0);
          grouped[key].total_profit += parseFloat(s.profit || 0);
          if (!grouped[key].last_purchase || s.created_at > grouped[key].last_purchase) {
            grouped[key].last_purchase = s.created_at;
          }
        });
        const customersList = Object.values(grouped)
          .sort((a, b) => String(b.last_purchase || '').localeCompare(String(a.last_purchase || '')))
          .map(c => ({
            ...c,
            total_spent: c.total_spent.toFixed(2),
            total_profit: c.total_profit.toFixed(2)
          }));
        return mockResponse(200, { success: true, data: customersList });
      }

      // 21. BOT STATUS (PUBLIC/BOT)
      if (cleanUrl.startsWith('/api/v1/bot-status') && method === 'GET') {
        const stored = JSON.parse(localStorage.getItem('quantum_mock_bot_status') || '{}');
        return mockResponse(200, {
          success: true,
          status: stored.status || 'active',
          maintenance_message: stored.maintenance_message || '⚠️ Estamos realizando uma manutenção preventiva no sistema. Em breve o bot estará de volta ao normal!',
          announcement: stored.announcement || ''
        });
      }

      // 22. BOT STATUS UPDATE (ADMIN)
      if (cleanUrl.startsWith('/api/admin/bot/status') && method === 'POST') {
        const stored = JSON.parse(localStorage.getItem('quantum_mock_bot_status') || '{}');
        const updated = { ...stored, ...body };
        localStorage.setItem('quantum_mock_bot_status', JSON.stringify(updated));
        return mockResponse(200, {
          success: true,
          message: 'Status do bot atualizado.',
          bot_status: updated.status,
          broadcast_result: body.notify_all ? { sent: getCustomers().length, failed: 0 } : null
        });
      }

      // 23. BOT BROADCAST (ADMIN)
      if (cleanUrl.startsWith('/api/admin/bot/broadcast') && method === 'POST') {
        const customers = getCustomers();
        return mockResponse(200, {
          success: true,
          sent: customers.length,
          failed: 0,
          total: customers.length
        });
      }

      // 24. FINANCIAL TRANSACTIONS (ADMIN)
      if (cleanUrl.startsWith('/api/admin/financial-transactions') && method === 'GET') {
        const urlObj = new URL(cleanUrl, window.location.origin);
        const typeFilter = urlObj.searchParams.get('type') || '';
        const search = (urlObj.searchParams.get('search') || '').trim().toLowerCase();

        let rawTxs = JSON.parse(localStorage.getItem('quantum_mock_financial_txs') || '[]');
        if (rawTxs.length === 0) {
          // Generate demo transactions from sales and customers
          const sales = getSales();
          rawTxs = sales.map((s, idx) => ({
            id: idx + 1,
            customer_id: s.customer_id || 'tg_100',
            customer_name: s.customer_name || 'Cliente Demo',
            customer_contact: s.customer_contact || '@cliente',
            type: 'purchase',
            description: `Compra do produto ${s.product || 'Acesso'}`,
            order_number: s.token || `PED-${idx + 100}`,
            product_name: s.product || 'Spotify Premium',
            amount: parseFloat(s.cost_price || 2.99),
            balance_before: 15.00,
            balance_after: 15.00 - parseFloat(s.cost_price || 2.99),
            created_at: s.created_at || new Date().toISOString()
          }));
        }

        let filtered = rawTxs.slice();
        if (typeFilter) {
          filtered = filtered.filter(t => t.type === typeFilter);
        }
        if (search) {
          filtered = filtered.filter(t =>
            String(t.customer_name || '').toLowerCase().includes(search) ||
            String(t.customer_contact || '').toLowerCase().includes(search) ||
            String(t.customer_id || '').toLowerCase().includes(search) ||
            String(t.order_number || '').toLowerCase().includes(search) ||
            String(t.product_name || '').toLowerCase().includes(search)
          );
        }

        const totalDeposits = rawTxs.filter(t => t.type === 'deposit').reduce((acc, t) => acc + Number(t.amount || 0), 0).toFixed(2);
        const totalPurchases = rawTxs.filter(t => t.type === 'purchase').reduce((acc, t) => acc + Number(t.amount || 0), 0).toFixed(2);
        const totalRefunds = rawTxs.filter(t => t.type === 'refund').reduce((acc, t) => acc + Number(t.amount || 0), 0).toFixed(2);
        const totalInWallets = getCustomers().reduce((acc, c) => acc + Number(c.balance || 0), 0).toFixed(2);

        return mockResponse(200, {
          success: true,
          data: filtered,
          kpis: {
            totalDeposits,
            totalPurchases,
            totalRefunds,
            totalInWallets
          }
        });
      }
    }

    // Caso não seja /api/, executa o fetch normal
    return originalFetch.apply(this, arguments);
  };
})();

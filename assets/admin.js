// Admin Panel Frontend Logic
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();

  const tokenKey = 'quantum_admin_token';
  let authToken = localStorage.getItem(tokenKey);

  const loginModal = document.getElementById('login-modal');
  const formLogin = document.getElementById('form-login');
  const btnLogout = document.getElementById('btn-logout');
  const btnRefreshStats = document.getElementById('btn-refresh-stats');
  const navTabs = document.getElementById('nav-tabs');
  const pageTitle = document.getElementById('page-title');

  let generationsChart = null;
  let resellersChart = null;
  let revenueProfitChart = null;
  let ordersChart = null;

  // Toast Helper
  window.showToast = function(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    
    let iconName = 'info';
    let borderColor = '#6366f1';

    if (type === 'success') {
      iconName = 'check-circle';
      borderColor = '#10b981';
    } else if (type === 'error') {
      iconName = 'alert-triangle';
      borderColor = '#f43f5e';
    }

    toast.style.borderLeftColor = borderColor;
    toast.innerHTML = `
      <i data-lucide="${iconName}" class="w-5 h-5 shrink-0" style="color: ${borderColor}"></i>
      <span class="text-xs sm:text-sm font-medium leading-tight">${message}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  };

  // Authenticated Fetch
  async function apiFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (authToken) {
      options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    options.headers['Content-Type'] = 'application/json';

    const res = await fetch(url, options);
    if (res.status === 401) {
      localStorage.removeItem(tokenKey);
      authToken = null;
      showLoginModal();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    return res;
  }

  function showLoginModal() {
    loginModal.classList.remove('hidden');
    loginModal.classList.add('flex');
  }

  function hideLoginModal() {
    loginModal.classList.add('hidden');
    loginModal.classList.remove('flex');
  }

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Credenciais inválidas.');
      }

      authToken = data.token;
      localStorage.setItem(tokenKey, authToken);
      hideLoginModal();
      showToast('Bem-vindo ao Painel Master Admin!', 'success');
      loadAllDashboardData();

    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  btnLogout.addEventListener('click', () => {
    localStorage.removeItem(tokenKey);
    authToken = null;
    showToast('Sessão encerrada.', 'info');
    showLoginModal();
  });

  // Check auth
  async function checkAuth() {
    if (!authToken) {
      showLoginModal();
      return false;
    }
    try {
      const res = await apiFetch('/api/admin/me');
      if (!res.ok) throw new Error();
      hideLoginModal();
      return true;
    } catch {
      showLoginModal();
      return false;
    }
  }

  // Tabs
  navTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    const targetTab = btn.getAttribute('data-tab');
    switchTab(targetTab);
  });

  function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.remove('text-white', 'bg-indigo-600/30', 'border', 'border-indigo-500/40');
      el.classList.add('text-slate-400');
    });

    const activeBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (activeBtn) {
      activeBtn.classList.remove('text-slate-400');
      activeBtn.classList.add('text-white', 'bg-indigo-600/30', 'border', 'border-indigo-500/40');
    }

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    const content = document.getElementById(`tab-${tabId}`);
    if (content) content.classList.remove('hidden');

    const titles = {
      dashboard: 'Visão geral',
      'all-sales': 'Histórico Geral de Pedidos',
      products: 'Catálogo de Produtos',
      coupons: 'Cupons de Desconto',
      customers: 'Clientes do Bot',
      financeiro: 'Extrato Financeiro e Movimentações',
      'bot-control': 'Controle e Notificações do Bot DarkFlix',
      'error-logs': 'Monitoramento de Falhas e Erros',
      settings: 'Configurações do Link Alvo',
      'api-docs': 'Documentação da API para Bots de Revenda'
    };
    if (pageTitle) pageTitle.innerHTML = `<i data-lucide="layout-dashboard" class="w-5 h-5 text-indigo-400"></i> ${titles[tabId] || 'Painel Admin'}`;
    if (window.lucide) window.lucide.createIcons();

    if (tabId === 'dashboard') loadStats();
    if (tabId === 'all-sales') loadAllSales();
    if (tabId === 'products') loadProducts();
    if (tabId === 'coupons') loadCoupons();
    if (tabId === 'customers') loadCustomers();
    if (tabId === 'financeiro') loadFinancialTransactions();
    if (tabId === 'bot-control') loadBotControl();
    if (tabId === 'error-logs') loadErrorLogs();
    if (tabId === 'settings') loadSettings();
  }

  // ==============================================
  // 1. VISÃO GERAL (DASHBOARD) & STATS
  // ==============================================
  async function loadStats() {
    try {
      const res = await apiFetch('/api/admin/stats');
      const data = await res.json();
      if (!data.success) return;

      const { kpis, charts, recentOrders, recentMovements, ggsoma } = data;

      // 1. Cards de Métricas (8 blocos no topo)
      // Card 1: Faturamento Hoje
      const elRevToday = document.getElementById('kpi-rev-today');
      if (elRevToday) elRevToday.innerText = `R$ ${Number(kpis.revenueToday || 0).toFixed(2).replace('.', ',')}`;
      const elOrdersToday = document.getElementById('kpi-orders-today');
      if (elOrdersToday) elOrdersToday.innerText = `${Number(kpis.ordersToday || 0)} pedidos hoje`;

      // Card 2: Faturamento no Mês
      const elRevMonth = document.getElementById('kpi-rev-month');
      if (elRevMonth) elRevMonth.innerText = `R$ ${Number(kpis.revenueMonth || 0).toFixed(2).replace('.', ',')}`;
      const elRevTotal = document.getElementById('kpi-rev-total');
      if (elRevTotal) elRevTotal.innerText = `Total: R$ ${Number(kpis.totalRevenue || 0).toFixed(2).replace('.', ',')}`;

      // Card 3: Lucro Acumulado
      const elProfitAccum = document.getElementById('kpi-profit-accum');
      if (elProfitAccum) elProfitAccum.innerText = `R$ ${Number(kpis.accumulatedProfit || 0).toFixed(2).replace('.', ',')}`;

      // Card 4: Saldo dos Clientes
      const elCustBal = document.getElementById('kpi-customers-balance');
      if (elCustBal) elCustBal.innerText = `R$ ${Number(kpis.customersBalance || 0).toFixed(2).replace('.', ',')}`;
      const elCustCount = document.getElementById('kpi-customers-count');
      if (elCustCount) elCustCount.innerText = `${Number(kpis.totalCustomers || 0).toLocaleString('pt-BR')} clientes`;

      // Card 5: Clientes Ativos (7D)
      const elActive7d = document.getElementById('kpi-active-7d');
      if (elActive7d) elActive7d.innerText = Number(kpis.activeCustomers7d || 0).toLocaleString('pt-BR');
      const elBlockedCount = document.getElementById('kpi-blocked-count');
      if (elBlockedCount) elBlockedCount.innerText = `${Number(kpis.blockedCustomers || 0)} bloqueados`;

      // Card 6: Pedidos Totais
      const elTotalOrders = document.getElementById('kpi-total-orders');
      if (elTotalOrders) elTotalOrders.innerText = Number(kpis.totalOrders || 0).toLocaleString('pt-BR');
      const elPending30d = document.getElementById('kpi-pending-30d');
      if (elPending30d) elPending30d.innerText = `${Number(kpis.pendingOrders30d || 0)} pendentes (30d)`;

      // Card 7: Depósitos no Mês
      const elDepMonth = document.getElementById('kpi-deposits-month');
      if (elDepMonth) elDepMonth.innerText = `R$ ${Number(kpis.depositsMonth || 0).toFixed(2).replace('.', ',')}`;

      // Card 8: Produtos Ativos
      const elActiveProd = document.getElementById('kpi-active-products');
      if (elActiveProd) elActiveProd.innerText = Number(kpis.activeProducts || 0).toLocaleString('pt-BR');

      // 2. Gráficos Analíticos
      renderRevenueProfitChart(charts?.timeline30d || []);
      renderOrdersChart(charts?.timeline30d || []);

      // 3. Painéis Inferiores
      renderRecentOrders(recentOrders || []);
      renderRecentMovements(recentMovements || []);

    } catch (e) {
      console.warn('Erro ao carregar estatísticas da visão geral:', e);
    }
  }

  function renderRevenueProfitChart(timeline30d = []) {
    const ctx = document.getElementById('chart-revenue-profit-30d');
    if (!ctx) return;

    const labels = timeline30d.map(d => {
      const parts = d.date_day.split('-');
      return `${parts[2]}/${parts[1]}`;
    });
    const revData = timeline30d.map(d => Number(d.revenue || 0));
    const profitData = timeline30d.map(d => Number(d.profit || 0));

    if (revenueProfitChart) revenueProfitChart.destroy();

    revenueProfitChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Faturamento',
            data: revData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#10b981',
            pointRadius: 3
          },
          {
            label: 'Lucro Líquido',
            data: profitData,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.08)',
            borderWidth: 2,
            borderDash: [3, 3],
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#6366f1',
            pointRadius: 2.5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: R$ ${Number(ctx.raw).toFixed(2).replace('.', ',')}`
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#64748b', maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#64748b' } }
        }
      }
    });
  }

  function renderOrdersChart(timeline30d = []) {
    const ctx = document.getElementById('chart-orders-30d');
    if (!ctx) return;

    const labels = timeline30d.map(d => {
      const parts = d.date_day.split('-');
      return `${parts[2]}/${parts[1]}`;
    });
    const countData = timeline30d.map(d => Number(d.count || 0));

    if (ordersChart) ordersChart.destroy();

    ordersChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Pedidos por Dia',
            data: countData,
            backgroundColor: 'rgba(245, 158, 11, 0.75)',
            borderRadius: 4,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#64748b', precision: 0 } }
        }
      }
    });
  }

  function renderRecentOrders(orders = []) {
    const container = document.getElementById('dashboard-recent-orders');
    if (!container) return;
    if (orders.length === 0) {
      container.innerHTML = '<div class="text-center py-6 text-slate-500 text-xs">Nenhum pedido recente.</div>';
      return;
    }
    container.innerHTML = orders.map(o => {
      const d = new Date(o.created_at);
      const dateStr = !isNaN(d.getTime()) ? `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
      const st = String(o.delivery_status || 'Entregue').toLowerCase();
      let badge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">Concluído</span>';
      if (st.includes('pend')) badge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/60 text-amber-400 border border-amber-500/30">Pendente</span>';
      if (st.includes('erro') || st.includes('falh')) badge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30">Erro</span>';

      return `
        <div class="pt-2.5 pb-1 flex items-center justify-between text-xs">
          <div class="min-w-0 pr-2">
            <span class="font-bold text-white block truncate">${escapeHtml(o.product || 'Produto')}</span>
            <span class="text-[11px] text-slate-400 block font-mono truncate"># ${escapeHtml(String(o.id))} · ${escapeHtml(o.customer_name || 'Cliente')} · ${dateStr}</span>
          </div>
          <div class="text-right shrink-0 flex flex-col items-end gap-1">
            <span class="font-mono font-bold text-white">R$ ${Number(o.sale_price || 0).toFixed(2).replace('.', ',')}</span>
            ${badge}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderRecentMovements(movements = []) {
    const container = document.getElementById('dashboard-recent-movements');
    if (!container) return;
    if (movements.length === 0) {
      container.innerHTML = '<div class="text-center py-6 text-slate-500 text-xs">Nenhuma movimentação recente.</div>';
      return;
    }
    container.innerHTML = movements.map(m => {
      const d = new Date(m.created_at);
      const dateStr = !isNaN(d.getTime()) ? `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
      const isDeposit = m.type === 'deposit' || m.type === 'refund';
      const sign = isDeposit ? '+' : '−';
      const colorClass = isDeposit ? 'text-emerald-400' : 'text-rose-400';
      const badge = isDeposit
        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">Depósito</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30">Compra</span>';

      return `
        <div class="pt-2.5 pb-1 flex items-center justify-between text-xs">
          <div class="min-w-0 pr-2">
            <div class="flex items-center gap-2 mb-0.5">
              ${badge}
            </div>
            <span class="text-[11px] text-slate-300 block font-mono truncate">${escapeHtml(m.customer_name || 'Cliente')} · ${dateStr}</span>
          </div>
          <div class="text-right shrink-0">
            <span class="font-mono font-bold ${colorClass}">${sign} R$ ${Number(m.amount || 0).toFixed(2).replace('.', ',')}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ==============================================
  // 3. HISTÓRICO GERAL DE PEDIDOS (GLOBAL)
  // ==============================================
  async function loadAllSales() {
    const tbody = document.getElementById('all-sales-table-body');
    if (!tbody) return;

    try {
      const searchInput = document.getElementById('sales-search');
      const query = searchInput ? searchInput.value.trim() : '';
      const url = query ? `/api/admin/all-sales?search=${encodeURIComponent(query)}` : '/api/admin/all-sales';

      const res = await apiFetch(url);
      const data = await res.json();
      if (!data.success) return;
      window.__allSales = data.data || [];

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="px-5 py-8 text-center text-slate-500">${query ? 'Nenhum pedido encontrado para a pesquisa.' : 'Nenhum pedido realizado ainda.'}</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(s => {
        const d = new Date(s.created_at);
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5">
              <span class="font-bold text-indigo-300 block text-xs">${escapeHtml(s.reseller_name)}</span>
              <span class="text-[10px] text-slate-400">${escapeHtml(s.reseller_email || '')}</span>
            </td>
            <td class="px-5 py-3.5">
              <span class="font-bold text-white block">${escapeHtml(s.customer_name || 'Cliente')}</span>
              <span class="text-[10px] text-slate-400 font-mono">${escapeHtml(s.customer_contact || s.customer_id || 'Via Bot')}</span>
            </td>
            <td class="px-5 py-3.5 max-w-xs font-mono text-[11px]">
              <div class="flex items-center gap-1 text-cyan-300">
                <span class="truncate">${escapeHtml(s.target_url)}</span>
                <button onclick="copyToClipboard('${escapeHtml(s.target_url)}')" class="p-1 hover:text-white" title="Copiar Link">
                  <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </td>
            <td class="px-5 py-3">
              <span class="font-bold text-amber-300 block text-xs">${escapeHtml(s.product || '—')}</span>
              ${s.delivered_login ? `
                <span class="flex items-center gap-1 text-[10px] text-emerald-400 font-mono mt-0.5">
                  <span class="text-slate-500 font-sans">Login:</span>
                  <span class="truncate max-w-[10rem]">${escapeHtml(s.delivered_login)}</span>
                  <button onclick="copyToClipboard('${escapeHtml(s.delivered_login)}')" class="p-0.5 hover:text-white" title="Copiar login"><i data-lucide="copy" class="w-3 h-3"></i></button>
                </span>` : ''}
              ${s.delivered_password ? `
                <span class="flex items-center gap-1 text-[10px] text-sky-300 font-mono mt-0.5">
                  <span class="text-slate-500 font-sans">Senha:</span>
                  <span class="truncate max-w-[10rem]">${escapeHtml(s.delivered_password)}</span>
                  <button onclick="copyToClipboard('${escapeHtml(s.delivered_password)}')" class="p-0.5 hover:text-white" title="Copiar senha"><i data-lucide="copy" class="w-3 h-3"></i></button>
                </span>` : ''}
              ${s.delivered_content ? `<span class="text-[10px] text-emerald-400 font-mono block mt-0.5 truncate max-w-[15rem]">Link entregue: ${escapeHtml(s.delivered_content)}</span>` : ''}
            </td>
            <td class="px-5 py-3 font-mono font-bold text-white">R$ ${Number(s.sale_price).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3 font-mono text-[11px] ${Number(s.discount || 0) > 0 ? 'text-emerald-400' : 'text-slate-600'}">
              ${Number(s.discount || 0) > 0 ? '− R$ ' + Number(s.discount).toFixed(2).replace('.', ',') : '—'}
            </td>
            <td class="px-5 py-3 font-mono font-bold text-emerald-400">+ R$ ${Number(s.profit).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5">
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                ${s.delivery_status || 'Entregue'}
              </span>
            </td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}</td>
            <td class="px-5 py-3.5 text-right">
              <button onclick="openSaleReceipt(${s.id})" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold transition-colors" title="Abrir comprovante da venda">
                <i data-lucide="receipt-text" class="w-3.5 h-3.5"></i>
                Comprovante
              </button>
            </td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();

    } catch (e) {
      console.warn('Erro ao carregar vendas globais:', e);
    }
  }

  const btnRefreshAllSales = document.getElementById('btn-refresh-all-sales');
  if (btnRefreshAllSales) {
    btnRefreshAllSales.addEventListener('click', () => {
      loadAllSales();
      showToast('Pedidos atualizados.', 'info');
    });
  }

  const btnSearchSales = document.getElementById('btn-search-sales');
  if (btnSearchSales) {
    btnSearchSales.addEventListener('click', () => loadAllSales());
  }

  const inputSearchSales = document.getElementById('sales-search');
  if (inputSearchSales) {
    inputSearchSales.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadAllSales();
    });
  }

  // ==============================================
  // 3.5 COMPROVANTE DE VENDA (modal ao clicar na venda)
  // ==============================================
  let currentReceiptUrl = '';

  function receiptStatusBadge(status) {
    const st = String(status || 'Entregue').toLowerCase();
    if (st.includes('erro') || st.includes('falha')) {
      return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>Erro no envio</span>';
    }
    if (st.includes('pend')) {
      return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/60 text-amber-400 border border-amber-500/30"><span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Envio pendente</span>';
    }
    return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Entregue</span>';
  }

  function receiptTypeLabel(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'link') return 'Link';
    if (t === 'pdf') return 'Arquivo PDF';
    if (t === 'file' || t === 'arquivo') return 'Arquivo';
    if (t === 'account' || t === 'conta') return 'Conta de Acesso';
    return 'Entrega';
  }

  function receiptFieldRow(label, value, isUrl) {
    const openBtn = isUrl
      ? `<a href="${escapeHtml(value)}" target="_blank" rel="noopener" class="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0" title="Abrir"><i data-lucide="external-link" class="w-3.5 h-3.5"></i></a>`
      : '';
    return `<div class="flex items-start justify-between gap-3 rounded-lg bg-slate-950/70 border border-white/5 p-2.5">
      <div class="min-w-0">
        <div class="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">${label}</div>
        <div class="font-mono text-[12px] text-white break-all">${escapeHtml(value)}</div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button onclick="copyToClipboard(this.dataset.v)" data-v="${escapeHtml(value)}" class="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300" title="Copiar"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
        ${openBtn}
      </div>
    </div>`;
  }

  function receiptItemFields(s) {
    const type = String(s.delivered_type || '').toLowerCase();
    const parts = [];
    const isAccount = type === 'account' || type === 'conta' || (!type && (s.delivered_login || s.delivered_password));
    if (isAccount) {
      if (s.delivered_login) parts.push(receiptFieldRow('Login', s.delivered_login, false));
      if (s.delivered_password) parts.push(receiptFieldRow('Senha', s.delivered_password, false));
    }
    if (s.delivered_content) {
      const isUrl = /^https?:\/\//i.test(String(s.delivered_content));
      parts.push(receiptFieldRow(type === 'link' ? 'Link entregue' : 'Arquivo / Conteúdo', s.delivered_content, isUrl));
    }
    if (!parts.length) {
      parts.push('<div class="text-slate-500 text-[11px]">Nenhum item entregue registrado (venda sem produto associado).</div>');
    }
    return parts.join('');
  }

  function fillReceipt(s) {
    const d = s.created_at ? new Date(s.created_at) : null;
    const datetime = d && !isNaN(d.getTime())
      ? `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      : '—';
    const tgId = s.customer_id ? String(s.customer_id).replace(/^tg_/, '') : '—';

    document.getElementById('receipt-token-line').textContent = s.token ? `Pedido #${s.token} • ID ${s.id}` : `Venda #${s.id}`;
    document.getElementById('receipt-buyer-name').textContent = s.customer_name || '—';
    document.getElementById('receipt-buyer-contact').textContent = s.customer_contact || s.customer_id || 'Via Bot';
    document.getElementById('receipt-telegram-id').textContent = tgId;
    document.getElementById('receipt-datetime').textContent = datetime;
    document.getElementById('receipt-status').innerHTML = receiptStatusBadge(s.delivery_status);
    document.getElementById('receipt-reseller').textContent = s.reseller_name || '—';
    document.getElementById('receipt-item-type').textContent = receiptTypeLabel(s.delivered_type);
    document.getElementById('receipt-product-name').textContent = s.product || '—';
    document.getElementById('receipt-item-fields').innerHTML = receiptItemFields(s);
    currentReceiptUrl = s.target_url || '';
    document.getElementById('receipt-target-url').textContent = currentReceiptUrl || '—';
    document.getElementById('receipt-price').textContent = __brl(s.sale_price);
    document.getElementById('receipt-discount').textContent = Number(s.discount || 0) > 0 ? '− ' + __brl(s.discount) : '—';
    document.getElementById('receipt-profit').textContent = '+ ' + __brl(s.profit);
    document.getElementById('receipt-generated-at').textContent = 'Comprovante gerado em ' + new Date().toLocaleString('pt-BR');
    if (window.lucide) window.lucide.createIcons();
  }

  window.openSaleReceipt = function(id) {
    const s = (window.__allSales || []).find(x => String(x.id) === String(id));
    if (!s) {
      showToast('Venda não encontrada.', 'error');
      return;
    }
    fillReceipt(s);
    const modal = document.getElementById('sale-receipt-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  };

  function closeSaleReceipt() {
    const modal = document.getElementById('sale-receipt-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  const receiptModal = document.getElementById('sale-receipt-modal');
  if (receiptModal) {
    const btnCloseReceipt = document.getElementById('sale-receipt-close');
    if (btnCloseReceipt) btnCloseReceipt.addEventListener('click', closeSaleReceipt);
    receiptModal.addEventListener('click', (e) => { if (e.target === receiptModal) closeSaleReceipt(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSaleReceipt(); });
  }

  const btnCopyReceiptLink = document.getElementById('receipt-copy-link');
  if (btnCopyReceiptLink) {
    btnCopyReceiptLink.addEventListener('click', () => {
      if (!currentReceiptUrl) { showToast('Nenhum link para copiar.', 'info'); return; }
      copyToClipboard(currentReceiptUrl);
    });
  }

  // ==============================================
  // 4. MONITORAMENTO & ERROR LOGS
  // ==============================================
  const filterSource = document.getElementById('filter-error-source');
  const btnClearLogs = document.getElementById('btn-clear-logs');

  if (filterSource) {
    filterSource.addEventListener('change', () => loadErrorLogs());
  }

  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', async () => {
      if (!confirm('Deseja limpar todos os registros de erro?')) return;
      try {
        const res = await apiFetch('/api/admin/logs', { method: 'DELETE' });
        const data = await res.json();
        showToast(data.message || 'Logs limpos.', 'info');
        loadErrorLogs();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  async function loadErrorLogs() {
    const tbody = document.getElementById('logs-table-body');
    if (!tbody) return;

    const source = filterSource ? filterSource.value : '';
    const url = source ? `/api/admin/logs?source=${source}` : '/api/admin/logs';

    try {
      const res = await apiFetch(url);
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-6 text-center text-slate-500">Nenhum log de erro registrado. Sistema 100% operacional!</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(log => {
        const d = new Date(log.created_at);
        const formattedDate = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}`;
        
        let statusBadge = 'bg-rose-950/60 text-rose-400 border-rose-500/30';
        if (log.status_code === 401) statusBadge = 'bg-amber-950/60 text-amber-300 border-amber-500/30';
        if (log.status_code === 402) statusBadge = 'bg-purple-950/60 text-purple-300 border-purple-500/30';
        if (log.status_code === 403) statusBadge = 'bg-orange-950/60 text-orange-300 border-orange-500/30';

        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">${formattedDate}</td>
            <td class="px-5 py-3">
              <span class="px-2 py-0.5 rounded border text-[11px] font-bold ${statusBadge}">
                ${log.status_code}
              </span>
            </td>
            <td class="px-5 py-3 font-semibold text-rose-300 text-xs">${escapeHtml(log.error_type)}</td>
            <td class="px-5 py-3">
              <span class="px-2 py-0.5 rounded bg-slate-900 border border-white/5 text-slate-300 text-[10px] uppercase font-mono">
                ${escapeHtml(log.source || 'sistema')}
              </span>
            </td>
            <td class="px-5 py-3 text-slate-300 max-w-xs break-words">${escapeHtml(log.message)}</td>
            <td class="px-5 py-3 text-slate-500 font-mono text-[11px]">${escapeHtml(log.ip_address)}</td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();

    } catch (e) {
      console.warn('Erro ao carregar logs de erro:', e);
    }
  }

  // ==============================================
  // 5. SETTINGS FORM
  // ==============================================
  const formSettings = document.getElementById('form-settings');

  async function loadSettings() {
    try {
      const res = await apiFetch('/api/admin/settings');
      const data = await res.json();
      if (!data.success) return;

      const s = data.data;
      document.getElementById('setting-target-link').value = s.target_link || '';
      document.getElementById('setting-service-name').value = s.service_name || '';
      document.getElementById('setting-expiry').value = s.default_expiry_hours || '24';
      document.getElementById('setting-public-enabled').checked = s.public_generation_enabled === '1';

      const modeRadio = document.querySelector(`input[name="link_mode"][value="${s.link_mode || 'token_suffix'}"]`);
      if (modeRadio) modeRadio.checked = true;

    } catch (e) {
      console.warn('Erro ao carregar configurações:', e);
    }
  }

  if (formSettings) {
    formSettings.addEventListener('submit', async (e) => {
      e.preventDefault();
      const target_link = document.getElementById('setting-target-link').value;
      const service_name = document.getElementById('setting-service-name').value;
      const default_expiry_hours = document.getElementById('setting-expiry').value;
      const public_generation_enabled = document.getElementById('setting-public-enabled').checked;
      const link_mode = document.querySelector('input[name="link_mode"]:checked')?.value || 'token_suffix';

      try {
        const res = await apiFetch('/api/admin/settings', {
          method: 'POST',
          body: JSON.stringify({
            target_link,
            service_name,
            default_expiry_hours,
            public_generation_enabled,
            link_mode
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao salvar configurações.');

        showToast('Configurações salvas com sucesso! O novo link alvo já está ativo.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Utilities
  window.copyToClipboard = function(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement('textarea');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
    }
    showToast('Copiado com sucesso!', 'success');
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  btnRefreshStats.addEventListener('click', () => {
    loadAllDashboardData();
    showToast('Dados atualizados.', 'info');
  });

  function loadAllDashboardData() {
    loadStats();
    loadAllSales();
    loadErrorLogs();
    loadSettings();
    loadProducts();
    loadCoupons();
    loadCustomers();
    loadFinancialTransactions();
    loadBotControl();
  }

  // ==============================================
  // CLIENTES DO BOT (ADMIN)
  // ==============================================
  let __adminCustomers = [];
  let __customerSearchTimer = null;

  function __brl(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  }

  function __fmtDateTime(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
  }

  function __fmtAgo(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return __fmtDateTime(v);
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'agora mesmo';
    if (mins < 60) return 'há ' + mins + ' min';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return 'há ' + hours + 'h';
    const days = Math.floor(hours / 24);
    if (days < 7) return 'há ' + days + ' dia' + (days > 1 ? 's' : '');
    return __fmtDateTime(v);
  }

  async function loadCustomers() {
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;
    const searchInput = document.getElementById('customer-search');
    const search = searchInput ? searchInput.value.trim() : '';

    try {
      const res = await apiFetch('/api/admin/customers?search=' + encodeURIComponent(search) + '&limit=200');
      const data = await res.json();
      if (!data.success) return;

      document.getElementById('kpi-customers-total').innerText = (data.total || 0).toString();
      document.getElementById('kpi-customers-blocked').innerText = (data.total_blocked || 0).toString();
      document.getElementById('kpi-customers-revenue').innerText = __brl(data.total_revenue);

      __adminCustomers = data.data || [];
      if (__adminCustomers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">Nenhum cliente encontrado${search ? ' para &quot;' + escapeHtml(search) + '&quot;' : ''}. As fichas são criadas automaticamente quando o cliente interage com o bot.</td></tr>`;
        return;
      }

      tbody.innerHTML = __adminCustomers.map(c => {
        const isBlocked = Number(c.blocked) === 1;
        const idLabel = c.telegram_id ? (c.username ? '@' + c.username : 'ID ' + c.telegram_id) : (c.username ? '@' + c.username : '—');
        const bal = parseFloat(c.balance || 0);
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5">
              <span class="font-bold text-sky-300 block text-xs">${escapeHtml(c.name || 'Cliente')}</span>
              <span class="text-[10px] text-slate-400 font-mono">${escapeHtml(idLabel)}</span>
              ${c.blocked_reason ? `<span class="text-[10px] text-rose-400/90 block mt-0.5">Motivo: ${escapeHtml(c.blocked_reason)}</span>` : ''}
            </td>
            <td class="px-5 py-3.5">
              <div class="flex items-center gap-2">
                <span class="font-mono font-bold text-xs ${bal > 0 ? 'text-emerald-400 font-black' : 'text-slate-400'}">${__brl(bal)}</span>
                <button onclick="openCustomerBalanceModal(${c.id})" class="px-2 py-0.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/25 text-amber-300 border border-amber-500/25 transition-all text-[10px] font-bold flex items-center gap-1" title="Adicionar ou Retirar Saldo">
                  <i data-lucide="wallet" class="w-3 h-3"></i>
                  <span>Ajustar</span>
                </button>
              </div>
            </td>
            <td class="px-5 py-3.5 font-mono font-bold text-white">${Number(c.orders_count || 0)}</td>
            <td class="px-5 py-3.5 font-mono font-bold text-emerald-400">${__brl(c.total_spent)}</td>
            <td class="px-5 py-3.5 text-[11px] text-slate-300">
              <span class="block">${__fmtAgo(c.last_seen)}</span>
              <span class="text-[10px] text-slate-500">primeira vez: ${__fmtDateTime(c.first_seen)}</span>
            </td>
            <td class="px-5 py-3.5">
              ${isBlocked
                ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>Bloqueado</span>`
                : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Ativo</span>`}
            </td>
            <td class="px-5 py-3.5">
              <div class="flex items-center gap-1.5">
                <button onclick="openCustomerBalanceModal(${c.id})" class="p-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-all" title="Colocar / Retirar Saldo"><i data-lucide="coins" class="w-3.5 h-3.5"></i></button>
                ${isBlocked
                  ? `<button onclick="toggleBlockCustomer(${c.id})" class="p-2 rounded-lg bg-emerald-950/50 hover:bg-emerald-800/50 text-emerald-400 border border-emerald-500/20" title="Desbloquear"><i data-lucide="unlock" class="w-3.5 h-3.5"></i></button>`
                  : `<button onclick="toggleBlockCustomer(${c.id})" class="p-2 rounded-lg bg-rose-950/50 hover:bg-rose-800/50 text-rose-400 border border-rose-500/20" title="Bloquear"><i data-lucide="ban" class="w-3.5 h-3.5"></i></button>`}
                <button onclick="showCustomerPurchases(${c.id})" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300" title="Ver compras"><i data-lucide="shopping-bag" class="w-3.5 h-3.5"></i></button>
                <button onclick="deleteCustomer(${c.id})" class="p-2 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-400" title="Excluir ficha"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.warn('Erro ao carregar clientes:', e);
    }
  }

  window.toggleBlockCustomer = async function (id) {
    const c = __adminCustomers.find(x => String(x.id) === String(id));
    const name = c ? (c.name || 'Cliente') : 'Cliente';
    const isBlocked = c ? Number(c.blocked) === 1 : false;
    let reason = null;
    if (!isBlocked) {
      reason = prompt('Bloquear &quot;' + name + '&quot;?\nMotivo (opcional):', '');
      if (reason === null) return; // cancelou
      reason = reason.trim() || null;
    }
    try {
      const res = await apiFetch('/api/admin/customers/' + id + '/toggle-block', {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Falha ao atualizar bloqueio.');
      showToast(data.message, data.blocked ? 'info' : 'success');
      loadCustomers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.showCustomerPurchases = async function (id) {
    const c = __adminCustomers.find(x => String(x.id) === String(id)) || {};
    const modal = document.getElementById('customer-purchases-modal');
    const title = document.getElementById('customer-purchases-title');
    const sub = document.getElementById('customer-purchases-sub');
    const tbody = document.getElementById('customer-purchases-body');
    const totalEl = document.getElementById('customer-purchases-total');
    if (!modal || !tbody) return;
    title.innerText = 'Compras de ' + (c.name || 'Cliente');
    sub.innerText = 'Carregando histórico...';
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">Carregando...</td></tr>';
    totalEl.innerText = 'R$ 0,00';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
      const res = await apiFetch('/api/admin/customers/' + id + '/purchases');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Falha ao carregar compras.');
      const purchases = data.data || [];
      sub.innerText = purchases.length + ' compra(s) encontrada(s)';
      totalEl.innerText = __brl(data.total_spent);
      if (purchases.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">Nenhuma compra registrada para este cliente.</td></tr>';
        return;
      }
      tbody.innerHTML = purchases.map(p => `
        <tr class="hover:bg-white/[0.02] transition-colors">
          <td class="px-4 py-3">
            <span class="font-bold text-amber-300 block text-xs">${escapeHtml(p.product || '—')}</span>
            ${p.token ? `<span class="text-[10px] text-slate-500 font-mono">${escapeHtml(p.token)}</span>` : ''}
            ${p.account_login ? `
              <span class="flex items-center gap-1 text-[10px] text-emerald-400 font-mono mt-1">
                <span class="text-slate-500 font-sans">Login:</span>
                <span class="truncate max-w-[11rem]">${escapeHtml(p.account_login)}</span>
                <button onclick="copyToClipboard('${escapeHtml(p.account_login)}')" class="p-0.5 hover:text-white" title="Copiar login"><i data-lucide="copy" class="w-3 h-3"></i></button>
              </span>` : ''}
            ${p.account_password ? `
              <span class="flex items-center gap-1 text-[10px] text-sky-300 font-mono mt-0.5">
                <span class="text-slate-500 font-sans">Senha:</span>
                <span class="truncate max-w-[11rem]">${escapeHtml(p.account_password)}</span>
                <button onclick="copyToClipboard('${escapeHtml(p.account_password)}')" class="p-0.5 hover:text-white" title="Copiar senha"><i data-lucide="copy" class="w-3 h-3"></i></button>
              </span>` : ''}
            ${p.item_content ? `<span class="text-[10px] text-emerald-400 font-mono block mt-0.5 truncate max-w-[15rem]">Link: ${escapeHtml(p.item_content)}</span>` : ''}
          </td>
          <td class="px-4 py-3 font-mono font-bold text-white">${__brl(p.sale_price)}</td>
          <td class="px-4 py-3 text-[11px] text-slate-300">${escapeHtml(p.reseller_name || '—')}</td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">${escapeHtml(p.delivery_status || 'Entregue')}</span>
          </td>
          <td class="px-4 py-3 font-mono text-[11px] text-slate-400">${__fmtDateTime(p.created_at)}</td>
        </tr>
      `).join('');
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      sub.innerText = 'Falha ao carregar compras.';
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-rose-400">' + escapeHtml(err.message) + '</td></tr>';
    }
  };

  window.closeCustomerPurchases = function () {
    const modal = document.getElementById('customer-purchases-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  };

  window.deleteCustomer = async function (id) {
    const c = __adminCustomers.find(x => String(x.id) === String(id));
    const name = c ? (c.name || 'Cliente') : 'Cliente';
    if (!confirm('Excluir a ficha de &quot;' + name + '&quot;?\nO histórico de vendas NÃO será apagado.')) return;
    try {
      const res = await apiFetch('/api/admin/customers/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Falha ao excluir ficha.');
      showToast(data.message, 'success');
      loadCustomers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ==============================================
  // MODAL: GERENCIAR SALDO DO CLIENTE (ADMIN)
  // ==============================================
  let __balanceCustomerId = null;
  let __balanceCurrentOp = 'add';

  window.openCustomerBalanceModal = function (id) {
    const c = __adminCustomers.find(x => String(x.id) === String(id));
    if (!c) return;
    __balanceCustomerId = id;
    const modal = document.getElementById('customer-balance-modal');
    const nameEl = document.getElementById('customer-balance-client-name');
    const currEl = document.getElementById('customer-balance-current');
    const amountInput = document.getElementById('customer-balance-amount');

    const idLabel = c.telegram_id ? (c.username ? '@' + c.username + ' • ID ' + c.telegram_id : 'ID ' + c.telegram_id) : (c.username ? '@' + c.username : '—');
    if (nameEl) nameEl.innerText = `${c.name || 'Cliente'} (${idLabel})`;
    if (currEl) currEl.innerText = __brl(c.balance || 0);
    if (amountInput) {
      amountInput.value = '';
      setTimeout(() => amountInput.focus(), 80);
    }
    setBalanceOperation('add');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
    if (window.lucide) window.lucide.createIcons();
  };

  window.closeCustomerBalanceModal = function () {
    const modal = document.getElementById('customer-balance-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    __balanceCustomerId = null;
  };

  window.setBalanceOperation = function (op) {
    __balanceCurrentOp = op;
    const btnAdd = document.getElementById('btn-op-add');
    const btnSub = document.getElementById('btn-op-sub');
    if (btnAdd && btnSub) {
      if (op === 'add') {
        btnAdd.className = 'py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-sm';
        btnSub.className = 'py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all bg-slate-800/60 border-white/10 text-slate-400 hover:text-slate-200';
      } else {
        btnSub.className = 'py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all bg-rose-600/20 border-rose-500 text-rose-300 shadow-sm';
        btnAdd.className = 'py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all bg-slate-800/60 border-white/10 text-slate-400 hover:text-slate-200';
      }
    }
  };

  window.setBalanceQuickAmount = function (val) {
    const amountInput = document.getElementById('customer-balance-amount');
    if (amountInput) {
      amountInput.value = Number(val).toFixed(2);
      amountInput.focus();
    }
  };

  window.confirmCustomerBalance = async function () {
    if (!__balanceCustomerId) return;
    const amountInput = document.getElementById('customer-balance-amount');
    const val = parseFloat(amountInput ? amountInput.value.replace(',', '.') : '0');
    if (!Number.isFinite(val) || val <= 0) {
      showToast('Informe um valor válido maior que zero.', 'error');
      if (amountInput) amountInput.focus();
      return;
    }

    const finalAmount = __balanceCurrentOp === 'sub' ? -val : val;
    const btnConfirm = document.getElementById('btn-confirm-balance');
    if (btnConfirm) btnConfirm.disabled = true;

    try {
      const res = await apiFetch('/api/admin/customers/' + __balanceCustomerId + '/balance', {
        method: 'POST',
        body: JSON.stringify({ amount: finalAmount })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Falha ao atualizar saldo.');
      showToast(data.message, 'success');
      closeCustomerBalanceModal();
      loadCustomers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btnConfirm) btnConfirm.disabled = false;
    }
  };

  const btnCloseBalance = document.getElementById('customer-balance-close');
  if (btnCloseBalance) btnCloseBalance.addEventListener('click', window.closeCustomerBalanceModal);

  const btnCancelBalance = document.getElementById('btn-cancel-balance');
  if (btnCancelBalance) btnCancelBalance.addEventListener('click', window.closeCustomerBalanceModal);

  const btnConfirmBalance = document.getElementById('btn-confirm-balance');
  if (btnConfirmBalance) btnConfirmBalance.addEventListener('click', window.confirmCustomerBalance);

  const balanceAmountInput = document.getElementById('customer-balance-amount');
  if (balanceAmountInput) {
    balanceAmountInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.confirmCustomerBalance();
      }
    });
  }

  const balanceModal = document.getElementById('customer-balance-modal');
  if (balanceModal) {
    balanceModal.addEventListener('click', (e) => {
      if (e.target === balanceModal) window.closeCustomerBalanceModal();
    });
  }

  const btnSearchCustomers = document.getElementById('btn-search-customers');
  if (btnSearchCustomers) {
    btnSearchCustomers.addEventListener('click', () => {
      clearTimeout(__customerSearchTimer);
      loadCustomers();
    });
  }

  const btnRefreshCustomers = document.getElementById('btn-refresh-customers');
  if (btnRefreshCustomers) {
    btnRefreshCustomers.addEventListener('click', () => {
      loadCustomers();
      showToast('Clientes atualizados.', 'info');
    });
  }

  const customerSearchInput = document.getElementById('customer-search');
  if (customerSearchInput) {
    customerSearchInput.addEventListener('input', () => {
      clearTimeout(__customerSearchTimer);
      __customerSearchTimer = setTimeout(loadCustomers, 350);
    });
    customerSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(__customerSearchTimer);
        loadCustomers();
      }
    });
  }

  const btnClosePurchases = document.getElementById('customer-purchases-close');
  if (btnClosePurchases) btnClosePurchases.addEventListener('click', window.closeCustomerPurchases);

  const purchasesModal = document.getElementById('customer-purchases-modal');
  if (purchasesModal) {
    purchasesModal.addEventListener('click', (e) => {
      if (e.target === purchasesModal) window.closeCustomerPurchases();
    });
  }

  // ==============================================
  // CATALOGO DE PRODUTOS (ADMIN)
  // ==============================================
  let __adminProducts = [];

  async function loadProducts() {
    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;
    try {
      const res = await apiFetch('/api/admin/products');
      const data = await res.json();
      if (!data.success) return;
      __adminProducts = data.data || [];
      if (__adminProducts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-5 py-8 text-center text-slate-500">Nenhum produto cadastrado ainda.</td></tr>';
        return;
      }
      tbody.innerHTML = __adminProducts.map(p => {
        const salePrice = p.price_type === 'margin' ? (Number(p.cost_price) * (1 + Number(p.price_value) / 100)) : Number(p.price_value);
        const margin = Number(p.cost_price) > 0 ? ((salePrice - Number(p.cost_price)) / Number(p.cost_price) * 100) : 0;
        const pStock = (p.stock === null || p.stock === undefined) ? null : Number(p.stock);
        const stockBadge = pStock === null
          ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-950/60 text-sky-400 border border-sky-500/30">ILIMITADO</span>'
          : (pStock <= 0
            ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30">ESGOTADO</span>'
            : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">${pStock} DISPONÍVEL</span>`);
        const pItems = Number(p.item_count || 0);
        const itemsBadge = pItems > 0
          ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950/60 text-indigo-400 border border-indigo-500/30">📦 ${pItems} ITENS</span>`
          : '<span class="text-[10px] text-slate-600">—</span>';
        return `<tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5">
              <span class="font-bold text-white block text-xs">${escapeHtml(p.name)}</span>
              ${p.description ? `<span class="text-[10px] text-slate-400 block">${escapeHtml(p.description)}</span>` : ''}
            </td>
            <td class="px-5 py-3.5 font-mono font-bold text-slate-300">R$ ${Number(p.cost_price).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5 font-mono font-bold text-emerald-400">R$ ${salePrice.toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${margin.toFixed(0)}%</td>
            <td class="px-5 py-3.5">${stockBadge}</td>
            <td class="px-5 py-3.5">${itemsBadge}</td>
            <td class="px-5 py-3.5">
              <button onclick="toggleProduct(${p.id})" class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${Number(p.active) ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30' : 'bg-rose-950/60 text-rose-400 border border-rose-500/30'}">
                <span class="w-1.5 h-1.5 rounded-full ${Number(p.active) ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
                ${Number(p.active) ? 'ATIVO' : 'INATIVO'}
              </button>
            </td>
            <td class="px-5 py-3.5">
              <div class="flex items-center gap-2">
                <button onclick="editProduct(${p.id})" class="p-1.5 text-slate-400 hover:text-white" title="Editar"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                <button onclick="deleteProduct(${p.id})" class="p-1.5 text-slate-400 hover:text-rose-400" title="Excluir"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
              </div>
            </td>
          </tr>`;
      }).join('');
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.warn('Erro ao carregar produtos:', e);
    }
  }

  function openProductForm(p) {
    const card = document.getElementById('product-form-card');
    if (!card) return;
    card.classList.remove('hidden');
    document.getElementById('product-form-title').innerText = p ? 'Editar Produto' : 'Novo Produto';
    document.getElementById('product-id').value = p ? p.id : '';
    document.getElementById('product-name').value = p ? p.name : '';
    document.getElementById('product-description').value = p ? (p.description || '') : '';
    document.getElementById('product-target-url').value = p ? (p.target_url || '') : '';
    document.getElementById('product-cost').value = p ? p.cost_price : '';
    document.getElementById('product-price-type').value = p ? (p.price_type || 'fixed') : 'fixed';
    document.getElementById('product-price-value').value = p ? p.price_value : '';
    document.getElementById('product-sort-order').value = p ? (p.sort_order || 0) : 0;
    document.getElementById('product-stock').value = p ? ((p.stock === null || p.stock === undefined) ? '' : p.stock) : '';
    const pItemCount = p ? Number(p.item_count || 0) : 0;
    const stockInput = document.getElementById('product-stock');
    if (stockInput) stockInput.disabled = pItemCount > 0;
    const stockHint = document.getElementById('product-stock-hint');
    if (stockHint) stockHint.innerText = pItemCount > 0 ? 'Estoque automático controlado pelos itens abaixo (' + pItemCount + ' disponíveis).' : '';
    // Seção de itens do estoque
    const itemsProductId = document.getElementById('product-items-product-id');
    if (itemsProductId) itemsProductId.value = p ? p.id : '';
    const linesInput = document.getElementById('product-items-lines');
    if (linesInput) linesInput.value = '';
    const statusEl = document.getElementById('product-items-status');
    if (statusEl) statusEl.innerText = '';
    if (p) {
      loadProductItems(p.id);
    } else {
      renderProductItems([]);
    }
    document.getElementById('product-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.editProduct = (id) => {
    const p = __adminProducts.find(x => Number(x.id) === Number(id));
    if (p) openProductForm(p);
  };
  window.toggleProduct = async (id) => {
    const p = __adminProducts.find(x => Number(x.id) === Number(id));
    if (!p) return;
    try {
      const res = await apiFetch('/api/admin/products/' + id, {
        method: 'PUT',
        body: JSON.stringify(Object.assign({}, p, { active: Number(p.active) ? 0 : 1 }))
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao alternar status.');
      showToast(data.message || 'Status atualizado.', 'success');
      loadProducts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  window.deleteProduct = async (id) => {
    if (!confirm('Excluir este produto? As vendas antigas são preservadas.')) return;
    try {
      const res = await apiFetch('/api/admin/products/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao excluir.');
      showToast(data.message || 'Produto excluído.', 'success');
      loadProducts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const btnNewProduct = document.getElementById('btn-new-product');
  if (btnNewProduct) btnNewProduct.addEventListener('click', () => openProductForm(null));
  const btnCancelProduct = document.getElementById('btn-cancel-product');
  if (btnCancelProduct) btnCancelProduct.addEventListener('click', () => {
    const card = document.getElementById('product-form-card');
    if (card) card.classList.add('hidden');
  });
  const btnSaveProduct = document.getElementById('btn-save-product');
  if (btnSaveProduct) {
    btnSaveProduct.addEventListener('click', async () => {
      const id = document.getElementById('product-id').value;
      const payload = {
        name: document.getElementById('product-name').value,
        description: document.getElementById('product-description').value,
        target_url: document.getElementById('product-target-url').value,
        cost_price: document.getElementById('product-cost').value,
        price_type: document.getElementById('product-price-type').value,
        price_value: document.getElementById('product-price-value').value,
        sort_order: document.getElementById('product-sort-order').value || 0,
        stock: document.getElementById('product-stock').value
      };
      if (!payload.name || payload.cost_price === '' || payload.price_value === '') {
        showToast('Preencha nome, custo e preço.', 'error');
        return;
      }
      try {
        const res = await apiFetch(id ? '/api/admin/products/' + id : '/api/admin/products', {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao salvar.');
        showToast(data.message || 'Produto salvo.', 'success');
        const card = document.getElementById('product-form-card');
        if (card) card.classList.add('hidden');
        loadProducts();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ==============================================
  // ITENS DE ESTOQUE DO PRODUTO (ADMIN)
  // ==============================================
  async function loadProductItems(productId) {
    const listEl = document.getElementById('product-items-list');
    if (!listEl || !productId) return;
    try {
      const res = await apiFetch('/api/admin/products/' + productId + '/items');
      const data = await res.json();
      const items = (data && data.success) ? (data.data || []) : [];
      renderProductItems(items, productId);
      const statusEl = document.getElementById('product-items-status');
      if (statusEl && items.length) statusEl.innerText = items.length + ' item(ns) disponível(eis).';
    } catch (e) {
      console.warn('Erro ao carregar itens do produto:', e);
    }
  }

  function renderProductItems(items, productId) {
    const listEl = document.getElementById('product-items-list');
    if (!listEl) return;
    if (!items || items.length === 0) {
      listEl.innerHTML = '<div class="text-[11px] text-slate-500 italic">Nenhum item no estoque. Adicione contas ou links acima.</div>';
      return;
    }
    listEl.innerHTML = items.map(it => {
      const label = it.type === 'link'
        ? `<span class="text-cyan-300 font-mono text-[11px] break-all">${escapeHtml(it.content)}</span>`
        : `<span class="text-emerald-300 font-mono text-[11px]">${escapeHtml(it.login)}<span class="text-slate-500">:</span>${escapeHtml(it.password)}</span>`;
      return `<div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-white/5">
        <div class="min-w-0 flex items-center gap-2">
          <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-bold uppercase ${it.type === 'link' ? 'text-cyan-400' : 'text-emerald-400'}">${it.type === 'link' ? 'Link' : 'Conta'}</span>
          <span class="truncate">${label}</span>
        </div>
        <button onclick="removeProductItem(event, ${productId}, ${it.id})" class="p-1 text-slate-500 hover:text-rose-400" title="Remover do estoque"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
      </div>`;
    }).join('');
    if (window.lucide) window.lucide.createIcons();
  }

  window.removeProductItem = async (event, productId, itemId) => {
    event.stopPropagation();
    if (!confirm('Remover este item do estoque?')) return;
    try {
      const res = await apiFetch('/api/admin/products/' + productId + '/items/' + itemId, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao remover.');
      showToast(data.message || 'Item removido.', 'success');
      const p = __adminProducts.find(x => Number(x.id) === Number(productId));
      if (p) { p.stock = data.stock; p.item_count = Number(data.stock); }
      const stockInput = document.getElementById('product-stock');
      if (stockInput) stockInput.value = data.stock;
      const stockHint = document.getElementById('product-stock-hint');
      if (stockHint) stockHint.innerText = Number(data.stock) > 0 ? 'Estoque automático: ' + data.stock + ' disponível(eis).' : 'Estoque zerado — adicione mais itens para vender.';
      loadProductItems(productId);
      loadProducts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const btnAddProductItems = document.getElementById('btn-add-product-items');
  if (btnAddProductItems) {
    btnAddProductItems.addEventListener('click', async () => {
      const productId = document.getElementById('product-items-product-id').value;
      if (!productId) {
        showToast('Salve o produto antes de adicionar itens ao estoque.', 'error');
        return;
      }
      const type = document.getElementById('product-items-type').value;
      const lines = document.getElementById('product-items-lines').value;
      if (!lines || !lines.trim()) {
        showToast('Cole as contas (uma por linha) ou os links.', 'error');
        return;
      }
      const statusEl = document.getElementById('product-items-status');
      if (statusEl) statusEl.innerText = 'Adicionando...';
      try {
        const res = await apiFetch('/api/admin/products/' + productId + '/items', {
          method: 'POST',
          body: JSON.stringify({ type, lines: lines.split(/\r?\n/) })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao adicionar itens.');
        document.getElementById('product-items-lines').value = '';
        if (statusEl) {
          statusEl.innerText = data.message + (data.errors && data.errors.length ? ' | Ignorados: ' + data.errors.join('; ') : '');
        }
        const p = __adminProducts.find(x => Number(x.id) === Number(productId));
        if (p) { p.stock = data.stock; p.item_count = Number(data.stock); }
        const stockInput = document.getElementById('product-stock');
        if (stockInput) { stockInput.disabled = true; stockInput.value = data.stock; }
        const stockHint = document.getElementById('product-stock-hint');
        if (stockHint) stockHint.innerText = 'Estoque automático: ' + data.stock + ' disponível(eis). Para editar manualmente, remova os itens.';
        loadProductItems(productId);
        loadProducts();
      } catch (err) {
        if (statusEl) statusEl.innerText = '';
        showToast(err.message, 'error');
      }
    });
  }

  // ==============================================
  // CUPONS DE DESCONTO (ADMIN)
  // ==============================================
  let __adminCoupons = [];

  async function loadCoupons() {
    const tbody = document.getElementById('coupons-table-body');
    if (!tbody) return;
    try {
      const res = await apiFetch('/api/admin/coupons');
      const data = await res.json();
      if (!data.success) return;
      __adminCoupons = data.data || [];
      if (__adminCoupons.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-5 py-8 text-center text-slate-500">Nenhum cupom cadastrado ainda.</td></tr>';
        return;
      }
      tbody.innerHTML = __adminCoupons.map(c => {
        const expired = c.expires_at && new Date(c.expires_at).getTime() < Date.now();
        return `<tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5">
              <span class="font-mono font-bold ${expired ? 'text-slate-500 line-through' : 'text-pink-300'}">${escapeHtml(c.code)}</span>
            </td>
            <td class="px-5 py-3.5 font-mono text-[11px]">${c.type === 'fixed' ? 'R$ ' + Number(c.value).toFixed(2).replace('.', ',') : Number(c.value).toFixed(0).replace('.', ',') + '%'}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${Number(c.max_uses) > 0 ? c.used_count + ' / ' + c.max_uses : 'Ilimitado'}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${c.expires_at ? new Date(c.expires_at).toLocaleDateString('pt-BR') : '—'}</td>
            <td class="px-5 py-3.5">
              <button onclick="toggleCoupon(${c.id})" class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${expired ? 'bg-slate-800 text-slate-500' : (Number(c.active) ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30' : 'bg-rose-950/60 text-rose-400 border border-rose-500/30')}">
                <span class="w-1.5 h-1.5 rounded-full ${expired ? 'bg-slate-500' : (Number(c.active) ? 'bg-emerald-400' : 'bg-rose-400')}"></span>
                ${expired ? 'EXPIRADO' : (Number(c.active) ? 'ATIVO' : 'INATIVO')}
              </button>
            </td>
            <td class="px-5 py-3.5">
              <div class="flex items-center gap-2">
                <button onclick="editCoupon(${c.id})" class="p-1.5 text-slate-400 hover:text-white" title="Editar"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                <button onclick="deleteCoupon(${c.id})" class="p-1.5 text-slate-400 hover:text-rose-400" title="Excluir"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
              </div>
            </td>
          </tr>`;
      }).join('');
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.warn('Erro ao carregar cupons:', e);
    }
  }

  function openCouponForm(c) {
    const card = document.getElementById('coupon-form-card');
    if (!card) return;
    card.classList.remove('hidden');
    document.getElementById('coupon-form-title').innerText = c ? 'Editar Cupom' : 'Novo Cupom';
    document.getElementById('coupon-id').value = c ? c.id : '';
    document.getElementById('coupon-code').value = c ? c.code : '';
    document.getElementById('coupon-type').value = c ? (c.type || 'percent') : 'percent';
    document.getElementById('coupon-value').value = c ? c.value : '';
    document.getElementById('coupon-max-uses').value = c ? (c.max_uses || 0) : 0;
    document.getElementById('coupon-expires-at').value = c && c.expires_at ? c.expires_at.slice(0, 10) : '';
    document.getElementById('coupon-active').checked = c ? !!Number(c.active) : true;
    document.getElementById('coupon-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.editCoupon = (id) => {
    const c = __adminCoupons.find(x => Number(x.id) === Number(id));
    if (c) openCouponForm(c);
  };
  window.toggleCoupon = async (id) => {
    const c = __adminCoupons.find(x => Number(x.id) === Number(id));
    if (!c) return;
    try {
      const res = await apiFetch('/api/admin/coupons/' + id, {
        method: 'PUT',
        body: JSON.stringify(Object.assign({}, c, { active: Number(c.active) ? 0 : 1 }))
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao alternar status.');
      showToast(data.message || 'Status atualizado.', 'success');
      loadCoupons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  window.deleteCoupon = async (id) => {
    if (!confirm('Excluir este cupom?')) return;
    try {
      const res = await apiFetch('/api/admin/coupons/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao excluir.');
      showToast(data.message || 'Cupom excluído.', 'success');
      loadCoupons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const btnNewCoupon = document.getElementById('btn-new-coupon');
  if (btnNewCoupon) btnNewCoupon.addEventListener('click', () => openCouponForm(null));
  const btnCancelCoupon = document.getElementById('btn-cancel-coupon');
  if (btnCancelCoupon) btnCancelCoupon.addEventListener('click', () => {
    const card = document.getElementById('coupon-form-card');
    if (card) card.classList.add('hidden');
  });
  const btnSaveCoupon = document.getElementById('btn-save-coupon');
  if (btnSaveCoupon) {
    btnSaveCoupon.addEventListener('click', async () => {
      const id = document.getElementById('coupon-id').value;
      const payload = {
        code: document.getElementById('coupon-code').value,
        type: document.getElementById('coupon-type').value,
        value: document.getElementById('coupon-value').value,
        max_uses: document.getElementById('coupon-max-uses').value || 0,
        expires_at: document.getElementById('coupon-expires-at').value || null,
        active: document.getElementById('coupon-active').checked ? 1 : 0
      };
      if (!payload.code || payload.value === '') {
        showToast('Preencha código e valor do cupom.', 'error');
        return;
      }
      try {
        const res = await apiFetch(id ? '/api/admin/coupons/' + id : '/api/admin/coupons', {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao salvar.');
        showToast(data.message || 'Cupom salvo.', 'success');
        const card = document.getElementById('coupon-form-card');
        if (card) card.classList.add('hidden');
        loadCoupons();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ==============================================
  // 7. EXTRATO FINANCEIRO (MOVIMENTAÇÕES)
  // ==============================================
  async function loadFinancialTransactions() {
    const tbody = document.getElementById('financial-table-body');
    if (!tbody) return;

    try {
      const typeFilter = document.getElementById('filter-finance-type')?.value || '';
      const searchInput = document.getElementById('finance-search')?.value.trim() || '';

      const params = new URLSearchParams();
      if (typeFilter) params.append('type', typeFilter);
      if (searchInput) params.append('search', searchInput);

      const qs = params.toString();
      const url = qs ? `/api/admin/financial-transactions?${qs}` : '/api/admin/financial-transactions';

      const res = await apiFetch(url);
      const data = await res.json();
      if (!data.success) return;

      // KPIs
      const kpis = data.kpis || {};
      const kpi = data.kpi || {};
      const elDep = document.getElementById('kpi-fin-deposits');
      const elPur = document.getElementById('kpi-fin-purchases');
      const elRef = document.getElementById('kpi-fin-refunds');
      const elWal = document.getElementById('kpi-fin-wallets');

      const depVal = kpis.totalDeposits != null ? kpis.totalDeposits : (kpi.total_deposits != null ? Number(kpi.total_deposits).toFixed(2) : '0,00');
      const purVal = kpis.totalPurchases != null ? kpis.totalPurchases : (kpi.total_purchases != null ? Number(kpi.total_purchases).toFixed(2) : '0,00');
      const refVal = kpis.totalRefunds != null ? kpis.totalRefunds : (kpi.total_refunds != null ? Number(kpi.total_refunds).toFixed(2) : '0,00');
      const walVal = kpis.totalInWallets != null ? kpis.totalInWallets : (kpi.total_in_wallets != null ? Number(kpi.total_in_wallets).toFixed(2) : '0,00');

      if (elDep) elDep.innerText = `R$ ${String(depVal).replace('.', ',')}`;
      if (elPur) elPur.innerText = `R$ ${String(purVal).replace('.', ',')}`;
      if (elRef) elRef.innerText = `R$ ${String(refVal).replace('.', ',')}`;
      if (elWal) elWal.innerText = `R$ ${String(walVal).replace('.', ',')}`;

      // Table rows
      const items = data.data || [];
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">Nenhuma movimentação financeira encontrada.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(tx => {
        const d = new Date(tx.created_at);
        const dateStr = !isNaN(d.getTime()) ? `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}` : (tx.created_at || '—');

        let typeBadge = '';
        let amountFormatted = '';
        const amt = Number(tx.amount || 0).toFixed(2).replace('.', ',');

        if (tx.type === 'deposit') {
          typeBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Depósito (+)</span>`;
          amountFormatted = `<span class="font-mono font-bold text-emerald-400">+ R$ ${amt}</span>`;
        } else if (tx.type === 'purchase') {
          typeBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-400 border border-rose-500/30"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>Compra (−)</span>`;
          amountFormatted = `<span class="font-mono font-bold text-rose-400">− R$ ${amt}</span>`;
        } else if (tx.type === 'refund') {
          typeBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950/60 text-cyan-400 border border-cyan-500/30"><span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>Reembolso (+)</span>`;
          amountFormatted = `<span class="font-mono font-bold text-cyan-400">+ R$ ${amt}</span>`;
        } else {
          typeBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-white/10">${escapeHtml(tx.type || 'outro')}</span>`;
          amountFormatted = `<span class="font-mono font-bold text-white">R$ ${amt}</span>`;
        }

        const orderInfo = tx.order_number ? `Pedido #${escapeHtml(tx.order_number)}` : '';
        const prodInfo = tx.product_name ? escapeHtml(tx.product_name) : '';
        const descInfo = tx.description ? escapeHtml(tx.description) : '';

        return `
          <tr class="hover:bg-white/[0.02] transition-colors whitespace-nowrap">
            <td class="px-5 py-3 text-slate-400 font-mono text-[11px]">${dateStr}</td>
            <td class="px-5 py-3">
              <span class="font-bold text-white block">${escapeHtml(tx.customer_name || 'Cliente')}</span>
              <span class="text-[10px] text-slate-400 font-mono">${escapeHtml(tx.customer_contact || (tx.customer_id ? 'ID ' + tx.customer_id : 'Via Bot'))}</span>
            </td>
            <td class="px-5 py-3">${typeBadge}</td>
            <td class="px-5 py-3">
              <span class="font-bold text-amber-300 block text-xs">${[orderInfo, prodInfo].filter(Boolean).join(' • ') || '—'}</span>
              ${descInfo ? `<span class="text-[10px] text-slate-400 block">${descInfo}</span>` : ''}
            </td>
            <td class="px-5 py-3">${amountFormatted}</td>
            <td class="px-5 py-3 font-mono text-slate-400 text-xs">R$ ${Number(tx.balance_before || 0).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3 font-mono font-bold text-white text-xs">R$ ${Number(tx.balance_after || 0).toFixed(2).replace('.', ',')}</td>
          </tr>
        `;
      }).join('');

    } catch (e) {
      console.warn('Erro ao carregar movimentações financeiras:', e);
    }
  }

  const btnRefreshFinance = document.getElementById('btn-refresh-finance');
  if (btnRefreshFinance) {
    btnRefreshFinance.addEventListener('click', () => {
      loadFinancialTransactions();
      showToast('Extrato financeiro atualizado.', 'info');
    });
  }

  const btnSearchFinance = document.getElementById('btn-search-finance');
  if (btnSearchFinance) {
    btnSearchFinance.addEventListener('click', () => loadFinancialTransactions());
  }

  const inputSearchFinance = document.getElementById('finance-search');
  if (inputSearchFinance) {
    inputSearchFinance.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadFinancialTransactions();
    });
  }

  const selectFilterFinance = document.getElementById('filter-finance-type');
  if (selectFilterFinance) {
    selectFilterFinance.addEventListener('change', () => loadFinancialTransactions());
  }

  // ==============================================
  // 8. CONTROLE DO BOT DARKFLIX
  // ==============================================
  let currentBotStatus = 'active';

  window.setBotStatusValue = function(status) {
    currentBotStatus = status;

    const btnActive = document.getElementById('btn-status-active');
    const btnMaint = document.getElementById('btn-status-maintenance');
    const btnOff = document.getElementById('btn-status-offline');

    const defaultClass = 'py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all bg-slate-800/60 border-white/10 text-slate-400 hover:text-slate-200';

    if (btnActive) {
      btnActive.className = status === 'active'
        ? 'py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all bg-emerald-600/20 border-emerald-500 text-emerald-300'
        : defaultClass;
    }
    if (btnMaint) {
      btnMaint.className = status === 'maintenance'
        ? 'py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all bg-amber-600/20 border-amber-500 text-amber-300'
        : defaultClass;
    }
    if (btnOff) {
      btnOff.className = status === 'offline'
        ? 'py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all bg-rose-600/20 border-rose-500 text-rose-300'
        : defaultClass;
    }
  };

  async function loadBotControl() {
    try {
      const res = await fetch('/api/v1/bot-status');
      const data = await res.json();
      if (!data.success) return;

      currentBotStatus = data.status || 'active';
      setBotStatusValue(currentBotStatus);

      const msgInput = document.getElementById('bot-maintenance-msg');
      if (msgInput && data.maintenance_message) {
        msgInput.value = data.maintenance_message;
      }

      const bannerInput = document.getElementById('bot-announcement-text');
      if (bannerInput) {
        bannerInput.value = data.announcement || '';
      }
    } catch (e) {
      console.warn('Erro ao carregar status do bot:', e);
    }
  }

  const btnSaveBotStatus = document.getElementById('btn-save-bot-status');
  if (btnSaveBotStatus) {
    btnSaveBotStatus.addEventListener('click', async () => {
      try {
        const maintenance_message = document.getElementById('bot-maintenance-msg')?.value.trim();
        const notify_all = document.getElementById('bot-notify-all-maintenance')?.checked || false;

        const res = await apiFetch('/api/admin/bot/status', {
          method: 'POST',
          body: JSON.stringify({
            status: currentBotStatus,
            maintenance_message,
            notify_all
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao atualizar status.');

        let msg = `Status do bot alterado para: ${currentBotStatus.toUpperCase()}`;
        if (data.broadcast_result) {
          msg += ` (${data.broadcast_result.sent} avisos enviados no Telegram)`;
        }
        showToast(msg, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnSaveAnnouncement = document.getElementById('btn-save-announcement');
  if (btnSaveAnnouncement) {
    btnSaveAnnouncement.addEventListener('click', async () => {
      try {
        const announcement = document.getElementById('bot-announcement-text')?.value.trim();
        const res = await apiFetch('/api/admin/bot/status', {
          method: 'POST',
          body: JSON.stringify({ announcement })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao salvar aviso.');
        showToast('Aviso fixo do menu atualizado com sucesso!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnClearAnnouncement = document.getElementById('btn-clear-announcement');
  if (btnClearAnnouncement) {
    btnClearAnnouncement.addEventListener('click', async () => {
      try {
        const bannerInput = document.getElementById('bot-announcement-text');
        if (bannerInput) bannerInput.value = '';

        const res = await apiFetch('/api/admin/bot/status', {
          method: 'POST',
          body: JSON.stringify({ announcement: '' })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao limpar aviso.');
        showToast('Aviso do menu removido.', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnSendBroadcast = document.getElementById('btn-send-broadcast');
  if (btnSendBroadcast) {
    btnSendBroadcast.addEventListener('click', async () => {
      const msgInput = document.getElementById('broadcast-message-text');
      const message = msgInput ? msgInput.value.trim() : '';

      if (!message) {
        showToast('Digite a mensagem a ser disparada aos clientes.', 'error');
        return;
      }

      if (!confirm('Deseja realmente disparar esta mensagem para TODOS os clientes cadastrados no bot DarkFlix?')) {
        return;
      }

      try {
        btnSendBroadcast.disabled = true;
        btnSendBroadcast.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Disparando...`;

        const res = await apiFetch('/api/admin/bot/broadcast', {
          method: 'POST',
          body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha no disparo.');

        showToast(`Mensagem enviada com sucesso para ${data.sent} clientes! (${data.failed} falhas)`, 'success');
        if (msgInput) msgInput.value = '';
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnSendBroadcast.disabled = false;
        btnSendBroadcast.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Disparar Mensagem para Todos</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }

  checkAuth().then(isAuth => {
    if (isAuth) loadAllDashboardData();
  });
});

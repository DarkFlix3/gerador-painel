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
      dashboard: 'Dashboard Geral & Estatísticas',
      resellers: 'Gestão Completa de Revendedores & Bloqueios',
      'all-sales': 'Vendas Realizadas por Bots para Clientes',
      products: 'Produtos Vendidos pelos Bots',
      coupons: 'Cupons de Desconto',
      orders: 'Pedidos, Entregas e Status',
      payments: 'Transações de Pagamento',
      'error-logs': 'Monitoramento de Falhas e Erros',
      settings: 'Configurações do Link Alvo',
      'api-docs': 'Documentação da API para Bots de Revenda'
    };
    if (pageTitle) pageTitle.innerHTML = `<i data-lucide="layout-dashboard" class="w-5 h-5 text-indigo-400"></i> ${titles[tabId] || 'Painel Admin'}`;
    if (window.lucide) window.lucide.createIcons();

    if (tabId === 'dashboard') loadStats();
    if (tabId === 'resellers') loadResellers();
    if (tabId === 'all-sales') setSection(currentSection);
    if (tabId === 'products') loadProducts();
    if (tabId === 'coupons') loadCoupons();
    if (tabId === 'orders') loadOrders();
    if (tabId === 'payments') loadPayments();
    if (tabId === 'error-logs') loadErrorLogs();
    if (tabId === 'settings') loadSettings();
  }

  // ==============================================
  // 1. DASHBOARD GERAL & STATS
  // ==============================================
  async function loadStats() {
    try {
      const res = await apiFetch('/api/admin/stats');
      const data = await res.json();
      if (!data.success) return;

      const { kpis, charts } = data;

      document.getElementById('kpi-platform-sales').innerText = (kpis.platformSalesCount || 0).toLocaleString('pt-BR');
      document.getElementById('kpi-gross-revenue').innerText = `Faturamento: R$ ${(kpis.platformGrossRevenue || '0,00').replace('.', ',')}`;
      document.getElementById('kpi-resellers-count').innerText = (kpis.totalResellers || 0).toString();
      document.getElementById('kpi-active-resellers').innerText = `${kpis.activeResellers || 0} ativos / ${kpis.blockedResellers || 0} bloqueados`;
      document.getElementById('kpi-total-generations').innerText = (kpis.totalGenerations || 0).toLocaleString('pt-BR');
      document.getElementById('kpi-today-generations').innerText = `${kpis.todayGenerations || 0} gerados hoje`;
      document.getElementById('kpi-errors-count').innerText = (kpis.errorsLast24h || 0).toString();

      renderGenerationsChart(charts.generationsTimeline, charts.errorsTimeline);
      renderResellersChart(charts.resellerBreakdown);

    } catch (e) {
      console.warn('Erro ao carregar estatísticas:', e);
    }
  }

  function renderGenerationsChart(genData = [], errData = []) {
    const ctx = document.getElementById('chart-generations');
    if (!ctx) return;

    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      dates.push(d.toISOString().slice(0, 10));
    }

    const genMap = Object.fromEntries(genData.map(x => [x.date_day, x.count]));
    const errMap = Object.fromEntries(errData.map(x => [x.date_day, x.count]));

    const genCounts = dates.map(d => genMap[d] || 0);
    const errCounts = dates.map(d => errMap[d] || 0);
    const labels = dates.map(d => {
      const [y, m, day] = d.split('-');
      return `${day}/${m}`;
    });

    if (generationsChart) generationsChart.destroy();

    generationsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Links Gerados com Sucesso',
            data: genCounts,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
            borderWidth: 3,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#6366f1',
            pointRadius: 4
          },
          {
            label: 'Erros / Falhas Bloqueadas',
            data: errCounts,
            borderColor: '#f43f5e',
            backgroundColor: 'rgba(244, 63, 94, 0.1)',
            borderWidth: 2,
            borderDash: [4, 4],
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#f43f5e',
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } }
        },
        scales: {
          x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#64748b' } },
          y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#64748b', precision: 0 } }
        }
      }
    });
  }

  function renderResellersChart(resellerData = []) {
    const ctx = document.getElementById('chart-resellers');
    if (!ctx) return;

    let labels = resellerData.map(r => r.label);
    let values = resellerData.map(r => r.count);

    if (labels.length === 0) {
      labels = ['Nenhuma venda ainda'];
      values = [1];
    }

    if (resellersChart) resellersChart.destroy();

    resellersChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ['#10b981', '#6366f1', '#06b6d4', '#a855f7', '#f59e0b', '#64748b'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } }
        },
        cutout: '70%'
      }
    });
  }

  // ==============================================
  // 2. GESTÃO DE REVENDEDORES & BLOQUEIOS
  // ==============================================
  async function loadResellers() {
    const tbody = document.getElementById('resellers-table-body');
    if (!tbody) return;

    try {
      const res = await apiFetch('/api/admin/resellers');
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-6 text-center text-slate-500">Nenhum revendedor cadastrado ainda.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(r => {
        const isBlocked = r.blocked === 1;

        return `
          <tr class="hover:bg-white/[0.02] transition-colors ${isBlocked ? 'bg-rose-950/10' : ''}">
            <td class="px-5 py-3.5">
              <span class="font-bold text-white block text-sm">${escapeHtml(r.name)}</span>
              <span class="text-[11px] text-cyan-400 font-mono block">${escapeHtml(r.email || 'Sem e-mail')}</span>
              ${r.phone ? `<span class="text-[10px] text-slate-400 block">${escapeHtml(r.phone)}</span>` : ''}
            </td>
            <td class="px-5 py-3.5 font-mono">
              <div class="flex items-center gap-2">
                <span class="bg-slate-900 px-2 py-1 rounded text-[11px] text-slate-300 border border-white/5 select-all">
                  ${r.api_key.substring(0, 16)}...
                </span>
                <button onclick="copyToClipboard('${r.api_key}')" class="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white" title="Copiar Chave Completa">
                  <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </td>
            <td class="px-5 py-3.5">
              <span class="font-bold ${r.credits > 0 ? 'text-emerald-400' : 'text-rose-400'} text-sm">
                ${r.credits}
              </span>
              <span class="text-[10px] text-slate-500 block">créditos</span>
            </td>
            <td class="px-5 py-3.5 text-white font-bold text-sm">
              ${r.total_links_sold || 0}
              <span class="text-[10px] text-slate-400 font-normal block">links gerados</span>
            </td>
            <td class="px-5 py-3.5 font-mono font-bold text-emerald-400 text-sm">
              R$ ${Number(r.total_revenue_sold || 0).toFixed(2).replace('.', ',')}
              <span class="text-[10px] text-slate-400 font-normal block">Preço médio: R$ ${Number(r.sale_price || 15).toFixed(2).replace('.', ',')}</span>
            </td>
            <td class="px-5 py-3.5">
              ${isBlocked 
                ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-500/40">
                     <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                     BLOQUEADO
                   </span>`
                : `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/40">
                     <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                     Ativo & Liberado
                   </span>`
              }
            </td>
            <td class="px-5 py-3.5 text-right space-x-1.5 whitespace-nowrap">
              <!-- Botão Bloquear / Desbloquear -->
              <button 
                onclick="toggleBlockReseller(${r.id}, ${isBlocked ? 'false' : 'true'}, '${escapeHtml(r.name)}')" 
                class="px-2.5 py-1.5 rounded text-[11px] font-bold transition-all border ${isBlocked ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500' : 'bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border-rose-500/40'}"
                title="${isBlocked ? 'Desbloquear Acesso' : 'Bloquear Acesso Imediatamente'}"
              >
                ${isBlocked ? 'Desbloquear' : 'Bloquear'}
              </button>

              <!-- Botão Adicionar Créditos -->
              <button 
                onclick="promptAdjustCredits(${r.id}, '${escapeHtml(r.name)}', ${r.credits})" 
                class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold border border-white/10"
              >
                + Créditos
              </button>

              <!-- Botão Excluir -->
              <button 
                onclick="deleteReseller(${r.id}, '${escapeHtml(r.name)}')" 
                class="p-1.5 hover:bg-rose-950/80 text-rose-400 rounded text-[11px]" 
                title="Excluir Revendedor"
              >
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();

    } catch (e) {
      console.warn('Erro ao carregar revendedores:', e);
    }
  }

  // Toggle Block Action
  window.toggleBlockReseller = async function(id, willBlock, name) {
    const actionName = willBlock ? 'BLOQUEAR' : 'DESBLOQUEAR';
    if (!confirm(`Deseja realmente ${actionName} o revendedor "${name}"?\n${willBlock ? 'O bot dele deixará de gerar links imediatamente!' : 'O bot dele voltará a funcionar normalmente.'}`)) return;

    try {
      const res = await apiFetch(`/api/admin/resellers/${id}/toggle-block`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);

      showToast(data.message, willBlock ? 'error' : 'success');
      loadResellers();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Adjust Credits / Balance in R$
  window.promptAdjustCredits = async function(id, name, currentCredits) {
    const formattedCurrent = Number(currentCredits || 0).toFixed(2).replace('.', ',');
    const input = prompt(`Adicionar Saldo em Reais (R$) para "${name}" (Saldo atual: R$ ${formattedCurrent}):\nInforme o valor em Reais a adicionar (ex: 15.00 ou 50.00):`, '15.00');
    if (input === null) return;
    const credits = parseFloat(input.replace(',', '.'));
    if (isNaN(credits) || credits <= 0) {
      showToast('Valor em Reais inválido.', 'error');
      return;
    }

    try {
      const res = await apiFetch(`/api/admin/resellers/${id}/credits`, {
        method: 'POST',
        body: JSON.stringify({ credits, mode: 'add' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);

      showToast(data.message, 'success');
      loadResellers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Delete Reseller
  window.deleteReseller = async function(id, name) {
    if (!confirm(`Tem certeza absoluta que deseja remover o revendedor "${name}" e todo o histórico dele?`)) return;

    try {
      const res = await apiFetch(`/api/admin/resellers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);

      showToast(data.message, 'info');
      loadResellers();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ==============================================
  // 3. VENDAS & CLIENTES (GLOBAL) - sub-abas + lupa
  // ==============================================
  let currentSection = 'sales';
  let currentQ = '';

  function setSection(section) {
    currentSection = section || 'sales';
    const btnSales = document.getElementById('btn-section-sales');
    const btnCustomers = document.getElementById('btn-section-customers');
    const panelSales = document.getElementById('section-sales');
    const panelCustomers = document.getElementById('section-customers');
    const input = document.getElementById('input-section-search');
    if (!panelSales || !panelCustomers) return;

    const activeClass = 'text-white bg-indigo-600/30 border border-indigo-500/40';
    const idleClass = 'text-slate-400';
    const baseClass = 'section-btn px-4 py-1.5 rounded-lg text-xs font-bold transition-all ';
    if (btnSales) btnSales.className = baseClass + (currentSection === 'sales' ? activeClass : idleClass);
    if (btnCustomers) btnCustomers.className = baseClass + (currentSection === 'customers' ? activeClass : idleClass);
    panelSales.classList.toggle('hidden', currentSection !== 'sales');
    panelCustomers.classList.toggle('hidden', currentSection !== 'customers');
    if (input) {
      input.placeholder = currentSection === 'customers'
        ? 'Buscar cliente por ID, nome ou contato...'
        : 'Buscar venda por código, cliente ou revendedor...';
    }
    if (currentSection === 'customers') loadCustomers(currentQ);
    else loadAllSales(currentQ);
  }

  async function loadAllSales(q = '') {
    const tbody = document.getElementById('all-sales-table-body');
    if (!tbody) return;

    try {
      const url = q ? `/api/admin/all-sales?q=${encodeURIComponent(q)}` : '/api/admin/all-sales';
      const res = await apiFetch(url);
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-8 text-center text-slate-500">Nenhuma venda encontrada.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(s => {
        const d = new Date(s.created_at);
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5">
              <span class="font-mono font-bold text-indigo-300 block text-[11px]">${escapeHtml(s.token || s.customer_id || '-')}</span>
              <span class="text-[10px] text-slate-500">#${escapeHtml(s.id)}</span>
            </td>
            <td class="px-5 py-3.5">
              <span class="font-bold text-white block text-xs">${escapeHtml(s.reseller_name)}</span>
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
            <td class="px-5 py-3.5 font-mono font-bold text-white">R$ ${Number(s.sale_price).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5 font-mono font-bold text-emerald-400">+ R$ ${Number(s.profit).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5">
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                ${s.delivery_status || 'Entregue'}
              </span>
            </td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}</td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();

    } catch (e) {
      console.warn('Erro ao carregar vendas globais:', e);
    }
  }

  async function loadCustomers(q = '') {
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;

    try {
      const url = q ? `/api/admin/customers?q=${encodeURIComponent(q)}` : '/api/admin/customers';
      const res = await apiFetch(url);
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-slate-500">Nenhum cliente encontrado.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(c => {
        const d = c.last_purchase ? new Date(c.last_purchase) : null;
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5">
              <span class="font-bold text-white block text-[11px]">${escapeHtml(c.customer_name || 'Cliente')}</span>
            </td>
            <td class="px-5 py-3.5">
              <span class="font-mono text-[11px] text-indigo-300 block">${escapeHtml(c.customer_id || '-')}</span>
              <span class="text-[10px] text-slate-400">${escapeHtml(c.customer_contact || '')}</span>
            </td>
            <td class="px-5 py-3.5 font-mono font-bold text-white">${Number(c.purchase_count || 0)}x</td>
            <td class="px-5 py-3.5 font-mono font-bold text-emerald-400">R$ ${Number(c.total_spent || 0).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${d ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR') : '-'}</td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();

    } catch (e) {
      console.warn('Erro ao carregar clientes:', e);
    }
  }

  const btnSectionSales = document.getElementById('btn-section-sales');
  if (btnSectionSales) btnSectionSales.addEventListener('click', () => setSection('sales'));
  const btnSectionCustomers = document.getElementById('btn-section-customers');
  if (btnSectionCustomers) btnSectionCustomers.addEventListener('click', () => setSection('customers'));

  const inputSectionSearch = document.getElementById('input-section-search');
  if (inputSectionSearch) {
    let searchTimer = null;
    inputSectionSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentQ = inputSectionSearch.value.trim();
        if (currentSection === 'customers') loadCustomers(currentQ);
        else loadAllSales(currentQ);
      }, 350);
    });
  }

  const btnRefreshAllSales = document.getElementById('btn-refresh-all-sales');
  if (btnRefreshAllSales) {
    btnRefreshAllSales.addEventListener('click', () => {
      if (currentSection === 'customers') loadCustomers(currentQ);
      else loadAllSales(currentQ);
      showToast('Dados atualizados.', 'info');
    });
  }

  // ==============================================
  // 4. PRODUTOS, CUPONS, PEDIDOS E PAGAMENTOS
  // ==============================================

  // ----- PRODUTOS -----
  async function loadProducts() {
    const tbody = document.getElementById('products-body');
    if (!tbody) return;

    try {
      const res = await apiFetch('/api/admin/products');
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">Nenhum produto cadastrado. Clique em \"Novo Produto\".</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(p => {
        const isActive = p.active === 1 || p.active === true;
        const profit = Number(p.price || 0) - Number(p.cost_price || 0);
        const createdAt = p.created_at ? new Date(p.created_at) : null;
        return `
          <tr class="hover:bg-white/[0.02] transition-colors ${!isActive ? 'opacity-50' : ''}">
            <td class="px-5 py-3.5">
              <span class="font-bold text-white block">${escapeHtml(p.emoji || '🎁')} ${escapeHtml(p.name)}</span>
              ${p.description ? `<span class="text-[10px] text-slate-400 block">${escapeHtml(p.description)}</span>` : ''}
            </td>
            <td class="px-5 py-3.5 font-mono font-bold text-white">R$ ${Number(p.price || 0).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5 font-mono text-slate-300">R$ ${Number(p.cost_price || 0).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5 font-mono font-bold text-emerald-400">R$ ${profit.toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5">
              ${isActive
                ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/40"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Ativo</span>`
                : `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-500/40">Inativo</span>`
              }
            </td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${createdAt ? createdAt.toLocaleDateString('pt-BR') : '—'}</td>
            <td class="px-5 py-3.5 text-right space-x-1.5 whitespace-nowrap">
              <button onclick="editProduct(${p.id})" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold border border-white/10">Editar</button>
              <button onclick="deleteProduct(${p.id}, '${escapeHtml(p.name)}')" class="p-1.5 hover:bg-rose-950/80 text-rose-400 rounded text-[11px]" title="Desativar Produto"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.warn('Erro ao carregar produtos:', e);
    }
  }

  window.createProduct = async function() {
    const name = prompt('Nome do produto (ex: Acesso Premium Spotify):');
    if (!name) return;
    const price = prompt('Preço de venda em R$ (ex: 15.00):', '15.00');
    const cost = prompt('Custo do link em R$ (ex: 2.99):', '2.99');
    const emoji = prompt('Emoji do produto (opcional):', '🎁') || '🎁';
    const description = prompt('Descrição curta (opcional):');

    try {
      const res = await apiFetch('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({ name, price, cost_price: cost, emoji, description })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao criar produto.');

      showToast(data.message, 'success');
      loadProducts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.editProduct = async function(id) {
    try {
      const res = await apiFetch('/api/admin/products');
      const data = await res.json();
      if (!data.success) return;
      const p = data.data.find(x => x.id === id);
      if (!p) return;

      const name = prompt('Nome do produto:', p.name);
      if (!name) return;
      const price = prompt('Preço de venda em R$:', String(p.price));
      const cost = prompt('Custo em R$:', String(p.cost_price));
      const emoji = prompt('Emoji:', p.emoji || '🎁') || '🎁';
      const desc = prompt('Descrição curta:', p.description || '');

      const upd = await apiFetch(`/api/admin/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, price, cost_price: cost, emoji, description: desc, active: 1 })
      });
      const updData = await upd.json();
      if (!upd.ok || !updData.success) throw new Error(updData.error || 'Falha ao atualizar produto.');

      showToast(updData.message, 'success');
      loadProducts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.deleteProduct = async function(id, name) {
    if (!confirm(`Desativar o produto \"${name}\"? Ele deixará de aparecer nos bots.`)) return;

    try {
      const res = await apiFetch(`/api/admin/products/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao desativar produto.');

      showToast(data.message, 'info');
      loadProducts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ----- CUPONS -----
  async function loadCoupons() {
    const tbody = document.getElementById('coupons-body');
    if (!tbody) return;

    try {
      const res = await apiFetch('/api/admin/coupons');
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-8 text-center text-slate-500">Nenhum cupom criado. Clique em \"Novo Cupom\".</td></tr>`;
        return;
      }

      const statusLabel = c => (c.active === 1 || c.active === true)
        ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/40"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Ativo</span>`
        : `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-500/40">Inativo</span>`;

      tbody.innerHTML = data.data.map(c => {
        const discountLabel = c.discount_type === 'fixed'
          ? `R$ ${Number(c.discount_value).toFixed(2).replace('.', ',')}`
          : `${Number(c.discount_value).toFixed(0).replace('.', ',')}%`;
        const expires = c.valid_until ? new Date(c.valid_until) : null;
        const usesLabel = c.max_uses > 0 ? `${c.used_count || 0}/${c.max_uses}` : `${c.used_count || 0} (ilimitado)`;
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5 font-mono font-bold text-fuchsia-300">${escapeHtml(c.code)}</td>
            <td class="px-5 py-3.5 text-slate-300 capitalize">${c.discount_type === 'fixed' ? 'Valor fixo' : 'Percentual'}</td>
            <td class="px-5 py-3.5 font-mono font-bold text-white">${discountLabel}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${usesLabel}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] ${expires && expires < new Date() ? 'text-rose-400' : 'text-slate-400'}">${expires ? expires.toLocaleDateString('pt-BR') : '—'}</td>
            <td class="px-5 py-3.5">${statusLabel(c)}</td>
            <td class="px-5 py-3.5 text-right space-x-1.5 whitespace-nowrap">
              <button onclick="editCoupon(${c.id})" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold border border-white/10">Editar</button>
              <button onclick="deleteCoupon(${c.id}, '${escapeHtml(c.code)}')" class="p-1.5 hover:bg-rose-950/80 text-rose-400 rounded text-[11px]" title="Desativar Cupom"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.warn('Erro ao carregar cupons:', e);
    }
  }

  window.createCoupon = async function() {
    const code = prompt('Código do cupom (ex: PROMO10):');
    if (!code) return;
    const type = prompt('Tipo de desconto — digite "percent" ou "fixed":', 'percent');
    const value = prompt('Valor do desconto (10 = 10% ou R$ 10,00):', '10');
    const maxUses = prompt('Limite de usos (0 = ilimitado):', '0');
    const validUntil = prompt('Validade (formato AAAA-MM-DD, opcional):');

    try {
      const res = await apiFetch('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code,
          discount_type: type === 'fixed' ? 'fixed' : 'percent',
          discount_value: value,
          max_uses: maxUses,
          valid_until: validUntil || null
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao criar cupom.');

      showToast(data.message, 'success');
      loadCoupons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.editCoupon = async function(id) {
    try {
      const res = await apiFetch('/api/admin/coupons');
      const data = await res.json();
      if (!data.success) return;
      const c = data.data.find(x => x.id === id);
      if (!c) return;

      const type = prompt('Tipo de desconto — "percent" ou "fixed":', c.discount_type) || c.discount_type;
      const value = prompt('Valor do desconto:', String(c.discount_value));
      const maxUses = prompt('Limite de usos (0 = ilimitado):', String(c.max_uses || 0));
      const validUntil = prompt('Validade (AAAA-MM-DD, vazio para sem expiração):', c.valid_until ? c.valid_until.slice(0, 10) : '');

      const upd = await apiFetch(`/api/admin/coupons/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          discount_type: type === 'fixed' ? 'fixed' : 'percent',
          discount_value: value,
          max_uses: maxUses,
          valid_until: validUntil || null
        })
      });
      const updData = await upd.json();
      if (!upd.ok || !updData.success) throw new Error(updData.error || 'Falha ao atualizar cupom.');

      showToast(updData.message, 'success');
      loadCoupons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.deleteCoupon = async function(id, code) {
    if (!confirm(`Desativar o cupom \"${code}\"? Ele não poderá mais ser usado.`)) return;

    try {
      const res = await apiFetch(`/api/admin/coupons/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao desativar cupom.');

      showToast(data.message, 'info');
      loadCoupons();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ----- PEDIDOS -----
  const ORDER_STATUS_LABELS = {
    pending: 'Pendente',
    paid: 'Pago',
    delivered: 'Entregue',
    cancelled: 'Cancelado'
  };

  async function loadOrders() {
    const tbody = document.getElementById('orders-body');
    if (!tbody) return;

    try {
      const res = await apiFetch('/api/admin/orders');
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="px-5 py-8 text-center text-slate-500">Nenhum pedido registrado ainda.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(o => {
        const d = o.created_at ? new Date(o.created_at) : null;
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5 font-mono text-[11px] text-sky-300">#${escapeHtml(o.order_code)}</td>
            <td class="px-5 py-3.5 font-semibold text-white">${escapeHtml(o.product_name || '—')}</td>
            <td class="px-5 py-3.5">${escapeHtml(o.customer_name || '—')}${o.customer_contact ? `<span class="text-[10px] text-slate-500 block">${escapeHtml(o.customer_contact)}</span>` : ''}</td>
            <td class="px-5 py-3.5 text-slate-300">${escapeHtml(o.reseller_name || '—')}</td>
            <td class="px-5 py-3.5 font-mono font-bold text-white">R$ ${Number(o.total || 0).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${escapeHtml(o.payment_method || '—')}</td>
            <td class="px-5 py-3.5">
              <select onchange="updateOrderStatus(${o.id}, this.value)" class="bg-slate-900 text-[10px] font-bold px-2 py-1.5 rounded-lg border border-white/10 text-slate-200 focus:outline-none">
                ${Object.keys(ORDER_STATUS_LABELS).map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${ORDER_STATUS_LABELS[s]}</option>`).join('')}
              </select>
            </td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${d ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR') : '—'}</td>
            <td class="px-5 py-3.5">${o.token ? `<span class="font-mono text-[10px] text-cyan-400">Link gerado</span>` : `<span class="text-[10px] text-slate-500">—</span>`}</td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.warn('Erro ao carregar pedidos:', e);
    }
  }

  window.updateOrderStatus = async function(id, status) {
    const label = ORDER_STATUS_LABELS[status] || status;
    if (!confirm(`Alterar o status deste pedido para \"${label}\"?`)) {
      loadOrders();
      return;
    }

    try {
      const res = await apiFetch(`/api/admin/orders/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao atualizar status.');

      showToast(data.message, data.delivered ? 'success' : 'info');
      loadOrders();
    } catch (err) {
      showToast(err.message, 'error');
      loadOrders();
    }
  };

  // ----- PAGAMENTOS -----
  async function loadPayments() {
    const tbody = document.getElementById('payments-body');
    if (!tbody) return;

    try {
      const res = await apiFetch('/api/admin/payments');
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-8 text-center text-slate-500">Nenhum pagamento registrado ainda.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(p => {
        const d = p.created_at ? new Date(p.created_at) : null;
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-500">#${p.id}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-sky-300">#${escapeHtml(p.order_code || '—')}</td>
            <td class="px-5 py-3.5 font-semibold text-white">${escapeHtml(p.product_name || '—')}</td>
            <td class="px-5 py-3.5 text-slate-300">${escapeHtml(p.reseller_name || '—')}</td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${escapeHtml(p.provider || '—')}</td>
            <td class="px-5 py-3.5 font-mono font-bold text-emerald-400">R$ ${Number(p.amount || 0).toFixed(2).replace('.', ',')}</td>
            <td class="px-5 py-3.5">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 text-slate-300 border border-white/10 capitalize">${escapeHtml(p.status || '—')}</span>
            </td>
            <td class="px-5 py-3.5 font-mono text-[11px] text-slate-400">${d ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR') : '—'}</td>
          </tr>
        `;
      }).join('');

      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.warn('Erro ao carregar pagamentos:', e);
    }
  }

  const btnNewProduct = document.getElementById('btn-new-product');
  if (btnNewProduct) btnNewProduct.addEventListener('click', () => createProduct());
  const btnRefreshProducts = document.getElementById('btn-refresh-products');
  if (btnRefreshProducts) btnRefreshProducts.addEventListener('click', () => { loadProducts(); showToast('Produtos atualizados.', 'info'); });

  const btnNewCoupon = document.getElementById('btn-new-coupon');
  if (btnNewCoupon) btnNewCoupon.addEventListener('click', () => createCoupon());
  const btnRefreshCoupons = document.getElementById('btn-refresh-coupons');
  if (btnRefreshCoupons) btnRefreshCoupons.addEventListener('click', () => { loadCoupons(); showToast('Cupons atualizados.', 'info'); });

  const btnRefreshOrdersAdmin = document.getElementById('btn-refresh-orders-admin');
  if (btnRefreshOrdersAdmin) btnRefreshOrdersAdmin.addEventListener('click', () => { loadOrders(); showToast('Pedidos atualizados.', 'info'); });

  const btnRefreshPayments = document.getElementById('btn-refresh-payments');
  if (btnRefreshPayments) btnRefreshPayments.addEventListener('click', () => { loadPayments(); showToast('Pagamentos atualizados.', 'info'); });

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
    loadResellers();
    setSection(currentSection);
    loadErrorLogs();
    loadSettings();
  }

  checkAuth().then(isAuth => {
    if (isAuth) loadAllDashboardData();
  });
});

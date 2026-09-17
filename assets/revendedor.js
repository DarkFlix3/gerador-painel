// Reseller Dashboard Logic
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();

  const tokenKey = 'quantum_reseller_token';
  let authToken = localStorage.getItem(tokenKey);

  const authModal = document.getElementById('auth-modal');
  const tabBtnLogin = document.getElementById('tab-btn-login');
  const tabBtnRegister = document.getElementById('tab-btn-register');
  const formLogin = document.getElementById('form-reseller-login');
  const formRegister = document.getElementById('form-reseller-register');
  const btnLogout = document.getElementById('btn-reseller-logout');
  const btnQuickRecharge = document.getElementById('btn-quick-recharge');
  const btnQuickManualGen = document.getElementById('btn-quick-manual-gen');

  let salesChart = null;
  let currentReseller = null;

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

  // Auth Fetch Helper
  async function resellerFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    if (authToken) {
      options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    options.headers['Content-Type'] = 'application/json';

    const res = await fetch(url, options);
    if (res.status === 401) {
      localStorage.removeItem(tokenKey);
      authToken = null;
      showAuthModal();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    return res;
  }

  function showAuthModal() {
    authModal.classList.remove('hidden');
    authModal.classList.add('flex');
  }

  function hideAuthModal() {
    authModal.classList.add('hidden');
    authModal.classList.remove('flex');
  }

  // Toggle Login / Register forms
  tabBtnLogin.addEventListener('click', () => {
    tabBtnLogin.classList.add('bg-indigo-600', 'text-white');
    tabBtnLogin.classList.remove('text-slate-400');
    tabBtnRegister.classList.remove('bg-indigo-600', 'text-white');
    tabBtnRegister.classList.add('text-slate-400');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
  });

  tabBtnRegister.addEventListener('click', () => {
    tabBtnRegister.classList.add('bg-indigo-600', 'text-white');
    tabBtnRegister.classList.remove('text-slate-400');
    tabBtnLogin.classList.remove('bg-indigo-600', 'text-white');
    tabBtnLogin.classList.add('text-slate-400');
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
  });

  // Login Submit
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/reseller/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro no login.');

      authToken = data.token;
      localStorage.setItem(tokenKey, authToken);
      hideAuthModal();
      showToast('Bem-vindo ao seu painel de revenda!', 'success');
      loadAllResellerData();

    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Register Submit
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const phone = document.getElementById('reg-phone').value;
    const password = document.getElementById('reg-password').value;

    try {
      const res = await fetch('/api/reseller/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro no cadastro.');

      authToken = data.token;
      localStorage.setItem(tokenKey, authToken);
      hideAuthModal();
      showToast('Conta criada com sucesso! 25 créditos grátis adicionados!', 'success');
      loadAllResellerData();

    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Logout
  btnLogout.addEventListener('click', () => {
    localStorage.removeItem(tokenKey);
    authToken = null;
    showToast('Sessão encerrada.', 'info');
    showAuthModal();
  });

  if (btnQuickRecharge) {
    btnQuickRecharge.addEventListener('click', () => switchResellerTab('recharge'));
  }

  if (btnQuickManualGen) {
    btnQuickManualGen.addEventListener('click', () => switchResellerTab('manual-gen'));
  }

  // Navigation Tabs Switcher
  const navContainer = document.getElementById('reseller-nav');
  navContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-item');
    if (!btn) return;
    const tabName = btn.getAttribute('data-tab');
    switchResellerTab(tabName);
  });

  window.switchResellerTab = function(tabName) {
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.remove('text-white', 'bg-indigo-600/30', 'border', 'border-indigo-500/40');
      el.classList.add('text-slate-400');
    });

    const activeBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
    if (activeBtn) {
      activeBtn.classList.remove('text-slate-400');
      activeBtn.classList.add('text-white', 'bg-indigo-600/30', 'border', 'border-indigo-500/40');
    }

    document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(`reseller-tab-${tabName}`);
    if (target) target.classList.remove('hidden');

    if (window.lucide) window.lucide.createIcons();

    if (tabName === 'customers') loadAllSales();
  };

  // ==========================================
  // CARREGAR DADOS DO PERFIL & DASHBOARD
  // ==========================================
  async function loadResellerProfile() {
    try {
      const res = await resellerFetch('/api/reseller/me');
      const data = await res.json();
      if (!data.success) return;

      currentReseller = data.reseller;

      const formattedBalance = 'R$ ' + Number(currentReseller.credits || 0).toFixed(2).replace('.', ',');
      document.getElementById('header-reseller-name').innerText = currentReseller.name.toUpperCase();
      document.getElementById('header-reseller-email').innerText = currentReseller.email;
      document.getElementById('header-credits').innerText = formattedBalance;
      document.getElementById('kpi-credits').innerText = formattedBalance;
      
      const apiKeyInput = document.getElementById('my-api-key-input');
      if (apiKeyInput) apiKeyInput.value = currentReseller.api_key;

      // Preenche o ID de perfil do Telegram (vínculo bot + site)
      const tgInput = document.getElementById('tg-profile-id-input');
      const tgStatus = document.getElementById('tg-link-status');
      if (tgInput) tgInput.value = currentReseller.telegram_id || '';
      if (tgStatus) {
        if (currentReseller.telegram_id) {
          tgStatus.className = 'text-xs p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/40 text-emerald-300';
          tgStatus.innerHTML = '✅ <b>Vinculado!</b> ID <code>' + escapeHtml(currentReseller.telegram_id) + '</code> — o /saldo do bot mostra o saldo desta conta.';
        } else {
          tgStatus.className = 'text-xs p-2.5 rounded-lg border border-amber-500/30 bg-amber-950/40 text-amber-300';
          tgStatus.innerHTML = '⚠️ Ainda não vinculado. Envie <b>/me</b> no bot para copiar seu ID e cole acima.';
        }
        tgStatus.classList.remove('hidden');
      }

      const codePreview = document.getElementById('bot-code-preview');
      if (codePreview) {
        codePreview.innerText = codePreview.innerText.replace(/API_KEY = ".*"/, `API_KEY = "${currentReseller.api_key}"`);
      }

      // Preenche form de preço
      const inputSalePrice = document.getElementById('input-sale-price');
      const inputPhone = document.getElementById('input-reseller-phone');
      if (inputSalePrice) inputSalePrice.value = currentReseller.sale_price || 15.00;
      if (inputPhone) inputPhone.value = currentReseller.phone || '';

      updateProfitSimulator(currentReseller.sale_price || 15.00, currentReseller.cost_per_link || 2.99);

    } catch (e) {
      console.warn('Erro ao carregar perfil:', e);
    }
  }

  async function loadResellerDashboard() {
    try {
      const res = await resellerFetch('/api/reseller/dashboard');
      const data = await res.json();
      if (!data.success) return;

      const { kpis, chart, recentSales } = data;

      const formattedBalance = 'R$ ' + Number(kpis.credits || 0).toFixed(2).replace('.', ',');
      document.getElementById('header-credits').innerText = formattedBalance;
      document.getElementById('kpi-credits').innerText = formattedBalance;

      document.getElementById('kpi-sale-price').innerText = `R$ ${kpis.salePrice.replace('.', ',')}`;
      document.getElementById('kpi-cost-margin').innerText = `Custo por link: R$ ${kpis.costPrice.replace('.', ',')}`;
      document.getElementById('kpi-total-profit').innerText = `R$ ${kpis.totalProfit.replace('.', ',')}`;
      document.getElementById('kpi-today-profit').innerText = `R$ ${kpis.todayProfit.replace('.', ',')} lucrado hoje`;
      document.getElementById('kpi-total-sales').innerText = kpis.totalSales.toString();
      document.getElementById('kpi-gross-revenue').innerText = `Faturamento: R$ ${kpis.totalRevenue.replace('.', ',')}`;

      // Render chart
      renderResellerSalesChart(chart);

      // Render recent sales
      renderRecentSalesTable(recentSales);

    } catch (e) {
      console.warn('Erro ao carregar dashboard:', e);
    }
  }

  function renderResellerSalesChart(chartData = []) {
    const ctx = document.getElementById('chart-reseller-sales');
    if (!ctx) return;

    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      dates.push(d.toISOString().slice(0, 10));
    }

    const dataMap = Object.fromEntries(chartData.map(x => [x.date_day, x]));

    const salesCounts = dates.map(d => dataMap[d]?.count || 0);
    const profitCounts = dates.map(d => dataMap[d]?.daily_profit || 0);
    const labels = dates.map(d => {
      const [y, m, day] = d.split('-');
      return `${day}/${m}`;
    });

    if (salesChart) salesChart.destroy();

    salesChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            label: 'Seu Lucro Líquido (R$)',
            data: profitCounts,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderWidth: 3,
            fill: true,
            tension: 0.3,
            yAxisID: 'y1'
          },
          {
            type: 'bar',
            label: 'Links Vendidos',
            data: salesCounts,
            backgroundColor: 'rgba(99, 102, 241, 0.8)',
            borderRadius: 6,
            yAxisID: 'y'
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
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#64748b', precision: 0 }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#10b981',
              callback: v => `R$ ${v}`
            }
          }
        }
      }
    });
  }

  function renderRecentSalesTable(sales = []) {
    const tbody = document.getElementById('reseller-recent-sales-body');
    if (!tbody) return;

    if (sales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-4 text-center text-slate-500">Nenhuma venda registrada ainda. Conecte seu bot à API para começar a vender!</td></tr>`;
      return;
    }

    tbody.innerHTML = sales.map(s => {
      const d = new Date(s.created_at);
      return `
        <tr class="hover:bg-white/[0.02]">
          <td class="px-4 py-3 font-semibold text-white">
            ${escapeHtml(s.customer_name || 'Cliente')}
            ${s.customer_id ? `<span class="text-[10px] text-slate-500 block">ID: ${escapeHtml(s.customer_id)}</span>` : ''}
          </td>
          <td class="px-4 py-3 text-white font-mono">R$ ${Number(s.sale_price).toFixed(2).replace('.', ',')}</td>
          <td class="px-4 py-3 text-emerald-400 font-bold font-mono">+ R$ ${Number(s.profit).toFixed(2).replace('.', ',')}</td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              ${s.delivery_status || 'Entregue'}
            </span>
          </td>
          <td class="px-4 py-3 text-slate-400 font-mono text-[11px]">${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // TAB CLIENTES E VENDAS COMPLETAS
  // ==========================================
  async function loadAllSales() {
    const tbody = document.getElementById('reseller-all-sales-body');
    if (!tbody) return;

    try {
      const res = await resellerFetch('/api/reseller/sales');
      const data = await res.json();
      if (!data.success) return;

      if (data.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-8 text-center text-slate-500">Nenhum cliente comprou ainda pelo seu bot.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.data.map(s => {
        const d = new Date(s.created_at);
        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
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
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
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
      console.warn('Erro ao carregar lista de vendas:', e);
    }
  }

  const btnRefreshCustomers = document.getElementById('btn-refresh-customers');
  if (btnRefreshCustomers) {
    btnRefreshCustomers.addEventListener('click', () => {
      loadAllSales();
      showToast('Lista de clientes atualizada.', 'info');
    });
  }

  // ==========================================
  // GERAÇÃO MANUAL DE LINK COM SALDO
  // ==========================================
  const formManualGen = document.getElementById('form-manual-generate');
  const btnSubmitManualGen = document.getElementById('btn-submit-manual-gen');
  const btnManualSpinner = document.getElementById('btn-manual-spinner');
  const btnManualText = document.getElementById('btn-manual-text');
  const manualGeneratedLink = document.getElementById('manual-generated-link');
  const manualTokenPreview = document.getElementById('manual-token-preview');
  const btnOpenManualLink = document.getElementById('btn-open-manual-link');
  const btnCopyManualLink = document.getElementById('btn-copy-manual-link');
  const copyManualBtnText = document.getElementById('copy-manual-btn-text');

  if (formManualGen) {
    formManualGen.addEventListener('submit', async (e) => {
      e.preventDefault();
      const customer_name = document.getElementById('manual-customer-name')?.value;
      const customer_contact = document.getElementById('manual-customer-contact')?.value;
      const sale_price = document.getElementById('manual-sale-price')?.value;

      btnSubmitManualGen.disabled = true;
      btnManualSpinner.classList.remove('hidden');
      btnManualText.innerText = 'GERANDO COM SEU SALDO...';

      try {
        const res = await resellerFetch('/api/reseller/generate-manual', {
          method: 'POST',
          body: JSON.stringify({ customer_name, customer_contact, sale_price })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Falha ao gerar link.');

        // Preenche dados do link gerado
        manualGeneratedLink.value = data.link;
        manualTokenPreview.innerText = data.token;
        if (btnOpenManualLink) btnOpenManualLink.href = data.link;

        // Atualiza saldo na tela
        const formattedBal = 'R$ ' + Number(data.balance_remaining || 0).toFixed(2).replace('.', ',');
        document.getElementById('header-credits').innerText = formattedBal;
        document.getElementById('kpi-credits').innerText = formattedBal;

        showToast(`Link gerado com sucesso! R$ 2,99 descontado do seu saldo. Saldo restante: ${formattedBal}`, 'success');

        // Atualiza vendas e perfil
        loadResellerDashboard();
        loadAllSales();

      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnSubmitManualGen.disabled = false;
        btnManualSpinner.classList.add('hidden');
        btnManualText.innerText = 'GERAR OUTRO LINK COM MEU SALDO (-R$ 2,99)';
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }

  if (btnCopyManualLink) {
    btnCopyManualLink.addEventListener('click', () => {
      const text = manualGeneratedLink.value;
      if (!text || text.includes('Nenhum link')) return;

      copyToClipboard(text);
      copyManualBtnText.innerText = 'Copiado!';
      btnCopyManualLink.classList.remove('bg-indigo-600', 'hover:bg-indigo-500');
      btnCopyManualLink.classList.add('bg-emerald-600', 'hover:bg-emerald-500');

      setTimeout(() => {
        copyManualBtnText.innerText = 'Copiar Link';
        btnCopyManualLink.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btnCopyManualLink.classList.add('bg-indigo-600', 'hover:bg-indigo-500');
      }, 2500);
    });
  }
  const formPricing = document.getElementById('form-pricing-settings');
  const inputSalePrice = document.getElementById('input-sale-price');

  if (inputSalePrice) {
    inputSalePrice.addEventListener('input', () => {
      const price = parseFloat(inputSalePrice.value) || 0;
      updateProfitSimulator(price, currentReseller?.cost_per_link || 2.99);
    });
  }

  function updateProfitSimulator(salePrice, costPrice) {
    const profit = Math.max(0, salePrice - costPrice);
    const simSale = document.getElementById('sim-sale');
    const simCost = document.getElementById('sim-cost');
    const simProfit = document.getElementById('sim-profit');

    if (simSale) simSale.innerText = `R$ ${salePrice.toFixed(2).replace('.', ',')}`;
    if (simCost) simCost.innerText = `- R$ ${costPrice.toFixed(2).replace('.', ',')}`;
    if (simProfit) simProfit.innerText = `R$ ${profit.toFixed(2).replace('.', ',')}`;
  }

  if (formPricing) {
    formPricing.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sale_price = inputSalePrice.value;
      const phone = document.getElementById('input-reseller-phone')?.value;

      try {
        const res = await resellerFetch('/api/reseller/settings', {
          method: 'POST',
          body: JSON.stringify({ sale_price, phone })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error);

        showToast(data.message, 'success');
        loadResellerProfile();
        loadResellerDashboard();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ==========================================
  // RECARGA DE SALDO (VALOR MÍNIMO R$ 15,00)
  // ==========================================
  window.rechargeCredits = async function(credits, amount) {
    const minRecharge = 15.00;
    if (amount < minRecharge) {
      showToast(`O valor mínimo para recarga de saldo é de R$ ${minRecharge.toFixed(2).replace('.', ',')}.`, 'error');
      return;
    }

    if (!confirm(`Confirmar recarga de +${credits} créditos por R$ ${amount.toFixed(2).replace('.', ',')} via PIX?`)) return;

    try {
      const res = await resellerFetch('/api/reseller/recharge', {
        method: 'POST',
        body: JSON.stringify({ credits, amount })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);

      showToast(data.message, 'success');
      loadResellerProfile();
      loadResellerDashboard();
      switchResellerTab('overview');

    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Formulário de Recarga Personalizada (Qualquer Valor a partir de R$ 15,00)
  const formCustomRecharge = document.getElementById('form-custom-recharge');
  const inputCustomRecharge = document.getElementById('input-custom-recharge');
  const customPreview = document.getElementById('custom-recharge-preview');

  window.setQuickRecharge = function(amount) {
    if (inputCustomRecharge) {
      inputCustomRecharge.value = parseFloat(amount).toFixed(2);
      inputCustomRecharge.dispatchEvent(new Event('input'));
    }
  };

  if (inputCustomRecharge && customPreview) {
    const updatePreview = () => {
      const val = parseFloat(inputCustomRecharge.value) || 0;
      const cost = 2.99;
      const linksCount = Math.floor(val / cost);
      const remainder = (val - (linksCount * cost)).toFixed(2).replace('.', ',');

      if (val < 15.00) {
        customPreview.innerHTML = '<span class="text-rose-400 font-bold">⚠️ O valor mínimo de recarga é de R$ 15,00.</span>';
      } else {
        customPreview.innerHTML = `<span class="text-emerald-400 font-black text-sm sm:text-base">+R$ ${val.toFixed(2).replace('.', ',')}</span> <span class="text-slate-300 text-xs font-semibold">de saldo (permite gerar <b>${linksCount} links</b> a R$ 2,99 cada)</span>`;
      }
    };
    inputCustomRecharge.addEventListener('input', updatePreview);
    setTimeout(updatePreview, 400);
  }

  if (formCustomRecharge) {
    formCustomRecharge.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(inputCustomRecharge.value);
      if (isNaN(amount) || amount < 15.00) {
        showToast('O valor mínimo para recarga de saldo é de R$ 15,00.', 'error');
        return;
      }

      rechargeCredits(null, amount);
    });
  }

  // ==========================================
  // API KEY & REGENERATE
  // ==========================================
  const btnCopyApiKey = document.getElementById('btn-copy-my-api-key');
  if (btnCopyApiKey) {
    btnCopyApiKey.addEventListener('click', () => {
      const input = document.getElementById('my-api-key-input');
      if (input && input.value) {
        copyToClipboard(input.value);
      }
    });
  }

  // ==========================================
  // VÍNCULO DO ID DE PERFIL (bot + site)
  // ==========================================
  const btnLinkTelegram = document.getElementById('btn-link-telegram');
  if (btnLinkTelegram) {
    btnLinkTelegram.addEventListener('click', async () => {
      const tgInput = document.getElementById('tg-profile-id-input');
      const tgStatus = document.getElementById('tg-link-status');
      const tgValue = (tgInput.value || '').replace(/[^0-9]/g, '').trim();

      if (!tgValue) {
        showToast('Cole seu ID de perfil (envie /me no bot para copiar).', 'error');
        return;
      }

      try {
        const res = await resellerFetch('/api/reseller/telegram-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegram_id: tgValue })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error);

        tgInput.value = data.telegram_id;
        tgStatus.className = 'text-xs p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/40 text-emerald-300';
        tgStatus.innerHTML = '✅ <b>Vinculado com sucesso!</b> ID <code>' + escapeHtml(data.telegram_id) + '</code>.';
        tgStatus.classList.remove('hidden');
        showToast(data.message, 'success');
        loadResellerProfile();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnRegenApiKey = document.getElementById('btn-regenerate-api-key');
  if (btnRegenApiKey) {
    btnRegenApiKey.addEventListener('click', async () => {
      if (!confirm('Tem certeza? Se regenerar sua chave, você terá que atualizar seu bot com a nova chave!')) return;

      try {
        const res = await resellerFetch('/api/reseller/regenerate-key', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error);

        showToast(data.message, 'success');
        loadResellerProfile();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Helpers
  window.copyToClipboard = function(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    showToast('Copiado com sucesso!', 'success');
  };

  window.copySnippet = function(id) {
    const el = document.getElementById(id);
    if (el) copyToClipboard(el.innerText);
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

  function loadAllResellerData() {
    loadResellerProfile();
    loadResellerDashboard();
  }

  // Verify Session on init
  if (authToken) {
    resellerFetch('/api/reseller/me')
      .then(res => {
        if (!res.ok) throw new Error();
        hideAuthModal();
        loadAllResellerData();
      })
      .catch(() => {
        showAuthModal();
      });
  } else {
    showAuthModal();
  }
});

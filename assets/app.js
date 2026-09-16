// Public Generator JavaScript Logic
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  const btnGenerate = document.getElementById('btn-generate');
  const btnText = document.getElementById('btn-text');
  const btnSpinner = document.getElementById('btn-spinner');
  const resultBox = document.getElementById('result-box');
  const generatedLinkInput = document.getElementById('generated-link-input');
  const btnCopy = document.getElementById('btn-copy');
  const copyBtnText = document.getElementById('copy-btn-text');
  const btnOpenLink = document.getElementById('btn-open-link');
  const btnToggleQr = document.getElementById('btn-toggle-qr');
  const qrContainer = document.getElementById('qr-container');
  const qrcodeDiv = document.getElementById('qrcode');
  const tokenPreview = document.getElementById('token-preview');
  const expiryText = document.getElementById('expiry-text');
  const createdTime = document.getElementById('created-time');
  const counterTotal = document.getElementById('counter-total');
  const navServiceName = document.getElementById('nav-service-name');

  let qrInstance = null;

  // Toast notification helper
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
    }, 4000);
  };

  // Fetch Public System Info
  async function loadPublicInfo() {
    try {
      const res = await fetch('/api/public/info');
      const data = await res.json();
      if (data.success) {
        if (counterTotal) counterTotal.innerText = data.total_generated.toLocaleString('pt-BR');
        if (navServiceName && data.service_name) {
          navServiceName.innerText = data.service_name.toUpperCase();
        }
        if (!data.public_enabled) {
          btnGenerate.disabled = true;
          btnText.innerText = 'GERAÇÃO DESATIVADA PELO ADMIN';
          btnGenerate.classList.add('opacity-50', 'cursor-not-allowed');
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar informações públicas:', e);
    }
  }

  // Generate Link Action
  btnGenerate.addEventListener('click', async () => {
    // UI Loading state
    btnGenerate.disabled = true;
    btnSpinner.classList.remove('hidden');
    btnText.innerText = 'GERANDO ACESSO...';

    try {
      let item = null;

      try {
        const res = await fetch('/api/public/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) item = json.data;
        }
      } catch (err) {
        // Modo estático GitHub Pages
      }

      if (!item) {
        // Geração Inteligente no Cliente (Modo GitHub Pages)
        const randBytes = new Uint8Array(8);
        crypto.getRandomValues(randBytes);
        const token = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        
        const isGithubPages = window.location.hostname.includes('github.io');
        const basePath = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
        const originUrl = window.location.origin + basePath;
        
        const targetUrl = isGithubPages 
          ? `${originUrl}/r.html?token=${token}` 
          : `${originUrl}/r/${token}`;

        item = {
          token,
          targetUrl,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
        };
      }

      // Fill in result details
      generatedLinkInput.value = item.targetUrl;
      btnOpenLink.href = item.targetUrl;
      tokenPreview.innerText = item.token;
      
      const expDate = new Date(item.expiresAt);
      expiryText.innerText = `Expira em: ${expDate.toLocaleDateString('pt-BR')} às ${expDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      createdTime.innerText = `Gerado às ${new Date(item.createdAt).toLocaleTimeString('pt-BR')}`;

      // Show Result Container
      resultBox.classList.remove('hidden');
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Generate or update QR Code
      if (window.QRCode) {
        qrcodeDiv.innerHTML = '';
        qrInstance = new window.QRCode(qrcodeDiv, {
          text: item.targetUrl,
          width: 160,
          height: 160,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.H
        });
      }

      // Re-create icons for any new element
      if (window.lucide) window.lucide.createIcons();

      // Show toast
      showToast('Link gerado com sucesso! Clique em Copiar para utilizar.', 'success');

      // Update counter
      if (counterTotal && counterTotal.innerText !== '--') {
        const current = parseInt(counterTotal.innerText.replace(/\D/g, ''), 10) || 0;
        counterTotal.innerText = (current + 1).toLocaleString('pt-BR');
      }

    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnGenerate.disabled = false;
      btnSpinner.classList.add('hidden');
      btnText.innerText = 'GERAR OUTRO LINK';
      if (window.lucide) window.lucide.createIcons();
    }
  });

  // Copy Link Button Action
  btnCopy.addEventListener('click', async () => {
    const text = generatedLinkInput.value;
    if (!text || text === 'https://...') return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        generatedLinkInput.select();
        document.execCommand('copy');
      }

      copyBtnText.innerText = 'Copiado!';
      btnCopy.classList.remove('bg-indigo-600', 'hover:bg-indigo-500');
      btnCopy.classList.add('bg-emerald-600', 'hover:bg-emerald-500');

      showToast('Link copiado para a área de transferência!', 'success');

      setTimeout(() => {
        copyBtnText.innerText = 'Copiar';
        btnCopy.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btnCopy.classList.add('bg-indigo-600', 'hover:bg-indigo-500');
      }, 2500);

    } catch (err) {
      showToast('Não foi possível copiar automaticamente.', 'error');
    }
  });

  // Toggle QR Code Display
  btnToggleQr.addEventListener('click', () => {
    qrContainer.classList.toggle('hidden');
  });

  // Initial load
  loadPublicInfo();
});

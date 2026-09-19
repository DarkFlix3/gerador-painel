// Public Landing Logic
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  const counterTotal = document.getElementById('counter-total');
  const navServiceName = document.getElementById('nav-service-name');

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
      }
    } catch (e) {
      console.warn('Erro ao carregar informações públicas:', e);
    }
  }

  loadPublicInfo();
});

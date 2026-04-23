/**
 * Generic UI utilities – theme toggle, toast notifications, modal helpers.
 */

export function toggleTheme() {
  const html = document.documentElement;
  const icon = document.getElementById('theme-icon');
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  icon.innerText = next === 'dark' ? 'light_mode' : 'dark_mode';
}

export function showNotification(msg) {
  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

/* ---------- Generic modal open / close helpers ---------- */

export function openModalById(id) {
  document.getElementById(id).classList.add('active');
}

export function closeModalById(id) {
  document.getElementById(id).classList.remove('active');
}

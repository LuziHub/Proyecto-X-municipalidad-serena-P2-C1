/* Utilidades compartidas por las pantallas del SGR. */
const API_URL = '/api';

const Sesion = {
  token() { try { return sessionStorage.getItem('sgr_token'); } catch (_) { return null; } },
  usuario() { try { return JSON.parse(sessionStorage.getItem('sgr_user') || 'null'); } catch (_) { return null; } },
  delegacion() { try { return sessionStorage.getItem('sgr_delegacion'); } catch (_) { return null; } },
  guardar(token, user) {
    try {
      sessionStorage.setItem('sgr_token', token);
      sessionStorage.setItem('sgr_user', JSON.stringify(user));
      if (user.delegacionActiva) sessionStorage.setItem('sgr_delegacion', String(user.delegacionActiva.id));
      return true;
    } catch (_) { return false; }
  },
  actualizarUsuario(user) { try { sessionStorage.setItem('sgr_user', JSON.stringify(user)); } catch (_) {} },
  fijarDelegacion(id) { try { sessionStorage.setItem('sgr_delegacion', String(id)); } catch (_) {} },
  cerrar() { try { sessionStorage.clear(); } catch (_) {} }
};

// Escapa texto antes de insertarlo en HTML (evita inyección desde datos de la base).
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Llamada a la API con token y delegación activa. Devuelve { ok, status, data }.
async function api(ruta, opciones = {}) {
  const cab = { 'Content-Type': 'application/json' };
  const t = Sesion.token();
  if (t) cab.Authorization = `Bearer ${t}`;
  const d = Sesion.delegacion();
  if (d) cab['X-Delegacion'] = d;
  try {
    const r = await fetch(API_URL + ruta, { method: opciones.method || 'GET', headers: cab, body: opciones.body ? JSON.stringify(opciones.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && t && !opciones.sinRedirigir) {
      Sesion.cerrar();
      await Swal.fire({ icon: 'info', title: 'Sesión finalizada', text: 'Tu sesión expiró. Ingresa nuevamente.', confirmButtonColor: '#DB0032' });
      window.location.replace('/');
    }
    return { ok: r.ok, status: r.status, data };
  } catch (_) {
    return { ok: false, status: 0, data: { message: 'No se pudo conectar con el servidor. Revisa tu conexión.' } };
  }
}

function aviso(icon, title, text) {
  return Swal.fire({ icon, title, text, confirmButtonColor: '#DB0032', confirmButtonText: 'Aceptar' });
}
function toast(icon, title) {
  Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 3200, timerProgressBar: true });
}
function fechaHora(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? esc(v) : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}

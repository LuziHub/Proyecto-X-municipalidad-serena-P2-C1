'use strict';

// Limitador en memoria: cuenta eventos por clave dentro de una ventana de tiempo.
// Suficiente para un solo proceso (PM2 en modo fork); si se escala a varios procesos,
// habría que moverlo a la base o a Redis.
function crearLimitador({ max, ventanaMs }) {
  const eventos = new Map();
  const vigentes = clave => {
    const ahora = Date.now();
    const lista = (eventos.get(clave) || []).filter(t => ahora - t < ventanaMs);
    if (lista.length) eventos.set(clave, lista); else eventos.delete(clave);
    return lista;
  };
  return {
    bloqueado: clave => vigentes(clave).length >= max,
    registrar: clave => { const l = vigentes(clave); l.push(Date.now()); eventos.set(clave, l); },
    limpiar: clave => { eventos.delete(clave); },
    reiniciar: () => eventos.clear()
  };
}

module.exports = { crearLimitador };

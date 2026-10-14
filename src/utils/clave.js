'use strict';

// Contraseñas: bcrypt (bcryptjs, o bcrypt si ya está instalado) y requisitos de la clave.

let lib = null;
function bcrypt() {
  if (lib) return lib;
  for (const nombre of ['bcryptjs', 'bcrypt']) {
    try { lib = require(nombre); return lib; } catch (_) { /* probar el siguiente */ }
  }
  const err = new Error('Falta la librería bcrypt. Ejecuta: npm install bcryptjs');
  err.code = 'CONFIG';
  throw err;
}

function bcryptDisponible() {
  try { bcrypt(); return true; } catch (_) { return false; }
}

const COSTO = 10;

// $2y$ (PHP) y $2b$ son el mismo algoritmo; se normaliza a $2b$ para las librerías de Node.
const normalizar = h => String(h).replace(/^\$2y\$/, '$2b$');
const esBcrypt = h => typeof h === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(h);

async function hashear(texto) {
  return bcrypt().hash(texto, COSTO);
}

// false si el hash no es bcrypt (por ejemplo, una clave guardada en texto plano): nunca se acepta.
async function comparar(texto, hash) {
  if (typeof texto !== 'string' || !esBcrypt(hash)) return false;
  try { return await bcrypt().compare(texto, normalizar(hash)); } catch (_) { return false; }
}

// Hash válido de una clave que nadie conoce, para gastar el mismo tiempo cuando el usuario no existe.
const HASH_FALSO = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.fSVx9eoRrYQ7mG3o4R2mXk5lU1uK';

// Gasta el mismo tiempo que una comparación real (cuando el usuario no existe).
async function gastarTiempo(texto) {
  try { await bcrypt().compare(String(texto), HASH_FALSO); } catch (_) { /* sin efecto */ }
}

const REQUISITOS = 'Mínimo 8 caracteres, al menos una letra y un número.';
function validarRequisitos(texto) {
  if (typeof texto !== 'string') return false;
  return texto.length >= 8 && texto.length <= 72 && /[A-Za-z]/.test(texto) && /\d/.test(texto);
}

module.exports = { bcryptDisponible, hashear, comparar, esBcrypt, gastarTiempo, validarRequisitos, REQUISITOS };

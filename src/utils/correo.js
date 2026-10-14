'use strict';

// Envío del código de recuperación. Los datos del SMTP vienen del .env (nunca del código):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE=true|false
let transporte = null;

function smtpConfigurado() {
  return !!process.env.SMTP_HOST;
}

function crearTransporte() {
  if (transporte) return transporte;
  const nodemailer = require('nodemailer');
  const puerto = Number(process.env.SMTP_PORT) || 587;
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: puerto,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : puerto === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transporte;
}

// Devuelve true si el correo salió. Nunca lanza: la API responde igual para no revelar si la cuenta existe.
async function enviarCodigo(correo, codigo, vigenciaMin) {
  if (!smtpConfigurado()) {
    if (process.env.NODE_ENV === 'production') {
      console.error('⚠️  SMTP no configurado: no se pudo enviar el código de recuperación.');
    } else {
      console.log(`[desarrollo] Código de recuperación para ${correo}: ${codigo}`);
    }
    return false;
  }
  try {
    await crearTransporte().sendMail({
      from: process.env.SMTP_FROM || '"SGR Municipalidad de La Serena" <no-reply@laserena.cl>',
      to: correo,
      subject: 'Código de recuperación - SGR',
      text: `Tu código de verificación es: ${codigo}\n\nEs válido por ${vigenciaMin} minutos. ` +
            'Si no solicitaste este cambio, ignora este mensaje.'
    });
    return true;
  } catch (err) {
    console.error('No se pudo enviar el correo de recuperación:', err.message);
    return false;
  }
}

module.exports = { enviarCodigo, smtpConfigurado };

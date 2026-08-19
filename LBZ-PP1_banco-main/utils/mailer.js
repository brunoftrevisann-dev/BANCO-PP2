const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

function plantillaCodigo({ nombre, mensaje, codigo, disclaimer }) {
  return `
    <div style="background:#F9F9F9;padding:40px 16px;font-family:Inter,-apple-system,sans-serif;">
      <div style="max-width:440px;margin:0 auto;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <div style="background:#0052FF;padding:28px 32px;text-align:center;">
          <span style="font-size:1.6rem;font-weight:800;letter-spacing:-0.05em;color:#FFFFFF;">tuo</span>
        </div>
        <div style="padding:32px 32px 36px;">
          <h2 style="font-size:1.25rem;font-weight:700;margin:0 0 10px;color:#1A1A1B;letter-spacing:-0.02em;">Hola ${nombre}</h2>
          <p style="color:#6B6B6B;margin:0 0 26px;font-size:0.92rem;line-height:1.5;">${mensaje}</p>
          <div style="font-size:2.6rem;font-weight:800;letter-spacing:0.22em;color:#0052FF;text-align:center;padding:22px 12px;background:#F0F5FF;border-radius:14px;">${codigo}</div>
          <p style="color:#6B6B6B;font-size:0.82rem;margin:22px 0 0;text-align:center;">Este código vence en <strong style="color:#1A1A1B;">5 minutos</strong>.</p>
        </div>
        <div style="border-top:1px solid #E5E5E5;padding:18px 32px;">
          <p style="color:#8E8E8E;font-size:0.76rem;margin:0;line-height:1.5;">${disclaimer}</p>
        </div>
      </div>
      <p style="text-align:center;color:#B0B0B0;font-size:0.72rem;margin-top:20px;">tuo — Banco digital</p>
    </div>
  `;
}

async function enviarCodigoVerificacion(email, nombre, codigo) {
  await transporter.sendMail({
    from: `"Banco tuo" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Código de verificación — tuo',
    html: plantillaCodigo({
      nombre,
      mensaje: 'Tu código para activar tu cuenta en <strong>tuo</strong> es:',
      codigo,
      disclaimer: 'Si no solicitaste esta cuenta, ignorá este email.'
    })
  });
}

async function enviarCodigoPassword(email, nombre, codigo) {
  await transporter.sendMail({
    from: `"Banco tuo" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Código para cambiar tu contraseña — tuo',
    html: plantillaCodigo({
      nombre,
      mensaje: 'Recibimos una solicitud para cambiar la contraseña de tu cuenta en <strong>tuo</strong>. Tu código es:',
      codigo,
      disclaimer: 'Si no solicitaste este cambio, ignorá este email. Tu contraseña no fue modificada.'
    })
  });
}

async function enviarCodigoAperturaUsd(email, nombre, codigo) {
  await transporter.sendMail({
    from: `"Banco tuo" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Código para abrir tu caja de ahorro en USD — tuo',
    html: plantillaCodigo({
      nombre,
      mensaje: 'Recibimos una solicitud para abrir tu caja de ahorro en dólares en <strong>tuo</strong>. Tu código es:',
      codigo,
      disclaimer: 'Si no solicitaste esto, ignorá este email. Tu cuenta no fue modificada.'
    })
  });
}

module.exports = { enviarCodigoVerificacion, enviarCodigoPassword, enviarCodigoAperturaUsd };

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

async function enviarCodigoVerificacion(email, nombre, codigo) {
  await transporter.sendMail({
    from: `"Banco tuo" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Código de verificación — tuo',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;">
        <h2 style="font-size:1.4rem;font-weight:700;margin-bottom:8px;color:#1A1A1B;">Hola ${nombre}</h2>
        <p style="color:#6B6B6B;margin-bottom:28px;font-size:0.95rem;">Tu código para activar tu cuenta en <strong>tuo</strong> es:</p>
        <div style="font-size:2.8rem;font-weight:800;letter-spacing:0.2em;color:#0052FF;margin-bottom:28px;text-align:center;padding:20px;background:#F0F5FF;border-radius:8px;">${codigo}</div>
        <p style="color:#6B6B6B;font-size:0.85rem;">Este código vence en <strong>5 minutos</strong>.</p>
        <p style="color:#6B6B6B;font-size:0.85rem;margin-top:8px;">Si no solicitaste esta cuenta, ignorá este email.</p>
      </div>
    `
  });
}

module.exports = { enviarCodigoVerificacion };

const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Envia email de convite para novo usuário.
 * Retorna true se enviado, false se SMTP não configurado.
 */
async function sendInviteEmail({ to, name, inviteLink, inviterName }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.log(`[Mailer] SMTP não configurado — link do convite para ${to}: ${inviteLink}`);
    return false;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();

  await transporter.sendMail({
    from: `"Paytcall Suporte" <${from}>`,
    to,
    subject: 'Você foi convidado para o Portal de Suporte Paytcall',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="margin-bottom:24px">
          <div style="display:inline-block;background:#e47c24;border-radius:8px;padding:8px 14px">
            <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.5px">P</span>
            <span style="color:#fff;font-size:13px;font-weight:700;margin-left:6px">PAYTCALL</span>
          </div>
        </div>
        <h2 style="margin:0 0 8px;font-size:20px;color:#111;font-weight:700">Olá, ${name}!</h2>
        <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6">
          <strong>${inviterName}</strong> convidou você para acessar o Portal de Suporte da Paytcall.
        </p>
        <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.6">
          Clique no botão abaixo para criar sua senha e começar a usar:
        </p>
        <a href="${inviteLink}"
           style="display:inline-block;padding:13px 28px;background:#e47c24;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
          Aceitar Convite
        </a>
        <p style="margin:24px 0 0;color:#888;font-size:12px;line-height:1.6">
          Este link expira em <strong>7 dias</strong>.<br>
          Se você não solicitou este acesso, ignore este email.
        </p>
        <p style="margin:8px 0 0;color:#aaa;font-size:11px;word-break:break-all">
          Ou acesse diretamente: ${inviteLink}
        </p>
      </div>
    `,
  });

  return true;
}

module.exports = { sendInviteEmail };

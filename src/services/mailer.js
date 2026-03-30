const { Resend } = require('resend');

/**
 * Envia email de convite para novo usuário via Resend.
 * Retorna true se enviado, false se RESEND_API_KEY não configurado.
 */
async function sendInviteEmail({ to, name, inviteLink, inviterName }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Mailer] RESEND_API_KEY não configurado — link do convite para ${to}: ${inviteLink}`);
    return false;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.SMTP_FROM || 'Paytcall Operações <sistema@paytcall.com.br>';

  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Você foi convidado para o Portal Paytcall Operações',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="margin-bottom:24px">
          <div style="display:inline-block;background:#e47c24;border-radius:8px;padding:8px 14px">
            <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.5px">S</span>
            <span style="color:#fff;font-size:13px;font-weight:700;margin-left:6px">PAYTCALL OPERAÇÕES</span>
          </div>
        </div>
        <h2 style="margin:0 0 8px;font-size:20px;color:#111;font-weight:700">Olá, ${name}!</h2>
        <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6">
          <strong>${inviterName}</strong> convidou você para acessar o Portal de Operações da Paytcall.
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

  if (error) {
    console.error('[Mailer] Erro ao enviar via Resend:', error.message);
    return false;
  }

  return true;
}

module.exports = { sendInviteEmail };

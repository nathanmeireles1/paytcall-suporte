const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');

// Middleware auth (reutiliza do dashboard)
function requireAuth(req, res, next) {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS;
  if (!adminPass) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="payt Tracker"');
    return res.status(401).send('Autenticação necessária');
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user !== adminUser || pass !== adminPass) {
    res.set('WWW-Authenticate', 'Basic realm="payt Tracker"');
    return res.status(401).send('Credenciais inválidas');
  }
  next();
}

// GET /relatorios/tickets — Relatório de todos os tickets
router.get('/tickets', requireAuth, async (req, res) => {
  const { tipo, status, assigned_to, priority, search, page = 1 } = req.query;

  const result = await Shipment.getAllTickets({
    tipo, status, assigned_to, priority, search, page: parseInt(page),
  });

  res.render('relatorios-tickets', {
    tickets: result.rows,
    total: result.total,
    pages: result.pages,
    currentPage: parseInt(page),
    filters: { tipo, status, assigned_to, priority, search },
  });
});

// GET /relatorios/cancelamentos — Relatório de chargebacks e reembolsos
router.get('/cancelamentos', requireAuth, async (req, res) => {
  const { tipo, payment_status, status_atendimento, search, page = 1 } = req.query;

  const result = await Shipment.getCancelamentos({
    tipo, payment_status, status_atendimento, search, page: parseInt(page),
  });

  res.render('relatorios-cancelamentos', {
    items: result.rows,
    total: result.total,
    pages: result.pages,
    currentPage: parseInt(page),
    filters: { tipo, payment_status, status_atendimento, search },
  });
});

// POST /relatorios/cancelamentos/:id — Atualiza campos manuais de um cancelamento
router.post('/cancelamentos/:id', requireAuth, async (req, res) => {
  try {
    const allowed = [
      'status_atendimento', 'pedido_suspenso', 'motivo', 'observacao',
      'nf_data', 'nf_id', 'nf_status', 'produto_novo', 'produto_novo_qtd',
      'produto_novo_nf_id', 'produto_novo_data', 'produto_novo_enviado',
      'devolucao_data_postagem', 'devolucao_reverso', 'devolucao_rastreio', 'devolucao_status',
      'contestar_ate',
    ];
    const fields = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) fields[key] = req.body[key] || null;
    }
    await Shipment.updateCancelamento(req.params.id, fields);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;

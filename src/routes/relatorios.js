const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { requirePermission } = require('../middleware/auth');

// GET /relatorios/tickets — Relatório de todos os tickets
router.get('/tickets', requirePermission('relatorio_tickets', 'can_view'), async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[Relatórios] Erro em /tickets:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar relatório de tickets: ' + err.message });
  }
});

// GET /relatorios/cancelamentos — Relatório de chargebacks e reembolsos
router.get('/cancelamentos', requirePermission('relatorio_cancelamentos', 'can_view'), async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[Relatórios] Erro em /cancelamentos:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar relatório de cancelamentos: ' + err.message });
  }
});

// POST /relatorios/cancelamentos/:id — Atualiza campos manuais de um cancelamento
router.post('/cancelamentos/:id', requirePermission('relatorio_cancelamentos', 'can_edit'), async (req, res) => {
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
    console.error('[Relatórios] Erro ao atualizar cancelamento:', e.message);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;

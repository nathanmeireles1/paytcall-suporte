const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { requirePermission } = require('../middleware/auth');

// Compatibilidade: /cancelamentos → /retencao
router.get('/cancelamentos', (req, res) => res.redirect(301, '/relatorios/retencao'));

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

// GET /relatorios/retencao — Relatório de chargebacks e reembolsos
router.get('/retencao', requirePermission('relatorio_cancelamentos', 'can_view'), async (req, res) => {
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
    console.error('[Relatórios] Erro em /retencao:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar relatório de retenção: ' + err.message });
  }
});

// GET /relatorios/tickets/export — Download XLSX ou CSV
router.get('/tickets/export', requirePermission('relatorio_tickets', 'can_view'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { tipo, status, assigned_to, priority, search, format = 'xlsx' } = req.query;
    const result = await Shipment.getAllTickets({ tipo, status, assigned_to, priority, search, page: 1, limit: 9999 });

    const PRIO = {1:'Alta', 2:'Média', 3:'Baixa'};
    const fmtDt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';

    const rows = result.rows.map(t => ({
      'ID':              t.id || '',
      'Tipo':            t.tipo || '',
      'Motivo':          t.motivo || '',
      'Status':          t.status || '',
      'Prioridade':      PRIO[t.priority] || '',
      'Responsável':     t.assigned_to || '',
      'Criado por':      t.created_by || '',
      'Rastreio':        t.tracking_code || '',
      'ID Pedido':       t.order_id || '',
      'Cliente':         t.shipments?.customer_name || '',
      'Empresa':         t.shipments?.company_name || '',
      'Criado em':       fmtDt(t.created_at),
      'Encerrado em':    fmtDt(t.closed_at),
      'Observação':      t.observacao || '',
    }));

    const filename = `tickets-${new Date().toISOString().slice(0,10)}`;

    if (format === 'csv') {
      const header = Object.keys(rows[0] || {}).join(';');
      const lines = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment;filename=${filename}.csv`);
      return res.send('\uFEFF' + [header, ...lines].join('\r\n'));
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tickets');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment;filename=${filename}.xlsx`);
    res.send(buf);
  } catch (err) {
    console.error('[Export] Erro tickets:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /relatorios/retencao/export — Download XLSX ou CSV
router.get('/retencao/export', requirePermission('relatorio_cancelamentos', 'can_view'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { tipo, payment_status, status_atendimento, search, format = 'xlsx' } = req.query;
    const result = await Shipment.getCancelamentos({ tipo, payment_status, status_atendimento, search, page: 1, limit: 9999 });

    const fmtDt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    const fmtMoney = (v) => v ? 'R$ ' + (v/100).toFixed(2).replace('.',',') : '';

    const rows = result.rows.map(c => ({
      'ID':                   c.id || '',
      'Tipo':                 c.tipo || '',
      'ID Pedido':            c.order_id || '',
      'Cliente':              c.customer_name || '',
      'CPF':                  c.customer_doc || '',
      'Email':                c.customer_email || '',
      'Produto':              c.product_name || '',
      'Valor':                fmtMoney(c.total_price),
      'Status Pagamento':     c.payment_status || '',
      'Status Atendimento':   c.status_atendimento || '',
      'Rastreio':             c.tracking_code || '',
      'Transportadora':       c.carrier || '',
      'Status Entrega':       c.status_entrega || '',
      'Status NF':            c.nf_status || '',
      'Contestar até':        fmtDt(c.contestar_ate),
      'Criado em':            fmtDt(c.created_at),
      'Observação':           c.observacao || '',
    }));

    const filename = `cancelamentos-${new Date().toISOString().slice(0,10)}`;

    if (format === 'csv') {
      const header = Object.keys(rows[0] || {}).join(';');
      const lines = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment;filename=${filename}.csv`);
      return res.send('\uFEFF' + [header, ...lines].join('\r\n'));
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Cancelamentos');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment;filename=${filename}.xlsx`);
    res.send(buf);
  } catch (err) {
    console.error('[Export] Erro cancelamentos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /relatorios/retencao/:id — Atualiza campos manuais de um cancelamento
router.post('/retencao/:id', requirePermission('relatorio_cancelamentos', 'can_edit'), async (req, res) => {
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

// GET /relatorios/logistica
router.get('/logistica', requirePermission('relatorio_logistica', 'can_view'), async (req, res) => {
  try {
    const { status, assigned_to, priority, search, page = 1 } = req.query;
    const result = await Shipment.getAllTickets({ tipo: 'LOGISTICA', status, assigned_to, priority, search, page: parseInt(page) });
    res.render('relatorios-logistica', {
      tickets: result.rows,
      total: result.total,
      pages: result.pages,
      currentPage: parseInt(page),
      filters: { status, assigned_to, priority, search },
    });
  } catch (err) {
    console.error('[Relatórios] Erro em /logistica:', err.message);
    res.status(500).render('error', { message: 'Erro: ' + err.message });
  }
});

// GET /relatorios/logistica/export
router.get('/logistica/export', requirePermission('relatorio_logistica', 'can_view'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { status, assigned_to, priority, search, format = 'xlsx' } = req.query;
    const result = await Shipment.getAllTickets({ tipo: 'LOGISTICA', status, assigned_to, priority, search, page: 1, limit: 9999 });
    const PRIO = {1:'Alta', 2:'Média', 3:'Baixa'};
    const fmtDt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    const rows = result.rows.map(t => ({
      'ID': t.id || '', 'Motivo': t.motivo || '', 'Status': t.status || '',
      'Prioridade': PRIO[t.priority] || '', 'Responsável': t.assigned_to || '',
      'Criado por': t.created_by || '', 'Rastreio': t.tracking_code || '',
      'ID Pedido': t.order_id || '', 'Cliente': t.shipments?.customer_name || '',
      'Empresa': t.shipments?.company_name || '', 'Criado em': fmtDt(t.created_at),
      'Encerrado em': fmtDt(t.closed_at), 'Observação': t.observacao || '',
    }));
    const filename = `logistica-${new Date().toISOString().slice(0,10)}`;
    if (format === 'csv') {
      const header = Object.keys(rows[0] || {}).join(';');
      const lines = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment;filename=${filename}.csv`);
      return res.send('\uFEFF' + [header, ...lines].join('\r\n'));
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Logística');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment;filename=${filename}.xlsx`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /relatorios/retencao/solicitacoes/export
router.get('/retencao/solicitacoes/export', requirePermission('tickets', 'can_view'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { status, assigned_to, priority, search, format = 'xlsx' } = req.query;
    const result = await Shipment.getAllTickets({ tipo: 'RETENCAO', status, assigned_to, priority, search, page: 1, limit: 9999 });
    const PRIO = {1:'Alta', 2:'Média', 3:'Baixa'};
    const fmtDt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    const rows = result.rows.map(t => ({
      'Rastreio': t.tracking_code || '', 'ID Pedido': t.order_id || '',
      'Motivo': t.motivo || '', 'Status': t.status || '',
      'Prioridade': PRIO[t.priority] || '', 'Responsável': t.assigned_to || '',
      'Criado por': t.created_by || '', 'Data': fmtDt(t.created_at), 'Observação': t.observacao || '',
    }));
    const filename = `retencao-solicitacoes-${new Date().toISOString().slice(0,10)}`;
    if (format === 'csv') {
      const header = Object.keys(rows[0] || {}).join(';');
      const lines = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment;filename=${filename}.csv`);
      return res.send('\uFEFF' + [header, ...lines].join('\r\n'));
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Solicitações');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment;filename=${filename}.xlsx`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /relatorios/logistica/solicitacoes/export
router.get('/logistica/solicitacoes/export', requirePermission('tickets', 'can_view'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { status, assigned_to, priority, search, format = 'xlsx' } = req.query;
    const result = await Shipment.getAllTickets({ tipo: 'LOGISTICA', status, assigned_to, priority, search, page: 1, limit: 9999 });
    const PRIO = {1:'Alta', 2:'Média', 3:'Baixa'};
    const fmtDt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    const rows = result.rows.map(t => ({
      'Rastreio': t.tracking_code || '', 'ID Pedido': t.order_id || '',
      'Motivo': t.motivo || '', 'Status': t.status || '',
      'Prioridade': PRIO[t.priority] || '', 'Responsável': t.assigned_to || '',
      'Criado por': t.created_by || '', 'Data': fmtDt(t.created_at), 'Observação': t.observacao || '',
    }));
    const filename = `logistica-solicitacoes-${new Date().toISOString().slice(0,10)}`;
    if (format === 'csv') {
      const header = Object.keys(rows[0] || {}).join(';');
      const lines = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment;filename=${filename}.csv`);
      return res.send('\uFEFF' + [header, ...lines].join('\r\n'));
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Solicitações');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment;filename=${filename}.xlsx`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /relatorios/retencao/solicitacoes
router.get('/retencao/solicitacoes', requirePermission('tickets', 'can_view'), async (req, res) => {
  try {
    const { status, assigned_to, priority, search, page = 1 } = req.query;
    const result = await Shipment.getAllTickets({ tipo: 'RETENCAO', status, assigned_to, priority, search, page: parseInt(page) });
    res.render('relatorios-solicitacoes', {
      setor: 'RETENCAO', setorLabel: 'Retenção',
      tickets: result.rows, total: result.total, pages: result.pages, currentPage: parseInt(page),
      filters: { status, assigned_to, priority, search },
    });
  } catch (err) { res.status(500).render('error', { message: err.message }); }
});

// GET /relatorios/logistica/solicitacoes
router.get('/logistica/solicitacoes', requirePermission('tickets', 'can_view'), async (req, res) => {
  try {
    const { status, assigned_to, priority, search, page = 1 } = req.query;
    const result = await Shipment.getAllTickets({ tipo: 'LOGISTICA', status, assigned_to, priority, search, page: parseInt(page) });
    res.render('relatorios-solicitacoes', {
      setor: 'LOGISTICA', setorLabel: 'Logística',
      tickets: result.rows, total: result.total, pages: result.pages, currentPage: parseInt(page),
      filters: { status, assigned_to, priority, search },
    });
  } catch (err) { res.status(500).render('error', { message: err.message }); }
});

// GET /relatorios/rastreio-log — Log das execuções do scheduler H7
router.get('/rastreio-log', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const result = await Shipment.getSchedulerLogs({ page: parseInt(page) });
    res.render('relatorios-rastreio-log', {
      logs: result.rows,
      total: result.total,
      pages: result.pages,
      currentPage: parseInt(page),
    });
  } catch (err) {
    console.error('[Relatórios] Erro em /rastreio-log:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar log: ' + err.message });
  }
});

module.exports = router;

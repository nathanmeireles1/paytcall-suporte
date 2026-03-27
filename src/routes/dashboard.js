const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { TICKET_CONFIG, MOTIVOS_CANCELAMENTO } = require('../models/Shipment');

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

function getNextWindow() {
  const brt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const mins = brt.getHours() * 60 + brt.getMinutes();
  if (mins < 8 * 60)  return 'hoje às 08:00';
  if (mins < 14 * 60) return 'hoje às 14:00';
  return 'amanhã às 08:00';
}

router.get('/', requireAuth, async (req, res) => {
  const { status, search, seller_id, carrier, product, paid_at_from, paid_at_to, page = 1 } = req.query;

  const [stats, result, companies, lastLog, pendingCount] = await Promise.all([
    Shipment.getStats(),
    Shipment.findAll({ status, search, seller_id, carrier, product, paid_at_from, paid_at_to, page: parseInt(page) }),
    Shipment.getCompanies(),
    Shipment.getLastSchedulerLog(),
    Shipment.countPendingForRefresh(),
  ]);

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  res.render('dashboard', {
    shipments: result.rows,
    stats,
    companies,
    total: result.total,
    pages: result.pages,
    currentPage: parseInt(page),
    filters: { status, search, seller_id, carrier, product, paid_at_from, paid_at_to },
    lastLog: lastLog ? { ...lastLog, ran_at_fmt: fmtDate(lastLog.ran_at) } : null,
    pendingCount,
    nextWindow: getNextWindow(),
  });
});

router.get('/shipment/:code', requireAuth, async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const [shipment, events, tickets] = await Promise.all([
    Shipment.findByCode(code),
    Shipment.getEvents(code),
    Shipment.getTickets(code),
  ]);

  if (!shipment) {
    return res.status(404).render('error', { message: 'Envio não encontrado' });
  }

  res.render('shipment', { shipment, events, tickets, TICKET_CONFIG, MOTIVOS_CANCELAMENTO });
});

// POST /shipment/:code/ticket — abre ticket de suporte
router.post('/shipment/:code/ticket', requireAuth, async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const { tipo, motivo, motivo_cancelamento, observacao, created_by } = req.body;
  const shipment = await Shipment.findByCode(code);
  if (!shipment) return res.status(404).json({ error: 'Pedido não encontrado' });

  try {
    await Shipment.createTicket({
      tracking_code: code,
      order_id: shipment.order_id,
      tipo, motivo, motivo_cancelamento, observacao, created_by,
    });
  } catch (err) {
    console.error('[Ticket] Erro ao criar:', err.message);
  }
  res.redirect(`/shipment/${code}`);
});

// POST /ticket/:id/status — altera status do ticket
router.post('/ticket/:id/status', requireAuth, async (req, res) => {
  try {
    await Shipment.updateTicketStatus(req.params.id, req.body.status);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;

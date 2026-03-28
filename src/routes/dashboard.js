const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { TICKET_CONFIG, MOTIVOS_CANCELAMENTO } = require('../models/Shipment');
const { requirePermission } = require('../middleware/auth');

function getNextWindow() {
  const brt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const mins = brt.getHours() * 60 + brt.getMinutes();
  if (mins < 8 * 60)  return 'hoje às 08:00';
  if (mins < 14 * 60) return 'hoje às 14:00';
  return 'amanhã às 08:00';
}

// GET /dashboard — página dedicada de dashboard
router.get('/dashboard', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const { seller_id, days = '30' } = req.query;

    const [stats, lastLog, pendingCount, ticketStats, timeSeries, companies] = await Promise.all([
      Shipment.getStats(),
      Shipment.getLastSchedulerLog(),
      Shipment.countPendingForRefresh(),
      Shipment.getTicketStats(),
      Shipment.getShipmentsPerDay({ days: parseInt(days) || 30, sellerId: seller_id || null }),
      Shipment.getCompanies(),
    ]);

    const fmtDate = (iso) => iso
      ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : null;

    res.render('home-dashboard', {
      stats,
      lastLog: lastLog ? { ...lastLog, ran_at_fmt: fmtDate(lastLog.ran_at) } : null,
      pendingCount,
      nextWindow: getNextWindow(),
      ticketStats,
      timeSeries,
      companies,
      filters: { seller_id: seller_id || '', days },
    });
  } catch (err) {
    console.error('[Dashboard] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar dashboard: ' + err.message });
  }
});

// Handler de rastreios — compartilhado entre / e /rastreios
async function handleRastreios(req, res) {
  try {
    const { status, search, seller_id, carrier, product, paid_at_from, paid_at_to, page = 1 } = req.query;

    // Terceiros: filtra por seller_ids permitidos
    let effectiveSellerId = seller_id;
    if (req.user.role === 'terceiros') {
      if (!seller_id || !req.user.seller_ids.includes(seller_id)) {
        effectiveSellerId = req.user.seller_ids[0] || '__none__';
      }
    }

    const [stats, result, companies, lastLog, pendingCount] = await Promise.all([
      Shipment.getStats(),
      Shipment.findAll({ status, search, seller_id: effectiveSellerId, carrier, product, paid_at_from, paid_at_to, page: parseInt(page) }),
      Shipment.getCompanies(),
      Shipment.getLastSchedulerLog(),
      Shipment.countPendingForRefresh(),
    ]);

    // Terceiros: filtra empresas visíveis
    let visibleCompanies = companies;
    if (req.user.role === 'terceiros') {
      visibleCompanies = companies.filter(c => req.user.seller_ids.includes(c.seller_id));
    }

    const fmtDate = (iso) => iso
      ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : null;

    res.render('dashboard', {
      shipments: result.rows,
      stats,
      companies: visibleCompanies,
      total: result.total,
      pages: result.pages,
      currentPage: parseInt(page),
      filters: { status, search, seller_id: effectiveSellerId, carrier, product, paid_at_from, paid_at_to },
      lastLog: lastLog ? { ...lastLog, ran_at_fmt: fmtDate(lastLog.ran_at) } : null,
      pendingCount,
      nextWindow: getNextWindow(),
    });
  } catch (err) {
    console.error('[Dashboard] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar painel: ' + err.message });
  }
}

// GET / e /rastreios — Rastreios (lista de envios)
router.get('/', requirePermission('dashboard', 'can_view'), handleRastreios);
router.get('/rastreios', requirePermission('dashboard', 'can_view'), handleRastreios);

// Handler compartilhado para exibir detalhe do pedido
async function handlePedido(shipment, req, res) {
  if (!shipment) return res.status(404).render('error', { message: 'Pedido não encontrado' });
  if (req.user.role === 'terceiros' && !req.user.seller_ids.includes(shipment.seller_id)) {
    return res.status(403).render('error', { message: 'Acesso negado a este pedido' });
  }
  const [events, tickets] = await Promise.all([
    Shipment.getEvents(shipment.tracking_code),
    Shipment.getTickets(shipment.tracking_code),
  ]);
  res.render('shipment', { shipment, events, tickets, TICKET_CONFIG, MOTIVOS_CANCELAMENTO });
}

// GET /pedido/:orderId — detalhe por ID do pedido Payt (URL canônica)
router.get('/pedido/:orderId', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const shipment = await Shipment.findByOrderId(req.params.orderId.trim());
    await handlePedido(shipment, req, res);
  } catch (err) {
    console.error('[Pedido] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar pedido: ' + err.message });
  }
});

// GET /shipment/:code — mantido para compatibilidade, redireciona para /pedido/:orderId
router.get('/shipment/:code', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const shipment = await Shipment.findByCode(code);
    if (shipment && shipment.order_id) return res.redirect(301, `/pedido/${shipment.order_id}`);
    await handlePedido(shipment, req, res);
  } catch (err) {
    console.error('[Shipment] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar pedido: ' + err.message });
  }
});

// POST /shipment/:code/ticket — abre ticket de suporte
router.post('/shipment/:code/ticket', requirePermission('tickets', 'can_create'), async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const { tipo, motivo, motivo_cancelamento, observacao } = req.body;
  const shipment = await Shipment.findByCode(code);
  if (!shipment) return res.status(404).json({ error: 'Pedido não encontrado' });

  try {
    await Shipment.createTicket({
      tracking_code: code,
      order_id: shipment.order_id,
      tipo, motivo, motivo_cancelamento, observacao,
      created_by: req.user.name,
    });
  } catch (err) {
    console.error('[Ticket] Erro ao criar:', err.message);
  }
  res.redirect(`/shipment/${code}`);
});

// POST /ticket/:id/status — altera status do ticket
router.post('/ticket/:id/status', requirePermission('tickets', 'can_edit'), async (req, res) => {
  try {
    await Shipment.updateTicketStatus(req.params.id, req.body.status);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/notifications — busca notificações
router.get('/api/notifications', async (req, res) => {
  try {
    const userName = req.user.name;
    const [notifications, unread] = await Promise.all([
      Shipment.getNotifications(userName),
      Shipment.getUnreadCount(userName),
    ]);
    res.json({ notifications, unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/read — marca todas como lidas
router.post('/api/notifications/read', async (req, res) => {
  try {
    await Shipment.markNotificationsRead(req.user.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pedido/:orderId — JSON para modal de detalhe
router.get('/api/pedido/:orderId', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const shipment = await Shipment.findByOrderId(req.params.orderId.trim());
    if (!shipment) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (req.user.role === 'terceiros' && !req.user.seller_ids.includes(shipment.seller_id)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const [events, tickets] = await Promise.all([
      Shipment.getEvents(shipment.tracking_code),
      Shipment.getTickets(shipment.tracking_code),
    ]);
    res.json({ shipment, events, tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics — página de KPIs e gráficos analíticos
router.get('/analytics', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const { seller_id, days = '30', carrier, status } = req.query;
    const [stats, analytics, timeSeries, companies] = await Promise.all([
      Shipment.getStats(),
      Shipment.getAnalytics(),
      Shipment.getShipmentsPerDay({ days: parseInt(days) || 30, sellerId: seller_id || null }),
      Shipment.getCompanies(),
    ]);
    res.render('analytics', {
      stats, analytics, timeSeries, companies,
      filters: { seller_id: seller_id || '', days, carrier: carrier || '', status: status || '' },
    });
  } catch (err) {
    console.error('[Analytics] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar analytics: ' + err.message });
  }
});

module.exports = router;

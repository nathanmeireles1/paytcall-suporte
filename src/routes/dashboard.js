const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { TICKET_CONFIG, MOTIVOS_CANCELAMENTO } = require('../models/Shipment');
const { requirePermission } = require('../middleware/auth');
const { db } = require('../config/database');

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
    const { seller_id, date_from, date_to } = req.query;

    const [stats, lastLog, pendingCount, ticketStats, timeSeries, companies] = await Promise.all([
      Shipment.getStats(),
      Shipment.getLastSchedulerLog(),
      Shipment.countPendingForRefresh(),
      Shipment.getTicketStats(),
      Shipment.getShipmentsPerDay({ sellerId: seller_id || null, dateFrom: date_from || null, dateTo: date_to || null }),
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
      filters: { seller_id: seller_id || '', date_from: date_from || '', date_to: date_to || '' },
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
      Shipment.findAllCombined({ status, search, seller_id: effectiveSellerId, paid_at_from, paid_at_to, page: parseInt(page) }),
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

// GET /api/rastreios/export — Download XLSX ou CSV com filtros atuais
router.get('/api/rastreios/export', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { status, search, seller_id, carrier, product, paid_at_from, paid_at_to, format = 'xlsx' } = req.query;

    let effectiveSellerId = seller_id;
    if (req.user.role === 'terceiros') {
      if (!seller_id || !req.user.seller_ids.includes(seller_id)) {
        effectiveSellerId = req.user.seller_ids[0] || '__none__';
      }
    }

    const result = await Shipment.findAllCombined({ status, search, seller_id: effectiveSellerId, paid_at_from, paid_at_to, page: 1, limit: 9999 });

    const STATUS_LABEL = { pending:'Pendente', posted_object:'Obj. Postado', forwarded:'Em Trânsito', delivering:'Saiu p/ Entrega', recipient_not_found:'Dest. não encontrado', delivery_problem:'Prob. Entrega', wrong_address:'End. Incorreto', waiting_client:'Ag. Retirada', delivered:'Entregue', returning:'Devolvendo', returned:'Devolvido', overdue:'Em Atraso', no_tracking:'Sem Rastreio', tracking_delayed:'Rastreio em Atraso' };
    const fmtDt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';

    const rows = result.rows.map(s => ({
      'ID Pedido':         s.order_id || '',
      'Código Rastreio':   s.tracking_code || '',
      'Cliente':           s.customer_name || '',
      'Email':             s.customer_email || '',
      'CPF':               s.customer_cpf || s.customer_doc || '',
      'Produto':           s.product_name || '',
      'Empresa':           s.company_name || s.seller_id || '',
      'Transportadora':    s.carrier || '',
      'Status':            STATUS_LABEL[s.status] || s.status || '',
      'Pago em':           fmtDt(s.paid_at),
      'Último evento':     s.last_event || '',
    }));

    const filename = `rastreios-${new Date().toISOString().slice(0,10)}`;

    if (format === 'csv') {
      const header = Object.keys(rows[0] || {}).join(';');
      const lines = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment;filename=${filename}.csv`);
      return res.send('\uFEFF' + [header, ...lines].join('\r\n'));
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Rastreios');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment;filename=${filename}.xlsx`);
    res.send(buf);
  } catch (err) {
    console.error('[Export] Erro rastreios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics — página de KPIs e gráficos analíticos
router.get('/analytics', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const { seller_id, date_from, date_to, carrier, status } = req.query;
    const [stats, analytics, timeSeries, companies] = await Promise.all([
      Shipment.getStats(),
      Shipment.getAnalytics(),
      Shipment.getShipmentsPerDay({ sellerId: seller_id || null, dateFrom: date_from || null, dateTo: date_to || null }),
      Shipment.getCompanies(),
    ]);
    res.render('analytics', {
      stats, analytics, timeSeries, companies,
      filters: { seller_id: seller_id || '', date_from: date_from || '', date_to: date_to || '', carrier: carrier || '', status: status || '' },
    });
  } catch (err) {
    console.error('[Analytics] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar analytics: ' + err.message });
  }
});

// POST /api/tickets/bulk — cria tickets em massa
router.post('/api/tickets/bulk', async (req, res) => {
  try {
    const { tracking_codes, tipo, motivo, priority, observacao } = req.body;
    if (!tracking_codes?.length || !tipo || !motivo) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
    const results = [];
    for (const code of tracking_codes) {
      const { data, error } = await db.from('tickets').insert({
        tracking_code: code || null,
        tipo, motivo, priority: priority || 3,
        observacao: observacao || null,
        status: 'Aberto',
        created_by: req.user.name,
        assigned_to: null,
      }).select().single();
      if (!error) results.push(data);
    }
    res.json({ ok: true, created: results.length });
  } catch (err) {
    console.error('[Tickets Bulk] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/photo — atualiza foto de perfil (todos os usuários)
router.post('/api/profile/photo', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Imagem inválida' });

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) return res.status(400).json({ error: 'Tipo de imagem não suportado' });

    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Imagem muito grande (máx 3MB)' });

    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
    const filename = `avatars/${req.user.id}.${ext}`;

    const { error: uploadError } = await db.storage
      .from('avatars')
      .upload(filename, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) throw new Error(uploadError.message);

    const { data: { publicUrl } } = db.storage.from('avatars').getPublicUrl(filename);

    await db.from('user_profiles').update({ avatar_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', req.user.id);

    res.json({ ok: true, url: publicUrl });
  } catch (err) {
    console.error('[Profile] Erro ao salvar foto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

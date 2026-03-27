const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');

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
  const { status, search, seller_id, page = 1 } = req.query;
  const [stats, result, companies, lastQueried] = await Promise.all([
    Shipment.getStats(),
    Shipment.findAll({ status, search, seller_id, page: parseInt(page) }),
    Shipment.getCompanies(),
    Shipment.getLastQueried(),
  ]);

  const lastQueriedFmt = lastQueried
    ? new Date(lastQueried).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  res.render('dashboard', {
    shipments: result.rows,
    stats,
    companies,
    total: result.total,
    pages: result.pages,
    currentPage: parseInt(page),
    filters: { status, search, seller_id },
    lastQueried: lastQueriedFmt,
    nextWindow: getNextWindow(),
  });
});

router.get('/shipment/:code', requireAuth, async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const [shipment, events] = await Promise.all([
    Shipment.findByCode(code),
    Shipment.getEvents(code),
  ]);

  if (!shipment) {
    return res.status(404).render('error', { message: 'Envio não encontrado' });
  }

  res.render('shipment', { shipment, events });
});

module.exports = router;

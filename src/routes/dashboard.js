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

router.get('/', requireAuth, async (req, res) => {
  const { status, search, seller_id, page = 1 } = req.query;
  const [stats, result, companies] = await Promise.all([
    Shipment.getStats(),
    Shipment.findAll({ status, search, seller_id, page: parseInt(page) }),
    Shipment.getCompanies(),
  ]);

  res.render('dashboard', {
    shipments: result.rows,
    stats,
    companies,
    total: result.total,
    pages: result.pages,
    currentPage: parseInt(page),
    filters: { status, search, seller_id },
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

const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { queryH7ByCpf } = require('../services/haga7');
// correios.js mantido como backup — consultas sempre via H7

// GET /api/tracking/:code — força nova consulta via H7 pelo CPF do cliente
router.get('/:code', async (req, res) => {
  const code = req.params.code.trim().toUpperCase();

  try {
    const shipment = await Shipment.findByCode(code);

    if (!shipment?.customer_doc) {
      return res.status(400).json({ error: 'Sem CPF cadastrado. Aguarde o próximo webhook da Payt.' });
    }

    const tracking = await queryH7ByCpf(shipment.customer_doc);

    const updated = await Shipment.upsert({
      ...shipment,
      tracking_code: code,
      status: tracking.status,
      last_event: tracking.last_event,
      last_event_date: tracking.last_event_date,
    });

    if (tracking.events?.length) {
      await Shipment.saveEvents(code, tracking.events);
    }

    res.json({ ...updated, events: await Shipment.getEvents(code) });
  } catch (err) {
    const shipment = await Shipment.findByCode(code).catch(() => null);
    if (shipment) {
      return res.json({
        ...shipment,
        events: await Shipment.getEvents(code),
        warning: 'Dados do cache — H7 indisponível no momento',
      });
    }
    res.status(502).json({ error: err.message });
  }
});

// POST /api/tracking/refresh — dispara atualização de todos os ativos via H7
router.post('/refresh', async (req, res) => {
  const { refreshPendingShipments } = require('../services/scheduler');
  const [pending, queue] = await Promise.all([
    Shipment.getPendingForRefresh(),
    Shipment.getCustomerQueue(),
  ]);
  const total = pending.length + queue.length;
  res.json({ message: `Atualizando ${total} envio(s) via H7...`, total });
  refreshPendingShipments().catch(console.error);
});

// POST /api/tracking/refresh-batch — atualiza rastreio de códigos específicos
router.post('/refresh-batch', async (req, res) => {
  const { codes } = req.body;
  if (!codes?.length) return res.status(400).json({ error: 'Nenhum código informado' });
  res.json({ message: `Atualizando ${codes.length} pedido(s)...`, total: codes.length });
  // Processa em background
  (async () => {
    for (const code of codes) {
      try {
        const shipment = await Shipment.findByCode(code);
        if (!shipment?.customer_doc) continue;
        const tracking = await queryH7ByCpf(shipment.customer_doc);
        await Shipment.upsert({ ...shipment, tracking_code: code, status: tracking.status, last_event: tracking.last_event, last_event_date: tracking.last_event_date });
        if (tracking.events?.length) await Shipment.saveEvents(code, tracking.events);
      } catch (e) { /* skip individual errors */ }
    }
  })().catch(console.error);
});

module.exports = router;

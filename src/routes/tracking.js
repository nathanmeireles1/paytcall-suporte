const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { queryTracking } = require('../services/correios');

// GET /api/tracking/:code — força nova consulta nos Correios
router.get('/:code', async (req, res) => {
  const code = req.params.code.trim().toUpperCase();

  try {
    const tracking = await queryTracking(code);
    const shipment = await Shipment.findByCode(code);

    const updated = await Shipment.upsert({
      tracking_code: code,
      order_id: shipment?.order_id,
      customer_name: shipment?.customer_name,
      customer_email: shipment?.customer_email,
      customer_phone: shipment?.customer_phone,
      status: tracking.status,
      last_event: tracking.last_event,
      last_event_date: tracking.last_event_date,
    });

    if (tracking.events?.length) {
      await Shipment.saveEvents(code, tracking.events);
    }

    res.json({ ...updated, events: await Shipment.getEvents(code) });
  } catch (err) {
    // Retorna cache se Correios estiver fora
    const shipment = await Shipment.findByCode(code).catch(() => null);
    if (shipment) {
      return res.json({
        ...shipment,
        events: await Shipment.getEvents(code),
        warning: 'Dados do cache — Correios indisponíveis',
      });
    }
    res.status(502).json({ error: err.message });
  }
});

// POST /api/tracking/refresh — atualiza todos os envios ainda em trânsito
router.post('/refresh', async (req, res) => {
  const { refreshPendingShipments } = require('../services/scheduler');
  const pending = await Shipment.getPendingForRefresh();
  res.json({ message: `Atualizando ${pending.length} envio(s)...`, total: pending.length });
  refreshPendingShipments().catch(console.error);
});

module.exports = router;

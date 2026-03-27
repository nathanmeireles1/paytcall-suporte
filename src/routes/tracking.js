const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { queryTracking } = require('../services/correios');
const { queryH7ByCpf } = require('../services/haga7');

// GET /api/tracking/:code — força nova consulta (Correios ou H7 conforme transportadora)
router.get('/:code', async (req, res) => {
  const code = req.params.code.trim().toUpperCase();

  try {
    const shipment = await Shipment.findByCode(code);
    let tracking;

    if (shipment?.carrier === 'Correios') {
      tracking = await queryTracking(code);
    } else if (shipment?.customer_doc) {
      tracking = await queryH7ByCpf(shipment.customer_doc);
    } else {
      return res.status(400).json({ error: 'Sem CPF para consultar H7. Aguarde o webhook da Payt repopular os dados.' });
    }

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
        warning: 'Dados do cache — API indisponível',
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

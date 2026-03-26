const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');
const { queryTracking } = require('../services/correios');

/**
 * POST /webhook
 * Recebe notificações da payt.com.br
 */

// 🔴 PAUSADO — migração para Supabase em andamento
// Altere para false para reativar o processamento
const WEBHOOK_PAUSED = true;

// GET /webhook — responde para testes de disponibilidade
router.get('/', (req, res) => {
  res.json({ success: true, message: WEBHOOK_PAUSED ? 'Webhook pausado (manutenção)' : 'Webhook ativo' });
});

router.post('/', async (req, res) => {
  if (WEBHOOK_PAUSED) {
    console.log(`[Webhook] PAUSADO — recebido mas ignorado: ${req.body?.shipping?.tracking_code || 'sem código'}`);
    return res.json({ success: true, message: 'Recebido (manutenção em andamento)' });
  }

  const body = req.body;

  console.log(`[Webhook] Recebido: method=POST status=${body.status} test=${body.test} tracking=${body.shipping?.tracking_code || 'nenhum'}`);

  // Responde ao teste da payt com sucesso
  if (body.test === true) {
    return res.json({ success: true, message: 'Webhook recebido com sucesso' });
  }

  const trackingCode = body.shipping?.tracking_code;

  // Sem código de rastreio ainda (ex: pedido em waiting_payment) — só confirma recebimento
  if (!trackingCode) {
    console.log(`[Webhook] Pedido ${body.transaction_id} sem tracking_code ainda (status: ${body.status})`);
    return res.json({ message: 'Recebido, sem tracking_code para processar' });
  }

  const code = trackingCode.trim().toUpperCase();
  const customer = body.customer || {};

  // Extrai nome da empresa pelo commission onde type = 'producer'
  const commissions = Array.isArray(body.commission) ? body.commission : [];
  const producer = commissions.find(c => c.type === 'producer');
  const company_name = producer?.name || null;
  const seller_id = body.seller_id || null;

  res.json({ message: 'Recebido, processando...', tracking_code: code });

  // Processa em background
  try {
    await processTracking({
      tracking_code: code,
      order_id: body.transaction_id || null,
      seller_id,
      company_name,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customer.phone || null,
    });
  } catch (err) {
    console.error(`[Webhook] Erro ao processar ${code}:`, err.message);
  }
});

async function processTracking(data) {
  console.log(`[Webhook] Processando: ${data.tracking_code}`);

  // Salva/atualiza no banco com status pendente
  await Shipment.upsert({ ...data, status: 'pending' });

  // Consulta nos Correios e atualiza
  try {
    const tracking = await queryTracking(data.tracking_code);

    await Shipment.upsert({
      ...data,
      status: tracking.status,
      last_event: tracking.last_event,
      last_event_date: tracking.last_event_date,
    });

    if (tracking.events?.length) {
      await Shipment.saveEvents(data.tracking_code, tracking.events);
    }

    console.log(`[Webhook] ${data.tracking_code} → ${tracking.status}`);
  } catch (err) {
    console.error(`[Webhook] Falha Correios para ${data.tracking_code}:`, err.message);
  }
}

module.exports = router;

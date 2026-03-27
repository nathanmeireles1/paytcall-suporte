const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');

/**
 * POST /webhook
 * Recebe notificações da payt.com.br
 * Salva dados do pedido — NÃO consulta Correios aqui (feito pelo scheduler)
 */

// GET /webhook — responde para testes de disponibilidade
router.get('/', (req, res) => {
  res.json({ success: true, message: 'Webhook ativo' });
});

router.post('/', async (req, res) => {
  const body = req.body;

  console.log(`[Webhook] Recebido: status=${body.status} test=${body.test} tracking=${body.shipping?.tracking_code || 'nenhum'}`);

  // Responde ao teste da payt com sucesso imediatamente
  if (body.test === true) {
    return res.json({ success: true, message: 'Webhook recebido com sucesso' });
  }

  // Ignora webhooks históricos — só processa a partir de 26/03/2026
  const WEBHOOK_START_DATE = new Date('2026-03-26T00:00:00Z');
  const rawDate = body.started_at || body.transaction?.created_at || body.updated_at;
  const webhookDate = rawDate ? new Date(rawDate) : null;
  if (webhookDate && webhookDate < WEBHOOK_START_DATE) {
    return res.json({ message: 'Ignorado: webhook histórico' });
  }

  const trackingCode = body.shipping?.tracking_code;

  // Sem código de rastreio — confirma recebimento mas não processa
  if (!trackingCode) {
    return res.json({ message: 'Recebido, sem tracking_code para processar' });
  }

  const code = trackingCode.trim().toUpperCase();
  const carrier = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code) ? 'Correios' : 'Loggi';
  const customer = body.customer || {};
  const commissions = Array.isArray(body.commission) ? body.commission : [];
  const producer = commissions.find(c => c.type === 'producer');
  const transaction = body.transaction || {};
  const product = body.product || {};
  const shippingAddress = body.shipping?.address || null;

  // Responde imediatamente para a payt não fazer retry
  res.json({ message: 'Recebido', tracking_code: code });

  // Salva dados do pedido sem sobrescrever status dos Correios
  try {
    await Shipment.upsertFromPaytcall({
      tracking_code: code,
      carrier,
      order_id: body.transaction_id || null,
      seller_id: body.seller_id || null,
      company_name: producer?.name || null,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customer.phone || null,
      customer_doc: customer.doc || null,
      product_name: product.name || null,
      product_price: product.price || null,
      product_quantity: product.quantity || null,
      payment_method: transaction.payment_method || null,
      payment_status: transaction.payment_status || null,
      total_price: transaction.total_price || null,
      shipping_address: shippingAddress,
    });
    console.log(`[Webhook] Salvo: ${code}`);
  } catch (err) {
    console.error(`[Webhook] Erro ao salvar ${code}:`, err.message);
  }
});

module.exports = router;

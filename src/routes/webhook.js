const express = require('express');
const router = express.Router();
const Shipment = require('../models/Shipment');

/**
 * POST /webhook
 * Recebe notificações da payt.com.br (payment status)
 * Rastreio 100% via H7 (scheduler 09h e 15h BRT)
 */

// GET /webhook — responde para testes de disponibilidade
router.get('/', (req, res) => {
  res.json({ success: true, message: 'Webhook ativo' });
});

router.post('/', async (req, res) => {
  const body = req.body;

  console.log(`[Webhook] Recebido: status=${body.status} test=${body.test} order=${body.transaction_id || '-'}`);

  // Responde ao teste da payt com sucesso imediatamente
  if (body.test === true) {
    return res.json({ success: true, message: 'Webhook recebido com sucesso' });
  }

  // Aceita apenas: pago, chargebacks e reembolsos (conforme docs Payt)
  const ACCEPTED_STATUSES = [
    'paid',                           // Pagamento Aprovado
    'chargeback_presented',           // Chargeback Apresentado
    'chargeback',                     // Chargeback
    'one_click_buy_refunded',         // Upsell Estornado
    'refunded',                       // Pagamento Estornado
    'one_click_buy_refunded_partial', // Upsell Reembolsado Parcial
    'refunded_partial',               // Pagamento Reembolsado Parcial
  ];
  if (body.status && !ACCEPTED_STATUSES.includes(body.status)) {
    return res.json({ message: `Ignorado: status '${body.status}' não processado` });
  }

  // Ignora webhooks históricos — só processa a partir de 26/03/2026
  const WEBHOOK_START_DATE = new Date('2026-03-26T00:00:00Z');
  const rawDate = body.started_at || body.transaction?.created_at || body.updated_at;
  const webhookDate = rawDate ? new Date(rawDate) : null;
  if (webhookDate && webhookDate < WEBHOOK_START_DATE) {
    return res.json({ message: 'Ignorado: webhook histórico' });
  }

  const customer = body.customer || {};
  const commissions = Array.isArray(body.commission) ? body.commission : [];
  const producer = commissions.find(c => c.type === 'producer');
  const transaction = body.transaction || {};
  const product = body.product || {};
  const trackingCode = body.shipping?.tracking_code;
  const shippingAddress = body.shipping?.address || null;
  const trackingUrl = body.shipping?.tracking_url || null;
  const orderId = body.transaction_id || null;

  const paidAt = body.status === 'paid'
    ? (body.started_at || body.transaction?.created_at || body.updated_at || null)
    : null;

  const orderData = {
    order_id:         orderId,
    seller_id:        body.seller_id || null,
    seller_email:     body.seller_email || null,
    company_name:     producer?.name || null,
    customer_name:    customer.name || null,
    customer_email:   customer.email || null,
    customer_phone:   customer.phone || null,
    customer_doc:     customer.doc || null,
    product_name:     product.name || null,
    product_price:    product.price || null,
    product_quantity: product.quantity || null,
    payment_method:   transaction.payment_method || null,
    payment_status:   body.status || transaction.payment_status || null,
    total_price:      transaction.total_price || null,
    shipping_address: shippingAddress,
    tracking_url:     trackingUrl,
    paid_at:          paidAt,
  };

  // Responde imediatamente para a payt não fazer retry
  res.json({ message: 'Recebido', order_id: orderId });

  try {
    const isChargeback = ['chargeback_presented', 'chargeback'].includes(body.status);
    const isRefund = ['one_click_buy_refunded', 'refunded', 'one_click_buy_refunded_partial', 'refunded_partial'].includes(body.status);

    if (isChargeback || isRefund) {
      // Atualiza payment_status no pedido existente pelo order_id
      await Shipment.updatePaymentStatus(orderId, body.status);
      console.log(`[Webhook] payment_status atualizado: order=${orderId} → ${body.status}`);
      return;
    }

    // status = 'paid'
    if (trackingCode) {
      // Já tem código de rastreio — salva direto na tabela principal
      const code = trackingCode.trim().toUpperCase();
      const carrier = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code) ? 'Correios' : 'Loggi';
      await Shipment.upsertFromPaytcall({ tracking_code: code, carrier, ...orderData });
      console.log(`[Webhook] Salvo com tracking: ${code}`);
    } else if (customer.doc) {
      // Sem código de rastreio ainda — guarda na fila para o scheduler H7 encontrar
      await Shipment.enqueueCustomer(orderData);
      console.log(`[Webhook] CPF enfileirado para H7: order=${orderId}`);
    } else {
      console.log(`[Webhook] Ignorado: paid sem tracking_code e sem CPF — order=${orderId}`);
    }
  } catch (err) {
    console.error(`[Webhook] Erro ao processar order=${orderId}:`, err.message);
  }
});

module.exports = router;

const cron = require('node-cron');
const Shipment = require('../models/Shipment');
const { queryH7ByCpf } = require('./haga7');
// correios.js mantido como backup — não usado no scheduler por ora

/**
 * Scheduler — consulta H7 (Correios + Loggi via CPF) 2x ao dia
 * 09:00 e 15:00 horário de Brasília
 */
function startScheduler() {
  cron.schedule('0 9,15 * * *', async () => {
    console.log('[Scheduler] Iniciando atualização via H7...');
    await refreshPendingShipments();
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[Scheduler] Agendado: consulta H7 às 09:00 e 15:00 (horário de Brasília)');
}

async function refreshPendingShipments() {
  const [pending, queue] = await Promise.all([
    Shipment.getPendingForRefresh(),
    Shipment.getCustomerQueue(),
  ]);

  // Monta mapa CPF → shipments ativos
  const cpfMap = {};
  for (const s of pending) {
    if (!cpfMap[s.customer_doc]) cpfMap[s.customer_doc] = { shipments: [], queued: [] };
    cpfMap[s.customer_doc].shipments.push(s);
  }

  // Adiciona CPFs da fila (paid sem tracking_code)
  for (const q of queue) {
    if (!cpfMap[q.customer_doc]) cpfMap[q.customer_doc] = { shipments: [], queued: [] };
    cpfMap[q.customer_doc].queued.push(q);
  }

  const totalCpfs = Object.keys(cpfMap).length;
  console.log(`[Scheduler] ${pending.length} rastreios ativos + ${queue.length} na fila → ${totalCpfs} CPFs únicos`);

  if (totalCpfs === 0) {
    console.log('[Scheduler] Nenhum CPF para consultar');
    return;
  }

  let updated = 0;
  let promoted = 0;
  let errors = 0;

  for (const [cpf, { shipments, queued }] of Object.entries(cpfMap)) {
    try {
      const tracking = await queryH7ByCpf(cpf);

      // Atualiza rastreios já existentes na tabela principal
      for (const shipment of shipments) {
        await Shipment.upsert({
          ...shipment,
          status: tracking.status,
          last_event: tracking.last_event,
          last_event_date: tracking.last_event_date,
        });
        if (tracking.events?.length) await Shipment.saveEvents(shipment.tracking_code, tracking.events);
        const tag = tracking.hasData ? '' : ' [sem rastreio]';
        console.log(`[H7] ${shipment.tracking_code} (CPF ${cpf.slice(0, 3)}***): ${shipment.status} → ${tracking.status}${tag}`);
        updated++;
      }

      // Pedidos na fila: se H7 retornou um código real, promove para shipments
      if (queued.length && tracking.loggi_code) {
        const code = tracking.loggi_code.trim().toUpperCase();
        const carrier = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code) ? 'Correios' : 'Loggi';

        for (const q of queued) {
          await Shipment.upsertFromPaytcall({
            tracking_code: code,
            carrier,
            status: tracking.status,
            last_event: tracking.last_event,
            last_event_date: tracking.last_event_date,
            order_id: q.order_id,
            seller_id: q.seller_id,
            company_name: q.company_name,
            customer_name: q.customer_name,
            customer_email: q.customer_email,
            customer_phone: q.customer_phone,
            customer_doc: q.customer_doc,
            product_name: q.product_name,
            product_price: q.product_price,
            product_quantity: q.product_quantity,
            payment_method: q.payment_method,
            payment_status: q.payment_status,
            total_price: q.total_price,
            shipping_address: q.shipping_address,
          });
          if (tracking.events?.length) await Shipment.saveEvents(code, tracking.events);
          await Shipment.dequeueCustomer(q.order_id);
          console.log(`[H7] Fila → Rastreio: CPF ${cpf.slice(0, 3)}*** | order=${q.order_id} → ${code} (${tracking.status})`);
          promoted++;
        }
      }

      await sleep(400);
    } catch (err) {
      console.error(`[H7] Erro no CPF ${cpf.slice(0, 3)}***:`, err.message);
      errors += (shipments.length + queued.length);
    }
  }

  console.log(`[Scheduler] Concluído: ${updated} atualizados, ${promoted} promovidos da fila, ${errors} erros`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler, refreshPendingShipments };

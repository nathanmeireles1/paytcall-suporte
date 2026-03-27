const cron = require('node-cron');
const Shipment = require('../models/Shipment');
const { queryH7ByCpf } = require('./haga7');

/**
 * Scheduler — consulta H7 2x ao dia (08:00 e 14:00 BRT)
 * Resultados prontos às 09:00 e 15:00 BRT
 */
function startScheduler() {
  cron.schedule('0 8,14 * * *', async () => {
    console.log('[Scheduler] Iniciando atualização via H7...');
    await refreshPendingShipments();
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[Scheduler] Agendado: 08:00 e 14:00 BRT');
}

async function refreshPendingShipments() {
  const [pending, queue] = await Promise.all([
    Shipment.getPendingForRefresh(),
    Shipment.getCustomerQueue(),
  ]);

  const cpfMap = {};
  for (const s of pending) {
    if (!cpfMap[s.customer_doc]) cpfMap[s.customer_doc] = { shipments: [], queued: [] };
    cpfMap[s.customer_doc].shipments.push(s);
  }
  for (const q of queue) {
    if (!cpfMap[q.customer_doc]) cpfMap[q.customer_doc] = { shipments: [], queued: [] };
    cpfMap[q.customer_doc].queued.push(q);
  }

  const totalCpfs = Object.keys(cpfMap).length;
  console.log(`[Scheduler] ${pending.length} rastreios + ${queue.length} na fila → ${totalCpfs} CPFs únicos`);

  if (totalCpfs === 0) {
    await Shipment.saveSchedulerLog({ total_cpfs: 0, updated: 0, promoted: 0, errors: 0, pending_after: 0 });
    return;
  }

  let updated = 0, promoted = 0, errors = 0;

  for (const [cpf, { shipments, queued }] of Object.entries(cpfMap)) {
    try {
      const tracking = await queryH7ByCpf(cpf);

      for (const shipment of shipments) {
        await Shipment.upsert({
          ...shipment,
          status:          tracking.status,
          last_event:      tracking.last_event,
          last_event_date: tracking.last_event_date,
          expected_date:   tracking.expected_date || null,
          loggi_code:      tracking.loggi_code    || null,
        });
        if (tracking.events?.length) await Shipment.saveEvents(shipment.tracking_code, tracking.events);
        const tag = tracking.hasData ? '' : ' [sem rastreio]';
        console.log(`[H7] ${shipment.tracking_code} (${cpf.slice(0,3)}***): ${shipment.status} → ${tracking.status}${tag}`);
        updated++;
      }

      if (queued.length && tracking.loggi_code) {
        const code = tracking.loggi_code.trim().toUpperCase();
        const carrier = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code) ? 'Correios' : 'Loggi';
        for (const q of queued) {
          await Shipment.upsertFromPaytcall({
            tracking_code:   code,
            carrier,
            status:          tracking.status,
            last_event:      tracking.last_event,
            last_event_date: tracking.last_event_date,
            expected_date:   tracking.expected_date || null,
            loggi_code:      code,
            ...q,
          });
          if (tracking.events?.length) await Shipment.saveEvents(code, tracking.events);
          await Shipment.dequeueCustomer(q.order_id);
          console.log(`[H7] Fila→Rastreio: ${cpf.slice(0,3)}*** | order=${q.order_id} → ${code}`);
          promoted++;
        }
      }

      await sleep(200);
    } catch (err) {
      console.error(`[H7] Erro CPF ${cpf.slice(0,3)}***:`, err.message);
      errors += (cpfMap[cpf].shipments.length + cpfMap[cpf].queued.length);
    }
  }

  const pending_after = await Shipment.countPendingForRefresh();
  await Shipment.saveSchedulerLog({ total_cpfs: totalCpfs, updated, promoted, errors, pending_after });
  console.log(`[Scheduler] Concluído: ${updated} atualizados, ${promoted} promovidos, ${errors} erros, ${pending_after} ainda ativos`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler, refreshPendingShipments };

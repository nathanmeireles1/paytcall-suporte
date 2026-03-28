const cron = require('node-cron');
const Shipment = require('../models/Shipment');
const { queryH7ByCpf } = require('./haga7');

/**
 * Scheduler — consulta H7 2x ao dia (08:00 e 14:00 BRT)
 * + verificação de rastreios em atraso
 */
function startScheduler() {
  cron.schedule('0 8,14 * * *', async () => {
    console.log('[Scheduler] Iniciando atualização via H7...');
    await refreshPendingShipments();
    console.log('[Scheduler] Verificando rastreios em atraso...');
    await checkTrackingDelays();
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[Scheduler] Agendado: 08:00 e 14:00 BRT');
}

async function refreshPendingShipments() {
  const startedAt = new Date().toISOString();
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
  await Shipment.saveSchedulerLog({ total_cpfs: totalCpfs, updated, promoted, errors, pending_after, started_at: startedAt, finished_at: new Date().toISOString() });
  console.log(`[Scheduler] Concluído: ${updated} atualizados, ${promoted} promovidos, ${errors} erros, ${pending_after} ainda ativos`);
}

/**
 * Verifica rastreios em atraso:
 * - 1 dia após paid_at sem código de rastreio → status "tracking_delayed"
 * - 3 dias após paid_at sem movimentação física → status "tracking_delayed" + abre ticket automático
 */
async function checkTrackingDelays() {
  const now = new Date();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let delayed1 = 0, delayed3 = 0, ticketsCreated = 0;

  // Statuses que indicam movimentação física
  const PHYSICAL_MOVEMENT = ['forwarded', 'delivering', 'delivered', 'posted_object',
    'recipient_not_found', 'returning', 'returned', 'waiting_client', 'wrong_address', 'delivery_problem'];

  // 1) Fila de clientes (sem tracking_code) com paid_at > 1 dia
  try {
    const queue = await Shipment.getCustomerQueue();
    for (const q of queue) {
      if (!q.paid_at) continue;
      const paidAt = new Date(q.paid_at);
      const daysSincePaid = (now - paidAt) / ONE_DAY;

      if (daysSincePaid >= 1) {
        console.log(`[Atraso] Fila sem rastreio há ${Math.floor(daysSincePaid)}d: order=${q.order_id}`);
        delayed1++;
      }
    }
  } catch (err) {
    console.error('[Atraso] Erro ao verificar fila:', err.message);
  }

  // 2) Shipments com paid_at > 3 dias e sem movimentação física
  try {
    const shipments = await Shipment.getShipmentsWithoutMovement();
    for (const s of shipments) {
      if (!s.paid_at) continue;
      const paidAt = new Date(s.paid_at);
      const daysSincePaid = (now - paidAt) / ONE_DAY;

      if (daysSincePaid >= 3 && !PHYSICAL_MOVEMENT.includes(s.status)) {
        // Atualiza status
        await Shipment.updateTrackingDelayed(s.tracking_code);
        delayed3++;
        console.log(`[Atraso] 3+ dias sem movimentação: ${s.tracking_code} (status: ${s.status})`);

        // Abre ticket automático de Logística/Envio se não existir
        const existingTickets = await Shipment.getTickets(s.tracking_code);
        const hasDelayTicket = existingTickets.some(t =>
          t.tipo === 'LOGISTICA' && t.motivo === 'Envio' && !['Concluído'].includes(t.status)
        );
        if (!hasDelayTicket) {
          await Shipment.createTicket({
            tracking_code: s.tracking_code,
            order_id: s.order_id,
            tipo: 'LOGISTICA',
            motivo: 'Envio',
            observacao: `Ticket automático: ${Math.floor(daysSincePaid)} dias após pagamento sem movimentação física do produto.`,
            created_by: 'Sistema',
          });
          ticketsCreated++;
          console.log(`[Atraso] Ticket automático criado: ${s.tracking_code}`);
        }
      }
    }
  } catch (err) {
    console.error('[Atraso] Erro ao verificar shipments:', err.message);
  }

  console.log(`[Atraso] Resumo: ${delayed1} sem rastreio (>1d), ${delayed3} sem movimentação (>3d), ${ticketsCreated} tickets criados`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler, refreshPendingShipments };

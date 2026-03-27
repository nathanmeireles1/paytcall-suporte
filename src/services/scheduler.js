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
  const pending = await Shipment.getPendingForRefresh();

  if (pending.length === 0) {
    console.log('[Scheduler] Nenhum rastreio ativo para atualizar');
    return;
  }

  // Agrupa por CPF — evita consultas duplicadas ao H7 para o mesmo cliente
  const cpfMap = {};
  for (const s of pending) {
    if (!s.customer_doc) continue;
    if (!cpfMap[s.customer_doc]) cpfMap[s.customer_doc] = [];
    cpfMap[s.customer_doc].push(s);
  }

  const totalCpfs = Object.keys(cpfMap).length;
  const semCpf = pending.filter(s => !s.customer_doc).length;
  console.log(`[Scheduler] ${pending.length} rastreios → ${totalCpfs} CPFs únicos (${semCpf} sem CPF, ignorados)`);

  let updated = 0;
  let errors = 0;

  for (const [cpf, shipments] of Object.entries(cpfMap)) {
    try {
      const tracking = await queryH7ByCpf(cpf);
      for (const shipment of shipments) {
        await Shipment.upsert({
          ...shipment,
          status: tracking.status,
          last_event: tracking.last_event,
          last_event_date: tracking.last_event_date,
        });
        if (tracking.events?.length) await Shipment.saveEvents(shipment.tracking_code, tracking.events);
        console.log(`[H7] ${shipment.tracking_code} (CPF ${cpf.slice(0, 3)}***): ${shipment.status} → ${tracking.status}`);
        updated++;
      }
      await sleep(400);
    } catch (err) {
      console.error(`[H7] Erro no CPF ${cpf.slice(0, 3)}***:`, err.message);
      errors += shipments.length;
    }
  }

  console.log(`[Scheduler] Concluído: ${updated} atualizados, ${errors} erros`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler, refreshPendingShipments };

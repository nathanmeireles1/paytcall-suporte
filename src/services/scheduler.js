const cron = require('node-cron');
const Shipment = require('../models/Shipment');
const { queryTracking } = require('./correios');
const { queryH7ByCpf } = require('./haga7');

/**
 * Scheduler — consulta Correios/H7 a cada 5 dias por rastreio
 * Roda a cada 6h para verificar quais pedidos estão prontos para atualização
 */
function startScheduler() {
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Verificando rastreios pendentes de atualização...');
    await refreshPendingShipments();
  });

  console.log('[Scheduler] Agendado: verificação a cada 6h (atualiza rastreios com 5+ dias sem consulta)');
}

async function refreshPendingShipments() {
  const pending = await Shipment.getPendingForRefresh();

  if (pending.length === 0) {
    console.log('[Scheduler] Nenhum rastreio pendente para atualizar');
    return;
  }

  const correios = pending.filter(s => s.carrier === 'Correios');
  const loggi = pending.filter(s => s.carrier !== 'Correios' && s.customer_doc);

  console.log(`[Scheduler] Atualizando ${correios.length} Correios + ${loggi.length} Loggi/H7...`);

  let updated = 0;
  let errors = 0;

  // Correios
  for (const shipment of correios) {
    try {
      const tracking = await queryTracking(shipment.tracking_code);
      await Shipment.upsert({ ...shipment, status: tracking.status, last_event: tracking.last_event, last_event_date: tracking.last_event_date });
      if (tracking.events?.length) await Shipment.saveEvents(shipment.tracking_code, tracking.events);
      console.log(`[Correios] ${shipment.tracking_code}: ${shipment.status} → ${tracking.status}`);
      updated++;
      await sleep(800);
    } catch (err) {
      console.error(`[Correios] Erro em ${shipment.tracking_code}:`, err.message);
      errors++;
    }
  }

  // H7/Loggi — agrupa por CPF para evitar consultas duplicadas
  const cpfMap = {};
  for (const s of loggi) {
    if (!cpfMap[s.customer_doc]) cpfMap[s.customer_doc] = [];
    cpfMap[s.customer_doc].push(s);
  }

  for (const [cpf, shipments] of Object.entries(cpfMap)) {
    try {
      const tracking = await queryH7ByCpf(cpf);
      for (const shipment of shipments) {
        await Shipment.upsert({ ...shipment, status: tracking.status, last_event: tracking.last_event, last_event_date: tracking.last_event_date });
        if (tracking.events?.length) await Shipment.saveEvents(shipment.tracking_code, tracking.events);
        console.log(`[H7] ${shipment.tracking_code} (CPF ${cpf.slice(0,3)}***): ${shipment.status} → ${tracking.status}`);
        updated++;
      }
      await sleep(500);
    } catch (err) {
      console.error(`[H7] Erro no CPF ${cpf.slice(0,3)}***:`, err.message);
      errors += shipments.length;
    }
  }

  console.log(`[Scheduler] Concluído: ${updated} atualizados, ${errors} erros`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler, refreshPendingShipments };

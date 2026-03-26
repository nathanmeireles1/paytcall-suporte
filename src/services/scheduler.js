const cron = require('node-cron');
const Shipment = require('../models/Shipment');
const { queryTracking } = require('./correios');

/**
 * Atualiza rastreios que ainda não foram finalizados
 * Roda automaticamente a cada 3 horas
 */
function startScheduler() {
  // Executa a cada 3 horas: minuto 0, a cada 3 horas
  cron.schedule('0 */3 * * *', async () => {
    console.log('[Scheduler] Iniciando atualização automática de rastreios...');
    await refreshPendingShipments();
  });

  console.log('[Scheduler] Agendado: atualização automática a cada 3 horas');
}

async function refreshPendingShipments() {
  const pending = await Shipment.getPendingForRefresh();

  if (pending.length === 0) {
    console.log('[Scheduler] Nenhum rastreio pendente para atualizar');
    return;
  }

  console.log(`[Scheduler] Atualizando ${pending.length} rastreio(s)...`);

  let updated = 0;
  let errors = 0;

  for (const shipment of pending) {
    try {
      const tracking = await queryTracking(shipment.tracking_code);

      await Shipment.upsert({
        tracking_code: shipment.tracking_code,
        order_id: shipment.order_id,
        seller_id: shipment.seller_id,
        company_name: shipment.company_name,
        customer_name: shipment.customer_name,
        customer_email: shipment.customer_email,
        customer_phone: shipment.customer_phone,
        status: tracking.status,
        last_event: tracking.last_event,
        last_event_date: tracking.last_event_date,
      });

      if (tracking.events?.length) {
        await Shipment.saveEvents(shipment.tracking_code, tracking.events);
      }

      console.log(`[Scheduler] ${shipment.tracking_code} → ${tracking.status}`);
      updated++;

      // Pequena pausa para não sobrecarregar a API da Wonca
      await sleep(500);
    } catch (err) {
      console.error(`[Scheduler] Erro em ${shipment.tracking_code}:`, err.message);
      errors++;
    }
  }

  console.log(`[Scheduler] Concluído: ${updated} atualizados, ${errors} erros`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler, refreshPendingShipments };

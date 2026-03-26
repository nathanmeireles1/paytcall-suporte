const cron = require('node-cron');
const Shipment = require('../models/Shipment');
const { queryTracking } = require('./correios');

/**
 * Scheduler — consulta Correios a cada 5 dias por rastreio
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

      const log = tracking.status !== shipment.status
        ? `${shipment.tracking_code}: ${shipment.status} → ${tracking.status}`
        : `${shipment.tracking_code}: sem mudança (${tracking.status})`;
      console.log(`[Scheduler] ${log}`);
      updated++;

      // Pausa entre consultas para não sobrecarregar a API
      await sleep(800);
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

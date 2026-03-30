const axios = require('axios');

const H7_API_URL = 'https://api.haga7digital.com.br/tracking-order';

/**
 * Consulta rastreamento H7/Loggi pelo CPF do cliente
 * @param {string} cpf - CPF do cliente (11 dígitos)
 * @returns {Object} Dados de rastreamento normalizados
 */
async function queryH7ByCpf(cpf) {
  const cleanCpf = cpf.replace(/\D/g, '');

  try {
    const response = await axios.post(
      H7_API_URL,
      { cpf: cleanCpf },
      {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        timeout: 15000,
      }
    );

    if (response.data?.message) {
      throw new Error(`H7 API: ${response.data.message}`);
    }

    return parseH7Response(response.data);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    throw new Error(`Falha ao consultar H7: ${msg}`);
  }
}

function parseH7Response(data) {
  const events = (data.events || []).map(ev => ({
    date: ev.status_created_at || '',
    description: ev.description || '',
    detail: ev.descriptionCompl || '',
    location: ev.address || '',
    status_code: ev.step || '',
  }));

  const latest = events[0] || {};
  const hasData = events.length > 0 || data.info?.trackingCode;

  return {
    status: hasData ? mapH7Status(latest.description) : 'no_tracking',
    last_event: hasData ? (latest.detail || latest.description || '') : 'Sem rastreio gerado',
    last_event_date: latest.date || '',
    loggi_code: data.info?.trackingCode || null,
    expected_date: data.info?.expected_date || null,
    events,
    hasData,
  };
}

// Mapeamento baseado nos 30 status oficiais da Loggi (Shipper Status V2)
// https://docs.api.loggi.com/reference/trackingapi
function mapH7Status(desc) {
  if (!desc) return 'forwarded';
  const val = desc.toUpperCase();

  // --- Terminal: entregue ao destinatário ---
  // "Entregue a transportadora" (status 30) NÃO é entrega final — checar antes
  if (val.includes('ENTREGUE A TRANSPORTADORA')) return 'forwarded';
  if (val === 'ENTREGUE' || val.includes('ENTREGUE')) return 'delivered'; // status 5

  // --- Terminal: devolvido ---
  if (val.includes('DEVOLVIDO') || val.includes('RETORNADO')) return 'returned'; // status 8

  // --- Saiu para entrega ---
  if (val.includes('EM ROTA')                  // status 11
   || val.includes('SAIU PARA ENTREGA')
   || val.includes('PREPARANDO PARA ENTREGA')) return 'delivering'; // status 4

  // --- Destinatário não encontrado / recusou ---
  if (val.includes('DESTINATÁRIO AUSENTE')      // status 18
   || val.includes('DESTINATARIO AUSENTE')
   || val.includes('RECUSADO PELO DESTINAT')    // status 6
   || val.includes('TENTATIVA')) return 'recipient_not_found';

  // --- Devolução em andamento ---
  if (val.includes('DEVOLUÇÃO INICIADA')        // status 7
   || val.includes('DEVOLUCAO INICIADA')
   || val.includes('DEVOLVENDO')
   || val.includes('RETORNO')) return 'returning';

  // --- Problema na entrega ---
  if (val.includes('IMPREVISTO NA ENTREGA')     // status 12
   || val.includes('AVARIADO')                  // status 19
   || val.includes('PENDÊNCIA INTERNA')         // status 20
   || val.includes('PENDENCIA INTERNA')
   || val.includes('EXTRAVIADO')                // status 9
   || val.includes('ROUBADO')                   // status 23
   || val.includes('FURTADO')
   || val.includes('RETIDO PELA')               // status 29
   || val.includes('PROBLEMA')) return 'delivery_problem';

  // --- Endereço errado ---
  if (val.includes('ENDERE')                    // status 21
   || val.includes('DADOS INCORRETOS')          // status 26
   || val.includes('DADOS INCORRETOS OU INV')
   || val.includes('AGUARDANDO AÇÃO DO REMETENTE')   // status 22
   || val.includes('AGUARDANDO ACAO DO REMETENTE')) return 'wrong_address';

  // --- Aguardando retirada ---
  if (val.includes('RETIRAR NOS CORREIOS')) return 'waiting_client'; // status 10

  // --- Postado / coletado (etapa inicial) ---
  if (val.includes('ADICIONADO NO SISTEMA')     // status 1
   || val.includes('COLETADO')                  // status 14
   || val.includes('COLETA PENDENTE')) return 'posted_object'; // status 28

  // --- Em trânsito (padrão para tudo mais) ---
  // status 3,13,15,16,17,24,25 = bases, transferências, medições = em trânsito
  return 'forwarded';
}

module.exports = { queryH7ByCpf };

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

function mapH7Status(desc) {
  if (!desc) return 'forwarded';
  const val = desc.toUpperCase();

  if (val.includes('ENTREGUE')) return 'delivered';
  if (val.includes('EM ROTA') || val.includes('SAIU PARA ENTREGA')) return 'delivering';
  if (val.includes('TENTATIVA')) return 'recipient_not_found';
  if (val.includes('DEVOLVIDO') || val.includes('RETORNADO')) return 'returned';
  if (val.includes('DEVOLVENDO') || val.includes('RETORNO')) return 'returning';
  if (val.includes('ADICIONADO NO SISTEMA') || val.includes('COLETADO')) return 'posted_object';
  if (val.includes('ENDERE')) return 'wrong_address';
  if (val.includes('PROBLEMA')) return 'delivery_problem';

  return 'forwarded';
}

module.exports = { queryH7ByCpf };

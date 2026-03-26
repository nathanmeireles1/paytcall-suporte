const axios = require('axios');

// Wonca Labs API — rastreamento dos Correios sem bloqueio/captcha
const WONCA_API_URL = 'https://api-labs.wonca.com.br/wonca.labs.v1.LabsService/Track';

/**
 * Consulta rastreamento via Wonca Labs
 * @param {string} trackingCode - Código de rastreio (ex: AA361812099BR)
 * @returns {Object} Dados de rastreamento normalizados
 */
async function queryTracking(trackingCode) {
  const code = trackingCode.trim().toUpperCase();
  const apiKey = process.env.WONCA_API_KEY;

  if (!apiKey) {
    throw new Error('WONCA_API_KEY não configurada no .env');
  }

  try {
    const response = await axios.post(
      WONCA_API_URL,
      { code },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Apikey ${apiKey}`,
        },
        timeout: 15000,
      }
    );

    return parseWoncaResponse(code, response.data);
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    console.error(`[Wonca] Erro ao rastrear ${code} (HTTP ${status}):`, msg);
    throw new Error(`Falha ao consultar rastreamento: ${msg}`);
  }
}

function parseWoncaResponse(code, data) {
  // A Wonca retorna os dados em data.json como string — precisa de JSON.parse
  let parsed = data;
  if (typeof data.json === 'string') {
    try {
      parsed = JSON.parse(data.json);
    } catch (e) {
      console.error('[Wonca] Falha ao parsear data.json:', e.message);
    }
  }

  const eventos = parsed.eventos || parsed.events || [];

  const events = (Array.isArray(eventos) ? eventos : [eventos]).map((ev) => {
    const cidade = ev.unidade?.endereco?.cidade || '';
    const uf = ev.unidade?.endereco?.uf || '';
    const location = [cidade, uf].filter(Boolean).join(' - ');

    return {
      date: ev.dtHrCriado?.date || ev.dtHrCriado || '',
      description: ev.descricao || ev.description || '',
      detail: ev.detalhe || ev.descricaoFrontEnd || '',
      location,
      status_code: ev.codigo || ev.tipo || '',
    };
  });

  const latest = events[0] || {};

  return {
    tracking_code: parsed.codObjeto || code,
    status: mapStatus(latest.description || latest.status_code),
    last_event: latest.detail || latest.description || '',
    last_event_date: latest.date || '',
    events,
  };
}

/**
 * Mapeia o texto do evento dos Correios (via Wonca) para os status da payt.
 * Referência: docs/payt-postback.md
 *
 * Status payt usados aqui:
 *   waiting_client  → Objeto aguardando retirada do cliente  ⚠️ payt para de notificar aqui
 *   delivered       → Entrega Realizada
 *   delivering      → Saiu para entrega
 *   recipient_not_found → Destinatário não encontrado / tentativa
 *   returned        → Devolvido
 *   returning       → Devolvendo ao Remetente
 *   forwarded       → Encaminhado (em trânsito)
 *   posted_object   → Objeto Postado
 *   overdue         → Em Atraso / Prazo expirado
 *   delivery_problem → Problema na Entrega
 */
function mapStatus(desc) {
  if (!desc) return 'forwarded';
  const val = desc.toUpperCase();

  if (val.includes('ENTREGUE') || val.includes('DELIVERED')) return 'delivered';
  if (val.includes('TENTATIVA') || val.includes('AUSENTE')) return 'recipient_not_found';
  if (val.includes('DEVOLVIDO') || val.includes('DEVOLU')) return 'returned';
  if (val.includes('DEVOLVENDO') || val.includes('RETORNO AO')) return 'returning';
  if (val.includes('SAIU') || val.includes('DISTRIBUI') || val.includes('OUT FOR DELIVERY')) return 'delivering';
  if (val.includes('RETIRADA') || val.includes('DISPONIVEL') || val.includes('DISPONÍVEL') || val.includes('AGUARDANDO CLIENTE')) return 'waiting_client';
  if (val.includes('POSTADO') || val.includes('POSTED')) return 'posted_object';
  if (val.includes('ENCAMINH') || val.includes('IN TRANSIT') || val.includes('TRANSPORTE')) return 'forwarded';
  if (val.includes('EXPIRADA') || val.includes('PRAZO') || val.includes('EXPIRED') || val.includes('ATRASO')) return 'overdue';
  if (val.includes('ENDERE') || val.includes('CEP')) return 'wrong_address';

  return 'forwarded';
}

module.exports = { queryTracking };

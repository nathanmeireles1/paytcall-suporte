const axios = require('axios');

// API pública dos Correios (SRO - Sistema de Rastreamento de Objetos)
const CORREIOS_API_URL = 'https://api.correios.com.br/srorastro/v1/objetos';

// Fallback: API token autenticada (conta corporativa)
let authToken = null;
let tokenExpiry = null;

async function getAuthToken() {
  if (!process.env.CORREIOS_USER || !process.env.CORREIOS_PASS) return null;
  if (authToken && tokenExpiry && Date.now() < tokenExpiry) return authToken;

  try {
    const credentials = Buffer.from(
      `${process.env.CORREIOS_USER}:${process.env.CORREIOS_PASS}`
    ).toString('base64');

    const response = await axios.post(
      'https://api.correios.com.br/token/v1/autentica/cartaopostagem',
      {},
      {
        headers: { Authorization: `Basic ${credentials}` },
        timeout: 10000,
      }
    );

    authToken = response.data.token;
    // Token válido por 1 hora (margem de 5 min)
    tokenExpiry = Date.now() + 55 * 60 * 1000;
    return authToken;
  } catch (err) {
    console.error('[Correios] Erro ao obter token:', err.message);
    return null;
  }
}

/**
 * Consulta rastreamento nos Correios
 * @param {string} trackingCode - Código de rastreio (ex: AB123456789BR)
 * @returns {Object} Dados de rastreamento
 */
async function queryTracking(trackingCode) {
  const code = trackingCode.trim().toUpperCase();

  try {
    const token = await getAuthToken();

    if (token) {
      return await queryWithAuth(code, token);
    } else {
      return await queryPublic(code);
    }
  } catch (err) {
    console.error(`[Correios] Erro ao rastrear ${code}:`, err.message);
    throw new Error(`Falha ao consultar Correios: ${err.message}`);
  }
}

async function queryWithAuth(code, token) {
  const response = await axios.get(`${CORREIOS_API_URL}/${code}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    timeout: 15000,
  });

  return parseCorreiosResponse(response.data);
}

// Consulta sem autenticação via API pública
async function queryPublic(code) {
  const response = await axios.get(
    `https://proxyapp.correios.com.br/v1/sro-rastro/${code}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 15000,
    }
  );

  return parseCorreiosResponse(response.data);
}

function parseCorreiosResponse(data) {
  // Normaliza diferentes formatos de resposta da API dos Correios
  const objetos = data.objetos || data.objeto || [data];
  const obj = Array.isArray(objetos) ? objetos[0] : objetos;

  if (!obj) return { status: 'not_found', events: [] };

  const eventos = obj.eventos || obj.evento || [];

  const events = (Array.isArray(eventos) ? eventos : [eventos]).map((ev) => ({
    date: ev.dtHrCriado || ev.data || '',
    description: ev.descricao || ev.descricaoEvento || '',
    location: formatLocation(ev.unidade || ev.cidade),
    status_code: ev.codigo || ev.tipo || '',
  }));

  const latest = events[0] || {};

  return {
    tracking_code: obj.codObjeto || obj.numero || '',
    status: mapStatus(latest.status_code || latest.description),
    last_event: latest.description || '',
    last_event_date: latest.date || '',
    events,
  };
}

function formatLocation(unidade) {
  if (!unidade) return '';
  if (typeof unidade === 'string') return unidade;
  const parts = [unidade.nome, unidade.endereco?.cidade, unidade.endereco?.uf];
  return parts.filter(Boolean).join(' - ');
}

function mapStatus(codeOrDesc) {
  if (!codeOrDesc) return 'in_transit';
  const val = codeOrDesc.toUpperCase();

  if (val.includes('ENTREGUE') || val.includes('BDE') || val.includes('BDI')) return 'delivered';
  if (val.includes('TENTATIVA') || val.includes('AUSENTE')) return 'delivery_attempt';
  if (val.includes('DEVOLVIDO') || val.includes('DEVOLU')) return 'returned';
  if (val.includes('SAIU') || val.includes('DISTRIBUI')) return 'out_for_delivery';
  if (val.includes('AGUARD') || val.includes('POSTADO')) return 'posted';
  if (val.includes('ENCAMINH')) return 'in_transit';

  return 'in_transit';
}

module.exports = { queryTracking };

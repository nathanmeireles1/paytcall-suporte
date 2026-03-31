const { db } = require('../config/database');

const API_KEY  = process.env.AIRTABLE_API_KEY;
const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;

const FIELD_MAP = {
  'Código':                 'codigo',
  'Tipo Venda':             'tipo_venda',
  'Sku':                    'sku',
  'Produto':                'produto',
  'Empresa':                'empresa',
  'Email':                  'email',
  'Status Pagamento':       'status_pagamento',
  'Valor da Venda':         'valor_venda',
  'f. Saldo da Venda':      'saldo_venda',
  'Forma de Pagamento':     'forma_pagamento',
  'Data de aprovação':      'dt_aprovacao',
  'Data de criação':        'dt_criacao',
  'Data de atualização':    'data_atualizacao',
  'Nome':                   'nome_cliente',
  'Telefone':               'telefone',
  'Documento':              'documento',
  'Status de auditoria':    'status_auditoria',
  'Status de atendimento':  'status_atendimento',
  'Status de entrega':      'status_entrega',
  'Rastreio':               'rastreio',
  'Pedido suspenso':        'pedido_suspenso',
  'Motivo do cancelamento': 'motivo_cancelamento',
  'Tipo de cancelamento':   'tipo_cancelamento',
};

const DATE_FIELDS = new Set(['dt_aprovacao', 'dt_criacao', 'data_atualizacao']);
const NUM_FIELDS  = new Set(['valor_venda', 'saldo_venda']);

function mapRecord(fields) {
  const rec = { fonte: 'airtable' };
  for (const [atField, dbField] of Object.entries(FIELD_MAP)) {
    let val = fields[atField];
    if (val === undefined || val === null || val === '') { rec[dbField] = null; continue; }
    if (DATE_FIELDS.has(dbField)) {
      rec[dbField] = String(val).slice(0, 10) || null;
    } else if (NUM_FIELDS.has(dbField)) {
      const n = parseFloat(String(val).replace(',', '.'));
      rec[dbField] = isNaN(n) ? null : n;
    } else if (typeof val === 'number') {
      rec[dbField] = val;
    } else {
      rec[dbField] = String(val).trim() || null;
    }
  }
  return rec;
}

async function fetchPages(params = {}) {
  const headers = { Authorization: `Bearer ${API_KEY}` };
  const records = [];
  let offset = null;

  do {
    // Monta URL manualmente para evitar encoding incorreto de fields[]
    let urlStr = BASE_URL + '?pageSize=100';
    for (const [k, v] of Object.entries(params)) {
      if (k === 'fields') continue; // campos: pega tudo, sem filtro
      urlStr += `&${k}=${encodeURIComponent(v)}`;
    }
    if (offset) urlStr += `&offset=${encodeURIComponent(offset)}`;

    const res  = await fetch(urlStr, { headers });
    const body = await res.text();
    if (!res.ok) throw new Error(`Airtable API error: ${body.slice(0, 200)}`);
    const json = JSON.parse(body);

    records.push(...(json.records || []));
    offset = json.offset || null;

    // respeita rate limit: 5 req/s
    if (offset) await new Promise(r => setTimeout(r, 220));
  } while (offset);

  return records;
}

async function upsertRecords(records) {
  const rows = records.map(r => mapRecord(r.fields)).filter(r => r.codigo);
  if (!rows.length) return 0;

  // dedup dentro do próprio lote
  const deduped = new Map();
  for (const rec of rows) {
    const ex = deduped.get(rec.codigo);
    if (!ex || (rec.data_atualizacao || '') > (ex.data_atualizacao || '')) {
      deduped.set(rec.codigo, rec);
    }
  }
  const unique = Array.from(deduped.values());

  let count = 0;
  const BATCH = 500;
  for (let i = 0; i < unique.length; i += BATCH) {
    const { data, error } = await db.from('vendas')
      .upsert(unique.slice(i, i + BATCH), { onConflict: 'codigo', ignoreDuplicates: false })
      .select('id');
    if (error) console.error('[Airtable] Upsert erro:', error.message);
    else count += (data || []).length;
  }
  return count;
}

// Sync incremental — só registros modificados nos últimos `minutes` minutos
async function syncIncremental(minutes = 10) {
  if (!API_KEY) return;
  try {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const formula = `IS_AFTER({Data de atualização}, DATETIME_PARSE('${since}', 'YYYY-MM-DD HH:mm:ss'))`;
    const records = await fetchPages({ filterByFormula: formula });
    if (!records.length) { console.log('[Airtable] Incremental: nenhum registro novo'); return; }
    const count = await upsertRecords(records);
    console.log(`[Airtable] Incremental: ${count} registros atualizados`);
  } catch (err) {
    console.error('[Airtable] Erro incremental:', err.message);
  }
}

// Full sync — busca todos os registros da tabela
async function syncFull() {
  if (!API_KEY) return;
  try {
    console.log('[Airtable] Full sync iniciando...');
    const records = await fetchPages({});
    const count = await upsertRecords(records);
    console.log(`[Airtable] Full sync: ${count} registros de ${records.length} processados`);
  } catch (err) {
    console.error('[Airtable] Erro full sync:', err.message);
  }
}

module.exports = { syncIncremental, syncFull };

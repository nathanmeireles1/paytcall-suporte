/**
 * Importação de pedidos da planilha Paytcall para o banco.
 * Uso: node scripts/import_planilha.js <arquivo.xlsx> "<Empresa>" [SELLER_ID]
 *
 * Exemplos:
 *   node scripts/import_planilha.js vendas.xlsx "Nutravita" NUTRAVITA
 *   node scripts/import_planilha.js vendas.xlsx "Fly Now" FLYNOW
 *
 * - Upsert em shipments (com rastreio) ou customer_queue (sem rastreio)
 * - Conflito por order_id — nunca duplica
 * - Upsells/Upsell Manual linkados ao pedido pai por CPF + VD mais próximo no tempo
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const FILE_PATH    = process.argv[2];
const COMPANY_NAME = process.argv[3] || 'Desconhecida';
const SELLER_ID    = process.argv[4] || COMPANY_NAME.toUpperCase().replace(/\s+/g, '_');

if (!FILE_PATH) {
  console.error('Uso: node scripts/import_planilha.js <arquivo.xlsx> "<Empresa>" [SELLER_ID]');
  process.exit(1);
}

// --- Helpers ---

function mapStatus(statusCompra) {
  const s = (statusCompra || '').toLowerCase();
  if (s.includes('transport'))   return 'in_transit';
  if (s.includes('entregue'))    return 'delivered';
  if (s.includes('devolvido'))   return 'returned';
  if (s.includes('saiu'))        return 'out_for_delivery';
  if (s.includes('tentativa'))   return 'delivery_attempt';
  return 'pending';
}

function detectCarrier(trackingCode) {
  if (!trackingCode) return null;
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode) ? 'Correios' : 'Loggi';
}

function parsePrice(val) {
  if (!val) return null;
  const cleaned = String(val).replace(/[R$\s]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.round(n * 100);
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const [datePart, timePart] = String(val).split(' ');
  const [d, m, y] = datePart.split('/');
  if (!y) return null;
  return `${y}-${m}-${d}T${timePart || '00:00:00'}.000Z`;
}

function getSaleType(tipoVenda) {
  const t = (tipoVenda || '').toLowerCase();
  if (t === 'upsell manual') return 'upsell_manual';
  if (t === 'upsell')        return 'upsell';
  if (t === 'venda manual')  return 'venda_manual';
  return 'venda_direta';
}

function isUpsellType(saleType) {
  return saleType === 'upsell' || saleType === 'upsell_manual';
}

async function upsertBatch(table, batch, conflictCol, stats) {
  const { error } = await db.from(table).upsert(batch, {
    onConflict: conflictCol,
    ignoreDuplicates: false,
  });
  if (error) {
    console.error(`\nErro no upsert (${table}):`, error.message);
    stats.errors += batch.length;
  } else {
    if (table === 'shipments') stats.shipments += batch.length;
    else stats.queue += batch.length;
  }
}

async function main() {
  console.log(`Arquivo:  ${FILE_PATH}`);
  console.log(`Empresa:  ${COMPANY_NAME}`);
  console.log(`SellerID: ${SELLER_ID}`);
  console.log('---');

  const wb = XLSX.readFile(FILE_PATH, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  console.log(`Total de linhas: ${rows.length}`);

  // Categorize rows
  const vdRows     = rows.filter(r => !isUpsellType(getSaleType(r['Tipo Venda'])));
  const upsellRows = rows.filter(r =>  isUpsellType(getSaleType(r['Tipo Venda'])));

  const typeCounts = {};
  rows.forEach(r => { const t = r['Tipo Venda'] || 'null'; typeCounts[t] = (typeCounts[t]||0)+1; });
  console.log('Tipos:', JSON.stringify(typeCounts));

  // Build CPF → [VD/Manual orders] map for upsell parent matching
  const vdByCpf = {};
  for (const row of vdRows) {
    const cpf = row['Documento'] ? String(row['Documento']).replace(/\D/g, '') : null;
    if (!cpf) continue;
    if (!vdByCpf[cpf]) vdByCpf[cpf] = [];
    vdByCpf[cpf].push({ code: row['Código'], date: parseDate(row['Data']) });
  }

  function findParentId(cpf, upsellDateStr) {
    const candidates = vdByCpf[cpf];
    if (!candidates) return null;
    const upsellTs = upsellDateStr ? new Date(upsellDateStr).getTime() : Infinity;
    const before = candidates
      .filter(c => c.date && new Date(c.date).getTime() <= upsellTs)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return before[0]?.code || candidates[0]?.code || null;
  }

  const stats = { shipments: 0, queue: 0, errors: 0 };
  const BATCH = 50;
  let shipmentsBatch = [], queueBatch = [];
  const now = new Date().toISOString();

  const allRows = [...vdRows, ...upsellRows];

  for (const row of allRows) {
    const orderId    = row['Código'] || null;
    const trackingRaw = row['Código de Rastreio'];
    const tracking   = trackingRaw ? String(trackingRaw).trim().toUpperCase() : null;
    const cpf        = row['Documento'] ? String(row['Documento']).replace(/\D/g, '') : null;
    const dateStr    = parseDate(row['Data']);
    const saleType   = getSaleType(row['Tipo Venda']);
    const parentId   = isUpsellType(saleType) && cpf ? findParentId(cpf, dateStr) : null;

    const base = {
      order_id:         orderId,
      seller_id:        SELLER_ID,
      seller_email:     null,
      company_name:     COMPANY_NAME,
      customer_name:    row['Cliente']   || null,
      customer_email:   row['Email']     || null,
      customer_phone:   row['Telefone']  ? String(row['Telefone']) : null,
      customer_doc:     cpf              || null,
      product_name:     row['Produto']   || null,
      product_price:    parsePrice(row['Preço do Produto']),
      product_quantity: row['Quantidade de produtos'] ? parseInt(row['Quantidade de produtos']) : null,
      payment_method:   row['Forma de Pagamento'] || null,
      payment_status:   row['Status Pagamento']   || null,
      total_price:      parsePrice(row['Valor da Venda']),
      shipping_address: row['Rua'] ? JSON.stringify({
        street:        row['Rua'],
        street_number: row['Número'] ? String(row['Número']) : null,
        complement:    row['Complemento'] || null,
        district:      row['Bairro']     || null,
        city:          row['Cidade']     || null,
        state:         row['Estado']     || null,
        zipcode:       row['CEP'] ? String(row['CEP']).replace(/\D/g, '') : null,
      }) : null,
      tracking_url:     row['Url de Acompanhamento'] || null,
      paid_at:          dateStr,
      sale_type:        saleType,
      parent_order_id:  parentId,
    };

    if (tracking) {
      shipmentsBatch.push({
        ...base,
        tracking_code: tracking,
        carrier:       detectCarrier(tracking),
        status:        mapStatus(row['Status Compra']),
        updated_at:    now,
      });
      if (shipmentsBatch.length >= BATCH) {
        await upsertBatch('shipments', shipmentsBatch, 'order_id', stats);
        shipmentsBatch = [];
        process.stdout.write(`\r  shipments: ${stats.shipments}  queue: ${stats.queue}  erros: ${stats.errors}   `);
      }
    } else {
      queueBatch.push(base);
      if (queueBatch.length >= BATCH) {
        await upsertBatch('customer_queue', queueBatch, 'order_id', stats);
        queueBatch = [];
        process.stdout.write(`\r  shipments: ${stats.shipments}  queue: ${stats.queue}  erros: ${stats.errors}   `);
      }
    }
  }

  if (shipmentsBatch.length) await upsertBatch('shipments', shipmentsBatch, 'order_id', stats);
  if (queueBatch.length)     await upsertBatch('customer_queue', queueBatch, 'order_id', stats);

  console.log(`\n\nConcluído:`);
  console.log(`  shipments:      ${stats.shipments}`);
  console.log(`  customer_queue: ${stats.queue}`);
  console.log(`  erros:          ${stats.errors}`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});

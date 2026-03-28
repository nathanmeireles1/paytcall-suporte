/**
 * Importação de pedidos da planilha Paytcall para o banco.
 * Uso: node scripts/import_planilha.js <caminho_para_planilha.xlsx>
 *
 * - Upsert em shipments (se tem rastreio) ou customer_queue (sem rastreio)
 * - Conflito resolvido por order_id (nunca duplica)
 * - Upsells linkados ao pedido pai por CPF + pedido VD mais próximo no tempo
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

const FILE_PATH = process.argv[2];
if (!FILE_PATH) {
  console.error('Uso: node scripts/import_planilha.js <arquivo.xlsx>');
  process.exit(1);
}

// --- Status mapping ---
function mapStatus(statusCompra) {
  const s = (statusCompra || '').toLowerCase();
  if (s.includes('transport'))   return 'in_transit';
  if (s.includes('entregue'))    return 'delivered';
  if (s.includes('devolvido'))   return 'returned';
  if (s.includes('saiu'))        return 'out_for_delivery';
  if (s.includes('tentativa'))   return 'delivery_attempt';
  return 'pending';
}

// --- Carrier detection ---
function detectCarrier(trackingCode) {
  if (!trackingCode) return null;
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode) ? 'Correios' : 'Loggi';
}

// --- Parse price: "127,00" or "R$ 99,92" → number ---
function parsePrice(val) {
  if (!val) return null;
  const cleaned = String(val).replace(/[R$\s]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.round(n * 100); // store in cents
}

// --- Parse date: "27/03/2026 23:38:36" → ISO ---
function parseDate(val) {
  if (!val) return null;
  // Excel may return a Date object
  if (val instanceof Date) return val.toISOString();
  const [datePart, timePart] = String(val).split(' ');
  const [d, m, y] = datePart.split('/');
  return `${y}-${m}-${d}T${timePart || '00:00:00'}.000Z`;
}

async function main() {
  console.log(`Lendo arquivo: ${FILE_PATH}`);
  const wb = XLSX.readFile(FILE_PATH, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  console.log(`Total de linhas: ${rows.length}`);

  // Separate VD and upsells
  const vdRows = rows.filter(r => (r['Tipo Venda'] || '') !== 'Upsell');
  const upsellRows = rows.filter(r => (r['Tipo Venda'] || '') === 'Upsell');

  console.log(`Venda Direta: ${vdRows.length} | Upsell: ${upsellRows.length}`);

  // Build CPF → [VD orders sorted by date asc] map for upsell matching
  const vdByCpf = {};
  for (const row of vdRows) {
    const cpf = row['Documento'];
    if (!cpf) continue;
    if (!vdByCpf[cpf]) vdByCpf[cpf] = [];
    vdByCpf[cpf].push({ code: row['Código'], date: parseDate(row['Data']) });
  }

  // Find parent VD for an upsell: same CPF, latest VD before or at upsell time
  function findParentId(cpf, upsellDateStr) {
    const candidates = vdByCpf[cpf];
    if (!candidates) return null;
    const upsellTs = new Date(upsellDateStr).getTime();
    // Get latest VD that happened before this upsell
    const before = candidates
      .filter(c => c.date && new Date(c.date).getTime() <= upsellTs)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return before[0]?.code || candidates[0]?.code || null;
  }

  let insertedShipments = 0, insertedQueue = 0, errors = 0;
  const BATCH = 50;

  async function upsertBatch(table, batch, conflictCol) {
    const { error } = await db.from(table).upsert(batch, {
      onConflict: conflictCol,
      ignoreDuplicates: false,
    });
    if (error) {
      console.error(`Erro no upsert (${table}):`, error.message);
      errors += batch.length;
    } else {
      if (table === 'shipments') insertedShipments += batch.length;
      else insertedQueue += batch.length;
    }
  }

  const allRows = [...vdRows, ...upsellRows];
  let shipmentsBatch = [], queueBatch = [];

  for (const row of allRows) {
    const orderId     = row['Código'];
    const trackingRaw = row['Código de Rastreio'];
    const tracking    = trackingRaw ? String(trackingRaw).trim().toUpperCase() : null;
    const cpf         = row['Documento'] ? String(row['Documento']).replace(/\D/g, '') : null;
    const dateStr     = parseDate(row['Data']);
    const isUpsell    = (row['Tipo Venda'] || '') === 'Upsell';
    const parentId    = isUpsell && cpf ? findParentId(cpf, dateStr) : null;

    const base = {
      order_id:         orderId || null,
      seller_id:        null, // planilha não tem seller_id
      seller_email:     null,
      company_name:     'Nutravita',
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
        street:       row['Rua'],
        street_number: row['Número'] ? String(row['Número']) : null,
        complement:   row['Complemento'] || null,
        district:     row['Bairro']      || null,
        city:         row['Cidade']      || null,
        state:        row['Estado']      || null,
        zipcode:      row['CEP'] ? String(row['CEP']).replace(/\D/g, '') : null,
      }) : null,
      tracking_url:     row['Url de Acompanhamento'] || null,
      paid_at:          dateStr,
      sale_type:        isUpsell ? 'upsell' : 'venda_direta',
      parent_order_id:  parentId,
    };

    if (tracking) {
      shipmentsBatch.push({
        ...base,
        tracking_code: tracking,
        carrier:       detectCarrier(tracking),
        status:        mapStatus(row['Status Compra']),
        updated_at:    new Date().toISOString(),
      });
      if (shipmentsBatch.length >= BATCH) {
        await upsertBatch('shipments', shipmentsBatch, 'order_id');
        shipmentsBatch = [];
        process.stdout.write(`\rProcessados: ${insertedShipments} shipments, ${insertedQueue} queue...`);
      }
    } else {
      queueBatch.push(base);
      if (queueBatch.length >= BATCH) {
        await upsertBatch('customer_queue', queueBatch, 'order_id');
        queueBatch = [];
        process.stdout.write(`\rProcessados: ${insertedShipments} shipments, ${insertedQueue} queue...`);
      }
    }
  }

  // flush remaining
  if (shipmentsBatch.length) await upsertBatch('shipments', shipmentsBatch, 'order_id');
  if (queueBatch.length)     await upsertBatch('customer_queue', queueBatch, 'order_id');

  console.log(`\n\nConcluído:`);
  console.log(`  shipments:      ${insertedShipments}`);
  console.log(`  customer_queue: ${insertedQueue}`);
  console.log(`  erros:          ${errors}`);
  console.log(`  upsells linkados por CPF: ${upsellRows.length}`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});

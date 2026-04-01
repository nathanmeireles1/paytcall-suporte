/**
 * Importa pedidos das planilhas da Paytcall para o Supabase.
 * Pedidos com código de rastreio → shipments
 * Pedidos sem código de rastreio → customer_queue
 *
 * Usage: node scripts/import-payt-pedidos.mjs
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const FILES = [
  { path: join(ROOT, 'vendas/payt/fly_now_vendas_31_03_2026.xlsx'),      seller_id: 'L8Q8DK', company_name: 'FLY NOW AGENCIA DIGITAL LTDA' },
  { path: join(ROOT, 'vendas/payt/nutravita_vendas_31_03_2026.xlsx'),    seller_id: 'RD3PJL', company_name: 'NUTRAVITA LTDA' },
];

function parseBRL(val) {
  if (!val) return null;
  const s = String(val).replace(/[^\d,.-]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDate(val) {
  if (!val) return null;
  // formato: "31/03/2026 19:51:58"
  const m = String(val).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`).toISOString();
}

function detectCarrier(code) {
  if (!code) return null;
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code.trim().toUpperCase()) ? 'Correios' : 'Loggi';
}

function mapSaleType(tipo) {
  if (!tipo) return 'venda_direta';
  if (String(tipo).toLowerCase().includes('upsell')) return 'upsell';
  return 'venda_direta';
}

async function run() {
  const withTracking   = [];
  const withoutTracking = [];
  const seen = new Set();

  for (const file of FILES) {
    const wb   = XLSX.readFile(file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

    console.log(`\n[${file.company_name}] ${rows.length} linhas`);

    let skipped = 0;
    for (const r of rows) {
      // Só pedidos aprovados
      if (r['Status Pagamento'] !== 'Pagamento Aprovado') { skipped++; continue; }

      const orderId = String(r['Código'] || '').trim();
      if (!orderId || seen.has(orderId)) continue;
      seen.add(orderId);

      const trackingRaw = r['Código de Rastreio'] ? String(r['Código de Rastreio']).trim() : null;
      const tracking    = trackingRaw && trackingRaw !== '-' && trackingRaw !== '' ? trackingRaw.toUpperCase() : null;
      const paidAt      = parseDate(r['Data']);

      const base = {
        order_id:         orderId,
        seller_id:        file.seller_id,
        company_name:     file.company_name,
        customer_name:    r['Cliente']             || null,
        customer_email:   r['Email']               || null,
        customer_phone:   String(r['Telefone'] || '').replace(/\D/g, '') || null,
        customer_doc:     String(r['Documento'] || '').replace(/\D/g, '') || null,
        product_name:     r['Produto']             || null,
        product_quantity: r['Quantidade de produtos'] ? parseInt(r['Quantidade de produtos']) : null,
        payment_method:   r['Forma de Pagamento']  || null,
        payment_status:   'paid',
        sale_type:        mapSaleType(r['Tipo Venda']),
        paid_at:          paidAt || new Date().toISOString(),
      };

      if (tracking) {
        withTracking.push({
          ...base,
          tracking_code: tracking,
          carrier:       detectCarrier(tracking),
          status:        'pending',
          updated_at:    new Date().toISOString(),
        });
      } else {
        withoutTracking.push(base);
      }
    }
    console.log(`  Ignorados (não aprovados): ${skipped}`);
  }

  console.log(`\nCom rastreio → shipments:       ${withTracking.length}`);
  console.log(`Sem rastreio → customer_queue:  ${withoutTracking.length}`);

  // Insere em shipments (ON CONFLICT order_id → ignora duplicados)
  if (withTracking.length) {
    const BATCH = 100;
    let inserted = 0;
    for (let i = 0; i < withTracking.length; i += BATCH) {
      const { data, error } = await db
        .from('shipments')
        .upsert(withTracking.slice(i, i + BATCH), { onConflict: 'tracking_code', ignoreDuplicates: true })
        .select('id');
      if (error) console.error('[shipments] Erro:', error.message);
      else inserted += (data || []).length;
    }
    console.log(`[shipments] ${inserted} inseridos`);
  }

  // Insere em customer_queue (ON CONFLICT order_id → ignora duplicados)
  if (withoutTracking.length) {
    const BATCH = 100;
    let inserted = 0;
    for (let i = 0; i < withoutTracking.length; i += BATCH) {
      const { data, error } = await db
        .from('customer_queue')
        .upsert(withoutTracking.slice(i, i + BATCH), { onConflict: 'order_id', ignoreDuplicates: true })
        .select('id');
      if (error) console.error('[customer_queue] Erro:', error.message);
      else inserted += (data || []).length;
    }
    console.log(`[customer_queue] ${inserted} inseridos`);
  }

  console.log('\nImportação concluída.');
}

run().catch(console.error);

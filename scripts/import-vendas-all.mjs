import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const COL_MAP = {
  'Código':                'codigo',
  'Tipo Venda':            'tipo_venda',
  'Sku':                   'sku',
  'Produto':               'produto',
  'Empresa':               'empresa',
  'Email':                 'email',
  'Status Pagamento':      'status_pagamento',
  'Valor da Venda':        'valor_venda',
  'f. Saldo da Venda':     'saldo_venda',
  'Forma de Pagamento':    'forma_pagamento',
  'Data de aprovação':     'dt_aprovacao',
  'Data de criação':       'dt_criacao',
  'Data de atualização':   'data_atualizacao',
  'Nome':                  'nome_cliente',
  'Telefone':              'telefone',
  'Documento':             'documento',
  'Status de auditoria':   'status_auditoria',
  'Status de atendimento': 'status_atendimento',
  'Status de entrega':     'status_entrega',
  'Rastreio':              'rastreio',
  'Pedido suspenso':       'pedido_suspenso',
  'Motivo do cancelamento':'motivo_cancelamento',
  'Tipo de cancelamento':  'tipo_cancelamento',
};

const DATE_FIELDS = new Set(['dt_aprovacao', 'dt_criacao', 'data_atualizacao']);
const NUM_FIELDS  = new Set(['valor_venda', 'saldo_venda']);

function excelDateToISO(val) {
  if (!val && val !== 0) return null;
  if (typeof val === 'string') return val.slice(0, 10) || null;
  const d = new Date((val - 25569) * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

async function importFile(filePath) {
  const filename = filePath.split(/[\\/]/).pop();
  console.log(`\n📂 ${filename}`);

  const wb   = XLSX.read(readFileSync(filePath), { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (rows.length < 2) { console.log('  ⚠ Vazia, pulando.'); return; }

  const headers = rows[0];
  const colIdx  = {};
  headers.forEach((h, i) => {
    const field = COL_MAP[h?.toString().trim()];
    if (field) colIdx[field] = i;
  });

  const allRecords = rows.slice(1)
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(row => {
      const rec = { fonte: 'planilha' };
      for (const [field, idx] of Object.entries(colIdx)) {
        let val = row[idx];
        if (val === '' || val === null || val === undefined) { rec[field] = null; continue; }
        if (DATE_FIELDS.has(field)) { rec[field] = excelDateToISO(val); continue; }
        if (NUM_FIELDS.has(field))  { rec[field] = typeof val === 'number' ? val : parseFloat(val) || null; continue; }
        rec[field] = String(val).trim() || null;
      }
      return rec;
    })
    .filter(r => r.codigo);

  // Deduplica por codigo mantendo data_atualizacao mais recente
  const deduped = new Map();
  for (const rec of allRecords) {
    const existing = deduped.get(rec.codigo);
    if (!existing || (rec.data_atualizacao || '') > (existing.data_atualizacao || '')) {
      deduped.set(rec.codigo, rec);
    }
  }
  const unique = Array.from(deduped.values());
  console.log(`  Linhas: ${rows.length - 1} | Únicas: ${unique.length}`);

  const BATCH = 500;
  let inserted = 0, errors = 0;
  for (let b = 0; b < unique.length; b += BATCH) {
    const batch = unique.slice(b, b + BATCH);
    const { data, error } = await db.from('vendas')
      .upsert(batch, { onConflict: 'codigo', ignoreDuplicates: false })
      .select('id');
    if (error) { errors += batch.length; console.error(`  ❌ Batch erro: ${error.message}`); }
    else { inserted += (data || []).length; }
    process.stdout.write(`\r  Progresso: ${Math.min(b + BATCH, unique.length)}/${unique.length}`);
  }
  console.log(`\n  ✅ Inseridas/atualizadas: ${inserted} | Erros: ${errors}`);
}

async function main() {
  const folder = join(__dirname, '../vendas/database_airtable');
  const files  = readdirSync(folder).filter(f => f.endsWith('.xlsx')).sort();
  console.log(`Importando ${files.length} planilhas...\n`);

  for (const file of files) {
    await importFile(join(folder, file));
  }

  const { count } = await db.from('vendas').select('*', { count: 'exact', head: true });
  console.log(`\n🎉 Total de registros na tabela vendas: ${count}`);
}

main().catch(console.error);

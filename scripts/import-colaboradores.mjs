import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function excelDateToISO(val) {
  if (!val && val !== 0) return null;
  if (typeof val === 'string') return val.slice(0, 10) || null;
  const d = new Date((val - 25569) * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

async function main() {
  const filePath = join(__dirname, '../vendas/cadastros/Cadastros gerais.xlsx');
  const wb = XLSX.read(readFileSync(filePath), { type: 'buffer' });
  const ws = wb.Sheets['Colaboradores'];
  if (!ws) { console.error('Aba "Colaboradores" não encontrada'); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];

  const idx = (name) => headers.findIndex(h => h?.toString().trim() === name);
  const iEmail     = idx('Email');
  const iSrc       = idx('Src');
  const iNome      = idx('Vendedora');
  const iPrimeiro  = idx('Primeiro nome');
  const iEquipe    = idx('Equipe');
  const iRegiao    = idx('Região');
  const iDemissao  = idx('Demissão');
  const iData      = idx('Data');
  const iTipo      = idx('Tipo de venda primária');

  const records = rows.slice(1)
    .filter(r => r[iEmail] && String(r[iEmail]).trim())
    .map(r => ({
      email:          String(r[iEmail]).trim().toLowerCase(),
      src:            r[iSrc]      ? String(r[iSrc]).trim().toLowerCase()  : null,
      nome:           r[iNome]     ? String(r[iNome]).trim()               : null,
      primeiro_nome:  r[iPrimeiro] ? String(r[iPrimeiro]).trim()           : null,
      equipe:         r[iEquipe]   ? String(r[iEquipe]).trim()             : null,
      regiao:         r[iRegiao]   ? String(r[iRegiao]).trim()             : null,
      ativo:          !r[iDemissao] || r[iDemissao] === '',
      data_inicio:    excelDateToISO(r[iData]),
      tipo_venda:     r[iTipo]     ? String(r[iTipo]).trim()               : null,
    }));

  // Deduplica por email — mantém o registro com data_inicio mais recente
  const deduped = new Map();
  for (const r of records) {
    const ex = deduped.get(r.email);
    if (!ex || (r.data_inicio || '') > (ex.data_inicio || '')) deduped.set(r.email, r);
  }
  const unique = Array.from(deduped.values());
  console.log(`Colaboradores encontrados: ${records.length} | Únicos: ${unique.length}`);

  const { data, error } = await db
    .from('vendas_colaboradores')
    .upsert(unique, { onConflict: 'email', ignoreDuplicates: false })
    .select('email');

  if (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  }

  const ativos   = unique.filter(r => r.ativo).length;
  const inativos = unique.filter(r => !r.ativo).length;
  console.log(`✅ ${(data || []).length} registros importados (${ativos} ativos, ${inativos} inativos)`);
}

main().catch(console.error);

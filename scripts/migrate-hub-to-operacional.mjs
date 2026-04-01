/**
 * Migra empresas, produtos, feedbacks e storage do hub para o operacional.
 * Usage: node scripts/migrate-hub-to-operacional.mjs
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

const db  = createClient(process.env.SUPABASE_URL,     process.env.SUPABASE_SERVICE_KEY);
const hub = createClient(process.env.HUB_SUPABASE_URL, process.env.HUB_SUPABASE_SERVICE_KEY);

// ── Helpers ────────────────────────────────────────────────────────────────────

async function migrateTable(tableName) {
  console.log(`\n[${tableName}] Buscando dados do hub...`);
  const { data, error } = await hub.from(tableName).select('*');
  if (error) { console.error(`  Erro ao ler hub.${tableName}:`, error.message); return 0; }
  if (!data?.length) { console.log(`  Nenhum registro.`); return 0; }

  const BATCH = 200;
  let total = 0;
  for (let i = 0; i < data.length; i += BATCH) {
    const { error: e } = await db.from(tableName)
      .upsert(data.slice(i, i + BATCH), { onConflict: 'id', ignoreDuplicates: false });
    if (e) console.error(`  Erro upsert batch ${i}:`, e.message);
    else total += Math.min(BATCH, data.length - i);
  }
  console.log(`  ✓ ${total}/${data.length} registros migrados`);
  return total;
}

async function migrateStorage(bucketName) {
  console.log(`\n[storage:${bucketName}] Iniciando...`);

  // Garante que o bucket existe no operacional
  const { data: buckets } = await db.storage.listBuckets();
  const exists = buckets?.some(b => b.name === bucketName);
  if (!exists) {
    const { error } = await db.storage.createBucket(bucketName, { public: true });
    if (error) { console.error('  Erro ao criar bucket:', error.message); return; }
    console.log(`  Bucket "${bucketName}" criado no operacional`);
  }

  // Lista recursiva de arquivos no hub
  async function listAll(prefix = '') {
    const { data, error } = await hub.storage.from(bucketName).list(prefix, { limit: 1000 });
    if (error || !data) return [];
    const files = [];
    for (const item of data) {
      if (item.id) {
        // É arquivo
        files.push(prefix ? `${prefix}/${item.name}` : item.name);
      } else {
        // É pasta
        const sub = await listAll(prefix ? `${prefix}/${item.name}` : item.name);
        files.push(...sub);
      }
    }
    return files;
  }

  const files = await listAll();
  console.log(`  ${files.length} arquivos encontrados`);

  let ok = 0, err = 0;
  for (const path of files) {
    try {
      // Download do hub
      const { data: blob, error: dlErr } = await hub.storage.from(bucketName).download(path);
      if (dlErr) throw new Error(dlErr.message);

      // Upload para operacional
      const { error: upErr } = await db.storage.from(bucketName).upload(path, blob, {
        upsert: true,
        contentType: blob.type || 'application/octet-stream',
      });
      if (upErr) throw new Error(upErr.message);
      ok++;
      process.stdout.write(`\r  ${ok}/${files.length} copiados...`);
    } catch (e) {
      err++;
      console.error(`\n  Erro em "${path}":`, e.message);
    }
  }
  console.log(`\n  ✓ ${ok} copiados | ${err} erros`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function run() {
  console.log('=== Migração Hub → Operacional ===\n');

  // 1. Tabelas
  await migrateTable('empresas');
  await migrateTable('produtos');
  await migrateTable('feedbacks');
  await migrateTable('configuracoes');

  // 2. Storage
  await migrateStorage('produtos-midias');
  await migrateStorage('empresas-logos');

  // 3. Atualiza URLs nas tabelas para apontar para o novo storage
  console.log('\n[Atualizando URLs de storage nas tabelas...]');
  const hubStorageBase = `${process.env.HUB_SUPABASE_URL}/storage/v1/object/public`;
  const newStorageBase = `${process.env.SUPABASE_URL}/storage/v1/object/public`;

  // Produtos: imagem_url
  const { data: prods } = await db.from('produtos').select('id, imagem_url').not('imagem_url', 'is', null);
  for (const p of prods || []) {
    if (p.imagem_url?.includes(hubStorageBase)) {
      const newUrl = p.imagem_url.replace(hubStorageBase, newStorageBase);
      await db.from('produtos').update({ imagem_url: newUrl }).eq('id', p.id);
    }
  }

  // Empresas: logo_url
  const { data: emps } = await db.from('empresas').select('id, logo_url').not('logo_url', 'is', null);
  for (const e of emps || []) {
    if (e.logo_url?.includes(hubStorageBase)) {
      const newUrl = e.logo_url.replace(hubStorageBase, newStorageBase);
      await db.from('empresas').update({ logo_url: newUrl }).eq('id', e.id);
    }
  }

  console.log('  ✓ URLs atualizadas');
  console.log('\n=== Migração concluída! ===');
  console.log('Próximos passos:');
  console.log('  1. Verifique os dados no Supabase operacional');
  console.log('  2. Faça deploy do portal com o código atualizado (hub → db)');
  console.log('  3. Teste o catálogo em produção');
  console.log('  4. Só então exclua o hub\n');
}

run().catch(console.error);

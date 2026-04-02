const { createClient } = require('@supabase/supabase-js');

// Projeto operacional — rastreios, tickets, usuários
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios');
}

const db = createClient(supabaseUrl, supabaseKey);

// Projeto hub — legado (não usar em código novo)
const hubUrl = process.env.HUB_SUPABASE_URL;
const hubKey = process.env.HUB_SUPABASE_SERVICE_KEY;

const hub = hubUrl && hubKey
  ? createClient(hubUrl, hubKey)
  : null;

// Projeto Gestão — colaboradores/RH (leitura de rh_colaboradores)
const gestaoUrl = process.env.GESTAO_SUPABASE_URL;
const gestaoKey = process.env.GESTAO_SUPABASE_SERVICE_KEY;

const dbGestao = gestaoUrl && gestaoKey
  ? createClient(gestaoUrl, gestaoKey)
  : null;

async function init() {
  const { error } = await db.from('shipments').select('id').limit(1);
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Erro ao conectar ao Supabase: ${error.message}`);
  }
  console.log('[DB] Conectado ao Supabase operacional com sucesso');

  if (dbGestao) {
    const { error: gErr } = await dbGestao.from('rh_colaboradores').select('id').limit(1);
    if (gErr && gErr.code !== 'PGRST116') {
      console.warn('[DB] Gestão Supabase conectado mas com aviso:', gErr.message);
    } else {
      console.log('[DB] Conectado ao Supabase gestão (colaboradores) com sucesso');
    }
  } else {
    console.warn('[DB] GESTAO_SUPABASE_URL/GESTAO_SUPABASE_SERVICE_KEY não configurados — colaboradores do portal-gestao indisponíveis');
  }
}

module.exports = { db, hub, dbGestao, init };

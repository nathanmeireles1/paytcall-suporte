const { createClient } = require('@supabase/supabase-js');

// Projeto operacional — rastreios, tickets, usuários
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios');
}

const db = createClient(supabaseUrl, supabaseKey);

// Projeto hub — vendas, empresas, produtos
const hubUrl = process.env.HUB_SUPABASE_URL;
const hubKey = process.env.HUB_SUPABASE_SERVICE_KEY;

const hub = hubUrl && hubKey
  ? createClient(hubUrl, hubKey)
  : null;

async function init() {
  const { error } = await db.from('shipments').select('id').limit(1);
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Erro ao conectar ao Supabase: ${error.message}`);
  }
  console.log('[DB] Conectado ao Supabase operacional com sucesso');

  if (hub) {
    const { error: hubError } = await hub.from('empresas').select('id').limit(1);
    if (hubError && hubError.code !== 'PGRST116') {
      console.warn('[DB] Hub Supabase conectado mas com aviso:', hubError.message);
    } else {
      console.log('[DB] Conectado ao Supabase hub com sucesso');
    }
  } else {
    console.warn('[DB] HUB_SUPABASE_URL/HUB_SUPABASE_SERVICE_KEY não configurados — módulos de vendas indisponíveis');
  }
}

module.exports = { db, hub, init };

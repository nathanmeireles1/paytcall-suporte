const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios');
}

const db = createClient(supabaseUrl, supabaseKey);

async function init() {
  const { error } = await db.from('shipments').select('id').limit(1);
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Erro ao conectar ao Supabase: ${error.message}`);
  }
  console.log('[DB] Conectado ao Supabase com sucesso');
}

module.exports = { db, init };

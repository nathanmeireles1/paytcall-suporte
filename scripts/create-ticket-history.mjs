/**
 * Cria a tabela ticket_history no Supabase operacional.
 * Execute uma vez: node scripts/create-ticket-history.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SQL = `
CREATE TABLE IF NOT EXISTS ticket_history (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  changed_by  text,
  changed_at  timestamptz DEFAULT now(),
  field       text NOT NULL,
  old_value   text,
  new_value   text
);

CREATE INDEX IF NOT EXISTS ticket_history_ticket_id_idx ON ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS ticket_history_changed_at_idx ON ticket_history(changed_at DESC);
`;

const { error } = await db.rpc('exec_sql', { sql: SQL }).catch(() => ({ error: 'rpc not available' }));

if (error) {
  // Fallback: tenta via Management API
  const managementUrl = `https://api.supabase.com/v1/projects/${process.env.SUPABASE_URL?.split('.')[0]?.split('//')[1]}/database/query`;
  const response = await fetch(managementUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error('Erro ao criar tabela:', result);
    process.exit(1);
  }
}

console.log('✓ Tabela ticket_history criada/verificada com sucesso.');

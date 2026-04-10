/**
 * migrate-vendas-rpcs.mjs
 * Cria/atualiza as funções SQL para agregar dados de vendas server-side,
 * eliminando queries de 300k linhas no Node.js.
 *
 * Uso: node scripts/migrate-vendas-rpcs.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Carrega variáveis do .env
const envPath = join(ROOT, '.env');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const PROJECT_REF   = 'mckldrujoktkhjzgdded';
const ACCESS_TOKEN  = env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN não encontrado no .env');
  process.exit(1);
}

async function runSQL(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`SQL error [${res.status}]: ${JSON.stringify(body)}`);
  }
  return body;
}

// ── Índice de performance ─────────────────────────────────────────────────────
// Cobre todos os filtros das queries de vendas (status + data)
const SQL_INDEX = `
CREATE INDEX IF NOT EXISTS idx_vendas_status_dt
  ON vendas(status_pagamento, dt_aprovacao);
`;

// ── RPC 1: get_vendas_formas_nichos ──────────────────────────────────────────
// Usa saldo_venda (igual ao get_vendas_dashboard) para totais consistentes.
// Retorna formas_pagamento, top_nichos (JOIN produtos) e daily_by_email (para dailyByRegiao no Node).
const SQL_FORMAS_NICHOS = `
CREATE OR REPLACE FUNCTION get_vendas_formas_nichos(
  p_from      text,
  p_to        text,
  p_emails    text[]   DEFAULT NULL,
  p_tipo      text     DEFAULT NULL,
  p_empresas  text[]   DEFAULT NULL,
  p_produtos  text[]   DEFAULT NULL,
  p_forma     text     DEFAULT NULL,
  p_fonte     text     DEFAULT NULL,
  p_vendedora text     DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
WITH filtered AS (
  SELECT
    v.forma_pagamento,
    LOWER(TRIM(COALESCE(v.produto, ''))) AS prod_norm,
    LOWER(TRIM(COALESCE(v.sku, '')))     AS sku_norm,
    COALESCE(v.saldo_venda, 0)           AS val,
    v.email,
    (v.dt_aprovacao::date)::text AS dia
  FROM vendas v
  WHERE v.status_pagamento = 'paid'
    AND v.dt_aprovacao >= p_from::date
    AND v.dt_aprovacao <= p_to::date
    AND (p_emails    IS NULL OR v.email             = ANY(p_emails))
    AND (p_tipo      IS NULL OR v.tipo_venda        = p_tipo)
    AND (p_empresas  IS NULL OR v.empresa           = ANY(p_empresas))
    AND (p_produtos  IS NULL OR v.produto           = ANY(p_produtos))
    AND (p_forma     IS NULL OR v.forma_pagamento   = p_forma)
    AND (p_fonte     IS NULL OR v.email ILIKE ('%' || p_fonte || '%'))
    AND (p_vendedora IS NULL OR v.email             = p_vendedora)
),
formas AS (
  SELECT
    COALESCE(forma_pagamento, 'outros') AS forma,
    COUNT(*)::int AS count,
    SUM(val)      AS total
  FROM filtered
  GROUP BY forma_pagamento
  ORDER BY total DESC NULLS LAST
),
nichos AS (
  SELECT
    COALESCE(pr.nicho, 'Sem nicho') AS nicho,
    COUNT(*)::int  AS qtd,
    SUM(f.val)     AS total
  FROM filtered f
  LEFT JOIN produtos pr
    ON (f.prod_norm = LOWER(TRIM(COALESCE(pr.nome, '')))
     OR (f.sku_norm <> '' AND f.sku_norm = LOWER(TRIM(COALESCE(pr.sku, '')))))
  GROUP BY pr.nicho
  ORDER BY total DESC NULLS LAST
),
daily_email AS (
  SELECT
    dia            AS data,
    email,
    SUM(val)       AS total,
    COUNT(*)::int  AS count
  FROM filtered
  WHERE email IS NOT NULL
  GROUP BY dia, email
  ORDER BY dia
)
SELECT json_build_object(
  'formas_pagamento', (SELECT COALESCE(json_agg(f), '[]'::json) FROM formas f),
  'top_nichos',       (SELECT COALESCE(json_agg(n), '[]'::json) FROM nichos n),
  'daily_by_email',   (SELECT COALESCE(json_agg(d), '[]'::json) FROM daily_email d)
);
$$;
`;

// ── RPC 2: get_vendas_ranking_agg ────────────────────────────────────────────
// Usa saldo_venda (igual ao get_vendas_dashboard) para totais consistentes.
const SQL_RANKING_AGG = `
CREATE OR REPLACE FUNCTION get_vendas_ranking_agg(
  p_from      text,
  p_to        text,
  p_emails    text[]   DEFAULT NULL,
  p_tipo      text     DEFAULT NULL,
  p_empresas  text[]   DEFAULT NULL,
  p_produtos  text[]   DEFAULT NULL,
  p_forma     text     DEFAULT NULL,
  p_fonte     text     DEFAULT NULL,
  p_vendedora text     DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
SELECT COALESCE(
  json_agg(r ORDER BY r.total DESC),
  '[]'::json
)
FROM (
  SELECT
    email,
    COALESCE(SUM(saldo_venda), 0) AS total,
    COUNT(*)::int                  AS qtd
  FROM vendas
  WHERE status_pagamento = 'paid'
    AND dt_aprovacao >= p_from::date
    AND dt_aprovacao <= p_to::date
    AND (p_emails    IS NULL OR email           = ANY(p_emails))
    AND (p_tipo      IS NULL OR tipo_venda      = p_tipo)
    AND (p_empresas  IS NULL OR empresa         = ANY(p_empresas))
    AND (p_produtos  IS NULL OR produto         = ANY(p_produtos))
    AND (p_forma     IS NULL OR forma_pagamento = p_forma)
    AND (p_fonte     IS NULL OR email ILIKE ('%' || p_fonte || '%'))
    AND (p_vendedora IS NULL OR email           = p_vendedora)
    AND email IS NOT NULL
  GROUP BY email
) r;
$$;
`;

async function main() {
  console.log('Criando índice idx_vendas_status_dt...');
  await runSQL(SQL_INDEX);
  console.log('  OK');

  console.log('Criando RPC get_vendas_formas_nichos...');
  await runSQL(SQL_FORMAS_NICHOS);
  console.log('  OK');

  console.log('Criando RPC get_vendas_ranking_agg...');
  await runSQL(SQL_RANKING_AGG);
  console.log('  OK');

  console.log('\nMigração concluída.');
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});

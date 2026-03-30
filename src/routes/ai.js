const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// Cache da chave Gemini (5 min)
let _geminiKeyCache = null;
let _geminiKeyCacheAt = 0;
async function getGeminiKey() {
  if (_geminiKeyCache && Date.now() - _geminiKeyCacheAt < 5 * 60 * 1000) return _geminiKeyCache;
  try {
    const { data } = await db.from('portal_settings').select('value').eq('key', 'gemini_api_key').single();
    if (data?.value) { _geminiKeyCache = data.value; _geminiKeyCacheAt = Date.now(); return data.value; }
  } catch(e) {}
  return process.env.GEMINI_API_KEY || '';
}

// Cache do conhecimento completo do banco (5 min)
let _kbCache = null;
let _kbCacheAt = 0;
const KB_TTL = 5 * 60 * 1000;

async function buildFullKnowledgeBase() {
  if (_kbCache && Date.now() - _kbCacheAt < KB_TTL) return _kbCache;

  const fmt = (iso) => iso
    ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—';

  // Busca tudo em paralelo
  const [
    { data: shipments },
    { data: queue },
    { data: tickets },
    { data: cancelamentos },
  ] = await Promise.all([
    db.from('shipments').select('*').order('updated_at', { ascending: false }),
    db.from('customer_queue').select('*').order('created_at', { ascending: false }),
    db.from('tickets').select('*').order('created_at', { ascending: false }),
    db.from('cancelamentos').select('*').order('created_at', { ascending: false }),
  ]);

  const allShipments = shipments || [];
  const allQueue = queue || [];
  const allTickets = tickets || [];
  const allCancelamentos = cancelamentos || [];

  // ── MÉTRICAS CALCULADAS ──────────────────────────────────────────
  const now = new Date();
  const startOfToday = new Date(now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00');
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const byStatus = {};
  for (const s of allShipments) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  }

  const deliveredAll = allShipments.filter(s => s.status === 'delivered');
  const deliveredToday = deliveredAll.filter(s => s.updated_at && new Date(s.updated_at) >= startOfToday).length;
  const deliveredWeek = deliveredAll.filter(s => s.updated_at && new Date(s.updated_at) >= startOfWeek).length;
  const deliveredMonth = deliveredAll.filter(s => s.updated_at && new Date(s.updated_at) >= startOfMonth).length;

  const paidThisMonth = allShipments.filter(s => s.paid_at && new Date(s.paid_at) >= startOfMonth).length
    + allQueue.filter(s => s.paid_at && new Date(s.paid_at) >= startOfMonth).length;

  // Tempo médio de entrega (paid_at → updated_at para entregues com ambas datas)
  const withDeliveryTime = deliveredAll.filter(s => s.paid_at && s.updated_at);
  const avgDeliveryDays = withDeliveryTime.length
    ? (withDeliveryTime.reduce((acc, s) => acc + (new Date(s.updated_at) - new Date(s.paid_at)) / 86400000, 0) / withDeliveryTime.length).toFixed(1)
    : '—';

  // Por empresa
  const byCompany = {};
  for (const s of [...allShipments, ...allQueue]) {
    const key = s.company_name || s.seller_id || 'Desconhecida';
    if (!byCompany[key]) byCompany[key] = { total: 0, entregues: 0, devolvidos: 0, em_transito: 0, sem_rastreio: 0 };
    byCompany[key].total++;
    if (s.status === 'delivered') byCompany[key].entregues++;
    else if (s.status === 'returned') byCompany[key].devolvidos++;
    else if (['forwarded','delivering','posted_object'].includes(s.status)) byCompany[key].em_transito++;
    else if (!s.tracking_code || s.status === 'no_tracking') byCompany[key].sem_rastreio++;
  }

  // Tickets
  const ticketsByStatus = {};
  const ticketsByTipo = {};
  const ticketsByAssignee = {};
  const slaViolations = [];
  for (const t of allTickets) {
    ticketsByStatus[t.status] = (ticketsByStatus[t.status] || 0) + 1;
    ticketsByTipo[t.tipo] = (ticketsByTipo[t.tipo] || 0) + 1;
    if (t.assigned_to) ticketsByAssignee[t.assigned_to] = (ticketsByAssignee[t.assigned_to] || 0) + 1;
    // SLA 72h
    if (t.created_at && !['Concluído','Cancelado','Retido'].includes(t.status)) {
      const hoursOpen = (now - new Date(t.created_at)) / 3600000;
      if (hoursOpen > 72) slaViolations.push(t);
    }
  }
  const openTickets = allTickets.filter(t => !['Concluído','Cancelado','Retido'].includes(t.status));

  // Cancelamentos
  const cancelByTipo = {};
  const cancelThisMonth = allCancelamentos.filter(c => c.created_at && new Date(c.created_at) >= startOfMonth);
  for (const c of allCancelamentos) {
    cancelByTipo[c.tipo] = (cancelByTipo[c.tipo] || 0) + 1;
  }

  // ── MONTA O CONTEXTO ─────────────────────────────────────────────
  let kb = '';

  kb += `\n${'='.repeat(60)}\n`;
  kb += `CONHECIMENTO COMPLETO DO BANCO DE DADOS — PAYTCALL SUPORTE\n`;
  kb += `Snapshot: ${fmt(now.toISOString())} (atualiza a cada 5 min)\n`;
  kb += `${'='.repeat(60)}\n`;

  // ── 1. MÉTRICAS GERAIS ──
  kb += `\n[MÉTRICAS GERAIS]\n`;
  kb += `Total pedidos: ${allShipments.length + allQueue.length} (${allShipments.length} com rastreio + ${allQueue.length} aguardando rastreio)\n`;
  kb += `Pedidos esse mês: ${paidThisMonth}\n`;
  kb += `\nStatus dos envios:\n`;
  const statusLabels = { delivered: 'Entregue', forwarded: 'Em trânsito', delivering: 'Saiu p/ entrega', posted_object: 'Obj. postado', returned: 'Devolvido', returning: 'Devolvendo', pending: 'Pendente', tracking_delayed: 'Rastreio em atraso', recipient_not_found: 'Dest. não encontrado', delivery_problem: 'Prob. entrega', wrong_address: 'End. incorreto', waiting_client: 'Ag. retirada', no_tracking: 'Sem rastreio' };
  for (const [st, qty] of Object.entries(byStatus).sort((a,b) => b[1]-a[1])) {
    kb += `  ${statusLabels[st] || st}: ${qty}\n`;
  }
  kb += `  Aguardando rastreio (fila H7): ${allQueue.length}\n`;
  kb += `\nEntregas:\n`;
  kb += `  Hoje: ${deliveredToday} | Essa semana: ${deliveredWeek} | Esse mês: ${deliveredMonth} | Total: ${deliveredAll.length}\n`;
  kb += `Tempo médio de entrega: ${avgDeliveryDays} dias\n`;
  kb += `Taxa de devolução: ${allShipments.length ? ((byStatus['returned']||0)/allShipments.length*100).toFixed(1) : 0}%\n`;

  // ── 2. POR EMPRESA ──
  kb += `\n[POR EMPRESA]\n`;
  for (const [empresa, d] of Object.entries(byCompany)) {
    const taxa = d.total ? (d.entregues/d.total*100).toFixed(1) : 0;
    kb += `${empresa}: ${d.total} pedidos | entregues: ${d.entregues} (${taxa}%) | em trânsito: ${d.em_transito} | devolvidos: ${d.devolvidos} | sem rastreio: ${d.sem_rastreio}\n`;
  }

  // ── 3. TICKETS ──
  kb += `\n[TICKETS]\n`;
  kb += `Total: ${allTickets.length} | Abertos/ativos: ${openTickets.length} | SLA vencido (>72h): ${slaViolations.length}\n`;
  kb += `Por tipo: ${Object.entries(ticketsByTipo).map(([k,v]) => `${k}: ${v}`).join(' | ')}\n`;
  kb += `Por status: ${Object.entries(ticketsByStatus).map(([k,v]) => `${k}: ${v}`).join(' | ')}\n`;
  kb += `Por atendente: ${Object.entries(ticketsByAssignee).map(([k,v]) => `${k}: ${v}`).join(' | ')}\n`;

  if (slaViolations.length > 0) {
    kb += `\nTickets com SLA vencido:\n`;
    for (const t of slaViolations.slice(0, 20)) {
      const hrs = Math.floor((now - new Date(t.created_at)) / 3600000);
      kb += `  [${t.tipo}] ${t.motivo} | ${t.status} | ${hrs}h aberto | order: ${t.order_id || t.tracking_code || '—'}\n`;
    }
  }

  if (openTickets.length > 0) {
    kb += `\nTickets abertos/ativos:\n`;
    for (const t of openTickets.slice(0, 50)) {
      kb += `  ID:${t.id} [${t.tipo}] ${t.motivo} | ${t.status} | prioridade:${t.priority} | atendente:${t.assigned_to||'—'} | pedido:${t.order_id||t.tracking_code||'—'} | aberto:${fmt(t.created_at)}\n`;
      if (t.observacao) kb += `    obs: ${t.observacao.slice(0,120)}\n`;
    }
  }

  // ── 4. CANCELAMENTOS ──
  kb += `\n[CANCELAMENTOS E CHARGEBACKS]\n`;
  kb += `Total: ${allCancelamentos.length} | Esse mês: ${cancelThisMonth.length}\n`;
  kb += `Por tipo: ${Object.entries(cancelByTipo).map(([k,v]) => `${k}: ${v}`).join(' | ')}\n`;
  if (allCancelamentos.length > 0) {
    kb += `\nÚltimos cancelamentos:\n`;
    for (const c of allCancelamentos.slice(0, 30)) {
      kb += `  [${c.tipo}] ${c.company_name||'—'} | ${c.customer_name||'—'} | ${c.product_name||'—'} | status: ${c.status_atendimento||'—'} | ${fmtDate(c.created_at)}\n`;
    }
  }

  // ── 5. TODOS OS PEDIDOS (shipments) ──
  kb += `\n[TODOS OS PEDIDOS COM RASTREIO — ${allShipments.length} registros]\n`;
  kb += `order_id | tracking_code | empresa | cliente | CPF | produto | status | transportadora | pago_em | ultimo_evento\n`;
  for (const s of allShipments) {
    kb += `${s.order_id||'—'} | ${s.tracking_code||'—'} | ${s.company_name||'—'} | ${s.customer_name||'—'} | ${s.customer_doc||'—'} | ${s.product_name||'—'} | ${s.status||'—'} | ${s.carrier||'—'} | ${fmtDate(s.paid_at)} | ${s.last_event||'—'}\n`;
  }

  // ── 6. FILA (customer_queue) ──
  kb += `\n[PEDIDOS AGUARDANDO RASTREIO (FILA H7) — ${allQueue.length} registros]\n`;
  kb += `order_id | empresa | cliente | CPF | produto | pago_em\n`;
  for (const q of allQueue) {
    kb += `${q.order_id||'—'} | ${q.company_name||'—'} | ${q.customer_name||'—'} | ${q.customer_doc||'—'} | ${q.product_name||'—'} | ${fmtDate(q.paid_at)}\n`;
  }

  _kbCache = kb;
  _kbCacheAt = Date.now();
  return kb;
}

const SYSTEM_PROMPT = `Você é a Payt IA, assistente de suporte interno da PAYTCALL.

Você tem acesso COMPLETO e em tempo real ao banco de dados do portal de suporte.
Todos os pedidos, rastreios, tickets, cancelamentos e métricas estão no contexto abaixo.

REGRAS ABSOLUTAS:
- Responda sempre em português brasileiro
- Seja direto, objetivo e profissional
- Use APENAS os dados do contexto — nunca invente informações
- Quando calcular métricas, mostre os números claramente
- Se o dado não estiver no contexto, diga explicitamente que não está disponível
- Para perguntas sobre pedidos específicos, busque pelo order_id, tracking_code, nome do cliente ou CPF
- Você pode fazer qualquer cálculo, comparação, ranking ou análise sobre os dados fornecidos

CAPACIDADES:
- Consultar qualquer pedido por ID, rastreio, nome, CPF ou empresa
- Calcular métricas: taxa de entrega, tempo médio, devoluções, SLA
- Listar tickets abertos, vencidos, por atendente
- Analisar cancelamentos e chargebacks
- Comparar performance entre empresas (NUTRAVITA, FLY NOW, etc)
- Identificar pedidos em atraso ou com problemas`;

// POST /api/ai/chat
router.post('/api/ai/chat', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

    const GEMINI_KEY = await getGeminiKey();
    if (!GEMINI_KEY) return res.status(500).json({ error: 'API do Gemini não configurada. Acesse Admin → Configurações para adicionar a chave.' });
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    // Conhecimento completo do banco (cacheado 5 min)
    const knowledgeBase = await buildFullKnowledgeBase().catch(err => {
      console.error('[AI] Erro ao construir knowledge base:', err.message);
      return '(Erro ao carregar dados do banco — tente novamente)';
    });

    // Histórico de conversa
    const contents = [];
    for (const msg of history.slice(-10)) {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    }

    // Mensagem com contexto completo
    const userText = `${knowledgeBase}\n\n${'='.repeat(60)}\nPERGUNTA DO USUÁRIO: ${message}`;
    contents.push({ role: 'user', parts: [{ text: userText }] });

    const payload = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        topP: 0.95,
      },
    };

    const { data } = await axios.post(GEMINI_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    });

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Não consegui gerar uma resposta. Tente novamente.';
    res.json({ reply });
  } catch (err) {
    console.error('[AI] Erro Gemini:', err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: 'Erro ao contatar o Gemini: ' + msg });
  }
});

module.exports = router;

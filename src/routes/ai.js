const express = require('express');
const router = express.Router();
const axios = require('axios');
const Shipment = require('../models/Shipment');
const { db } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// Lê a chave Gemini do DB (com cache de 5 min) ou cai no env var
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

const SYSTEM_PROMPT = `Você é o assistente de suporte da PAYTCALL, chamado de "Payt IA".

Você tem acesso completo ao sistema de suporte interno da Paytcall e ajuda a equipe com:
- Consultas sobre pedidos, rastreamentos e status de entrega
- Análise de tickets de suporte (Retenção e Logística)
- Relatórios de cancelamentos, chargebacks e reembolsos
- KPIs e métricas operacionais

Regras:
- Responda sempre em português brasileiro
- Seja direto, objetivo e profissional
- Quando o usuário citar um ID de pedido ou código de rastreio, use os dados fornecidos no contexto
- Se não souber algo ou os dados não estiverem no contexto, diga claramente e sugira como buscar
- Você pode fazer cálculos e análises sobre os dados fornecidos
- Nunca invente dados — se não está no contexto, não sabe

Estrutura de dados do sistema:
- Pedidos: order_id (ID da Payt), tracking_code (código de rastreio), status, customer_name, customer_email, customer_cpf, product_name, seller_id, company_name, paid_at, carrier
- Status possíveis: pending, posted_object, forwarded (em trânsito), delivering (saiu p/ entrega), delivered (entregue), returned (devolvido), tracking_delayed (rastreio em atraso), no_tracking (sem rastreio)
- Tickets: tipo (RETENCAO/LOGISTICA), motivo, status, assigned_to, priority (1=alta, 2=média, 3=baixa), sla (72h)
- Cancelamentos: chargeback ou reembolso, status_atendimento, motivo`;

// POST /api/ai/chat
router.post('/api/ai/chat', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

    const GEMINI_KEY = await getGeminiKey();
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    if (!GEMINI_KEY) return res.status(500).json({ error: 'API do Gemini não configurada. Acesse Admin → Configurações para adicionar a chave.' });

    // Busca contexto relevante
    let contextData = '';
    try {
      const stats = await Shipment.getStats();
      contextData += `\n=== DADOS DO SISTEMA (momento atual) ===\n`;
      contextData += `Total de envios: ${stats.total || 0}\n`;
      contextData += `Entregues: ${stats.delivered || 0} | Em trânsito: ${stats.in_transit || 0} | Devolvidos: ${stats.returned || 0}\n`;
      contextData += `Saiu p/ entrega: ${stats.out_for_delivery || 0} | Rastreio em atraso: ${stats.tracking_delayed || 0}\n`;

      // Pedidos aguardando rastreio (customer_queue)
      const { count: queueCount } = await db.from('customer_queue').select('*', { count: 'exact', head: true });
      if (queueCount > 0) {
        contextData += `Aguardando rastreio (fila H7): ${queueCount}\n`;
      }

      // Se a mensagem menciona um código ou ID específico, busca o pedido
      // Regex: formato Correios (AA999999999AA) OU ID alfanumérico com pelo menos 1 letra E 1 número
      // (evita capturar palavras comuns como "status", "pedido", "rastreio")
      const codeMatch = message.match(/\b([A-Z]{2}\d{9}[A-Z]{2}|(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{4,25})\b/i);
      if (codeMatch) {
        const code = codeMatch[1].toUpperCase();

        // Busca em shipments primeiro (por código de rastreio e por order_id)
        const [byCode, byOrder] = await Promise.all([
          Shipment.findByCode(code).catch(() => null),
          Shipment.findByOrderId(code).catch(() => null),
        ]);
        let shipment = byCode || byOrder;

        // Se não encontrou em shipments, tenta na customer_queue (pedidos sem rastreio)
        if (!shipment) {
          const { data: queueItem } = await db
            .from('customer_queue')
            .select('*')
            .eq('order_id', code)
            .maybeSingle();
          if (queueItem) {
            shipment = { ...queueItem, tracking_code: null, status: 'no_tracking', carrier: null, last_event: null };
          }
        }

        if (shipment) {
          const isQueue = !shipment.tracking_code && shipment.status === 'no_tracking';
          contextData += `\n=== PEDIDO ENCONTRADO: ${shipment.order_id || shipment.tracking_code} ===\n`;
          if (isQueue) contextData += `⚠️ Pedido aguardando código de rastreio (na fila H7)\n`;
          contextData += `Cliente: ${shipment.customer_name || '—'} | CPF: ${shipment.customer_doc || '—'}\n`;
          contextData += `Email: ${shipment.customer_email || '—'} | Tel: ${shipment.customer_phone || '—'}\n`;
          contextData += `Produto: ${shipment.product_name || '—'} (Qtd: ${shipment.product_quantity || 1})\n`;
          contextData += `Empresa: ${shipment.company_name || shipment.seller_id || '—'}\n`;
          contextData += `Transportadora: ${shipment.carrier || '—'} | Código rastreio: ${shipment.tracking_code || 'Ainda não gerado'}\n`;
          contextData += `Status: ${shipment.status || '—'}\n`;
          contextData += `Pago em: ${shipment.paid_at ? new Date(shipment.paid_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}\n`;
          if (shipment.last_event) contextData += `Último evento: ${shipment.last_event} (${shipment.last_event_date || '—'})\n`;
          if (shipment.expected_date) contextData += `Previsão entrega: ${shipment.expected_date}\n`;

          // Tickets do pedido
          const tickets = await Shipment.getTickets(shipment.tracking_code, shipment.order_id).catch(() => []);
          if (tickets.length > 0) {
            contextData += `Tickets (${tickets.length}): `;
            contextData += tickets.map(t => `[${t.tipo} | ${t.motivo} | ${t.status} | prioridade ${t.priority}]`).join(', ') + '\n';
          } else {
            contextData += `Tickets: nenhum\n`;
          }
        } else {
          contextData += `\n=== PEDIDO "${code}" NÃO ENCONTRADO ===\n`;
          contextData += `Nenhum registro com este código ou ID no sistema.\n`;
        }
      }
    } catch (e) {
      // contexto parcial não quebra o chat
    }

    // Monta histórico de conversa no formato Gemini
    const contents = [];
    for (const msg of history.slice(-8)) { // últimas 8 trocas
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    }

    // Mensagem atual com contexto injetado
    const userText = contextData
      ? `${contextData}\n\n=== PERGUNTA DO USUÁRIO ===\n${message}`
      : message;

    contents.push({ role: 'user', parts: [{ text: userText }] });

    const payload = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        topP: 0.9,
      },
    };

    const { data } = await axios.post(GEMINI_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
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

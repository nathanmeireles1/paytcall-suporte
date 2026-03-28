const express = require('express');
const router = express.Router();
const axios = require('axios');
const Shipment = require('../models/Shipment');
const { requireAuth } = require('../middleware/auth');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

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

    if (!GEMINI_KEY) return res.status(500).json({ error: 'API do Gemini não configurada. Adicione GEMINI_API_KEY no Railway.' });

    // Busca contexto relevante
    let contextData = '';
    try {
      const stats = await Shipment.getStats();
      contextData += `\n=== DADOS DO SISTEMA (momento atual) ===\n`;
      contextData += `Total de envios: ${stats.total || 0}\n`;
      contextData += `Entregues: ${stats.delivered || 0} | Em trânsito: ${stats.in_transit || 0} | Devolvidos: ${stats.returned || 0}\n`;
      contextData += `Saiu p/ entrega: ${stats.out_for_delivery || 0} | Rastreio em atraso: ${stats.tracking_delayed || 0}\n`;

      // Se a mensagem menciona um código ou ID específico, busca o pedido
      const codeMatch = message.match(/\b([A-Z]{2}\d{9}[A-Z]{2}|[A-Z0-9]{10,20})\b/i);
      if (codeMatch) {
        const code = codeMatch[1].toUpperCase();
        const [byCode, byOrder] = await Promise.all([
          Shipment.findByCode(code).catch(() => null),
          Shipment.findByOrderId(code).catch(() => null),
        ]);
        const shipment = byCode || byOrder;
        if (shipment) {
          contextData += `\n=== PEDIDO ENCONTRADO: ${shipment.order_id || shipment.tracking_code} ===\n`;
          contextData += `Cliente: ${shipment.customer_name || '—'} (${shipment.customer_cpf || '—'})\n`;
          contextData += `Email: ${shipment.customer_email || '—'}\n`;
          contextData += `Produto: ${shipment.product_name || '—'} (Qtd: ${shipment.product_quantity || 1})\n`;
          contextData += `Transportadora: ${shipment.carrier || '—'} | Código: ${shipment.tracking_code || '—'}\n`;
          contextData += `Status: ${shipment.status || '—'}\n`;
          contextData += `Empresa: ${shipment.company_name || shipment.seller_id || '—'}\n`;
          contextData += `Pago em: ${shipment.paid_at ? new Date(shipment.paid_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}\n`;
          contextData += `Último evento: ${shipment.last_event || '—'}\n`;

          // Busca tickets do pedido
          const tickets = await Shipment.getTickets(shipment.tracking_code).catch(() => []);
          if (tickets.length > 0) {
            contextData += `Tickets (${tickets.length}): `;
            contextData += tickets.map(t => `[${t.tipo} - ${t.motivo} - ${t.status}]`).join(', ') + '\n';
          }
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

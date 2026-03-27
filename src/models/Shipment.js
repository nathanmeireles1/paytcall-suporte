const { db } = require('../config/database');

// Terminal = entrega definitivamente encerrada (parar de consultar H7)
// 'overdue' NÃO é terminal: etiqueta expirada pode ser atualizada pela H7
const TERMINAL_STATUSES = ['delivered', 'returned'];

// --- Configuração de Tickets ---
const TICKET_CONFIG = {
  RETENCAO: {
    motivos: ['Cancelamento', 'Desconto', 'Devolução'],
    statuses: ['Aberto', 'Em andamento', 'Cancelado', 'Retido'],
    terminalStatuses: ['Cancelado', 'Retido'],
    assignedTo: 'Flaviany',
    priorities: { 'Cancelamento': 1, 'Desconto': 2, 'Devolução': 3 },
  },
  LOGISTICA: {
    motivos: ['Reenvio', 'Alteração de pedido', 'Nota fiscal', 'Envio'],
    statuses: ['Aberto', 'Em andamento', 'Aguardando estoque', 'Concluído'],
    terminalStatuses: ['Concluído'],
    assignedTo: 'Shelida',
    priorities: { 'Alteração de pedido': 1, 'Envio': 1, 'Reenvio': 2, 'Nota fiscal': 3 },
  },
};

const MOTIVOS_CANCELAMENTO = [
  'Compra duplicada', 'Não autorizou upsell/order bump',
  'Forma de pagamento incorreta', 'Não sentiu efeito', 'Alergia',
  'Valor', 'Demora no envio', 'Fraude', 'Informação do rótulo',
  'Quantidade incorreta enviada', 'Produto incorreto enviado',
  'Orientação médica', 'Desistência', 'Sem motivo', 'Outros',
];

const Shipment = {
  async findByCode(trackingCode) {
    const { data, error } = await db
      .from('shipments')
      .select('*')
      .eq('tracking_code', trackingCode)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async findAll({ page = 1, limit = 50, status, search, seller_id, carrier, product, paid_at_from, paid_at_to } = {}) {
    const offset = (page - 1) * limit;

    let query = db.from('shipments').select('*', { count: 'exact' });

    if (status)       query = query.eq('status', status);
    if (seller_id)    query = query.eq('seller_id', seller_id);
    if (carrier)      query = query.eq('carrier', carrier);
    if (product)      query = query.ilike('product_name', `%${product}%`);
    if (paid_at_from) query = query.gte('paid_at', paid_at_from);
    if (paid_at_to)   query = query.lte('paid_at', paid_at_to + 'T23:59:59Z');
    if (search) {
      query = query.or(
        `tracking_code.ilike.%${search}%,order_id.ilike.%${search}%,customer_name.ilike.%${search}%,company_name.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    const total = count || 0;
    return { rows: data || [], total, page, pages: Math.ceil(total / limit) };
  },

  async upsertFromPaytcall(data) {
    const existing = await this.findByCode(data.tracking_code);

    const fields = {
      carrier:          data.carrier          || null,
      order_id:         data.order_id         || null,
      seller_id:        data.seller_id        || null,
      seller_email:     data.seller_email     || null,
      company_name:     data.company_name     || null,
      customer_name:    data.customer_name    || null,
      customer_email:   data.customer_email   || null,
      customer_phone:   data.customer_phone   || null,
      customer_doc:     data.customer_doc     || null,
      product_name:     data.product_name     || null,
      product_price:    data.product_price    || null,
      product_quantity: data.product_quantity || null,
      payment_method:   data.payment_method   || null,
      payment_status:   data.payment_status   || null,
      total_price:      data.total_price      || null,
      shipping_address: data.shipping_address || null,
      tracking_url:     data.tracking_url     || null,
      paid_at:          data.paid_at          || null,
      updated_at:       new Date().toISOString(),
    };

    if (!existing) {
      const { error } = await db.from('shipments').insert({
        tracking_code: data.tracking_code,
        status: data.status || 'pending',
        ...fields,
      });
      if (error) throw error;
    } else {
      // Preserva campos H7 (status, last_event, expected_date, loggi_code)
      const update = {};
      for (const [k, v] of Object.entries(fields)) {
        update[k] = v || existing[k];
      }
      const { error } = await db.from('shipments').update(update).eq('tracking_code', data.tracking_code);
      if (error) throw error;
    }

    return this.findByCode(data.tracking_code);
  },

  async upsert(data) {
    const payload = {
      tracking_code:    data.tracking_code,
      order_id:         data.order_id      || null,
      seller_id:        data.seller_id     || null,
      seller_email:     data.seller_email  || null,
      company_name:     data.company_name  || null,
      customer_name:    data.customer_name || null,
      customer_email:   data.customer_email || null,
      customer_phone:   data.customer_phone || null,
      status:           data.status        || 'pending',
      last_event:       data.last_event    || null,
      last_event_date:  data.last_event_date || null,
      expected_date:    data.expected_date || null,
      loggi_code:       data.loggi_code   || null,
      last_queried_at:  new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    };

    const { error } = await db
      .from('shipments')
      .upsert(payload, { onConflict: 'tracking_code', ignoreDuplicates: false });

    if (error) throw error;
    return this.findByCode(data.tracking_code);
  },

  async saveEvents(trackingCode, events) {
    const rows = events.map(ev => ({
      tracking_code: trackingCode,
      event_date:    ev.date,
      description:   ev.description,
      location:      ev.location,
      status_code:   ev.status_code,
    }));

    const { error } = await db
      .from('tracking_events')
      .upsert(rows, { onConflict: 'tracking_code,event_date,description', ignoreDuplicates: true });

    if (error && error.code !== '23505') throw error;
  },

  async getEvents(trackingCode) {
    const { data, error } = await db
      .from('tracking_events')
      .select('*')
      .eq('tracking_code', trackingCode)
      .order('event_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getStats() {
    const { data, error } = await db.rpc('get_shipment_stats');
    if (error) {
      const { count } = await db.from('shipments').select('*', { count: 'exact', head: true });
      return { total: count || 0, delivered: 0, in_transit: 0, out_for_delivery: 0, delivery_attempt: 0, returned: 0, waiting_client: 0 };
    }
    return data?.[0] || {};
  },

  async getCompanies() {
    const { data, error } = await db
      .from('shipments')
      .select('seller_id, company_name')
      .not('seller_id', 'is', null);
    if (error) throw error;

    const map = {};
    for (const row of data || []) {
      const key = row.seller_id;
      if (!map[key]) map[key] = { seller_id: key, company_name: row.company_name, total: 0 };
      map[key].total++;
    }
    return Object.values(map).sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''));
  },

  async getPendingForRefresh() {
    const { data, error } = await db
      .from('shipments')
      .select('*')
      .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)
      .not('customer_doc', 'is', null)
      .order('updated_at', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async countPendingForRefresh() {
    const { count, error } = await db
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)
      .not('customer_doc', 'is', null);
    if (error) return 0;
    return count || 0;
  },

  async getShipmentsWithoutMovement() {
    // Busca shipments que não estão em status terminal e não tiveram movimentação física
    const NON_MOVEMENT = ['pending', 'no_tracking', 'tracking_delayed'];
    const { data, error } = await db
      .from('shipments')
      .select('*')
      .in('status', NON_MOVEMENT)
      .not('paid_at', 'is', null);
    if (error) throw error;
    return data || [];
  },

  async updateTrackingDelayed(trackingCode) {
    const { error } = await db
      .from('shipments')
      .update({ status: 'tracking_delayed', updated_at: new Date().toISOString() })
      .eq('tracking_code', trackingCode);
    if (error) throw error;
  },

  async updatePaymentStatus(orderId, paymentStatus) {
    if (!orderId) return;
    const { error } = await db
      .from('shipments')
      .update({ payment_status: paymentStatus, updated_at: new Date().toISOString() })
      .eq('order_id', orderId);
    if (error) throw error;
  },

  // --- Scheduler logs ---

  async saveSchedulerLog({ total_cpfs, updated, promoted, errors, pending_after }) {
    const { error } = await db.from('scheduler_logs').insert({
      ran_at: new Date().toISOString(),
      total_cpfs, updated, promoted, errors, pending_after,
    });
    if (error) console.error('[Scheduler] Erro ao salvar log:', error.message);
  },

  async getLastSchedulerLog() {
    const { data, error } = await db
      .from('scheduler_logs')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    return data[0];
  },

  // --- customer_queue ---

  async enqueueCustomer(data) {
    const { error } = await db.from('customer_queue').upsert(
      {
        order_id:         data.order_id,
        seller_id:        data.seller_id        || null,
        seller_email:     data.seller_email     || null,
        company_name:     data.company_name     || null,
        customer_name:    data.customer_name    || null,
        customer_email:   data.customer_email   || null,
        customer_phone:   data.customer_phone   || null,
        customer_doc:     data.customer_doc,
        product_name:     data.product_name     || null,
        product_price:    data.product_price    || null,
        product_quantity: data.product_quantity || null,
        payment_method:   data.payment_method   || null,
        payment_status:   data.payment_status   || null,
        total_price:      data.total_price      || null,
        shipping_address: data.shipping_address || null,
        paid_at:          data.paid_at          || null,
      },
      { onConflict: 'order_id', ignoreDuplicates: false }
    );
    if (error) throw error;
  },

  async getCustomerQueue() {
    const { data, error } = await db
      .from('customer_queue')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async dequeueCustomer(orderId) {
    const { error } = await db.from('customer_queue').delete().eq('order_id', orderId);
    if (error) throw error;
  },

  // --- Tickets ---

  async getTickets(trackingCode) {
    const { data, error } = await db
      .from('tickets')
      .select('*')
      .eq('tracking_code', trackingCode)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createTicket({ tracking_code, order_id, tipo, motivo, motivo_cancelamento, observacao, created_by }) {
    const config = TICKET_CONFIG[tipo];
    if (!config) throw new Error('Tipo inválido');
    if (!config.motivos.includes(motivo)) throw new Error('Motivo inválido para este tipo');

    const priority = config.priorities[motivo] || 2;
    const assigned_to = config.assignedTo;

    const payload = {
      tracking_code,
      order_id,
      tipo,
      motivo,
      observacao: observacao || null,
      status: 'Aberto',
      priority,
      assigned_to,
      created_by: created_by || 'Suporte',
      sla_hours: 72,
    };

    if (tipo === 'RETENCAO' && motivo === 'Cancelamento' && motivo_cancelamento) {
      payload.motivo_cancelamento = motivo_cancelamento;
    }

    const { data, error } = await db.from('tickets').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async updateTicketStatus(id, newStatus) {
    const { data: ticket, error: fetchErr } = await db
      .from('tickets').select('tipo').eq('id', id).single();
    if (fetchErr) throw fetchErr;

    const config = TICKET_CONFIG[ticket.tipo];
    if (!config.statuses.includes(newStatus)) throw new Error('Status inválido para este tipo de ticket');

    const update = { status: newStatus, updated_at: new Date().toISOString() };
    if (config.terminalStatuses.includes(newStatus)) {
      update.closed_at = new Date().toISOString();
    } else {
      update.closed_at = null;
    }

    const { error } = await db.from('tickets').update(update).eq('id', id);
    if (error) throw error;
  },
};

module.exports = Shipment;
module.exports.TICKET_CONFIG = TICKET_CONFIG;
module.exports.MOTIVOS_CANCELAMENTO = MOTIVOS_CANCELAMENTO;

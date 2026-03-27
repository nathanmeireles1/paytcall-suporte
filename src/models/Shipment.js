const { db } = require('../config/database');

const TERMINAL_STATUSES = ['delivered', 'returned', 'overdue'];

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

  async findAll({ page = 1, limit = 50, status, search, seller_id } = {}) {
    const offset = (page - 1) * limit;

    let query = db.from('shipments').select('*', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (seller_id) query = query.eq('seller_id', seller_id);
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

  /**
   * Upsert vindo da Paytcall — salva dados do pedido/cliente
   * Nunca sobrescreve status/eventos que já vieram dos Correios
   */
  async upsertFromPaytcall(data) {
    const existing = await this.findByCode(data.tracking_code);

    if (!existing) {
      const { error } = await db.from('shipments').insert({
        tracking_code: data.tracking_code,
        carrier: data.carrier || null,
        order_id: data.order_id || null,
        seller_id: data.seller_id || null,
        company_name: data.company_name || null,
        customer_name: data.customer_name || null,
        customer_email: data.customer_email || null,
        customer_phone: data.customer_phone || null,
        customer_doc: data.customer_doc || null,
        product_name: data.product_name || null,
        product_price: data.product_price || null,
        product_quantity: data.product_quantity || null,
        payment_method: data.payment_method || null,
        payment_status: data.payment_status || null,
        total_price: data.total_price || null,
        shipping_address: data.shipping_address || null,
        tracking_url: data.tracking_url || null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    } else {
      // Atualiza apenas dados do pedido — preserva status/eventos dos Correios
      const { error } = await db.from('shipments')
        .update({
          carrier: data.carrier || existing.carrier,
          order_id: data.order_id || existing.order_id,
          seller_id: data.seller_id || existing.seller_id,
          company_name: data.company_name || existing.company_name,
          customer_name: data.customer_name || existing.customer_name,
          customer_email: data.customer_email || existing.customer_email,
          customer_phone: data.customer_phone || existing.customer_phone,
          customer_doc: data.customer_doc || existing.customer_doc,
          product_name: data.product_name || existing.product_name,
          product_price: data.product_price || existing.product_price,
          product_quantity: data.product_quantity || existing.product_quantity,
          payment_method: data.payment_method || existing.payment_method,
          payment_status: data.payment_status || existing.payment_status,
          total_price: data.total_price || existing.total_price,
          shipping_address: data.shipping_address || existing.shipping_address,
          tracking_url: data.tracking_url || existing.tracking_url,
          updated_at: new Date().toISOString(),
        })
        .eq('tracking_code', data.tracking_code);
      if (error) throw error;
    }

    return this.findByCode(data.tracking_code);
  },

  /**
   * Upsert vindo dos Correios — sempre sobrescreve status e eventos
   * Atualiza last_queried_at para controle do ciclo de 5 dias
   */
  async upsert(data) {
    const payload = {
      tracking_code: data.tracking_code,
      order_id: data.order_id || null,
      seller_id: data.seller_id || null,
      company_name: data.company_name || null,
      customer_name: data.customer_name || null,
      customer_email: data.customer_email || null,
      customer_phone: data.customer_phone || null,
      status: data.status || 'pending',
      last_event: data.last_event || null,
      last_event_date: data.last_event_date || null,
      last_queried_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
      event_date: ev.date,
      description: ev.description,
      location: ev.location,
      status_code: ev.status_code,
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
      // fallback manual se a função não existir ainda
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

  /**
   * Retorna todos os pedidos ativos com CPF para consulta no H7
   * Critério: não finalizados + com customer_doc (CPF obrigatório para H7)
   * Scheduler roda 2x/dia (09h e 15h BRT) — sem restrição de intervalo
   */
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

  async updatePaymentStatus(orderId, paymentStatus) {
    if (!orderId) return;
    const { error } = await db
      .from('shipments')
      .update({ payment_status: paymentStatus, updated_at: new Date().toISOString() })
      .eq('order_id', orderId);
    if (error) throw error;
  },

  // --- customer_queue: pedidos paid sem tracking_code ainda ---

  async enqueueCustomer(data) {
    const { error } = await db.from('customer_queue').upsert(
      {
        order_id: data.order_id,
        seller_id: data.seller_id || null,
        company_name: data.company_name || null,
        customer_name: data.customer_name || null,
        customer_email: data.customer_email || null,
        customer_phone: data.customer_phone || null,
        customer_doc: data.customer_doc,
        product_name: data.product_name || null,
        product_price: data.product_price || null,
        product_quantity: data.product_quantity || null,
        payment_method: data.payment_method || null,
        payment_status: data.payment_status || null,
        total_price: data.total_price || null,
        shipping_address: data.shipping_address || null,
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
    const { error } = await db
      .from('customer_queue')
      .delete()
      .eq('order_id', orderId);
    if (error) throw error;
  },
};

module.exports = Shipment;

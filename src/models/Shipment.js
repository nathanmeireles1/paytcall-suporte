const { db } = require('../config/database');

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
    const { data: rows, error } = await db.from('shipments').select('status');
    if (error) throw error;
    const count = (s) => (rows || []).filter(r => r.status === s).length;
    const countIn = (...ss) => (rows || []).filter(r => ss.includes(r.status)).length;
    return {
      total: (rows || []).length,
      delivered: count('delivered'),
      in_transit: countIn('forwarded', 'posted_object'),
      out_for_delivery: count('delivering'),
      delivery_attempt: count('recipient_not_found'),
      returned: countIn('returned', 'returning'),
      waiting_client: count('waiting_client'),
    };
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
      .eq('status', 'waiting_client')
      .order('updated_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    return data || [];
  },
};

module.exports = Shipment;

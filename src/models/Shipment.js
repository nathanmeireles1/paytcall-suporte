const { db } = require('../config/database');

const Shipment = {
  async findByCode(trackingCode) {
    const r = await db.execute({ sql: 'SELECT * FROM shipments WHERE tracking_code = ?', args: [trackingCode] });
    return r.rows[0] || null;
  },

  async findAll({ page = 1, limit = 50, status, search } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (search) {
      conditions.push('(tracking_code LIKE ? OR order_id LIKE ? OR customer_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows, countRes] = await Promise.all([
      db.execute({ sql: `SELECT * FROM shipments ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, args: [...params, limit, offset] }),
      db.execute({ sql: `SELECT COUNT(*) as count FROM shipments ${where}`, args: params }),
    ]);

    const total = Number(countRes.rows[0]?.count || 0);
    return { rows: rows.rows, total, page, pages: Math.ceil(total / limit) };
  },

  async upsert(data) {
    const existing = await this.findByCode(data.tracking_code);

    if (existing) {
      await db.execute({
        sql: `UPDATE shipments SET
          order_id = COALESCE(?, order_id),
          customer_name = COALESCE(?, customer_name),
          customer_email = COALESCE(?, customer_email),
          customer_phone = COALESCE(?, customer_phone),
          status = ?,
          last_event = ?,
          last_event_date = ?,
          last_queried_at = datetime('now'),
          updated_at = datetime('now')
        WHERE tracking_code = ?`,
        args: [
          data.order_id || null,
          data.customer_name || null,
          data.customer_email || null,
          data.customer_phone || null,
          data.status,
          data.last_event || null,
          data.last_event_date || null,
          data.tracking_code,
        ],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO shipments (tracking_code, order_id, customer_name, customer_email, customer_phone, status, last_event, last_event_date, last_queried_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          data.tracking_code,
          data.order_id || null,
          data.customer_name || null,
          data.customer_email || null,
          data.customer_phone || null,
          data.status || 'pending',
          data.last_event || null,
          data.last_event_date || null,
        ],
      });
    }

    return this.findByCode(data.tracking_code);
  },

  async saveEvents(trackingCode, events) {
    for (const ev of events) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO tracking_events (tracking_code, event_date, description, location, status_code)
              VALUES (?, ?, ?, ?, ?)`,
        args: [trackingCode, ev.date, ev.description, ev.location, ev.status_code],
      }).catch(() => {});
    }
  },

  async getEvents(trackingCode) {
    const r = await db.execute({
      sql: 'SELECT * FROM tracking_events WHERE tracking_code = ? ORDER BY event_date DESC',
      args: [trackingCode],
    });
    return r.rows;
  },

  async getStats() {
    const r = await db.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'in_transit' THEN 1 ELSE 0 END) as in_transit,
        SUM(CASE WHEN status = 'out_for_delivery' THEN 1 ELSE 0 END) as out_for_delivery,
        SUM(CASE WHEN status = 'delivery_attempt' THEN 1 ELSE 0 END) as delivery_attempt,
        SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) as returned,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM shipments
    `);
    return r.rows[0] || {};
  },

  async getPendingForRefresh() {
    const r = await db.execute(
      `SELECT * FROM shipments WHERE status NOT IN ('delivered', 'returned') ORDER BY updated_at ASC LIMIT 50`
    );
    return r.rows;
  },
};

module.exports = Shipment;

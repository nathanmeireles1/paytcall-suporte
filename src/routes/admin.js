const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /admin/users — lista todos os usuários
router.get('/users', requireAuth, requireRole(['admin']), async (req, res) => {
  const { data: users } = await db
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  // Busca acessos de empresa para cada terceiro
  const terceiros = (users || []).filter(u => u.role === 'terceiros');
  const accessMap = {};
  if (terceiros.length > 0) {
    const { data: access } = await db
      .from('user_company_access')
      .select('user_id, seller_id')
      .in('user_id', terceiros.map(t => t.id));
    for (const a of (access || [])) {
      if (!accessMap[a.user_id]) accessMap[a.user_id] = [];
      accessMap[a.user_id].push(a.seller_id);
    }
  }

  // Busca empresas para o dropdown
  const { data: shipments } = await db
    .from('shipments')
    .select('seller_id, company_name')
    .not('seller_id', 'is', null);

  const companyMap = {};
  for (const s of (shipments || [])) {
    if (s.seller_id && !companyMap[s.seller_id]) {
      companyMap[s.seller_id] = s.company_name || s.seller_id;
    }
  }

  res.render('admin-users', {
    users: users || [],
    accessMap,
    companies: companyMap,
  });
});

// POST /admin/users/invite — cria convite
router.post('/users/invite', requireAuth, requireRole(['admin']), async (req, res) => {
  const { email, name, role, seller_ids } = req.body;

  if (!email || !name || !role) {
    return res.status(400).json({ error: 'Email, nome e papel são obrigatórios' });
  }

  const validRoles = ['admin', 'suporte', 'usuario', 'terceiros'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  // Verifica se email já existe
  const { data: existing } = await db
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return res.status(400).json({ error: 'Email já cadastrado' });
  }

  const invite_token = crypto.randomBytes(32).toString('hex');
  const invite_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: profile, error } = await db
    .from('user_profiles')
    .insert({
      email,
      name,
      role,
      invite_token,
      invite_expires_at,
      invited_by: req.user.id,
    })
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  // Se é terceiros, salva seller_ids
  if (role === 'terceiros' && seller_ids) {
    const ids = Array.isArray(seller_ids) ? seller_ids : [seller_ids];
    for (const sid of ids) {
      if (sid) {
        await db.from('user_company_access').insert({
          user_id: profile.id,
          seller_id: sid,
        });
      }
    }
  }

  const baseUrl = req.protocol + '://' + req.get('host');
  const inviteLink = `${baseUrl}/invite/${invite_token}`;

  res.json({ ok: true, inviteLink });
});

// POST /admin/users/:id/role — altera role
router.post('/users/:id/role', requireAuth, requireRole(['admin']), async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'suporte', 'usuario', 'terceiros'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  await db.from('user_profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  res.json({ ok: true });
});

// POST /admin/users/:id/toggle — ativa/desativa
router.post('/users/:id/toggle', requireAuth, requireRole(['admin']), async (req, res) => {
  const { data: user } = await db.from('user_profiles').select('active').eq('id', req.params.id).single();
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  await db.from('user_profiles').update({ active: !user.active, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  res.json({ ok: true, active: !user.active });
});

// POST /admin/users/:id/companies — atualiza seller_ids de terceiro
router.post('/users/:id/companies', requireAuth, requireRole(['admin']), async (req, res) => {
  const { seller_ids } = req.body;
  const ids = Array.isArray(seller_ids) ? seller_ids : seller_ids ? [seller_ids] : [];

  // Remove todos e reinsere
  await db.from('user_company_access').delete().eq('user_id', req.params.id);
  for (const sid of ids) {
    if (sid) {
      await db.from('user_company_access').insert({ user_id: req.params.id, seller_id: sid });
    }
  }
  res.json({ ok: true });
});

module.exports = router;

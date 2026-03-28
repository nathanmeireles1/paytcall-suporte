const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/database');
const { requireAuth, requirePermission, loadPermissions, invalidatePermissionsCache } = require('../middleware/auth');

// Módulos disponíveis no sistema
const MODULES = [
  { key: 'dashboard',                label: 'Painel (Dashboard)' },
  { key: 'tickets',                  label: 'Tickets' },
  { key: 'relatorio_tickets',        label: 'Relatório de Tickets' },
  { key: 'relatorio_cancelamentos',  label: 'Relatório de Cancelamentos' },
  { key: 'admin_usuarios',           label: 'Admin — Usuários' },
  { key: 'admin_permissoes',         label: 'Admin — Permissões' },
  { key: 'tracking',                 label: 'Rastreamento (API)' },
  { key: 'notificacoes',             label: 'Notificações' },
];
const ROLES = ['admin', 'suporte', 'usuario', 'terceiros'];
const ROLE_LABELS = { admin: 'Administrador', suporte: 'Suporte', usuario: 'Usuário', terceiros: 'Terceiros' };

// GET /admin/users — lista todos os usuários
router.get('/users', requireAuth, requirePermission('admin_usuarios', 'can_view'), async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[Admin] Erro em /users:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar usuários: ' + err.message });
  }
});

// POST /admin/users/invite — cria convite
router.post('/users/invite', requireAuth, requirePermission('admin_usuarios', 'can_create'), async (req, res) => {
  try {
    const { email, name, role, seller_ids } = req.body;

    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, nome e papel são obrigatórios' });
    }

    if (!ROLES.includes(role)) {
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
  } catch (err) {
    console.error('[Admin] Erro ao convidar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/users/:id/role — altera role
router.post('/users/:id/role', requireAuth, requirePermission('admin_usuarios', 'can_edit'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'Papel inválido' });
    }
    await db.from('user_profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/users/:id/toggle — ativa/desativa
router.post('/users/:id/toggle', requireAuth, requirePermission('admin_usuarios', 'can_edit'), async (req, res) => {
  try {
    const { data: user } = await db.from('user_profiles').select('active').eq('id', req.params.id).single();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    await db.from('user_profiles').update({ active: !user.active, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ ok: true, active: !user.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/users/:id/companies — atualiza seller_ids de terceiro
router.post('/users/:id/companies', requireAuth, requirePermission('admin_usuarios', 'can_edit'), async (req, res) => {
  try {
    const { seller_ids } = req.body;
    const ids = Array.isArray(seller_ids) ? seller_ids : seller_ids ? [seller_ids] : [];

    await db.from('user_company_access').delete().eq('user_id', req.params.id);
    for (const sid of ids) {
      if (sid) {
        await db.from('user_company_access').insert({ user_id: req.params.id, seller_id: sid });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// PERMISSÕES POR MÓDULO
// =====================

// GET /admin/permissions — Tela de permissões
router.get('/permissions', requireAuth, requirePermission('admin_permissoes', 'can_view'), async (req, res) => {
  try {
    const perms = await loadPermissions();
    res.render('admin-permissions', {
      MODULES,
      ROLES,
      ROLE_LABELS,
      permissions: perms,
    });
  } catch (err) {
    console.error('[Admin] Erro em /permissions:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar permissões: ' + err.message });
  }
});

// POST /admin/permissions — Salvar permissões
router.post('/permissions', requireAuth, requirePermission('admin_permissoes', 'can_edit'), async (req, res) => {
  try {
    const updates = req.body; // { "admin|dashboard|can_view": "on", ... }

    // Reconstrói a matrix completa
    const rows = [];
    for (const role of ROLES) {
      for (const mod of MODULES) {
        rows.push({
          role,
          module: mod.key,
          can_view:   updates[`${role}|${mod.key}|can_view`] === 'on',
          can_create: updates[`${role}|${mod.key}|can_create`] === 'on',
          can_edit:   updates[`${role}|${mod.key}|can_edit`] === 'on',
          can_delete: updates[`${role}|${mod.key}|can_delete`] === 'on',
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Upsert cada linha
    for (const row of rows) {
      const { error } = await db.from('role_permissions').upsert(row, {
        onConflict: 'role,module',
      });
      if (error) console.error('[Permissions] Erro upsert:', row.role, row.module, error.message);
    }

    // Invalida cache
    invalidatePermissionsCache();

    res.redirect('/admin/permissions?saved=1');
  } catch (err) {
    console.error('[Admin] Erro ao salvar permissões:', err.message);
    res.status(500).render('error', { message: 'Erro ao salvar permissões: ' + err.message });
  }
});

// GET /admin/settings
router.get('/settings', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Acesso negado' });
  const { data: settings } = await db.from('portal_settings').select('*').order('key');
  res.render('admin-settings', { settings: settings || [], saved: req.query.saved });
});

// POST /admin/settings
router.post('/settings', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Acesso negado' });
  const { key, value } = req.body;
  if (!key) return res.redirect('/admin/settings');
  await db.from('portal_settings').upsert({ key, value, updated_at: new Date().toISOString(), updated_by: req.user.name });
  res.redirect('/admin/settings?saved=1');
});

module.exports = router;

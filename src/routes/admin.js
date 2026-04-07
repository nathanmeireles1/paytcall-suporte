const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/database');
const { requireAuth, requirePermission, loadPermissions, invalidatePermissionsCache } = require('../middleware/auth');
const { sendInviteEmail } = require('../services/mailer');
const { logAudit } = require('../services/audit');

// Módulos disponíveis no sistema
const MODULES = [
  { key: 'dashboard',                label: 'Painel (Dashboard)' },
  { key: 'tickets',                  label: 'Tickets' },
  { key: 'relatorio_tickets',        label: 'Relatório de Tickets' },
  { key: 'relatorio_cancelamentos',  label: 'Relatório de Cancelamentos (Retenção)' },
  { key: 'relatorio_logistica',      label: 'Relatório de Logística' },
  { key: 'admin_usuarios',           label: 'Admin — Usuários' },
  { key: 'admin_permissoes',         label: 'Admin — Permissões' },
  { key: 'tracking',                 label: 'Rastreamento (API)' },
  { key: 'notificacoes',             label: 'Notificações' },
  { key: 'rastreio_log',             label: 'Logs de Rastreio (Agendado + Manual)' },
];
const ROLES = ['admin', 'suporte', 'logistica', 'retencao', 'usuario', 'terceiros'];
const ROLE_LABELS = { admin: 'Administrador', suporte: 'Suporte', logistica: 'Logística', retencao: 'Retenção', usuario: 'Usuário', terceiros: 'Terceiros' };

// Helper — carrega dados da página de configurações (usuários + permissões + settings)
async function loadConfigData(req) {
  const [
    { data: users },
    { data: access },
    { data: shipments },
    { data: settings },
  ] = await Promise.all([
    db.from('user_profiles').select('*').order('created_at', { ascending: false }),
    db.from('user_company_access').select('user_id, seller_id'),
    db.from('shipments').select('seller_id, company_name').not('seller_id', 'is', null),
    db.from('portal_settings').select('*').order('key'),
  ]);

  const accessMap = {};
  for (const a of (access || [])) {
    if (!accessMap[a.user_id]) accessMap[a.user_id] = [];
    accessMap[a.user_id].push(a.seller_id);
  }
  const companyMap = {};
  for (const s of (shipments || [])) {
    if (s.seller_id && !companyMap[s.seller_id]) companyMap[s.seller_id] = s.company_name || s.seller_id;
  }
  const perms = await loadPermissions();

  return { users: users || [], accessMap, companies: companyMap, settings: settings || [], permissions: perms };
}

// GET /admin/configuracoes — página unificada (usuários + permissões + sistema)
router.get('/configuracoes', requireAuth, requirePermission('admin_usuarios', 'can_view'), async (req, res) => {
  try {
    const data = await loadConfigData(req);
    const savedTab = req.query.saved; // 'usuarios' | 'permissoes' | 'sistema'
    res.render('admin-configuracoes', {
      ...data, MODULES, ROLES, ROLE_LABELS,
      saved: !!savedTab,
      savedMessage: savedTab === 'permissoes' ? 'Permissões salvas com sucesso!'
                  : savedTab === 'sistema'    ? 'Configuração salva com sucesso!'
                  : savedTab === 'usuarios'   ? 'Usuário atualizado com sucesso!' : '',
      activeTab: req.query.tab || 'usuarios',
    });
  } catch (err) {
    console.error('[Admin] Erro em /configuracoes:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar configurações: ' + err.message });
  }
});

// Redirects de compatibilidade para URLs antigas
router.get('/users',       requireAuth, (req, res) => res.redirect('/admin/configuracoes?tab=usuarios'));
router.get('/permissions', requireAuth, (req, res) => res.redirect('/admin/configuracoes?tab=permissoes'));
router.get('/settings',    requireAuth, (req, res) => res.redirect('/admin/configuracoes?tab=sistema'));

// POST /admin/users/invite — cria usuário (com senha imediata ou convite por link)
router.post('/users/invite', requireAuth, requirePermission('admin_usuarios', 'can_create'), async (req, res) => {
  try {
    const { email, name, role, seller_ids, password } = req.body;

    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, nome e papel são obrigatórios' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'Papel inválido' });
    }

    // Verifica se email já existe
    const { data: existing } = await db.from('user_profiles').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Email já cadastrado' });

    const saveCompanyAccess = async (profileId) => {
      if (role === 'terceiros' && seller_ids) {
        const ids = Array.isArray(seller_ids) ? seller_ids : [seller_ids];
        for (const sid of ids) {
          if (sid) await db.from('user_company_access').insert({ user_id: profileId, seller_id: sid });
        }
      }
    };

    // ── Fluxo 1: senha definida na hora → usuário ativo imediatamente
    if (password && password.length >= 6) {
      const { data: authData, error: authError } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authError) return res.status(400).json({ error: authError.message });

      const { data: profile, error: profileError } = await db.from('user_profiles').insert({
        email,
        name,
        role,
        auth_id: authData.user.id,
        active: true,
        invited_by: req.user.id,
      }).select().single();

      if (profileError) {
        await db.auth.admin.deleteUser(authData.user.id).catch(() => {});
        return res.status(400).json({ error: profileError.message });
      }

      await saveCompanyAccess(profile.id);
      logAudit(req.user, 'usuario.criar', { entityType: 'usuario', entityId: profile.id, entityName: email, details: { role, immediate: true } });
      return res.json({ ok: true, immediate: true, emailSent: false });
    }

    // ── Fluxo 2: sem senha → convite por link
    const invite_token = crypto.randomBytes(32).toString('hex');
    const invite_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: profile, error } = await db.from('user_profiles').insert({
      email, name, role, invite_token, invite_expires_at, invited_by: req.user.id,
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });

    await saveCompanyAccess(profile.id);

    const baseUrl = process.env.APP_URL || (req.protocol + '://' + req.get('host'));
    const inviteLink = `${baseUrl}/invite/${invite_token}`;

    const emailSent = await sendInviteEmail({
      to: email, name, inviteLink, inviterName: req.user.name,
    }).catch(err => { console.error('[Admin] Erro ao enviar email:', err.message); return false; });

    logAudit(req.user, 'usuario.convidar', { entityType: 'usuario', entityId: profile.id, entityName: email, details: { role, emailSent } });
    res.json({ ok: true, immediate: false, inviteLink, emailSent });
  } catch (err) {
    console.error('[Admin] Erro ao criar usuário:', err.message);
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
    const { data: target } = await db.from('user_profiles').select('email, name').eq('id', req.params.id).maybeSingle();
    const { error } = await db.from('user_profiles').update({ role }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    logAudit(req.user, 'usuario.alterar_role', { entityType: 'usuario', entityId: req.params.id, entityName: target?.email, details: { novo_role: role } });
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

    const { data: tgt } = await db.from('user_profiles').select('email').eq('id', req.params.id).maybeSingle();
    await db.from('user_profiles').update({ active: !user.active, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    logAudit(req.user, user.active ? 'usuario.desativar' : 'usuario.ativar', { entityType: 'usuario', entityId: req.params.id, entityName: tgt?.email });
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

// DELETE /admin/users/:id — remove usuário (pendente ou ativo)
router.delete('/users/:id', requireAuth, requirePermission('admin_usuarios', 'can_delete'), async (req, res) => {
  try {
    const { data: user } = await db.from('user_profiles').select('auth_id, name').eq('id', req.params.id).maybeSingle();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Se tem auth_id, remove também do Supabase Auth
    if (user.auth_id) {
      const { error: authErr } = await db.auth.admin.deleteUser(user.auth_id);
      if (authErr) return res.status(400).json({ error: 'Erro ao remover autenticação: ' + authErr.message });
    }

    await db.from('user_company_access').delete().eq('user_id', req.params.id);
    await db.from('user_profiles').delete().eq('id', req.params.id);
    logAudit(req.user, 'usuario.excluir', { entityType: 'usuario', entityId: req.params.id, entityName: user.name });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/users/:id/resend-invite — reenvia email de convite
router.post('/users/:id/resend-invite', requireAuth, requirePermission('admin_usuarios', 'can_edit'), async (req, res) => {
  try {
    const { data: user } = await db.from('user_profiles').select('*').eq('id', req.params.id).maybeSingle();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (user.auth_id) return res.status(400).json({ error: 'Usuário já ativou a conta' });

    // Renova token e prazo
    const invite_token = crypto.randomBytes(32).toString('hex');
    const invite_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.from('user_profiles').update({ invite_token, invite_expires_at }).eq('id', req.params.id);

    const baseUrl = process.env.APP_URL || (req.protocol + '://' + req.get('host'));
    const inviteLink = `${baseUrl}/invite/${invite_token}`;

    const emailSent = await sendInviteEmail({
      to: user.email, name: user.name, inviteLink, inviterName: req.user.name,
    }).catch(() => false);

    res.json({ ok: true, inviteLink, emailSent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/users/:id/password — define nova senha para usuário ativo
router.post('/users/:id/password', requireAuth, requirePermission('admin_usuarios', 'can_edit'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });

    const { data: user } = await db.from('user_profiles').select('auth_id').eq('id', req.params.id).maybeSingle();
    if (!user?.auth_id) return res.status(400).json({ error: 'Usuário ainda não ativou a conta' });

    const { error } = await db.auth.admin.updateUserById(user.auth_id, { password });
    if (error) return res.status(400).json({ error: error.message });

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
    logAudit(req.user, 'permissoes.salvar', { entityType: 'permissao' });
    res.redirect('/admin/configuracoes?tab=permissoes&saved=permissoes');
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
  logAudit(req.user, 'configuracao.salvar', { entityType: 'configuracao', entityName: key });
  res.redirect('/admin/configuracoes?tab=sistema&saved=sistema');
});

// GET /admin/mural
router.get('/mural', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Acesso negado' });
  const { data } = await db.from('portal_settings').select('value').eq('key', 'mural_notices').maybeSingle();
  let notices = [];
  try { notices = JSON.parse(data?.value || '[]'); } catch(e) {}
  res.render('admin-mural', { notices, saved: req.query.saved });
});

// POST /admin/mural
router.post('/mural', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Acesso negado' });
  const { data } = await db.from('portal_settings').select('value').eq('key', 'mural_notices').maybeSingle();
  let notices = [];
  try { notices = JSON.parse(data?.value || '[]'); } catch(e) {}

  if (req.body.action === 'add') {
    notices.unshift({ title: req.body.title, message: req.body.message, tipo: req.body.tipo || 'info', author: req.user.name, created_at: new Date().toISOString() });
  } else if (req.body.action === 'delete') {
    const idx = parseInt(req.body.idx);
    if (!isNaN(idx)) notices.splice(idx, 1);
  }

  await db.from('portal_settings').upsert({ key: 'mural_notices', value: JSON.stringify(notices), updated_at: new Date().toISOString(), updated_by: req.user.name });
  res.redirect('/admin/mural?saved=1');
});

// GET /admin/docs — Documentação do sistema
router.get('/docs', requireAuth, requirePermission('admin_usuarios', 'can_view'), async (req, res) => {
  res.render('admin-docs');
});

// GET /admin/ia — Agente Lina
router.get('/ia', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Acesso negado' });
  res.render('admin-ia', { currentUser: req.user });
});

// GET /admin/auditoria — Log de auditoria global
router.get('/auditoria', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Acesso negado' });
  try {
    const { action, user: userFilter, page = 1 } = req.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;

    let query = db.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (action && action !== 'all') query = query.ilike('action', action + '%');
    if (userFilter) query = query.ilike('user_email', '%' + userFilter + '%');

    const { data: logs, count, error } = await query;
    if (error) throw error;

    const total = count || 0;
    const pages = Math.ceil(total / limit);
    res.render('admin-auditoria', {
      logs: logs || [],
      total, pages,
      currentPage: parseInt(page),
      perPage: limit,
      filters: { action: action || '', user: userFilter || '' },
    });
  } catch (err) {
    console.error('[Admin/Auditoria] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar auditoria: ' + err.message });
  }
});

// GET /admin/bi — Power BI embed (somente admin)
router.get('/bi', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Acesso negado' });
  try {
    const { data: config } = await db
      .from('configuracoes')
      .select('valor')
      .eq('id', 'powerbi')
      .maybeSingle();

    let embedUrl = null, pageName = null;
    if (config?.valor) {
      try {
        const parsed = typeof config.valor === 'string' ? JSON.parse(config.valor) : config.valor;
        embedUrl = parsed.embedUrl || null;
        pageName = parsed.pageName || null;
      } catch (_) {}
    }

    res.render('gestao-bi', { activePage: 'admin-bi', embedUrl, pageName });
  } catch (err) {
    console.error('[Admin/BI] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar BI: ' + err.message });
  }
});

module.exports = router;

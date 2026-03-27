const { db } = require('../config/database');

// Verifica se o cookie contém um JWT válido do Supabase Auth
async function requireAuth(req, res, next) {
  const token = req.cookies?.auth_token;
  const isApi = req.path.startsWith('/api') || req.xhr || req.headers.accept?.includes('json');

  const deny = (msg) => {
    res.clearCookie('auth_token');
    if (isApi) return res.status(401).json({ error: msg || 'Não autenticado' });
    return res.redirect('/login');
  };

  if (!token) return deny();

  try {
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return deny();

    // Busca perfil completo
    const { data: profile } = await db
      .from('user_profiles')
      .select('*')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (!profile || !profile.active) return deny('Conta desativada');

    // Disponibiliza no request
    req.user = {
      id: profile.id,
      auth_id: user.id,
      email: user.email,
      name: profile.name,
      role: profile.role,
    };

    // Para terceiros, busca seller_ids permitidos
    if (profile.role === 'terceiros') {
      const { data: access } = await db
        .from('user_company_access')
        .select('seller_id')
        .eq('user_id', profile.id);
      req.user.seller_ids = (access || []).map(a => a.seller_id);
    }

    // Disponibiliza para EJS
    res.locals.currentUser = req.user;

    next();
  } catch (err) {
    console.error('[Auth] Erro:', err.message);
    return deny('Erro de autenticação');
  }
}

// Verifica se o usuário tem uma das roles permitidas
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      if (req.path.startsWith('/api') || req.headers.accept?.includes('json')) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
      return res.status(403).render('error', { message: 'Acesso negado — permissão insuficiente' });
    }
    next();
  };
}

// Auth para rotas de API (webhook, tracking) — sem redirect
async function requireApiAuth(req, res, next) {
  // Webhook usa chave própria, não precisa de auth de usuário
  // Tracking API pode usar Basic Auth para compatibilidade
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS;
  if (!adminPass) return next();

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user !== adminUser || pass !== adminPass) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireApiAuth };

const express = require('express');
const router = express.Router();
const { db, dbGestao } = require('../config/database');

// Helper: lê colaboradores ativos do portal-gestao (rh_colaboradores)
// Retorna array normalizado com {email, nome, primeiro_nome, equipe, regiao, ativo}
let _colabCache = null;
let _colabCacheTs = 0;
async function getColaboradores() {
  if (_colabCache && Date.now() - _colabCacheTs < 5 * 60 * 1000) return _colabCache;
  if (!dbGestao) return [];
  const { data } = await dbGestao
    .from('rh_colaboradores')
    .select('email_corporativo, nome, setor, unidade, status')
    .not('email_corporativo', 'is', null);
  _colabCache = (data || []).map(c => ({
    email:        c.email_corporativo.toLowerCase().trim(),
    nome:         c.nome || '',
    primeiro_nome: (c.nome || '').split(' ')[0],
    equipe:       c.setor   || null,
    regiao:       c.unidade || null,
    ativo:        c.status === 'Ativo',
  }));
  _colabCacheTs = Date.now();
  return _colabCache;
}
const { requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

// ── Cache em memória (45s) para respostas da API de Vendas ────────────────────
const _apiCache = new Map();
let _nichoCache    = null;
let _nichoSkuCache = null;
let _nichoCacheTs  = 0;

// Permissão de edição: admin ou role_permissions.catalogo.can_edit
function canEdit(req, res, next) {
  const role = req.user.role;
  const perms = req.user.permissions || {};
  if (role === 'admin' || perms.catalogo?.can_edit) return next();
  return res.status(403).render('error', { message: 'Sem permissão para editar o catálogo' });
}

// Exclusão: somente admin
function canDelete(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Apenas administradores podem excluir registros' });
  }
  next();
}

// Helper: resolve canEdit para passar às views
function userCanEdit(req) {
  return req.user.role === 'admin' || !!(req.user.permissions?.catalogo?.can_edit);
}

// ─── CATÁLOGO (Empresas + Produtos + Nichos unificados) ──────────────────────

// Redirects de URLs antigas
router.get('/empresas', (req, res) => res.redirect('/gestao/catalogo?tab=empresas'));
router.get('/produtos',  (req, res) => res.redirect('/gestao/catalogo?tab=produtos'));
router.get('/segmentos', (req, res) => res.redirect('/gestao/catalogo?tab=nichos'));
router.get('/segmentos/:slug', (req, res) => res.redirect('/gestao/catalogo?tab=nichos'));

// GET /gestao/catalogo
router.get('/catalogo', async (req, res) => {
  try {
    const [
      { data: empresas, error: empErr },
      { data: produtos, error: prodErr },
    ] = await Promise.all([
      db.from('empresas').select('*').order('nome'),
      db.from('produtos').select('*').order('nome'),
    ]);

    if (empErr) throw empErr;
    if (prodErr) throw prodErr;

    const segmentosUnicos = [...new Set((empresas || []).map(e => e.segmento).filter(Boolean))].sort();

    const nichosCount = {};
    for (const p of (produtos || [])) {
      const n = p.nicho || 'Sem categoria';
      nichosCount[n] = (nichosCount[n] || 0) + 1;
    }
    const nichos = Object.entries(nichosCount)
      .map(([nicho, total]) => ({ nicho, total }))
      .sort((a, b) => a.nicho.localeCompare(b.nicho));

    const porNicho = {};
    for (const p of (produtos || [])) {
      const n = p.nicho || 'Sem categoria';
      if (!porNicho[n]) porNicho[n] = [];
      porNicho[n].push(p);
    }

    const nichosUnicos = [...new Set((produtos || []).map(p => p.nicho).filter(Boolean))].sort();

    // Slugs com fotos e/ou vídeos no storage (verifica subpastas de cada slug)
    const slugsComFotos  = new Set();
    const slugsComVideos = new Set();
    try {
      const { data: slugFolders } = await db.storage.from('produtos-midias').list('playbooks', { limit: 500 });
      if (slugFolders && slugFolders.length) {
        await Promise.all(slugFolders.map(async (f) => {
          if (!f.name) return;
          const { data: subs } = await db.storage.from('produtos-midias').list(`playbooks/${f.name}`, { limit: 10 });
          if (subs) {
            const subNames = subs.map(s => s.name);
            if (subNames.includes('fotos'))       slugsComFotos.add(f.name);
            if (subNames.includes('depoimentos')) slugsComVideos.add(f.name);
          }
        }));
      }
    } catch (_) {}

    res.render('gestao-catalogo', {
      activePage: 'gestao-catalogo',
      empresas: empresas || [],
      produtos: produtos || [],
      nichos,
      porNicho,
      segmentos: segmentosUnicos,
      nichosUnicos,
      tab: req.query.tab || 'empresas',
      canEdit: userCanEdit(req),
      isAdmin: req.user.role === 'admin',
      slugsComFotos:  [...slugsComFotos],
      slugsComVideos: [...slugsComVideos],
    });
  } catch (err) {
    console.error('[Gestao/Catalogo] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar catálogo: ' + err.message });
  }
});

// ─── EMPRESAS ────────────────────────────────────────────────────────────────

// GET /gestao/empresas/:id
router.get('/empresas/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [{ data: empresa, error }, { data: feedbacks }, { data: todosProdutos }] = await Promise.all([
      db.from('empresas').select('*').eq('id', id).maybeSingle(),
      db.from('feedbacks').select('*').order('dt_criacao', { ascending: false }),
      db.from('produtos').select('id,nome,nicho,sku,playbook_slug,status,empresa').order('nome'),
    ]);

    if (error) throw error;
    if (!empresa) return res.status(404).render('error', { message: 'Empresa não encontrada' });

    const feedbacksEmpresa = (feedbacks || []).filter(
      f => f.empresa && f.empresa.toLowerCase() === empresa.nome.toLowerCase()
    );
    const produtosEmpresa = (todosProdutos || []).filter(
      p => p.empresa && p.empresa.toLowerCase() === empresa.nome.toLowerCase()
    );

    res.render('gestao-empresa-detalhe', {
      activePage: 'gestao-catalogo',
      empresa,
      feedbacks: feedbacksEmpresa,
      produtos: produtosEmpresa,
      canEdit: userCanEdit(req),
      isAdmin: req.user.role === 'admin',
    });
  } catch (err) {
    console.error('[Gestao/Empresa] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar empresa: ' + err.message });
  }
});

// POST /gestao/empresas — criar
router.post('/empresas', canEdit, async (req, res) => {
  try {
    const campos = ['nome','segmento','status','cnpj','email','telefone','contato','site','cidade','estado','descricao'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { data: nova, error } = await db.from('empresas').insert(data).select().maybeSingle();
    if (error) throw error;
    logAudit(req.user, 'empresa.criar', { entityType: 'empresa', entityId: nova.id, entityName: data.nome });
    res.redirect(`/gestao/empresas/${nova.id}`);
  } catch (err) {
    console.error('[Gestao/Empresa/Criar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao criar empresa: ' + err.message });
  }
});

// POST /gestao/empresas/:id/editar
router.post('/empresas/:id/editar', canEdit, async (req, res) => {
  try {
    const { id } = req.params;
    const campos = ['nome','segmento','status','cnpj','email','telefone','contato','site','cidade','estado','descricao'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { error } = await db.from('empresas').update(data).eq('id', id);
    if (error) throw error;
    logAudit(req.user, 'empresa.editar', { entityType: 'empresa', entityId: id, entityName: data.nome });
    res.redirect(`/gestao/empresas/${id}`);
  } catch (err) {
    console.error('[Gestao/Empresa/Editar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao editar empresa: ' + err.message });
  }
});

// POST /gestao/empresas/:id/excluir
router.post('/empresas/:id/excluir', canDelete, async (req, res) => {
  try {
    const { data: emp } = await db.from('empresas').select('nome').eq('id', req.params.id).maybeSingle();
    const { error } = await db.from('empresas').delete().eq('id', req.params.id);
    if (error) throw error;
    logAudit(req.user, 'empresa.excluir', { entityType: 'empresa', entityId: req.params.id, entityName: emp?.nome });
    res.redirect('/gestao/catalogo?tab=empresas');
  } catch (err) {
    console.error('[Gestao/Empresa/Excluir] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao excluir empresa: ' + err.message });
  }
});

// ─── PRODUTOS ────────────────────────────────────────────────────────────────

// GET /gestao/produtos/:id
router.get('/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [{ data: produto, error }, { data: feedbacks }] = await Promise.all([
      db.from('produtos').select('*').eq('id', id).maybeSingle(),
      db.from('feedbacks').select('*').order('dt_criacao', { ascending: false }),
    ]);

    if (error) throw error;
    if (!produto) return res.status(404).render('error', { message: 'Produto não encontrado' });

    const feedbacksProduto = (feedbacks || []).filter(
      f => f.produto && f.produto.toLowerCase() === produto.nome.toLowerCase()
    );

    let fotos = [];
    let depoimentos = [];
    const slug = produto.playbook_slug || produto.id;
    const [{ data: fotosData }, { data: depData }] = await Promise.all([
      db.storage.from('produtos-midias').list(`playbooks/${slug}/fotos`),
      db.storage.from('produtos-midias').list(`playbooks/${slug}/depoimentos`),
    ]);

    const getUrl = (path) => db.storage.from('produtos-midias').getPublicUrl(path).data.publicUrl;
    fotos = (fotosData || []).filter(f => f.name !== '.emptyFolderPlaceholder').map(f => ({
      url: getUrl(`playbooks/${slug}/fotos/${f.name}`),
      path: `playbooks/${slug}/fotos/${f.name}`,
      name: f.name,
    }));
    depoimentos = (depData || []).filter(d => d.name !== '.emptyFolderPlaceholder').map(d => ({
      url: getUrl(`playbooks/${slug}/depoimentos/${d.name}`),
      path: `playbooks/${slug}/depoimentos/${d.name}`,
      name: d.name,
      isVideo: /\.(mp4|webm|mov)$/i.test(d.name),
    }));

    res.render('gestao-produto-detalhe', {
      activePage: 'gestao-catalogo',
      produto,
      feedbacks: feedbacksProduto,
      fotos,
      depoimentos,
      playbook_slug: slug,
      canEdit: userCanEdit(req),
      isAdmin: req.user.role === 'admin',
    });
  } catch (err) {
    console.error('[Gestao/Produto] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar produto: ' + err.message });
  }
});

// POST /gestao/produtos — criar
router.post('/produtos', canEdit, async (req, res) => {
  try {
    const campos = ['nome','empresa','nicho','sku','o_que_e','composicao','como_funciona','descricao','playbook_slug'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { data: novo, error } = await db.from('produtos').insert(data).select().maybeSingle();
    if (error) throw error;
    logAudit(req.user, 'produto.criar', { entityType: 'produto', entityId: novo.id, entityName: data.nome });
    res.redirect(`/gestao/produtos/${novo.id}`);
  } catch (err) {
    console.error('[Gestao/Produto/Criar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao criar produto: ' + err.message });
  }
});

// POST /gestao/produtos/:id/editar
router.post('/produtos/:id/editar', canEdit, async (req, res) => {
  try {
    const { id } = req.params;
    const campos = ['nome','empresa','nicho','sku','o_que_e','composicao','como_funciona','descricao','playbook_slug'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { error } = await db.from('produtos').update(data).eq('id', id);
    if (error) throw error;
    logAudit(req.user, 'produto.editar', { entityType: 'produto', entityId: id, entityName: data.nome });
    res.redirect(`/gestao/produtos/${id}`);
  } catch (err) {
    console.error('[Gestao/Produto/Editar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao editar produto: ' + err.message });
  }
});

// POST /gestao/produtos/:id/excluir
router.post('/produtos/:id/excluir', canDelete, async (req, res) => {
  try {
    const { data: prd } = await db.from('produtos').select('nome').eq('id', req.params.id).maybeSingle();
    const { error } = await db.from('produtos').delete().eq('id', req.params.id);
    if (error) throw error;
    logAudit(req.user, 'produto.excluir', { entityType: 'produto', entityId: req.params.id, entityName: prd?.nome });
    res.redirect('/gestao/catalogo?tab=produtos');
  } catch (err) {
    console.error('[Gestao/Produto/Excluir] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao excluir produto: ' + err.message });
  }
});

// ─── MÍDIAS ──────────────────────────────────────────────────────────────────

// POST /gestao/api/upload-media — base64 → Supabase Storage
router.post('/api/upload-media', canEdit, async (req, res) => {
  try {
    const { base64, mimeType, tipo, slug } = req.body;
    if (!base64 || !tipo || !slug) return res.status(400).json({ error: 'Parâmetros inválidos' });

    const allowed = ['image/jpeg','image/png','image/webp','video/mp4','video/webm'];
    if (!allowed.includes(mimeType)) return res.status(400).json({ error: 'Tipo de arquivo não permitido' });

    const ext = mimeType.split('/')[1].replace('jpeg','jpg');
    const filename = `${Date.now()}.${ext}`;
    const path = `playbooks/${slug}/${tipo}/${filename}`;
    const buffer = Buffer.from(base64, 'base64');

    const { error } = await db.storage.from('produtos-midias').upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) throw error;

    const url = db.storage.from('produtos-midias').getPublicUrl(path).data.publicUrl;
    res.json({ ok: true, url, path, name: filename });
  } catch (err) {
    console.error('[Gestao/Upload] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /gestao/api/delete-media
router.post('/api/delete-media', canEdit, async (req, res) => {
  try {
    const { path } = req.body;
    if (!path || !path.startsWith('playbooks/')) return res.status(400).json({ error: 'Path inválido' });

    const { error } = await db.storage.from('produtos-midias').remove([path]);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[Gestao/DeleteMedia] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── FEEDBACKS ───────────────────────────────────────────────────────────────

// POST /gestao/feedbacks — qualquer usuário autenticado pode registrar
router.post('/feedbacks', async (req, res) => {
  try {
    const { texto, empresa, produto, redirect: redir } = req.body;
    if (!texto?.trim()) return res.status(400).render('error', { message: 'Texto do feedback obrigatório' });

    const { error } = await db.from('feedbacks').insert({
      texto: texto.trim(),
      empresa: empresa || null,
      produto: produto || null,
      autor: req.user.name || req.user.email,
    });
    if (error) throw error;
    res.redirect(redir || '/gestao/catalogo');
  } catch (err) {
    console.error('[Gestao/Feedback] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao salvar feedback: ' + err.message });
  }
});

// POST /gestao/feedbacks/:id/editar
router.post('/feedbacks/:id/editar', async (req, res) => {
  try {
    const { texto, redirect: redir } = req.body;
    if (!texto?.trim()) return res.status(400).render('error', { message: 'Texto obrigatório' });

    const { data: fb } = await db.from('feedbacks').select('autor').eq('id', req.params.id).maybeSingle();
    const autorAtual = req.user.name || req.user.email;
    if (req.user.role !== 'admin' && fb?.autor !== autorAtual) {
      return res.status(403).render('error', { message: 'Sem permissão para editar este feedback' });
    }

    const { error } = await db.from('feedbacks').update({ texto: texto.trim() }).eq('id', req.params.id);
    if (error) throw error;
    res.redirect(redir || '/gestao/catalogo');
  } catch (err) {
    console.error('[Gestao/Feedback/Editar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao editar feedback: ' + err.message });
  }
});

// POST /gestao/feedbacks/:id/excluir
router.post('/feedbacks/:id/excluir', async (req, res) => {
  try {
    const { redirect: redir } = req.body;

    const { data: fb } = await db.from('feedbacks').select('autor').eq('id', req.params.id).maybeSingle();
    const autorAtual = req.user.name || req.user.email;
    if (req.user.role !== 'admin' && fb?.autor !== autorAtual) {
      return res.status(403).render('error', { message: 'Sem permissão para excluir este feedback' });
    }

    const { error } = await db.from('feedbacks').delete().eq('id', req.params.id);
    if (error) throw error;
    res.redirect(redir || '/gestao/catalogo');
  } catch (err) {
    console.error('[Gestao/Feedback/Excluir] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao excluir feedback: ' + err.message });
  }
});

// ─── VENDAS ──────────────────────────────────────────────────────────────────

// Cache de opções de filtro (evita timeout por DISTINCT em 1M+ linhas a cada page load)
let _filterCache = null;
let _filterCacheAt = 0;
async function getFilterOptions() {
  if (_filterCache && Date.now() - _filterCacheAt < 10 * 60 * 1000) return _filterCache;
  const { data } = await db.rpc('get_vendas_filter_options');
  if (data) { _filterCache = data; _filterCacheAt = Date.now(); }
  return _filterCache || {};
}

// GET /gestao/vendas
router.get('/vendas', async (req, res) => {
  try {
    const user = req.user;
    const role = user.role;

    const [filterOpts, colaboradoresData] = await Promise.all([
      getFilterOptions(),
      role === 'admin' ? getColaboradores() : Promise.resolve([]),
    ]);

    const opts         = filterOpts;
    const tipos        = (opts.tipos    || []).sort();
    const empresas     = (opts.empresas || []).sort();
    const produtos     = (opts.produtos || []).sort();
    const formas       = (opts.formas   || []).sort();
    const ativos       = colaboradoresData.filter(c => c.ativo);
    const equipes      = [...new Set(ativos.map(c => c.equipe).filter(Boolean))].sort();
    const colaboradores = [...new Map(ativos.filter(c => c.email).map(c => [c.email, c])).values()];

    res.render('gestao-vendas', {
      activePage: 'gestao-vendas',
      tipos,
      empresas,
      produtos,
      equipes,
      formas,
      colaboradores,
      userRole: role,
      userEmail: user.email,
      isAdmin: role === 'admin',
    });
  } catch (err) {
    console.error('[Gestao/Vendas] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar vendas: ' + err.message });
  }
});

// GET /gestao/api/vendas — endpoint de dados para o dashboard (chamado via fetch)
router.get('/api/vendas', async (req, res) => {
  try {
    const { period, dateFrom, dateTo, equipe, fonte, vendedora, tipo, empresas: empresasParam, produtos: produtosParam, forma } = req.query;
    const user = req.user;
    const role = user.role;

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    let from = new Date('2000-01-01');
    if (period === '7d')   { from = new Date(today); from.setDate(from.getDate() - 7); }
    if (period === '30d')  { from = new Date(today); from.setDate(from.getDate() - 30); }
    if (period === '90d')  { from = new Date(today); from.setDate(from.getDate() - 90); }
    if (period === '12m')  { from = new Date(today); from.setDate(from.getDate() - 365); }
    if (period === 'custom') {
      from = dateFrom ? new Date(dateFrom) : new Date('2000-01-01');
      today.setTime(dateTo ? new Date(dateTo).setHours(23,59,59,999) : today.getTime());
    }

    const fromStr = from.toISOString().slice(0, 10);
    // Mantém o horário 23:59:59 para que dt_aprovacao <= toStr inclua todo o último dia
    const toStr   = today.toISOString().slice(0, 19);

    let emailFilter = null;
    if (role !== 'admin') {
      emailFilter = [user.email];
    } else if (equipe && equipe !== 'all') {
      const cols = await getColaboradores();
      emailFilter = cols.filter(c => c.ativo && c.equipe === equipe).map(c => c.email);
    }

    const empresasFiltro = empresasParam ? empresasParam.split(',').filter(Boolean) : [];
    const produtosFiltro = produtosParam  ? produtosParam.split(',').filter(Boolean)  : [];

    // Cache key: todos os parâmetros + identidade do usuário
    const cacheKey = `vendas:${role === 'admin' ? 'admin' : user.email}:${JSON.stringify({ fromStr, toStr, equipe, fonte, vendedora, tipo, empresasParam, produtosParam, forma })}`;
    const cached = _apiCache.get(cacheKey);
    if (cached) return res.json(cached);

    // Se lite=1 (chamada de período anterior), só precisa dos KPIs — pula formasQuery
    const lite = req.query.lite === '1';

    // Mapa email → região para dailyByRegiao (só admin, só no modo completo)
    let emailToRegiao = {};
    if (!lite && role === 'admin') {
      const colabs = await getColaboradores();
      for (const c of colabs) {
        if (c.email && c.regiao) emailToRegiao[c.email.toLowerCase().trim()] = c.regiao;
      }
    }

    let formasData = null;
    if (!lite) {
      let formasQuery = db.from('vendas')
        .select('forma_pagamento, valor_venda, produto, sku, email, dt_aprovacao')
        .eq('status_pagamento', 'paid')
        .gte('dt_aprovacao', fromStr)
        .lte('dt_aprovacao', toStr);
      if (emailFilter) formasQuery = formasQuery.in('email', emailFilter);
      if (fonte && fonte !== 'all') formasQuery = formasQuery.ilike('email', `%${fonte}%`);
      if (vendedora && vendedora !== 'all') formasQuery = formasQuery.eq('email', vendedora);
      if (empresasFiltro.length) formasQuery = formasQuery.in('empresa', empresasFiltro);
      if (produtosFiltro.length) formasQuery = formasQuery.in('produto', produtosFiltro);
      if (tipo && tipo !== 'all') formasQuery = formasQuery.eq('tipo_venda', tipo);
      if (forma && forma !== 'all') formasQuery = formasQuery.eq('forma_pagamento', forma);
      const res2 = await formasQuery.limit(300000);
      formasData = res2.data;
    }

    const [{ data: result, error }] = await Promise.all([
      db.rpc('get_vendas_dashboard', {
        p_from:      fromStr,
        p_to:        toStr,
        p_emails:    emailFilter || null,
        p_tipo:      (tipo      && tipo      !== 'all') ? tipo      : null,
        p_empresas:  empresasFiltro.length ? empresasFiltro : null,
        p_produtos:  produtosFiltro.length ? produtosFiltro : null,
        p_forma:     (forma     && forma     !== 'all') ? forma     : null,
        p_fonte:     (fonte     && fonte     !== 'all') ? fonte     : null,
        p_vendedora: (vendedora && vendedora !== 'all') ? vendedora : null,
      }),
    ]);

    if (error) return res.status(500).json({ error: error.message });

    const r          = Array.isArray(result) ? result[0] : result;
    if (!r) return res.status(500).json({ error: 'Nenhum resultado retornado pelo banco' });
    const totalPaid  = Number(r.total_paid  || 0);
    const chargebacks= Number(r.chargebacks || 0);
    const faturamento= Number(r.faturamento || 0);
    const ticketMedio= totalPaid ? faturamento / totalPaid : 0;
    const taxaCb     = (totalPaid + chargebacks) ? (chargebacks / (totalPaid + chargebacks)) * 100 : 0;

    // Agrega formas e nichos a partir das linhas pagas (somente no modo completo)
    let formasPagamento = [];
    let topNichos       = [];
    let dailyByRegiao   = {};
    if (!lite && formasData) {
      // Nicho map em cache (produtos mudam raramente)
      if (!_nichoCache || Date.now() - _nichoCacheTs > 5 * 60 * 1000) {
        const { data: pnData } = await db.from('produtos').select('nome, sku, nicho');
        _nichoCache   = {};
        _nichoSkuCache = {};
        for (const p of (pnData || [])) {
          if (p.nome && p.nicho) _nichoCache[p.nome.toLowerCase().trim()]  = p.nicho;
          if (p.sku  && p.nicho) _nichoSkuCache[p.sku.toLowerCase().trim()] = p.nicho;
        }
        _nichoCacheTs = Date.now();
      }

      const formasMap   = {};
      const nichoAggMap = {};
      const dailyRegMap = {};
      for (const row of formasData) {
        const f    = row.forma_pagamento || 'outros';
        const prod = (row.produto || '').toLowerCase().trim();
        const sku  = (row.sku    || '').toLowerCase().trim();
        const val  = Number(row.valor_venda || 0);
        const nicho = _nichoCache[prod] || _nichoSkuCache[sku] || 'Sem nicho';

        if (!formasMap[f]) formasMap[f] = { forma: f, count: 0, total: 0 };
        formasMap[f].count++;
        formasMap[f].total += val;

        if (!nichoAggMap[nicho]) nichoAggMap[nicho] = { nicho, total: 0, qtd: 0 };
        nichoAggMap[nicho].total += val;
        nichoAggMap[nicho].qtd++;

        // Daily por região
        if (row.dt_aprovacao && row.email) {
          const reg = emailToRegiao[row.email.toLowerCase().trim()];
          if (reg) {
            // Normaliza para YYYY-MM-DD independente do formato (date, timestamp, timestamptz)
            const rawDt = String(row.dt_aprovacao);
            const dia = rawDt.length >= 10 ? rawDt.slice(0, 10) : null;
            if (dia) {
              if (!dailyRegMap[reg]) dailyRegMap[reg] = {};
              if (!dailyRegMap[reg][dia]) dailyRegMap[reg][dia] = { data: dia, total: 0, count: 0 };
              dailyRegMap[reg][dia].total += val;
              dailyRegMap[reg][dia].count++;
            }
          }
        }
      }
      formasPagamento = Object.values(formasMap).sort((a, b) => b.total - a.total);
      topNichos       = Object.values(nichoAggMap).sort((a, b) => b.total - a.total);
      dailyByRegiao   = Object.fromEntries(
        Object.entries(dailyRegMap).map(([reg, dayMap]) => [
          reg,
          Object.values(dayMap).sort((a, b) => a.data.localeCompare(b.data)).map(d => ({ data: d.data, total: d.total, count: d.count })),
        ])
      );
      // Diagnóstico: regiões detectadas e total de vendas por região
      const regStats = Object.entries(dailyByRegiao).map(([r, days]) => `${r}:${days.reduce((s,d)=>s+d.count,0)}v/${days.reduce((s,d)=>s+d.total,0).toFixed(0)}`);
      const emailsMapped = Object.values(dailyRegMap).reduce((s, m) => s + Object.values(m).reduce((ss, d) => ss + d.count, 0), 0);
      console.log(`[Vendas/dailyByRegiao] formasData=${formasData.length} matched=${emailsMapped} regioes=[${regStats.join(', ')}] emailToRegiao_keys=${Object.keys(emailToRegiao).length}`);
    }

    const reembolsos      = Number(r.reembolsos || 0);
    const reembolsosTotal = Number(r.reembolsos_total || 0);

    const payload = {
      kpis: { faturamento, ticketMedio, chargebacks, taxaCb, pix: Number(r.pix||0), cartao: Number(r.cartao||0), totalPaid, reembolsos, reembolsosTotal },
      formasPagamento,
      daily:          (r.daily        || []).map(d => ({ data: d.data, total: Number(d.total), count: Number(d.count) })),
      dailyByRegiao,
      topEmpresas:    (r.top_empresas || []).map(e => ({ label: e.label, total: Number(e.total), qtd: Number(e.qtd) })),
      topProdutos:    (r.top_produtos || []).map(p => ({ label: p.label, total: Number(p.total), qtd: Number(p.qtd) })),
      topNichos,
    };
    _apiCache.set(cacheKey, payload);
    setTimeout(() => _apiCache.delete(cacheKey), 45000);
    res.json(payload);
  } catch (err) {
    console.error('[Gestao/API/Vendas] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /gestao/api/vendas/ranking — ranking de vendedoras por faturamento
router.get('/api/vendas/ranking', async (req, res) => {
  try {
    const { period, dateFrom, dateTo, equipe, fonte, vendedora, tipo, empresas: empresasParam, produtos: produtosParam, forma } = req.query;
    const user = req.user;
    const role = user.role;

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    let from = new Date();
    from.setDate(from.getDate() - 30);
    if (period === '7d')   { from = new Date(today); from.setDate(from.getDate() - 7); }
    if (period === '30d')  { from = new Date(today); from.setDate(from.getDate() - 30); }
    if (period === '90d')  { from = new Date(today); from.setDate(from.getDate() - 90); }
    if (period === '12m')  { from = new Date(today); from.setDate(from.getDate() - 365); }
    if (period === 'all')  { from = new Date('2000-01-01'); }
    if (period === 'custom') {
      from = dateFrom ? new Date(dateFrom) : new Date('2000-01-01');
      if (dateTo) today.setTime(new Date(dateTo).setHours(23, 59, 59, 999));
    }

    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = today.toISOString().slice(0, 19);

    // Carrega colaboradores para filtro por equipe + mapa email→regiao
    const todosColabs = role === 'admin' ? await getColaboradores() : [];

    let emailsPermitidos = null;
    if (role !== 'admin') {
      emailsPermitidos = [user.email];
    } else if (equipe && equipe !== 'all') {
      emailsPermitidos = todosColabs.filter(c => c.ativo && c.equipe === equipe).map(c => c.email);
    }

    const empresasFiltro = empresasParam ? empresasParam.split(',').filter(Boolean) : [];
    const produtosFiltro = produtosParam  ? produtosParam.split(',').filter(Boolean)  : [];

    // Mapas email → região / nome
    const emailToRegiao = {};
    const emailToNome   = {};
    for (const c of todosColabs) {
      if (c.email && c.regiao) emailToRegiao[c.email] = c.regiao;
      if (c.email && c.nome)   emailToNome[c.email]   = { nome: c.nome, primeiro_nome: c.primeiro_nome };
    }

    let q = db.from('vendas')
      .select('email, valor_venda')
      .eq('status_pagamento', 'paid')
      .gte('dt_aprovacao', fromStr)
      .lte('dt_aprovacao', toStr)
      .not('email', 'is', null);
    if (fonte && fonte !== 'all') q = q.ilike('email', `%${fonte}%`);
    if (vendedora && vendedora !== 'all') q = q.eq('email', vendedora);
    if (emailsPermitidos) q = q.in('email', emailsPermitidos);
    if (tipo && tipo !== 'all') q = q.eq('tipo_venda', tipo);
    if (forma && forma !== 'all') q = q.eq('forma_pagamento', forma);
    if (empresasFiltro.length) q = q.in('empresa', empresasFiltro);
    if (produtosFiltro.length) q = q.in('produto', produtosFiltro);
    const { data } = await q.limit(300000);

    const map = {};
    const mapByRegiao = {};
    for (const row of (data || [])) {
      if (!row.email) continue;
      const k      = row.email.toLowerCase().trim();
      const regiao = emailToRegiao[k] || null;
      const val    = Number(row.valor_venda || 0);
      const info   = emailToNome[k] || {};
      if (!map[k]) map[k] = { email: row.email, nome: info.nome || null, primeiro_nome: info.primeiro_nome || null, qtd: 0, total: 0 };
      map[k].qtd++;
      map[k].total += val;
      if (regiao) {
        if (!mapByRegiao[regiao]) mapByRegiao[regiao] = {};
        if (!mapByRegiao[regiao][k]) mapByRegiao[regiao][k] = { email: row.email, nome: info.nome || null, primeiro_nome: info.primeiro_nome || null, qtd: 0, total: 0 };
        mapByRegiao[regiao][k].qtd++;
        mapByRegiao[regiao][k].total += val;
      }
    }
    const ranking = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
    const rankingByRegiao = {};
    for (const reg of Object.keys(mapByRegiao)) {
      rankingByRegiao[reg] = Object.values(mapByRegiao[reg]).sort((a, b) => b.total - a.total).slice(0, 5);
    }
    res.json({ ranking, rankingByRegiao });
  } catch (err) {
    console.error('[Gestao/API/Ranking] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── BI ──────────────────────────────────────────────────────────────────────
// Movido para /admin/bi — redirect para não quebrar bookmarks
router.get('/bi', (req, res) => res.redirect('/admin/bi'));

// ─── IMPORTADOR EXCEL / VENDAS ────────────────────────────────────────────────

const multer  = require('multer');
const XLSX    = require('xlsx');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Mapa: nome da coluna Excel → campo na tabela vendas
const COL_MAP = {
  'Código':                        'codigo',
  'Tipo Venda':                    'tipo_venda',
  'Sku':                           'sku',
  'Produto':                       'produto',
  'Empresa':                       'empresa',
  'Email':                         'email',
  'Status Pagamento':              'status_pagamento',
  'Valor da Venda':                'valor_venda',
  'f. Saldo da Venda':             'saldo_venda',
  'Forma de Pagamento':            'forma_pagamento',
  'Data de aprovação':             'dt_aprovacao',
  'Data de criação':               'dt_criacao',
  'Data de atualização':           'data_atualizacao',
  'Nome':                          'nome_cliente',
  'Telefone':                      'telefone',
  'Documento':                     'documento',
  'Status de auditoria':           'status_auditoria',
  'Status de atendimento':         'status_atendimento',
  'Status de entrega':             'status_entrega',
  'Rastreio':                      'rastreio',
  'Pedido suspenso':               'pedido_suspenso',
  'Motivo do cancelamento':        'motivo_cancelamento',
  'Tipo de cancelamento':          'tipo_cancelamento',
};

const DATE_FIELDS = new Set([
  'dt_aprovacao','dt_criacao','data_atualizacao',
]);

function excelDateToISO(val) {
  if (!val && val !== 0) return null;
  if (typeof val === 'string') return val || null;
  // Serial date do Excel → JS Date
  const d = new Date((val - 25569) * 86400 * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// GET /gestao/vendas/import
router.get('/vendas/import', (req, res) => {
  res.render('gestao-vendas-import', { activePage: 'gestao-vendas', result: null });
});

// POST /gestao/vendas/import
router.post('/vendas/import', upload.single('arquivo'), async (req, res) => {
  const isJson = req.headers['x-requested-with'] === 'XMLHttpRequest';
  const sendErr = (msg) => isJson ? res.status(400).json({ error: msg }) : res.status(400).render('gestao-vendas-import', { activePage: 'gestao-vendas', result: { error: msg } });
  try {
    if (!req.file) return sendErr('Nenhum arquivo enviado.');

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) return sendErr('Planilha vazia ou sem dados.');

    const headers = rows[0];
    const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c !== null));

    // Descobre colunas reais da tabela vendas no Supabase
    const { data: sampleRow } = await db.from('vendas').select('*').limit(1);
    const tableColumns = sampleRow && sampleRow.length > 0
      ? new Set(Object.keys(sampleRow[0]))
      : null; // se tabela vazia, aceita tudo do COL_MAP

    // Mapeia colunas presentes na planilha E que existem na tabela
    const colIndexes = {}; // dbField → index na planilha
    headers.forEach((h, i) => {
      const dbField = COL_MAP[h?.toString().trim()];
      if (dbField && (!tableColumns || tableColumns.has(dbField))) colIndexes[dbField] = i;
    });

    // Mapeia todas as linhas primeiro
    const allRecords = dataRows.map(row => {
      const rec = {};
      for (const [field, idx] of Object.entries(colIndexes)) {
        let val = row[idx];
        if (val === '' || val === null || val === undefined) { rec[field] = null; continue; }
        if (DATE_FIELDS.has(field)) { rec[field] = excelDateToISO(val); continue; }
        if (typeof val === 'number' && ['valor_sem_juros','valor_da_venda','f_valor_da_venda','saldo_da_venda','saldo_venda'].includes(field)) {
          rec[field] = val;
        } else {
          rec[field] = String(val).trim() || null;
        }
      }
      return rec;
    }).filter(r => r.codigo);

    // Deduplica por codigo mantendo o registro com data_atualizacao mais recente
    const deduped = new Map();
    for (const rec of allRecords) {
      const existing = deduped.get(rec.codigo);
      if (!existing) { deduped.set(rec.codigo, rec); continue; }
      const dateNew = rec.data_atualizacao || '';
      const dateOld = existing.data_atualizacao || '';
      if (dateNew > dateOld) deduped.set(rec.codigo, rec);
    }
    const uniqueRecords = Array.from(deduped.values());

    const BATCH = 500;
    let inserted = 0, errors = 0, firstError = null;

    for (let b = 0; b < uniqueRecords.length; b += BATCH) {
      const batch = uniqueRecords.slice(b, b + BATCH);

      const { error, data } = await db.from('vendas')
        .upsert(batch, { onConflict: 'codigo', ignoreDuplicates: false })
        .select('codigo');

      if (error) {
        errors += batch.length;
        console.error('[Import] Erro batch:', error.message, error.details, error.hint);
        if (errors === batch.length) firstError = error.message; // captura erro do 1º batch
      } else { inserted += (data || []).length; }
    }

    const result = { ok: true, total: dataRows.length, unique: uniqueRecords.length, inserted, errors, firstError: firstError || null, arquivo: req.file.originalname };
    if (isJson) return res.json(result);
    res.render('gestao-vendas-import', { activePage: 'gestao-vendas', result });
  } catch (err) {
    console.error('[Gestao/Import] Erro:', err.message);
    if (isJson) return res.status(500).json({ error: err.message });
    res.render('gestao-vendas-import', { activePage: 'gestao-vendas', result: { error: err.message } });
  }
});

// ─── COLABORADORES ───────────────────────────────────────────────────────────

// GET /gestao/colaboradores
router.get('/colaboradores', requireRole(['admin']), async (req, res) => {
  try {
    const { data: colaboradores, error } = await db
      .from('vendas_colaboradores')
      .select('*')
      .order('primeiro_nome');
    if (error) throw error;
    res.render('gestao-colaboradores', {
      activePage: 'gestao-colaboradores',
      colaboradores: colaboradores || [],
    });
  } catch (err) {
    res.status(500).render('error', { message: err.message });
  }
});

// POST /gestao/colaboradores — criar
router.post('/colaboradores', requireRole(['admin']), async (req, res) => {
  try {
    const { email, primeiro_nome, nome, equipe, regiao, tipo_venda } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email obrigatório' });
    const src = email.trim().toLowerCase().split('@')[0];
    const { error } = await db.from('vendas_colaboradores').insert({
      email: email.trim().toLowerCase(),
      src,
      primeiro_nome: primeiro_nome?.trim() || null,
      nome: nome?.trim() || null,
      equipe: equipe?.trim() || null,
      regiao: regiao?.trim() || null,
      tipo_venda: tipo_venda?.trim() || null,
      ativo: true,
    });
    if (error) return res.status(400).json({ error: error.message });
    // invalida cache de filtros
    _filterCache = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /gestao/colaboradores/:id/editar
router.post('/colaboradores/:id/editar', requireRole(['admin']), async (req, res) => {
  try {
    const { primeiro_nome, nome, equipe, regiao, tipo_venda, ativo } = req.body;
    const { error } = await db.from('vendas_colaboradores').update({
      primeiro_nome: primeiro_nome?.trim() || null,
      nome: nome?.trim() || null,
      equipe: equipe?.trim() || null,
      regiao: regiao?.trim() || null,
      tipo_venda: tipo_venda?.trim() || null,
      ativo: ativo === 'true' || ativo === true,
    }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    _filterCache = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /gestao/colaboradores/:id/excluir
router.post('/colaboradores/:id/excluir', requireRole(['admin']), async (req, res) => {
  try {
    const { error } = await db.from('vendas_colaboradores').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    _filterCache = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

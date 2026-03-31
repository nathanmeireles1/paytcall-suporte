const express = require('express');
const router = express.Router();
const { db, hub } = require('../config/database');
const { requireRole } = require('../middleware/auth');

// Middleware: garante que o hub está configurado
function requireHub(req, res, next) {
  if (!hub) {
    return res.status(503).render('error', {
      message: 'Módulo de gestão indisponível — configure HUB_SUPABASE_URL e HUB_SUPABASE_SERVICE_KEY.',
    });
  }
  next();
}

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
router.get('/empresas', requireHub, (req, res) => res.redirect('/gestao/catalogo?tab=empresas'));
router.get('/produtos',  requireHub, (req, res) => res.redirect('/gestao/catalogo?tab=produtos'));
router.get('/segmentos', requireHub, (req, res) => res.redirect('/gestao/catalogo?tab=nichos'));
router.get('/segmentos/:slug', requireHub, (req, res) => res.redirect('/gestao/catalogo?tab=nichos'));

// GET /gestao/catalogo
router.get('/catalogo', requireHub, async (req, res) => {
  try {
    const [
      { data: empresas, error: empErr },
      { data: produtos, error: prodErr },
    ] = await Promise.all([
      hub.from('empresas').select('*').order('nome'),
      hub.from('produtos').select('*').order('nome'),
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
    });
  } catch (err) {
    console.error('[Gestao/Catalogo] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar catálogo: ' + err.message });
  }
});

// ─── EMPRESAS ────────────────────────────────────────────────────────────────

// GET /gestao/empresas/:id
router.get('/empresas/:id', requireHub, async (req, res) => {
  try {
    const { id } = req.params;

    const [{ data: empresa, error }, { data: feedbacks }] = await Promise.all([
      hub.from('empresas').select('*').eq('id', id).maybeSingle(),
      hub.from('feedbacks').select('*').order('dt_criacao', { ascending: false }),
    ]);

    if (error) throw error;
    if (!empresa) return res.status(404).render('error', { message: 'Empresa não encontrada' });

    const feedbacksEmpresa = (feedbacks || []).filter(
      f => f.empresa && f.empresa.toLowerCase() === empresa.nome.toLowerCase()
    );

    res.render('gestao-empresa-detalhe', {
      activePage: 'gestao-catalogo',
      empresa,
      feedbacks: feedbacksEmpresa,
      canEdit: userCanEdit(req),
      isAdmin: req.user.role === 'admin',
    });
  } catch (err) {
    console.error('[Gestao/Empresa] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar empresa: ' + err.message });
  }
});

// POST /gestao/empresas — criar
router.post('/empresas', requireHub, canEdit, async (req, res) => {
  try {
    const campos = ['nome','segmento','status','cnpj','email','telefone','contato','site','cidade','estado','descricao'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { data: nova, error } = await hub.from('empresas').insert(data).select().maybeSingle();
    if (error) throw error;
    res.redirect(`/gestao/empresas/${nova.id}`);
  } catch (err) {
    console.error('[Gestao/Empresa/Criar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao criar empresa: ' + err.message });
  }
});

// POST /gestao/empresas/:id/editar
router.post('/empresas/:id/editar', requireHub, canEdit, async (req, res) => {
  try {
    const { id } = req.params;
    const campos = ['nome','segmento','status','cnpj','email','telefone','contato','site','cidade','estado','descricao'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { error } = await hub.from('empresas').update(data).eq('id', id);
    if (error) throw error;
    res.redirect(`/gestao/empresas/${id}`);
  } catch (err) {
    console.error('[Gestao/Empresa/Editar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao editar empresa: ' + err.message });
  }
});

// POST /gestao/empresas/:id/excluir
router.post('/empresas/:id/excluir', requireHub, canDelete, async (req, res) => {
  try {
    const { error } = await hub.from('empresas').delete().eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/gestao/catalogo?tab=empresas');
  } catch (err) {
    console.error('[Gestao/Empresa/Excluir] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao excluir empresa: ' + err.message });
  }
});

// ─── PRODUTOS ────────────────────────────────────────────────────────────────

// GET /gestao/produtos/:id
router.get('/produtos/:id', requireHub, async (req, res) => {
  try {
    const { id } = req.params;

    const [{ data: produto, error }, { data: feedbacks }] = await Promise.all([
      hub.from('produtos').select('*').eq('id', id).maybeSingle(),
      hub.from('feedbacks').select('*').order('dt_criacao', { ascending: false }),
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
      hub.storage.from('produtos-midias').list(`playbooks/${slug}/fotos`),
      hub.storage.from('produtos-midias').list(`playbooks/${slug}/depoimentos`),
    ]);

    const getUrl = (path) => hub.storage.from('produtos-midias').getPublicUrl(path).data.publicUrl;
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
router.post('/produtos', requireHub, canEdit, async (req, res) => {
  try {
    const campos = ['nome','nicho','sku','o_que_e','composicao','como_funciona','descricao','playbook_slug'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { data: novo, error } = await hub.from('produtos').insert(data).select().maybeSingle();
    if (error) throw error;
    res.redirect(`/gestao/produtos/${novo.id}`);
  } catch (err) {
    console.error('[Gestao/Produto/Criar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao criar produto: ' + err.message });
  }
});

// POST /gestao/produtos/:id/editar
router.post('/produtos/:id/editar', requireHub, canEdit, async (req, res) => {
  try {
    const { id } = req.params;
    const campos = ['nome','nicho','sku','o_que_e','composicao','como_funciona','descricao','playbook_slug'];
    const data = {};
    for (const c of campos) data[c] = req.body[c]?.trim() || null;
    if (!data.nome) return res.status(400).render('error', { message: 'Nome é obrigatório' });

    const { error } = await hub.from('produtos').update(data).eq('id', id);
    if (error) throw error;
    res.redirect(`/gestao/produtos/${id}`);
  } catch (err) {
    console.error('[Gestao/Produto/Editar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao editar produto: ' + err.message });
  }
});

// POST /gestao/produtos/:id/excluir
router.post('/produtos/:id/excluir', requireHub, canDelete, async (req, res) => {
  try {
    const { error } = await hub.from('produtos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/gestao/catalogo?tab=produtos');
  } catch (err) {
    console.error('[Gestao/Produto/Excluir] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao excluir produto: ' + err.message });
  }
});

// ─── MÍDIAS ──────────────────────────────────────────────────────────────────

// POST /gestao/api/upload-media — base64 → Supabase Storage
router.post('/api/upload-media', requireHub, canEdit, async (req, res) => {
  try {
    const { base64, mimeType, tipo, slug } = req.body;
    if (!base64 || !tipo || !slug) return res.status(400).json({ error: 'Parâmetros inválidos' });

    const allowed = ['image/jpeg','image/png','image/webp','video/mp4','video/webm'];
    if (!allowed.includes(mimeType)) return res.status(400).json({ error: 'Tipo de arquivo não permitido' });

    const ext = mimeType.split('/')[1].replace('jpeg','jpg');
    const filename = `${Date.now()}.${ext}`;
    const path = `playbooks/${slug}/${tipo}/${filename}`;
    const buffer = Buffer.from(base64, 'base64');

    const { error } = await hub.storage.from('produtos-midias').upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) throw error;

    const url = hub.storage.from('produtos-midias').getPublicUrl(path).data.publicUrl;
    res.json({ ok: true, url, path, name: filename });
  } catch (err) {
    console.error('[Gestao/Upload] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /gestao/api/delete-media
router.post('/api/delete-media', requireHub, canEdit, async (req, res) => {
  try {
    const { path } = req.body;
    if (!path || !path.startsWith('playbooks/')) return res.status(400).json({ error: 'Path inválido' });

    const { error } = await hub.storage.from('produtos-midias').remove([path]);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[Gestao/DeleteMedia] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── FEEDBACKS ───────────────────────────────────────────────────────────────

// POST /gestao/feedbacks — qualquer usuário autenticado pode registrar
router.post('/feedbacks', requireHub, async (req, res) => {
  try {
    const { texto, empresa, produto, redirect: redir } = req.body;
    if (!texto?.trim()) return res.status(400).render('error', { message: 'Texto do feedback obrigatório' });

    const { error } = await hub.from('feedbacks').insert({
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
router.post('/feedbacks/:id/editar', requireHub, async (req, res) => {
  try {
    const { texto, redirect: redir } = req.body;
    if (!texto?.trim()) return res.status(400).render('error', { message: 'Texto obrigatório' });

    const { data: fb } = await hub.from('feedbacks').select('autor').eq('id', req.params.id).maybeSingle();
    const autorAtual = req.user.name || req.user.email;
    if (req.user.role !== 'admin' && fb?.autor !== autorAtual) {
      return res.status(403).render('error', { message: 'Sem permissão para editar este feedback' });
    }

    const { error } = await hub.from('feedbacks').update({ texto: texto.trim() }).eq('id', req.params.id);
    if (error) throw error;
    res.redirect(redir || '/gestao/catalogo');
  } catch (err) {
    console.error('[Gestao/Feedback/Editar] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao editar feedback: ' + err.message });
  }
});

// POST /gestao/feedbacks/:id/excluir
router.post('/feedbacks/:id/excluir', requireHub, async (req, res) => {
  try {
    const { redirect: redir } = req.body;

    const { data: fb } = await hub.from('feedbacks').select('autor').eq('id', req.params.id).maybeSingle();
    const autorAtual = req.user.name || req.user.email;
    if (req.user.role !== 'admin' && fb?.autor !== autorAtual) {
      return res.status(403).render('error', { message: 'Sem permissão para excluir este feedback' });
    }

    const { error } = await hub.from('feedbacks').delete().eq('id', req.params.id);
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

    const [filterOpts, { data: colaboradoresData }] = await Promise.all([
      getFilterOptions(),
      role === 'admin'
        ? db.from('vendas_colaboradores').select('email, equipe, primeiro_nome').eq('ativo', true).order('primeiro_nome')
        : Promise.resolve({ data: [] }),
    ]);

    const opts         = filterOpts;
    const tipos        = (opts.tipos    || []).sort();
    const empresas     = (opts.empresas || []).sort();
    const produtos     = (opts.produtos || []).sort();
    const formas       = (opts.formas   || []).sort();
    const equipes      = [...new Set((colaboradoresData || []).map(r => r.equipe).filter(Boolean))].sort();
    const colaboradores = [...new Map((colaboradoresData || [])
      .filter(r => r.email)
      .map(r => [r.email, r])).values()];

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
    const toStr   = today.toISOString().slice(0, 10);

    let emailFilter = null;
    if (role !== 'admin') {
      emailFilter = [user.email];
    } else if (equipe && equipe !== 'all') {
      const { data: cols } = await db
        .from('vendas_colaboradores')
        .select('email')
        .eq('equipe', equipe)
        .eq('ativo', true);
      emailFilter = (cols || []).map(c => c.email);
    }

    const empresasFiltro = empresasParam ? empresasParam.split(',').filter(Boolean) : [];
    const produtosFiltro = produtosParam  ? produtosParam.split(',').filter(Boolean)  : [];

    const { data: result, error } = await db.rpc('get_vendas_dashboard', {
      p_from:     fromStr,
      p_to:       toStr,
      p_emails:   emailFilter || null,
      p_tipo:     (tipo && tipo !== 'all') ? tipo : null,
      p_empresas: empresasFiltro.length ? empresasFiltro : null,
      p_produtos: produtosFiltro.length ? produtosFiltro : null,
      p_forma:    (forma && forma !== 'all') ? forma : null,
      p_fonte:    (vendedora && vendedora !== 'all') ? vendedora :
                  (fonte    && fonte    !== 'all') ? fonte    : null,
    });

    if (error) return res.status(500).json({ error: error.message });

    const r          = Array.isArray(result) ? result[0] : result;
    if (!r) return res.status(500).json({ error: 'Nenhum resultado retornado pelo banco' });
    const totalPaid  = Number(r.total_paid  || 0);
    const chargebacks= Number(r.chargebacks || 0);
    const faturamento= Number(r.faturamento || 0);
    const ticketMedio= totalPaid ? faturamento / totalPaid : 0;
    const taxaCb     = (totalPaid + chargebacks) ? (chargebacks / (totalPaid + chargebacks)) * 100 : 0;

    res.json({
      kpis: { faturamento, ticketMedio, chargebacks, taxaCb, pix: Number(r.pix||0), cartao: Number(r.cartao||0), totalPaid },
      daily:       (r.daily        || []).map(d => ({ data: d.data, total: Number(d.total), count: Number(d.count) })),
      topEmpresas: (r.top_empresas || []).map(e => ({ label: e.label, total: Number(e.total), qtd: Number(e.qtd) })),
      topProdutos: (r.top_produtos || []).map(p => ({ label: p.label, total: Number(p.total), qtd: Number(p.qtd) })),
    });
  } catch (err) {
    console.error('[Gestao/API/Vendas] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── BI ──────────────────────────────────────────────────────────────────────

router.get('/bi', requireHub, requireRole(['admin']), async (req, res) => {
  try {
    const { data: config } = await hub
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

    res.render('gestao-bi', { activePage: 'gestao-bi', embedUrl, pageName });
  } catch (err) {
    console.error('[Gestao/BI] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar BI: ' + err.message });
  }
});

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
  try {
    if (!req.file) return res.status(400).render('gestao-vendas-import', { activePage: 'gestao-vendas', result: { error: 'Nenhum arquivo enviado.' } });

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) return res.render('gestao-vendas-import', { activePage: 'gestao-vendas', result: { error: 'Planilha vazia ou sem dados.' } });

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

    res.render('gestao-vendas-import', {
      activePage: 'gestao-vendas',
      result: { ok: true, total: dataRows.length, unique: uniqueRecords.length, inserted, errors, firstError: firstError || null, arquivo: req.file.originalname },
    });
  } catch (err) {
    console.error('[Gestao/Import] Erro:', err.message);
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

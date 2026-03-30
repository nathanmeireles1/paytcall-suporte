const express = require('express');
const router = express.Router();
const { hub } = require('../config/database');
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

// Acesso: admin e supervisor podem criar/editar; todos os roles autenticados podem ver
const canManage = requireRole(['admin', 'supervisor']);

// ─── EMPRESAS ────────────────────────────────────────────────────────────────

// GET /gestao/empresas
router.get('/empresas', requireHub, async (req, res) => {
  try {
    const { search, segmento, status } = req.query;

    let q = hub.from('empresas').select('*').order('nome');
    if (search)   q = q.ilike('nome', `%${search}%`);
    if (segmento) q = q.eq('segmento', segmento);
    if (status)   q = q.eq('status', status);

    const [{ data: empresas, error }, { data: segmentos }] = await Promise.all([
      q,
      hub.from('empresas').select('segmento').not('segmento', 'is', null),
    ]);

    if (error) throw error;

    const segmentosUnicos = [...new Set((segmentos || []).map(s => s.segmento))].sort();

    res.render('gestao-empresas', {
      activePage: 'gestao-empresas',
      empresas: empresas || [],
      segmentos: segmentosUnicos,
      filters: { search: search || '', segmento: segmento || '', status: status || '' },
    });
  } catch (err) {
    console.error('[Gestao/Empresas] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar empresas: ' + err.message });
  }
});

// GET /gestao/empresas/:id
router.get('/empresas/:id', requireHub, async (req, res) => {
  try {
    const { id } = req.params;

    const [{ data: empresa, error }, { data: notas }] = await Promise.all([
      hub.from('empresas').select('*').eq('id', id).maybeSingle(),
      hub.from('notas').select('*').eq('empresa_id', id).order('dt_criacao', { ascending: false }),
    ]);

    if (error) throw error;
    if (!empresa) return res.status(404).render('error', { message: 'Empresa não encontrada' });

    res.render('gestao-empresa-detalhe', {
      activePage: 'gestao-empresas',
      empresa,
      notas: notas || [],
      canManage: ['admin', 'supervisor'].includes(req.user.role),
    });
  } catch (err) {
    console.error('[Gestao/Empresa] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar empresa: ' + err.message });
  }
});

// POST /gestao/empresas/:id/notas — adiciona nota/follow-up
router.post('/empresas/:id/notas', requireHub, canManage, async (req, res) => {
  try {
    const { id } = req.params;
    const { conteudo, data_followup } = req.body;
    if (!conteudo?.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });

    const { error } = await hub.from('notas').insert({
      empresa_id: id,
      conteudo: conteudo.trim(),
      data_followup: data_followup || null,
      user_id: req.user.id,
      autor: req.user.name,
    });
    if (error) throw error;

    res.redirect(`/gestao/empresas/${id}`);
  } catch (err) {
    console.error('[Gestao/Nota] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao salvar nota: ' + err.message });
  }
});

// ─── PRODUTOS ────────────────────────────────────────────────────────────────

// GET /gestao/produtos
router.get('/produtos', requireHub, async (req, res) => {
  try {
    const { search, nicho } = req.query;

    let q = hub.from('produtos').select('*').order('nome');
    if (search) q = q.ilike('nome', `%${search}%`);
    if (nicho)  q = q.eq('nicho', nicho);

    const [{ data: produtos, error }, { data: nichos }] = await Promise.all([
      q,
      hub.from('produtos').select('nicho').not('nicho', 'is', null),
    ]);

    if (error) throw error;

    const nichosUnicos = [...new Set((nichos || []).map(n => n.nicho))].sort();

    // Agrupa por nicho para exibição em grid
    const porNicho = {};
    for (const p of (produtos || [])) {
      const n = p.nicho || 'Sem categoria';
      if (!porNicho[n]) porNicho[n] = [];
      porNicho[n].push(p);
    }

    res.render('gestao-produtos', {
      activePage: 'gestao-produtos',
      produtos: produtos || [],
      porNicho,
      nichos: nichosUnicos,
      filters: { search: search || '', nicho: nicho || '' },
    });
  } catch (err) {
    console.error('[Gestao/Produtos] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar produtos: ' + err.message });
  }
});

// GET /gestao/produtos/:id
router.get('/produtos/:id', requireHub, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: produto, error } = await hub.from('produtos').select('*').eq('id', id).maybeSingle();

    if (error) throw error;
    if (!produto) return res.status(404).render('error', { message: 'Produto não encontrado' });

    // Busca mídias do playbook no Storage (se slug existir)
    let fotos = [];
    let depoimentos = [];
    if (produto.playbook_slug) {
      const [{ data: fotosData }, { data: depData }] = await Promise.all([
        hub.storage.from('produtos-midias').list(`playbooks/${produto.playbook_slug}/fotos`),
        hub.storage.from('produtos-midias').list(`playbooks/${produto.playbook_slug}/depoimentos`),
      ]);

      const getUrl = (path) => hub.storage.from('produtos-midias').getPublicUrl(path).data.publicUrl;

      fotos = (fotosData || []).map(f => getUrl(`playbooks/${produto.playbook_slug}/fotos/${f.name}`));
      depoimentos = (depData || []).map(d => ({
        url: getUrl(`playbooks/${produto.playbook_slug}/depoimentos/${d.name}`),
        isVideo: d.name.endsWith('.mp4'),
      }));
    }

    res.render('gestao-produto-detalhe', {
      activePage: 'gestao-produtos',
      produto,
      fotos,
      depoimentos,
    });
  } catch (err) {
    console.error('[Gestao/Produto] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar produto: ' + err.message });
  }
});

// ─── SEGMENTOS ────────────────────────────────────────────────────────────────

// GET /gestao/segmentos
router.get('/segmentos', requireHub, async (req, res) => {
  try {
    const { data: produtos, error } = await hub.from('produtos').select('nicho').not('nicho', 'is', null);
    if (error) throw error;

    const contagem = {};
    for (const p of (produtos || [])) {
      contagem[p.nicho] = (contagem[p.nicho] || 0) + 1;
    }

    const segmentos = Object.entries(contagem)
      .map(([nicho, total]) => ({ nicho, total }))
      .sort((a, b) => a.nicho.localeCompare(b.nicho));

    res.render('gestao-segmentos', {
      activePage: 'gestao-segmentos',
      segmentos,
    });
  } catch (err) {
    console.error('[Gestao/Segmentos] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar segmentos: ' + err.message });
  }
});

// GET /gestao/segmentos/:slug
router.get('/segmentos/:slug', requireHub, async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const { data: produtos, error } = await hub.from('produtos').select('*').eq('nicho', slug).order('nome');
    if (error) throw error;

    res.render('gestao-segmento-detalhe', {
      activePage: 'gestao-segmentos',
      nicho: slug,
      produtos: produtos || [],
    });
  } catch (err) {
    console.error('[Gestao/Segmento] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar segmento: ' + err.message });
  }
});

// ─── VENDAS ──────────────────────────────────────────────────────────────────

// GET /gestao/vendas
router.get('/vendas', requireHub, async (req, res) => {
  try {
    const user = req.user;
    const role = user.role; // admin, supervisor, vendedor (mapeados dos roles do hub)
    // No portal de operações: admin = admin; demais roles = vendedor (acesso próprio)
    // Supervisor pode ser mapeado via vendas_colaboradores se necessário

    // Opções para os filtros (carregadas no primeiro acesso)
    const [{ data: tiposData }, { data: empresasData }, { data: produtosData }, { data: colaboradoresData }] = await Promise.all([
      hub.from('vendas').select('tipo_venda').not('tipo_venda', 'is', null).limit(2000),
      hub.from('vendas').select('empresa').not('empresa', 'is', null).limit(2000),
      hub.from('vendas').select('produto').not('produto', 'is', null).limit(2000),
      role === 'admin'
        ? hub.from('vendas_colaboradores').select('equipe').eq('ativo', true)
        : Promise.resolve({ data: [] }),
    ]);

    const tipos    = [...new Set((tiposData    || []).map(r => r.tipo_venda))].sort();
    const empresas = [...new Set((empresasData || []).map(r => r.empresa))].sort();
    const produtos = [...new Set((produtosData || []).map(r => r.produto))].sort();
    const equipes  = [...new Set((colaboradoresData || []).map(r => r.equipe).filter(Boolean))].sort();

    res.render('gestao-vendas', {
      activePage: 'gestao-vendas',
      tipos,
      empresas,
      produtos,
      equipes,
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
router.get('/api/vendas', requireHub, async (req, res) => {
  try {
    const { period, dateFrom, dateTo, equipe, tipo, empresas: empresasParam, produtos: produtosParam } = req.query;
    const user = req.user;
    const role = user.role;

    // Resolve período
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

    // Resolve filtro de email por role
    let emailFilter = null;
    if (role !== 'admin') {
      // Todos os não-admin veem apenas suas próprias vendas
      emailFilter = [user.email];
    } else if (equipe && equipe !== 'all') {
      const { data: cols } = await hub
        .from('vendas_colaboradores')
        .select('email')
        .eq('equipe', equipe)
        .eq('ativo', true);
      emailFilter = (cols || []).map(c => c.email);
    }

    const empresasFiltro = empresasParam ? empresasParam.split(',').filter(Boolean) : [];
    const produtosFiltro = produtosParam  ? produtosParam.split(',').filter(Boolean)  : [];

    // Helper para aplicar filtros comuns
    const applyFilters = (q, statusOverride) => {
      q = q.gte('dt_aprovacao', fromStr).lte('dt_aprovacao', toStr);
      if (emailFilter)        q = q.in('email', emailFilter);
      if (tipo && tipo !== 'all') q = q.eq('tipo_venda', tipo);
      if (empresasFiltro.length) q = q.in('empresa', empresasFiltro);
      if (produtosFiltro.length) q = q.in('produto', produtosFiltro);
      return q;
    };

    // Executa todas as queries em paralelo
    const [
      { data: kpiPaid },
      { data: kpiCb },
      { data: formaPgto },
      { data: daily },
      { data: topEmpresas },
      { data: topProdutos },
    ] = await Promise.all([
      applyFilters(hub.from('vendas').select('valor_venda, id')).eq('status_pagamento', 'paid'),
      applyFilters(hub.from('vendas').select('id')).eq('status_pagamento', 'chargeback'),
      applyFilters(hub.from('vendas').select('forma_pagamento, id')).eq('status_pagamento', 'paid'),
      applyFilters(hub.from('vendas').select('dt_aprovacao, valor_venda, id')).eq('status_pagamento', 'paid').order('dt_aprovacao', { ascending: true }),
      applyFilters(hub.from('vendas').select('empresa, valor_venda, id')).eq('status_pagamento', 'paid').not('empresa', 'is', null),
      applyFilters(hub.from('vendas').select('produto, valor_venda, id')).eq('status_pagamento', 'paid').not('produto', 'is', null),
    ]);

    // KPIs
    const totalPaid  = (kpiPaid || []).length;
    const faturamento = (kpiPaid || []).reduce((s, v) => s + (v.valor_venda || 0), 0);
    const ticketMedio = totalPaid ? faturamento / totalPaid : 0;
    const chargebacks = (kpiCb || []).length;
    const taxaCb = (totalPaid + chargebacks) ? (chargebacks / (totalPaid + chargebacks)) * 100 : 0;

    // Forma de pagamento
    const pix       = (formaPgto || []).filter(v => v.forma_pagamento === 'pix').length;
    const cartao    = (formaPgto || []).filter(v => v.forma_pagamento === 'credit_card').length;

    // Daily
    const dailyMap = {};
    for (const v of (daily || [])) {
      const d = v.dt_aprovacao?.slice(0, 10);
      if (!d) continue;
      if (!dailyMap[d]) dailyMap[d] = { data: d, total: 0, count: 0 };
      dailyMap[d].total += v.valor_venda || 0;
      dailyMap[d].count += 1;
    }
    const dailyData = Object.values(dailyMap).sort((a, b) => a.data.localeCompare(b.data));

    // Top empresas
    const empMap = {};
    for (const v of (topEmpresas || [])) {
      if (!empMap[v.empresa]) empMap[v.empresa] = { label: v.empresa, total: 0, qtd: 0 };
      empMap[v.empresa].total += v.valor_venda || 0;
      empMap[v.empresa].qtd  += 1;
    }
    const topEmpresasArr = Object.values(empMap).sort((a, b) => b.total - a.total).slice(0, 10);

    // Top produtos
    const prodMap = {};
    for (const v of (topProdutos || [])) {
      if (!prodMap[v.produto]) prodMap[v.produto] = { label: v.produto, total: 0, qtd: 0 };
      prodMap[v.produto].total += v.valor_venda || 0;
      prodMap[v.produto].qtd  += 1;
    }
    const topProdutosArr = Object.values(prodMap).sort((a, b) => b.qtd - a.qtd).slice(0, 10);

    res.json({
      kpis: { faturamento, ticketMedio, chargebacks, taxaCb, pix, cartao, totalPaid },
      daily: dailyData,
      topEmpresas: topEmpresasArr,
      topProdutos: topProdutosArr,
    });
  } catch (err) {
    console.error('[Gestao/API/Vendas] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── BI ──────────────────────────────────────────────────────────────────────

// GET /gestao/bi — somente admin
router.get('/bi', requireHub, requireRole(['admin']), async (req, res) => {
  try {
    const { data: config } = await hub
      .from('configuracoes')
      .select('valor')
      .eq('id', 'powerbi')
      .maybeSingle();

    let embedUrl = null;
    let pageName = null;
    if (config?.valor) {
      try {
        const parsed = typeof config.valor === 'string' ? JSON.parse(config.valor) : config.valor;
        embedUrl = parsed.embedUrl || null;
        pageName = parsed.pageName || null;
      } catch (_) {}
    }

    res.render('gestao-bi', {
      activePage: 'gestao-bi',
      embedUrl,
      pageName,
    });
  } catch (err) {
    console.error('[Gestao/BI] Erro:', err.message);
    res.status(500).render('error', { message: 'Erro ao carregar BI: ' + err.message });
  }
});

module.exports = router;

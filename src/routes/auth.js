const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/database');

// GET /login
router.get('/login', (req, res) => {
  if (req.cookies?.auth_token) {
    return res.redirect('/');
  }
  res.render('login', { error: req.query.error || null });
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('login', { error: 'Preencha todos os campos' });
  }

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      return res.render('login', { error: 'Email ou senha incorretos' });
    }

    // Verifica se tem perfil ativo
    const { data: profile } = await db
      .from('user_profiles')
      .select('active')
      .eq('auth_id', data.user.id)
      .maybeSingle();

    if (!profile || !profile.active) {
      return res.render('login', { error: 'Conta desativada. Contate o administrador.' });
    }

    // Cookie httpOnly, seguro em produção
    res.cookie('auth_token', data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    });

    res.redirect('/');
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.render('login', { error: 'Erro interno. Tente novamente.' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/login');
});

// GET /logout (conveniência)
router.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/login');
});

// GET /invite/:token — página de cadastro via convite
router.get('/invite/:token', async (req, res) => {
  const { data: profile } = await db
    .from('user_profiles')
    .select('*')
    .eq('invite_token', req.params.token)
    .is('auth_id', null)
    .maybeSingle();

  if (!profile) {
    return res.render('login', { error: 'Convite inválido ou já utilizado' });
  }

  if (profile.invite_expires_at && new Date(profile.invite_expires_at) < new Date()) {
    return res.render('login', { error: 'Convite expirado. Solicite um novo ao administrador.' });
  }

  res.render('invite', { token: req.params.token, email: profile.email, name: profile.name });
});

// POST /invite/:token — cria conta via convite
router.post('/invite/:token', async (req, res) => {
  const { password, name } = req.body;
  if (!password || password.length < 6) {
    return res.render('invite', {
      token: req.params.token,
      email: req.body.email,
      name: name || '',
      error: 'Senha deve ter pelo menos 6 caracteres',
    });
  }

  const { data: profile } = await db
    .from('user_profiles')
    .select('*')
    .eq('invite_token', req.params.token)
    .is('auth_id', null)
    .maybeSingle();

  if (!profile) {
    return res.render('login', { error: 'Convite inválido ou já utilizado' });
  }

  try {
    // Cria usuário no Supabase Auth
    const { data: authData, error: authError } = await db.auth.admin.createUser({
      email: profile.email,
      password,
      email_confirm: true,
    });

    if (authError) throw authError;

    // Vincula auth_id ao perfil e limpa convite
    await db
      .from('user_profiles')
      .update({
        auth_id: authData.user.id,
        name: name || profile.name,
        invite_token: null,
        invite_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    // Faz login automaticamente
    const { data: loginData } = await db.auth.signInWithPassword({
      email: profile.email,
      password,
    });

    if (loginData?.session) {
      res.cookie('auth_token', loginData.session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    res.redirect('/');
  } catch (err) {
    console.error('[Auth] Invite error:', err.message);
    res.render('invite', {
      token: req.params.token,
      email: profile.email,
      name: name || profile.name,
      error: 'Erro ao criar conta: ' + err.message,
    });
  }
});

module.exports = router;

# 📦 Guia de Deploy — Paytcall Suporte

Deploy automático via GitHub → Hostinger

---

## 1️⃣ Preparação no GitHub

✅ **Já feito:**
- Repositório criado: `nathanmeireles1/paytcall-suporte`
- Branch `feat/payt-webhook-tracker` com todos os arquivos
- Código testado localmente

### Próximo: Fazer merge para `main`

```bash
# No seu computador ou via GitHub UI
git checkout main
git merge feat/payt-webhook-tracker
git push origin main
```

Ou clique em **"Merge pull request"** na PR #1.

---

## 2️⃣ Configuração na Hostinger

### Passo 1: Acessar o painel da Hostinger

1. Entre em **hpanel.hostinger.com**
2. Vá em **Hospedagem** → Seu plano
3. Procure por **Git** ou **Implantações**

### Passo 2: Conectar repositório GitHub

1. Clique em **"Conectar repositório"** ou **"Deploy"**
2. Selecione **GitHub** como provedor
3. Autorize a Hostinger acessar sua conta GitHub
4. Selecione o repositório: **`paytcall-suporte`**
5. Branch: **`main`**

### Passo 3: Configurar variáveis de ambiente

Na Hostinger, vá em **Variáveis de ambiente** (ou Environment Variables):

```
PORT=3000
NODE_ENV=production
DATABASE_URL=file:./data/tracker.db
ADMIN_PASS=adminportal
WONKA_API_KEY=CqarjlMZAB6_uyOahWczdedfGpiQoxBl5K8827PQN9w
```

⚠️ **Atenção:** Proteja a `WONKA_API_KEY`. Se vazar, mude na Wonca.

### Passo 4: Configurar o comando de inicialização

- **Start command:** `npm start`
- **Build command:** `npm install` (ou deixe em branco)
- **Root directory:** `/` (raiz do repo)

### Passo 5: Ativar auto-deploy

- Marque **"Deploy automático ao fazer push"** ou similar
- Salve as configurações

---

## 3️⃣ Estrutura de pastas na Hostinger

Após o primeiro deploy, sua estrutura será:

```
/public_html/paytcall-suporte/
├── src/
├── public/
├── data/
│   └── tracker.db (criado automaticamente)
├── node_modules/
├── package.json
├── .env (criado automaticamente com as variáveis)
└── ...
```

---

## 4️⃣ Webhook URL da payt

Após o deploy, a URL do seu webhook será:

```
https://seu-dominio.com/webhook
```

Exemplo:
```
https://paytcall-suporte.hostinger.com/webhook
```

ou se você tiver um domínio customizado:

```
https://seu-dominio-customizado.com/webhook
```

**Você precisa cadastrar essa URL dentro do painel da payt.com.br**

---

## 5️⃣ Primeiros passos após deploy

### Testar se está rodando

```bash
curl https://seu-dominio.com
# Deve retornar uma resposta (HTML ou JSON)
```

### Testar o webhook

```bash
curl -X POST https://seu-dominio.com/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "shipping": {
      "tracking_code": "AB548273316BR"
    }
  }'
```

### Ver logs na Hostinger

Na Hostinger, procure por **Logs** ou **Terminal** para ver erros de deploy/execução.

---

## 6️⃣ Atualizações futuras

Quando você fizer mudanças:

1. **Edite o código** localmente
2. **Commit e push:**
   ```bash
   git add .
   git commit -m "sua mensagem"
   git push origin main
   ```
3. **Hostinger detecta automaticamente** e faz redeploy (30-60 segundos)
4. Pronto! Nova versão no ar

Se o redeploy falhar, Hostinger volta para a versão anterior automaticamente.

---

## 7️⃣ Troubleshooting

### "Application crashed" ou "Error 500"

Verifique nos **Logs** da Hostinger:
- `WONKA_API_KEY` está definida?
- Porta 3000 está disponível?
- `npm install` rodou com sucesso?

### Webhook não funciona

- Teste a URL: `curl https://seu-dominio.com`
- Verrifique se o domínio aponta corretamente
- Verifique os logs: `tail -f /path/to/logs`

### Banco de dados vazio

- Isso é normal no primeiro deploy
- Dados serão criados conforme webhooks chegarem
- Verifique se `data/tracker.db` foi criado

---

## 📝 Checklist de deploy

- [ ] Repository em `main` com código final
- [ ] Variáveis de ambiente cadastradas na Hostinger
- [ ] Auto-deploy ativo
- [ ] URL do webhook definida na payt
- [ ] Teste manual de webhook funcionou
- [ ] Logs acessíveis para monitoramento
- [ ] API Key da Wonka protegida (não vaze!)
- [ ] Backup dos dados planejado (opcional)

---

**Pronto para produção?** → Vá para [CHECKLIST.md](./CHECKLIST.md)

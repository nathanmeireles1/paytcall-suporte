# ✅ Checklist de Pré-Produção

Use este checklist para garantir que tudo está configurado corretamente antes de colocar a aplicação em produção.

---

## 🔐 Segurança

- [ ] **API Key protegida**
  - [ ] `WONKA_API_KEY` não está commitada no GitHub (apenas em `.env.example` como placeholder)
  - [ ] `WONKA_API_KEY` está configurada como variável de ambiente na Hostinger (não no código)
  - [ ] Senha do painel (`ADMIN_PASS`) foi alterada do padrão "adminportal"

- [ ] **Dados sensíveis**
  - [ ] Arquivo `.env` está no `.gitignore`
  - [ ] `data/tracker.db` está no `.gitignore`
  - [ ] Nenhuma credencial está no repositório público

- [ ] **HTTPS**
  - [ ] Seu domínio usa HTTPS (criptografia SSL/TLS)
  - [ ] Certificado é válido e não expirado

---

## 🌐 Configuração de Domínio

- [ ] **URL de webhook definida**
  - [ ] A URL `https://seu-dominio.com/webhook` está registrada na payt.com.br
  - [ ] DNS aponta corretamente para a Hostinger
  - [ ] Você testou a URL com `curl` e recebeu resposta

- [ ] **Portas corretas**
  - [ ] Aplicação roda na porta 3000 (ou a porta configurada)
  - [ ] Hostinger redireciona porta 80/443 para a aplicação

---

## 📦 Banco de Dados

- [ ] **SQLite preparado**
  - [ ] Pasta `data/` existe no servidor
  - [ ] Arquivo `data/tracker.db` pode ser criado (permissões OK)
  - [ ] Backup automático está planejado (opcional, mas recomendado)

- [ ] **Estrutura do banco**
  - [ ] Tabela `shipments` será criada automaticamente na primeira execução
  - [ ] Índices de performance estão em place

---

## 🔗 Integração com payt

- [ ] **Webhook payt configurado**
  - [ ] URL registrada na payt: `https://seu-dominio.com/webhook`
  - [ ] Tipo de evento: "order" ou "shipping" (conforme a payt oferece)
  - [ ] Teste com payload de teste foi bem-sucedido

- [ ] **Payload payt esperado**
  - [ ] Código de rastreio vem em `shipping.tracking_code`
  - [ ] Transaction ID vem em `transaction_id`
  - [ ] Seu código foi testado com o payload real da payt

---

## 🛠️ Funcionamento

- [ ] **Aplicação inicia sem erros**
  - [ ] `npm start` funciona
  - [ ] Nenhum erro de módulo ou dependência
  - [ ] Porta 3000 fica acessível

- [ ] **Webhook funciona**
  - [ ] Teste com `curl -X POST` foi bem-sucedido
  - [ ] Dados chegam corretos no banco
  - [ ] Status do rastreamento foi atualizado corretamente

- [ ] **Consulta Wonca funciona**
  - [ ] API Key da Wonka está ativa e válida
  - [ ] Requisição retorna eventos de rastreamento
  - [ ] Response é parseada corretamente

- [ ] **Dashboard acessível**
  - [ ] URL: `https://seu-dominio.com/dashboard`
  - [ ] Senha admin foi alterada
  - [ ] Dados aparecem corretamente na tabela

---

## 📊 Monitoramento

- [ ] **Logs configurados**
  - [ ] Você sabe onde estão os logs na Hostinger
  - [ ] Consegue acessá-los facilmente
  - [ ] Erros são visíveis

- [ ] **Alertas (opcional)**
  - [ ] Sistema de notificação de erros está planejado
  - [ ] Você tem forma de saber se a aplicação cair

---

## 🚀 Deploy na Hostinger

- [ ] **Auto-deploy configurado**
  - [ ] GitHub está conectado à Hostinger
  - [ ] Branch `main` foi selecionado
  - [ ] Variáveis de ambiente foram cadastradas

- [ ] **Primeira implantação**
  - [ ] Deploy inicial foi bem-sucedido
  - [ ] Arquivo `.env` foi criado corretamente
  - [ ] Aplicação está rodando em produção

- [ ] **Testes em produção**
  - [ ] Webhook URL responde (status 200)
  - [ ] Primeiro webhook de teste foi processado
  - [ ] Dados aparecem no dashboard

---

## 📋 Documentação

- [ ] **README.md atualizado**
  - [ ] Instruções de instalação local estão claras
  - [ ] Como rodar em desenvolvimento está documentado

- [ ] **DEPLOYMENT.md completo**
  - [ ] Todos os passos para deploy foram documentados
  - [ ] URLs de webhook estão corretas

---

## 🎯 Pós-Deploy

- [ ] **Monitorar primeiros webhooks**
  - [ ] Pelo menos 5 webhooks foram processados com sucesso
  - [ ] Nenhum erro nos logs

- [ ] **Teste de recuperação**
  - [ ] Se a aplicação cair, ela reinicia sozinha?
  - [ ] Dados persistem após reinicialização?

- [ ] **Comunicação com payt**
  - [ ] payt sabe a nova URL do webhook
  - [ ] payt foi informada de que o sistema está pronto

---

## 🎓 Treinamento (se necessário)

- [ ] **Pessoas autorizadas sabem:**
  - [ ] Como acessar o dashboard
  - [ ] Como interpretar os dados de rastreamento
  - [ ] Quem contatar em caso de problemas

---

## ⚠️ Itens Críticos

Se algum desses itens não estiver marcado, **NÃO coloque em produção:**

- ✅ WONKA_API_KEY está configurada e funcionando
- ✅ Webhook URL está registrada na payt
- ✅ HTTPS está ativo
- ✅ Dados persistem no banco de dados
- ✅ Você consegue acessar os logs na Hostinger

---

## 📞 Suporte

Algum problema? Verifique:

1. **[DEPLOYMENT.md](./DEPLOYMENT.md)** — Guia detalhado de deploy
2. **[README.md](./README.md)** — Como rodar localmente
3. **Logs na Hostinger** — Erros específicos aparecem lá
4. **API Wonca** — Verifique se a key está válida em labs.wonca.com.br

---

**Data de checklist:** ____/____/______
**Responsável:** _______________________
**Status:** [ ] Aprovado [ ] Precisa ajustes

Quando tudo passar ✅ você está pronto para produção! 🚀

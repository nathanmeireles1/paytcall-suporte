# 🚚 Paytcall Suporte — Rastreamento de Encomendas

Plataforma de rastreamento de encomendas integrada com webhooks da payt.com.br e API dos Correios via Wonca Labs.

---

## ✨ O que faz

- ✅ Recebe webhooks da payt.com.br com código de rastreio
- ✅ Consulta status real nas Correios via Wonca Labs API
- ✅ Armazena histórico de eventos de rastreamento
- ✅ Dashboard simples para visualizar rastreamentos
- ✅ Sem autenticação no webhook (URL é o segredo)

---

## 🚀 Quick Start

### 1. Clone e instale

```bash
git clone https://github.com/nathanmeireles1/paytcall-suporte.git
cd paytcall-suporte
npm install
```

### 2. Configure variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` e configure:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=file:./data/tracker.db
ADMIN_PASS=sua_senha_segura
WONKA_API_KEY=sua_api_key_da_wonca
```

### 3. Inicie a aplicação

```bash
npm start
```

Você verá:

```
✅ Servidor rodando em http://localhost:3000
✅ Dashboard em http://localhost:3000/dashboard
✅ Webhook pronto em http://localhost:3000/webhook
```

### 4. Teste o webhook

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "integration_key": "test",
    "transaction_id": "123456",
    "shipping": {
      "tracking_code": "AB548273316BR"
    }
  }'
```

Você deverá ver a resposta:

```json
{
  "success": true,
  "tracking_code": "AB548273316BR",
  "status": "in_transit"
}
```

---

## 📁 Estrutura do Projeto

```
paytcall-suporte/
├── src/
│   ├── server.js                 # Entrada da aplicação
│   ├── app.js                    # Configuração Express
│   ├── config/
│   │   └── database.js           # Setup SQLite
│   ├── models/
│   │   └── Shipment.js           # Modelo de dados
│   ├── services/
│   │   └── correios.js           # Integração Wonca
│   ├── routes/
│   │   ├── webhook.js            # POST /webhook
│   │   ├── tracking.js           # GET/POST de rastreamento
│   │   └── dashboard.js          # GET /dashboard
│   └── views/
│       ├── dashboard.ejs         # UI do dashboard
│       ├── shipment.ejs          # Detalhe do rastreio
│       └── error.ejs             # Página de erro
├── public/
│   └── css/js/                   # Assets
├── data/
│   └── tracker.db                # SQLite (gerado automaticamente)
├── .env.example                  # Template de configuração
├── package.json
├── DEPLOYMENT.md                 # Guia de deploy para Hostinger
├── CHECKLIST.md                  # Checklist pré-produção
└── README.md                      # Este arquivo
```

---

## 🔌 API Endpoints

### Webhook (payt → seu servidor)

```http
POST /webhook

Content-Type: application/json
{
  "integration_key": "SUA_CHAVE",
  "transaction_id": "123456",
  "shipping": {
    "tracking_code": "AB548273316BR"
  }
}
```

**Response (200):**

```json
{
  "success": true,
  "tracking_code": "AB548273316BR",
  "status": "in_transit",
  "last_event": "Em trânsito"
}
```

### Dashboard

```http
GET /dashboard
```

Acesso ao painel. Use a senha configurada em `ADMIN_PASS`.

### Listar rastreamentos

```http
GET /api/tracking
```

**Response:**

```json
[
  {
    "id": 1,
    "tracking_code": "AB548273316BR",
    "status": "in_transit",
    "last_event": "Etiqueta expirada",
    "created_at": "2025-03-25T10:30:00Z",
    "updated_at": "2025-03-25T10:35:00Z"
  }
]
```

### Rastreamento por código

```http
GET /api/tracking/:code
```

**Response:**

```json
{
  "tracking_code": "AB548273316BR",
  "status": "in_transit",
  "last_event": "Etiqueta expirada",
  "last_event_date": "2025-10-11 00:04:50",
  "events": [
    {
      "date": "2025-10-11 00:04:50",
      "description": "Etiqueta expirada",
      "detail": "Prazo para postagem encerrado",
      "location": "BR"
    }
  ]
}
```

### Atualizar rastreamentos pendentes

```http
POST /api/tracking/refresh
```

Consulta novamente todos os rastreamentos que ainda estão em trânsito.

---

## 🗄️ Banco de Dados

SQLite com uma tabela principal:

### Tabela: `shipments`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PRIMARY KEY | ID único |
| `tracking_code` | TEXT UNIQUE | Código de rastreio |
| `transaction_id` | TEXT | ID da transação payt |
| `status` | TEXT | Status atual (in_transit, delivered, etc) |
| `last_event` | TEXT | Último evento |
| `last_event_date` | TEXT | Data do último evento |
| `events` | JSON | Array de eventos completo |
| `created_at` | TEXT | Data de criação |
| `updated_at` | TEXT | Data da última atualização |

---

## 🔐 Segurança

### Webhook
- Sem autenticação por token (a URL é o segredo)
- Protegido por HTTPS em produção
- Rate limiting ativo (veja `express-rate-limit`)

### Dashboard
- Senha simples (`ADMIN_PASS`)
- Sem JWT ou sessões (apenas para demo)
- Para produção: considere adicionar autenticação real

### Variáveis sensíveis
- Sempre use `.env` para guardar chaves
- Nunca commite `.env` no Git
- `WONKA_API_KEY` deve ser protegida

---

## 🚀 Deploy

### Local (desenvolvimento)

```bash
npm start
```

### Produção (Hostinger)

Veja **[DEPLOYMENT.md](./DEPLOYMENT.md)** para:
- Configurar GitHub auto-deploy
- Registrar webhook na payt
- Variáveis de ambiente em produção
- Troubleshooting

### Pré-produção

Use **[CHECKLIST.md](./CHECKLIST.md)** para garantir que tudo está pronto.

---

## 📊 Statuses de Rastreamento

| Status | Significado | Exemplo |
|--------|-------------|---------|
| `posted` | Postado | Etiqueta emitida |
| `in_transit` | Em trânsito | Encaminhado, saiu para entrega |
| `out_for_delivery` | Saiu para entrega | Objeto distribuído |
| `delivery_attempt` | Tentativa de entrega | Ausente, tentativa |
| `delivered` | Entregue | Entregue ao destinatário |
| `returned` | Devolvido | Objeto devolvido |
| `expired` | Expirado | Prazo de postagem encerrado |

---

## 🔧 Desenvolvimento

### Variáveis para desenvolvimento

```bash
NODE_ENV=development
PORT=3000
```

### Logs

A aplicação exibe logs detalhados no console:

```
[Correios] Consultando AB548273316BR
[Wonca] Resposta recebida com 2 eventos
[Webhook] Shipment AB548273316BR atualizado
```

### Hot reload

Use [nodemon](https://nodemon.io/):

```bash
npm run dev
```

---

## 📝 Problemas comuns

### "WONKA_API_KEY não configurada"

- Verifique se o arquivo `.env` existe
- Confirme que `WONKA_API_KEY=...` está preenchida

### "Erro ao consultar rastreamento"

- Teste a API Key da Wonca diretamente:
  ```bash
  curl -X POST https://api-labs.wonca.com.br/wonca.labs.v1.LabsService/Track \
    -H "Authorization: Apikey SEU_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"code":"AB548273316BR"}'
  ```

### "Webhook não funciona"

- Verifique o método HTTP: `POST /webhook`
- Verifique o `Content-Type: application/json`
- Veja os logs: procure por `[Webhook]`

### "Erro 500 no dashboard"

- Verifique se `data/` tem permissões de escrita
- Verifique se o SQLite não está corrompido
- Reinicie a aplicação

---

## 📚 Dependências

| Pacote | Versão | Uso |
|--------|--------|-----|
| `express` | ^4.19 | Framework web |
| `axios` | ^1.7 | HTTP client |
| `@libsql/client` | ^0.14 | SQLite client |
| `dotenv` | ^16.4 | Variáveis de ambiente |
| `ejs` | ^3.1 | Template engine |
| `express-rate-limit` | ^7.3 | Rate limiting |
| `nodemailer` | ^6.9 | Email (futuro) |

---

## 📞 Suporte

- **Documentação de Deploy:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Checklist de Produção:** [CHECKLIST.md](./CHECKLIST.md)
- **Issues:** [GitHub](https://github.com/nathanmeireles1/paytcall-suporte/issues)

---

## 📄 Licença

MIT — Uso livre para fins educacionais e comerciais.

---

**Última atualização:** 2025-03-25

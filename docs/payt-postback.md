# Documentação payt Postback

> Fonte: https://github.com/ventuinha/payt-postback
> Salvo em: 2026-03-26

---

## Campos principais do Postback

| Campo | Descrição |
|-------|-----------|
| `integration_key` | Sua chave de integração — valida que o postback veio da payt |
| `transaction_id` | ID da transação |
| `seller_id` | ID do vendedor (separação multi-tenant no nosso sistema) |
| `test` | `true` quando é postback de teste |
| `status` | Status do pedido e motivo do postback |

---

## Status do Pedido (`status`)

| Status | Significado |
|--------|-------------|
| `waiting_payment` | Aguardando pagamento |
| `paid` | Pago |
| `billed` | Faturado |
| `separation` | Em separação |
| `collected` | Coletado |
| `shipping` | Em processo de envio |
| `shipped` | Enviado — `tracking_code` disponível a partir daqui |
| `canceled` | Cancelado |
| `lost_cart` | Carrinho abandonado |
| `subscription_activated` | Assinatura ativada |
| `subscription_canceled` | Assinatura cancelada |
| `subscription_overdue` | Assinatura em atraso |
| `subscription_renewed` | Assinatura renovada |

---

## Objeto `shipping` (produtos físicos)

| Campo | Descrição |
|-------|-----------|
| `price` | Valor do frete em centavos |
| `status` | Status da entrega (ver tabela abaixo) |
| `service` | Tipo de serviço de entrega |
| `tracking_code` | Código de rastreio (opcional) |
| `tracking_url` | URL de rastreio (opcional) |

### Sub-objeto `address`
`zipcode`, `street`, `district`, `city`, `state`

---

## Shipping Status — valores de `shipping.status`

> Estes são os status que a **payt envia para nós** via webhook.
> Nosso sistema os usa também como status internos (derivados do Wonca/Correios).

| Status | Nome (pt-BR) | Observação |
|--------|-------------|------------|
| `waiting` | Aguardando postagem | |
| `tracking_received` | Rastreio Recebido | |
| `invalid_code` | Código de Rastreio Inválido | |
| `delivery_problem` | Problema na Entrega | |
| `overdue` | Em Atraso | |
| `wrong_address` | Endereço Errado do Destinatário | |
| `waiting_client` | Objeto aguardando retirada do cliente | ⚠️ **payt para de notificar aqui** |
| `recipient_not_found` | Destinatário não encontrado | |
| `delivered` | Entrega Realizada | |
| `posted_object` | Objeto Postado | |
| `forwarded` | Encaminhado | |
| `delivering` | Saiu para entrega | |
| `waiting_validation` | Aguardando Validação | |
| `returning` | Devolvendo ao Remetente | |
| `returned` | Devolvido | |
| `shipping` | Em transporte | |

---

## Objeto `commission`

Array de comissões. Cada item tem:
- `type`: tipo do comissionado (`producer` = empresa dona do produto)
- `name`: nome do comissionado

> No nosso sistema: `commission.find(c => c.type === 'producer').name` → `company_name`

---

## Fluxo no Nosso Sistema

```
payt webhook → POST /webhook
    ↓
Extrai tracking_code de body.shipping.tracking_code
    ↓
Consulta Wonca API (Correios) → status real do objeto
    ↓
Mapeia texto do Correios → status interno (mesmo vocabulário da payt)
    ↓
Se status = 'waiting_client' → scheduler diário às 8h BRT re-consulta automaticamente
    (payt para de enviar webhooks nesse ponto)
```

---

## Mapeamento Texto Correios → Status Interno

| Texto do Correios (Wonca) | Status interno |
|---------------------------|----------------|
| ENTREGUE / DELIVERED | `delivered` |
| TENTATIVA / AUSENTE | `recipient_not_found` |
| DEVOLVIDO / DEVOLU | `returned` |
| DEVOLVENDO / RETORNO AO | `returning` |
| SAIU / DISTRIBUI / OUT FOR DELIVERY | `delivering` |
| RETIRADA / DISPONIVEL / AGUARDANDO CLIENTE | `waiting_client` ⚠️ |
| POSTADO / POSTED | `posted_object` |
| ENCAMINH / IN TRANSIT / TRANSPORTE | `forwarded` |
| EXPIRADA / PRAZO / EXPIRED / ATRASO | `overdue` |
| ENDERE / CEP | `wrong_address` |
| (padrão) | `forwarded` |

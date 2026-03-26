#!/bin/bash

# 🚀 Script de Deploy — Paytcall Suporte
# Uso: bash deploy.sh

set -e

echo "================================"
echo "🚀 INICIANDO DEPLOY"
echo "================================"
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Verificar Node.js
echo -e "${YELLOW}[1/6] Verificando Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js não está instalado${NC}"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✅ Node.js $NODE_VERSION${NC}"
echo ""

# 2. Instalar dependências
echo -e "${YELLOW}[2/6] Instalando dependências...${NC}"
npm install --production
echo -e "${GREEN}✅ Dependências instaladas${NC}"
echo ""

# 3. Criar pasta de dados
echo -e "${YELLOW}[3/6] Preparando pasta de dados...${NC}"
mkdir -p data
if [ -f data/tracker.db ]; then
    echo -e "${GREEN}✅ Banco de dados já existe (data/tracker.db)${NC}"
else
    echo -e "${GREEN}✅ Pasta de dados criada (banco será criado na primeira execução)${NC}"
fi
echo ""

# 4. Verificar arquivo .env
echo -e "${YELLOW}[4/6] Verificando variáveis de ambiente...${NC}"
if [ -f .env ]; then
    echo -e "${GREEN}✅ Arquivo .env encontrado${NC}"
    # Verificar se as chaves essenciais estão presentes
    if grep -q "WONKA_API_KEY" .env; then
        echo -e "${GREEN}✅ WONKA_API_KEY está configurada${NC}"
    else
        echo -e "${RED}❌ WONKA_API_KEY não está em .env${NC}"
        echo "   Adicione: WONKA_API_KEY=sua_chave_aqui"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  .env não encontrado${NC}"
    echo "   Copie de .env.example e configure as variáveis:"
    echo "   cp .env.example .env"
    echo ""
    read -p "   Deseja criar .env agora? (s/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        cp .env.example .env
        echo -e "${YELLOW}⚠️  Abra .env e configure WONKA_API_KEY${NC}"
        exit 1
    fi
fi
echo ""

# 5. Testar se a aplicação inicia
echo -e "${YELLOW}[5/6] Testando inicialização da aplicação...${NC}"
timeout 5 node src/server.js > /dev/null 2>&1 &
PID=$!
sleep 2

if kill -0 $PID 2>/dev/null; then
    kill $PID 2>/dev/null || true
    echo -e "${GREEN}✅ Aplicação iniciou com sucesso${NC}"
else
    echo -e "${RED}❌ Erro ao iniciar a aplicação${NC}"
    echo "   Verifique os logs acima"
    exit 1
fi
echo ""

# 6. Resumo final
echo -e "${YELLOW}[6/6] Verificação final...${NC}"
echo -e "${GREEN}✅ Deploy preparado com sucesso!${NC}"
echo ""

echo "================================"
echo "📝 PRÓXIMOS PASSOS"
echo "================================"
echo ""
echo "1. Configure as variáveis em .env (se não fez ainda):"
echo "   - WONKA_API_KEY"
echo "   - PORT (padrão: 3000)"
echo "   - ADMIN_PASS (padrão: adminportal)"
echo ""
echo "2. Inicie a aplicação:"
echo "   npm start"
echo ""
echo "3. Acesse o painel:"
echo "   http://localhost:3000/dashboard"
echo ""
echo "4. Teste o webhook:"
echo "   curl -X POST http://localhost:3000/webhook \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"shipping\": {\"tracking_code\": \"AB548273316BR\"}}'"
echo ""
echo "================================"
echo "🎉 TUDO PRONTO!"
echo "================================"

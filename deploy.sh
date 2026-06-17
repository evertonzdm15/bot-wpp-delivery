#!/usr/bin/env bash
# Deploy no servidor Ubuntu + Docker Swarm (rodar DENTRO da pasta do projeto no servidor).
# Constrói a imagem localmente (single-node swarm usa imagem local) e sobe o stack.
set -euo pipefail

STACK_NAME="${STACK_NAME:-botdelivery}"
export IMAGE="${IMAGE:-bot-delivery:latest}"
# Rede externa do Traefik neste servidor (grupodm)
NETWORK="${NETWORK:-grupodmsite}"

# --- Carrega .env.production ---
if [ ! -f .env.production ]; then
  echo "❌ .env.production não encontrado. Rode: cp .env.production.example .env.production && nano .env.production"
  exit 1
fi
set -a; . ./.env.production; set +a

# --- Valida segredos obrigatórios ---
: "${EVOLUTION_API_KEY:?defina EVOLUTION_API_KEY no .env.production}"
: "${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD no .env.production}"
if [ "${POSTGRES_PASSWORD}" = "troque-esta-senha" ] || [ "${EVOLUTION_API_KEY}" = "coloque-sua-api-key-aqui" ]; then
  echo "❌ Edite o .env.production com valores reais (POSTGRES_PASSWORD e EVOLUTION_API_KEY)."
  exit 1
fi

echo "==> Swarm..."
docker info 2>/dev/null | grep -q "Swarm: active" || docker swarm init

echo "==> Rede externa ${NETWORK}..."
docker network inspect "${NETWORK}" >/dev/null 2>&1 || \
  docker network create --driver overlay --attachable "${NETWORK}"

echo "==> Build da imagem ${IMAGE}..."
docker build -t "${IMAGE}" .

echo "==> Deploy do stack ${STACK_NAME}..."
docker stack deploy -c docker-stack.yml "${STACK_NAME}"

echo
echo "==> Serviços:"
docker stack services "${STACK_NAME}"
echo
echo "✅ Deploy disparado. Acompanhe:"
echo "   docker service logs -f ${STACK_NAME}_bot"
echo "   curl -s https://bot.grupodm.site/health"

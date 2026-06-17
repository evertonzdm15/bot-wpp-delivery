# Bot WhatsApp — Delivery de Farmácia (Grupo DM)

Bot de gestão de entregas para farmácia via WhatsApp, integrado à **Evolution API 2.3.7**.

**Stack:** Node.js + TypeScript · PostgreSQL (Prisma) · Redis · Express · ExcelJS · Docker (Swarm + Traefik)

---

## Perfis (menus)

| Perfil | O que faz |
|--------|-----------|
| ⭐ **Super Admin** | Tudo do Admin + pode criar outros Admins/Super Admins |
| 👑 **Admin** | Cria filiais e códigos de acesso, vincula/remove menus de números, vê histórico |
| 🏪 **Filial** | Cria tarefas, vê tarefas em aberto, exporta histórico |
| 🛵 **Motoboy** | `/pedidos`, `/entregas`, pega/solta/finaliza pedidos por resposta citada |

Um mesmo número pode ter **vários menus** (ex.: Motoboy + Admin). Ao escrever, o bot pergunta qual menu usar.

---

## Conceitos-chave

### Código de acesso por filial
O Admin define um **código** para cada filial. Qualquer número que digitar o código entra no menu daquela filial — sem precisar de cadastro prévio.

### Tarefas e coletas
- **Primeira coleta = tipo principal**: `🚀 Rápida R6`, `⚡ Rápida` ou `🗓️ Programada`.
- **Coletas adicionais = sempre TR**: fluxo enxuto, **sem cliente/endereço**, só **filial + itens** (em loop, quantas quiser).
- SLA automático: R6 = 40 min, Rápida = 90 min, Programada = horário informado (configurável via `.env`).

### Interação do motoboy (resposta citada)
Responder (citar) a mensagem de um pedido com:
- **`pegar`** → assume o pedido (atribui)
- **`soltar`** → devolve para a fila (desatribui)
- **qualquer outro texto** → **finaliza** a entrega

### Comandos globais
| Comando | Efeito |
|---------|--------|
| `inicio` | Zera tudo (sessão e perfil) |
| `menu` | Volta ao menu principal do perfil |
| `0` | Volta uma etapa |
| `9` | Pula campo opcional |
| `/pedidos` | (Motoboy) Lista pedidos da fila, 1 mensagem por pedido |
| `/entregas` | (Motoboy) Lista suas entregas em andamento |

### Alertas automáticos
Job de cron a cada minuto: avisa **15 min antes** do vencimento (configurável). Notifica motoboy responsável + criador; se ainda estiver na fila, notifica todos os motoboys.

### Exportação XLSX
No **Histórico**, escolha o período (hoje / 7d / 30d / tudo) e exporte uma planilha `.xlsx` enviada como documento no WhatsApp.

---

## Estrutura

```
src/
├── config/env.ts            # Variáveis de ambiente
├── lib/                     # prisma, redis, logger
├── core/
│   ├── types.ts             # SessionState, Ctx, IncomingMessage
│   ├── engine.ts            # Motor de fluxos (steps, goTo, goBack)
│   ├── router.ts            # Roteia comandos globais e etapas
│   ├── webhook.ts           # Parser do payload da Evolution
│   └── quoted.ts            # pegar/soltar/finalizar via resposta citada
├── flows/
│   ├── menu.ts              # Entrada + escolha de menu + menu principal
│   ├── auth.flow.ts         # Código de acesso da filial
│   ├── choose.flow.ts       # Seleção entre múltiplos menus
│   ├── filial.flow.ts       # Nova tarefa (principal + coletas TR), aberto, cancelar
│   ├── motoboy.flow.ts      # /pedidos, /entregas
│   ├── historico.flow.ts    # Histórico + exportação XLSX
│   └── admin.flow.ts        # Filiais, vincular/remover menus, usuários
├── services/                # evolution, task, user, session, export, webhook-setup
├── jobs/alerts.job.ts       # Alertas de vencimento (cron)
└── server.ts                # Express + bootstrap
prisma/
├── schema.prisma
└── seed.ts
```

---

## Rodando localmente

```bash
cp .env.example .env          # ajuste se necessário
npm install
docker compose up -d postgres redis
npm run prisma:migrate -- --name init
npm run seed                  # cria Super Admin (se SUPER_ADMIN_PHONE) e filial Matriz
npm run dev
```

Para subir tudo em containers de uma vez (local):

```bash
docker compose up -d --build
```

Exponha a porta 3000 publicamente (ex.: ngrok) e configure `PUBLIC_URL` para o webhook ser registrado automaticamente na Evolution.

---

## Deploy em produção (Ubuntu 20.04 · Docker Swarm · Traefik)

Domínio: **bot.grupodm.site** · Evolution: **api.grupodm.site** · Instância: **GRUPODM**

1. **Build e push da imagem** (registry de sua escolha):
   ```bash
   docker build -t SEU_REGISTRO/bot-delivery:latest .
   docker push SEU_REGISTRO/bot-delivery:latest
   ```

2. **Defina segredos via variáveis de ambiente** no host:
   ```bash
   export IMAGE=SEU_REGISTRO/bot-delivery:latest
   export POSTGRES_PASSWORD='senha-forte'
   export SUPER_ADMIN_PHONE='5511999998888'
   export WEBHOOK_TOKEN='um-token-secreto'   # opcional
   ```

3. **Deploy do stack** (a rede `traefik_public` deve existir):
   ```bash
   docker stack deploy -c docker-stack.yml botdelivery
   ```

   O container aplica `prisma migrate deploy` no start e registra o webhook
   `https://bot.grupodm.site/webhook` na Evolution automaticamente (via `PUBLIC_URL`).

4. **Seed (primeira vez)** — criar o Super Admin:
   ```bash
   docker exec -it $(docker ps -qf name=botdelivery_bot) npx tsx prisma/seed.ts
   ```

### Webhook manual (se preferir)
Na Evolution API, configure o webhook da instância `GRUPODM`:
- URL: `https://bot.grupodm.site/webhook` (acrescente `?token=...` se usar `WEBHOOK_TOKEN`)
- Evento: `MESSAGES_UPSERT`

---

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DATABASE_URL` | Conexão PostgreSQL | — |
| `REDIS_URL` | Conexão Redis | `redis://localhost:6379` |
| `EVOLUTION_API_URL` | URL da Evolution API | `https://api.grupodm.site` |
| `EVOLUTION_INSTANCE` | Nome da instância | `GRUPODM` |
| `EVOLUTION_API_KEY` | API key da Evolution | — |
| `PUBLIC_URL` | URL pública deste bot (auto-config do webhook) | — |
| `WEBHOOK_TOKEN` | Token opcional do webhook | vazio |
| `SUPER_ADMIN_PHONE` | Telefone do Super Admin (DDI+DDD+nº) | vazio |
| `SLA_RAPIDA_R6_MIN` | SLA Rápida R6 (min) | `40` |
| `SLA_RAPIDA_MIN` | SLA Rápida (min) | `90` |
| `ALERTA_ANTECEDENCIA_MIN` | Antecedência do alerta (min) | `15` |

---

## Notas técnicas

- **Sessões** ficam no Redis (TTL 30 dias), permitindo escalar horizontalmente.
- **Deduplicação** de mensagens via Redis (`dedup:<id>`, TTL 2 min) evita reprocessar reentregas do webhook.
- **`TaskMessage`** guarda o id da mensagem no WhatsApp de cada pedido enviado, para mapear respostas citadas → pedido.
- O webhook responde `200` imediatamente e processa de forma assíncrona.
```

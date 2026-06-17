# Deploy em Produção — bot.grupodm.site

Servidor: **Ubuntu 20.04 · Docker Swarm · Traefik** · Domínio: **bot.grupodm.site**
Evolution: **api.grupodm.site** · Instância: **GRUPODM**

O deploy é via **Git**: o servidor clona o repositório, configura `.env.production` e
roda `deploy.sh` (builda a imagem localmente e sobe o stack no Swarm). O próprio
container aplica as migrations e registra o webhook na Evolution no boot.

---

## Pré-requisitos no servidor (já atendidos no servidor grupodm)
- Docker Swarm ativo + **Traefik** rodando.
- entrypoint `websecure` · certresolver `letsencryptresolver` · rede externa `grupodmsite`.
  (Já configurado — o `docker-stack.yml` deste projeto já usa esse padrão.)
- DNS de `bot.grupodm.site` apontando para o servidor (já está, via Cloudflare).

## 1. Clonar o repositório
Repo **privado** — autentique com `gh` logado ou um token:
```bash
git clone https://github.com/evertonzdm15/bot-wpp-delivery.git
cd bot-wpp-delivery
```

## 2. Configurar segredos
```bash
cp .env.production.example .env.production
nano .env.production
```
Preencha:
| Variável | Valor |
|----------|-------|
| `POSTGRES_PASSWORD` | uma senha forte |
| `EVOLUTION_API_KEY` | a API key da instância Evolution (não versionar) |
| `SUPER_ADMIN_PHONE` | seu número pessoal (⚠️ **diferente** da linha do bot/Zap Logística) |
| `SUPER_ADMIN_CODE` | a senha que o Super Admin vai digitar pra entrar |
| `BOT_TEST_CODE` | **vazio** em produção (senão libera tudo a qualquer um) |
| `PUBLIC_URL` | `https://bot.grupodm.site` |

> O Super Admin é criado automaticamente no boot a partir de `SUPER_ADMIN_PHONE` +
> `SUPER_ADMIN_CODE` — não precisa rodar seed em produção.

## 3. (Importante) Remover o bot antigo
O stack antigo que serve `bot.grupodm.site` chama-se **`delivery-bot`**. Remova-o
antes (os volumes dele ficam preservados como backup):
```bash
docker stack rm delivery-bot
sleep 10
```

## 4. Deploy
```bash
bash deploy.sh
```
Acompanhe:
```bash
docker service logs -f botdelivery_bot
curl -s https://bot.grupodm.site/health      # espera {"ok":true,...}
```

## 5. Verificar o webhook
O bot registra sozinho no boot. Confira:
```bash
curl -s -H "apikey: $EVOLUTION_API_KEY" \
  https://api.grupodm.site/webhook/find/GRUPODM
# url deve ser https://bot.grupodm.site/webhook
```

## 6. Primeiro acesso
Do **seu número pessoal** (o `SUPER_ADMIN_PHONE`), mande "oi" pro WhatsApp do bot e
digite o `SUPER_ADMIN_CODE`. Pelo painel Super Admin você cria Admins, e cada Admin
cria filiais, motoboys e tipos de entrega.

---

## Atualizar (deploy de nova versão)
```bash
cd bot-wpp-delivery
git pull
bash deploy.sh        # rebuilda a imagem e atualiza o serviço (migrations aplicam no boot)
```

## Troubleshooting
- **404 / "Bad Gateway" no domínio:** Traefik não está roteando. Confira se o serviço
  está na rede `traefik_public` e se o resolver/entrypoint das labels batem com o seu Traefik.
- **Bot reinicia / erro P1001 (DB):** Postgres ainda subindo ou senha errada. Veja
  `docker service logs botdelivery_postgres`.
- **Prisma/OpenSSL:** a imagem já instala `openssl` (corrigido no Dockerfile).
- **Webhook não chega:** confira o `find` acima; reenvie com
  `node scripts/set-webhook.mjs prod` (precisa do `.env`/variáveis carregadas).
- **Mensagens duplicadas / nada acontece:** confira `docker service logs -f botdelivery_bot`.

## Rollback
```bash
git checkout <commit-anterior>
bash deploy.sh
```

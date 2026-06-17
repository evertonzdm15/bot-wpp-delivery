# Escopo dos Menus — Bot Delivery (fonte da verdade)

> Documento de alinhamento. Fase atual: **esqueleto navegável** (navegação + árvore de menus;
> lógicas profundas marcadas como 🚧 ficam para a fase 2 / multi-tenant).

## Hierarquia (multi-tenant — fase 2 para o modelo de dados)

```
SUPER ADMIN (dono de tudo)
 └── ADMIN (clientes do Super Admin — cada um é um tenant)
       ├── FILIAIS (clientes do Admin)
       └── MOTOBOYS (entregadores do Admin, vinculados a filiais)
```

## Autenticação
- **Número = login, código = senha.** Toda sessão começa pedindo o código.
- Após o código → se o número tem +1 perfil, abre o **menu de escolha de perfil**; se tem 1, entra direto.
- **Esqueleto (atalho de teste):** o código **`1234`** (env `BOT_TEST_CODE`) vincula os **4 perfis**
  ao número que digitar, para você testar tudo de qualquer celular. O modelo real
  (senha por número, definida pelo criador) entra na fase 2.

## Comandos de navegação (globais)
| Comando | Ação |
|---------|------|
| `INICIO` | Zera a navegação (mantém os acessos vinculados ao número) |
| `SAIR` | Volta ao **menu de escolha de perfil** |
| `MENU` | Menu principal do perfil ativo |
| `0` / `VOLTAR` | Volta uma etapa (encadeado até o menu inicial) |
| `9` | Pula campo opcional |

Rodapé fixo nos menus: `0/VOLTAR ⬅️ · MENU 🏠 · SAIR 🔄 · INICIO ♻️`

---

## 🤝 Auto-cadastro via código de convite ✅ IMPLEMENTADO
Permite que **lojas (filiais)** e **motoboys** se cadastrem sozinhos, sem o Admin
digitar telefone/código manualmente.

**Como funciona:**
1. O **Admin** gera um **código de convite** em `Admin → 9️⃣ Solicitações de cadastro
   → Gerar/alterar código` (6 caracteres, ex.: `K7P2QX`) e compartilha com seus contatos.
2. No **primeiro acesso**, a pessoa digita esse código na tela de identificação →
   escolhe **🏪 Loja/Cliente** ou **🛵 Motoboy** → informa nome (e endereço, p/ loja).
   O telefone é o próprio número do WhatsApp.
3. Cria uma **solicitação PENDENTE** e notifica automaticamente o(s) número(s) Admin.
4. O Admin **aprova** ou **recusa** em `Admin → 9️⃣ Solicitações de cadastro`. Ao aprovar:
   - **Loja** → cria a **Filial** com um código de acesso gerado e concede o perfil 🏪.
   - **Motoboy** → cria o usuário com código de acesso gerado e concede o perfil 🛵
     (o valor por entrega é definido depois em `Motoboys → Valores por tipo`).
5. O solicitante recebe uma mensagem com o **código de acesso** gerado para entrar.

> Modelo de dados: `Admin.inviteCode` + tabela `RegistrationRequest`
> (`kind`, `name`, `phone`, `extra`, `status: PENDENTE|ACEITO|RECUSADO`).

---

## ⭐ SUPER ADMIN
```
1️⃣ Admins (cadastro)   → criar / editar / vincular / remover / código de acesso
2️⃣ Filiais             → lista de filiais ativas + média de entregas/mês
3️⃣ Motoboys            → lista de motoboys ativos + média de entregas/mês
4️⃣ Pedidos (todos)     → visão global de todos os Admins
5️⃣ Histórico / Exportar XLSX
6️⃣ Relatórios
```

## 👑 ADMIN — [nome da operação]
```
1️⃣ Filiais   → criar/editar · configurar TIPOS DE ENTREGA + PRAZOS de vencimento · código de acesso
2️⃣ Motoboys  → criar/editar · vincular a filiais · valor por pedido + valor padrão
              (valor padrão usado quando o tipo de entrega da filial não tiver
               parâmetro no cadastro do motoboy)
3️⃣ Pedidos / Entregas → ACOMPANHAR (não cria; quem cria é a Filial)
4️⃣ Histórico / Exportar
```

## 🛵 MOTOBOY
```
1️⃣ Pedidos disponíveis (/pedidos)
     → dispara UMA mensagem por vez, em ordem do MENOR PRAZO.
       Cada mensagem é uma solicitação avulsa; o motoboy CITA a mensagem
       para atualizar status: "pegar" → depois "finalizar" ou "soltar".
2️⃣ Em andamento        → pedidos que ele PEGOU e ainda não finalizou
     (dispara 1 msg por pedido para ele citar e finalizar)
3️⃣ Minhas entregas     → entregas já FINALIZADAS
4️⃣ Relatório           → seleciona período → qtd por tipo de entrega finalizada + total em R$
5️⃣ Histórico / Exportar XLSX
ℹ️ Citar a msg do pedido: pegar / soltar / finalizar.
   Ao FINALIZAR, pede observação: entregue · não entregue · retorno à loja · texto livre.
```

## 🏪 FILIAL — [nome]
```
1️⃣ Nova tarefa
2️⃣ Tarefas em aberto
     → pode CANCELAR se estiver PENDENTE.
       Se já ATRIBUÍDA, não cancela (orienta a contatar o motoboy).
3️⃣ Histórico de pedidos → seleciona período → lista de pedidos + quem entregou
4️⃣ Dados do pedido → pede o código → mostra: horário de criação, horário de
     atribuição pelo motoboy, horário de finalização e a observação
5️⃣ Histórico / Exportar XLSX
```

---

## Fluxo "Nova tarefa" (Filial) — revisado
1. **Tipo da coleta principal** → lista os TIPOS cadastrados pela filial (cada um com prazo próprio) + **Programada** (prazo = horário informado).
2. (se Programada) **Horário** — `HH:mm` ou `dd/mm HH:mm`.
3. **Cliente** (nome).
4. **Telefone** (opcional, `9` pula).
5. **Endereço**.
6. **Itens** (um por mensagem; `ok` finaliza).
7. **Observação** (opcional, `9` pula).
8. **Coletas adicionais TR** → texto livre, **uma por mensagem**; cada mensagem
   conta como **+1 TR**. `Sim` entra no loop; envie cada TR e `ok` para finalizar.
   (sem seleção de filial e sem sub-itens — campo livre).
9. **Confirmação** (resumo → confirmar/cancelar).
10. Ao confirmar: cria pedido `#N`, calcula prazo pelo tipo, dispara 1 mensagem por pedido aos motoboys.

### Finalização (revisada)
- Citar a mensagem do pedido com "finalizar" → pede **motivo/obs**:
  `entregue` · `não entregue` · `retorno à loja` · texto livre.

---

## Contabilização / Financeiro ✅ IMPLEMENTADO

**Regra:** cada pedido finalizado gera `1 (tipo principal) + N (TR)` **lançamentos**,
creditados ao **motoboy que finalizou**, no momento da finalização.
Ex.: Pedido com Rápida R6 + 3 TR → 1× Rápida R6 + 3× TR = 4 lançamentos.

**O que conta:** *toda* finalização gera lançamentos — `entregue`, `não entregue` e
`retorno à loja` contam igualmente (o motivo é gravado só para informação).

**Valoração:** cada **tipo** (incl. TR) tem um valor vindo do **cadastro do motoboy**;
se o tipo não tiver valor no cadastro dele, usa o **valor padrão**. O valor é
**congelado** (snapshot) na linha do lançamento → relatórios antigos não mudam se o
preço mudar depois.

**Modelo de dados (planejado):**
```
Lancamento {
  id, taskId, motoboyId,
  tipo,        // tipo da entrega (configurado) ou TR
  valor,       // snapshot no momento da finalização (Decimal)
  motivo,      // entregue | nao_entregue | retorno
  createdAt    // = finishedAt do pedido
}
```
Relatórios (Motoboy / Filial / Admin / Super Admin) = agregação de `Lancamento`
por período / motoboy / tipo, somando `valor`.

Implementado em `Lancamento` (valor em **centavos**, `Int`). Relatórios
(Motoboy / Admin / Super Admin) = agregação por período / tipo, somando valor.

## ✅ Implementado (sistema completo)
- Modelo multi-tenant real: `Admin` (tenant) dono de filiais/motoboys; dados escopados por Admin.
- Tipos de entrega por filial (`DeliveryType`) com prazo próprio ou "programada".
- Valores por motoboy/tipo (`MotoboyRate`) + valor padrão; livro de lançamentos.
- Relatórios financeiros (motoboy, admin, global) por período.
- Finalização com motivo (entregue / não entregue / retorno) + observação.
- **Motoboys em rota** (Filial/Admin/Super Admin): lista motoboys com pedidos
  atribuídos não finalizados, escopado por perfil, com filtro de vencidos,
  **cobrança de finalização** (reenvia os pedidos ao motoboy) e export XLSX.
- **Importação de pedidos por XLSX** (Filial): baixa um modelo, recebe o arquivo
  no chat e cria os pedidos em lote (com relatório de linhas com erro).
- Ações do motoboy também por texto: `pegar 5` / `soltar 5` / `finalizar 5`.
- Códigos: teste=1234 (4 perfis) · Admin=2000 · Filial=1010 · Motoboy=3000 · SuperAdmin=9000.

## ✅ Ferramentas avançadas (implementadas)
**Operação:** gerenciar pedido (reatribuir / cancelar / marcar URGENTE) · busca por
cliente/telefone/código · urgência aparece 🔴 e sobe na fila.
**Comunicação:** avisos/broadcast (Admin→motoboys+filiais; Super Admin→todos) ·
resumo no topo dos menus (pendentes · em rota · vencidos) · notificação automática
ao cliente (saiu para entrega / entregue).
**Financeiro:** fechamento de pagamento por motoboy (total a pagar + marcar pago) ·
taxa da plataforma (% por Admin, definida pelo Super Admin) → receita no relatório global.
**Automação/qualidade:** atribuição automática (balanceada por carga) **ligável por
motoboy** pelo Admin · status do motoboy (disponível/ocupado/offline; só disponível
recebe auto-atribuição).

## ✅ UX de texto afiada (Plano B — botões não são viáveis nessa stack)
> Botões/listas da Evolution 2.3.7 não funcionam (WhatsApp/Baileys não renderiza
> botões; endpoint de lista quebra com `isZero`). Logo, otimizamos o texto:
- **Endereço → link do Google Maps** na mensagem do pedido (motoboy toca e navega).
- **Finalizar em 1 toque:** `finalizar 5` = entregue; `finalizar 5 retorno` / `nao` / `<obs>`
  para outros resultados. A citação mantém o fluxo de motivo interativo.
- **Itens numa mensagem só** (vírgula/`;`/linha) na criação e na edição.
- **Editar campo no resumo** (cliente/telefone/endereço/itens/obs) sem refazer o pedido.
- **Memória de cliente:** ao digitar o telefone, oferece reusar o endereço da última entrega.
- **Atalhos do motoboy:** `ocupado` · `disponivel` · `offline` · `ganhei` (ganhos do dia).

## Diferido para a próxima fase
- Comprovante por **foto** e **localização** na finalização (precisa de mídia recebida — testar ao vivo).
- Permissões granulares por Admin (Super Admin liga/desliga cada função do Admin).
- Edição de cadastro de motoboy (nome/senha) e vínculo motoboy↔filial específica.
- "Média de entregas/mês" hoje é proxy = finalizadas nos últimos 30 dias.

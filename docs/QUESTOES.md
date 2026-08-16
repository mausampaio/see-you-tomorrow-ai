# Questões abertas

Canal do agente dev (e do revisor) para o PO. Quando a spec não responde, **escreva aqui e
pare a tarefa** — não decida sozinho.

Formato: uma questão por bloco, numerada, com contexto suficiente para o PO responder sem
reabrir o código.

```
## Q-00X — <título curto>
**Tarefa:** S1-T3
**Bloqueia:** sim | não
**Contexto:** o que você estava fazendo e o que encontrou.
**Opções que enxergo:** A) ... B) ...
**Resposta:** (preenchida pelo PO)
```

Questão respondida que muda comportamento vira decisão nova em `docs/DECISOES.md`.

---

## Q-001 — Comportamento real do `--resume` headless sobre sessão viva
**Tarefa:** S0-T3
**Bloqueia:** sim (para o Sprint 2)
**Contexto:** a arquitetura assume que `claude -p --resume <id> --fork-session` funciona mesmo
com a sessão original em execução, e que o transcript original não é alterado. Isso ainda não
foi verificado empiricamente. É o risco número um do projeto.
**Opções que enxergo:** A) funciona como assumido, seguimos com D-001 literal. B) não funciona
com sessão viva, e a geração passa a montar o contexto a partir do transcript lido, chamando
`claude -p` numa sessão nova.
**Resposta:** **Opção A — FECHADA em 2026-08-16.** Ver `docs/spikes/A-resume-headless.md`.
Funciona com a sessão viva, o transcript original é preservado, o fork enxerga a conversa
inteira, ~5,5 s por sessão. D-001 permanece como está. O spike levantou três consequências
novas: custo por captura, forks acumulando em disco e risco de laço de realimentação — todas
tratadas em D-011, D-012 e nas tarefas dos Sprints 1 e 2.

---

## Q-002 — Uma sessão do `agente-interno` chega a ser descoberta?
**Tarefa:** S1-T3
**Bloqueia:** não a v1; **sim** o cenário do agente autônomo
**Contexto:** D-013 resolve o handoff de sessão sem transcript lendo git e worktree. Mas isso
pressupõe que o `seeya` **enxergue** a sessão. A descoberta depende de o Claude Code registrar
o processo em `~/.claude/sessions/<pid>.json`.

Sessões interativas registram — verificado nesta máquina. Sessões headless (`-p`) podem não
registrar: os spikes A e C não deixaram entrada no registro, mas foram curtos demais para
concluir. O campo `kind: "interactive"` sugere que existem outros valores.

Se o `agente-interno` roda `claude -p`, é possível que **não haja registro nem transcript** — o
`seeya` ficaria completamente cego para ele. Nesse caso a descoberta teria de ser
**por worktree**, e não por sessão: varrer repositórios conhecidos e tratar cada worktree novo
como unidade de trabalho, independente de haver processo Claude associado.

**Dados necessários (a coletar na segunda máquina, com o `agente-interno` rodando):**
```
claude agents --json --all
ls ~/.claude/sessions/           # há entrada nova? qual o "kind"?
ls ~/.claude/projects/*/         # apareceu .jsonl?
git worktree list --porcelain    # no repositório do projeto
```

**Opções que enxergo:**
A) O agente-interno registra → D-013 basta, nada muda.
B) Não registra, mas cria worktree → precisamos de **descoberta por worktree** como segunda
   origem do `ProvedorDeSessoes`. É trabalho novo, provavelmente um sprint.
C) Não registra e não dá pista nenhuma → esse cenário só é resolvido pelo wrapper (D-014),
   e vira mais um argumento para priorizar a v2.

**Resposta:** **Respondida em parte — opção B, em 2026-08-16.** Ver
`docs/spikes/D-sessao-filha-e-descoberta-de-headless.md`. Sessão headless deixa transcript mas
**não** se registra em `~/.claude/sessions/`. Descoberta só por registro é cega para agentes de
execução. Resolvido por D-016 (registro + varredura de transcripts). Falta saber por que as
sessões do `agente-interno` não deixam transcript → Q-003.

---

## Q-003 — Por que as sessões do `agente-interno` não deixam transcript?
**Tarefa:** nenhuma; investigação do PO
**Bloqueia:** não. D-013 e D-016 cobrem o caso independentemente da causa.
**Contexto:** a hipótese de que "sessão filha desabilita o transcript" foi testada e
**falsificada** (Spike D): com e sem `CLAUDE_CODE_CHILD_SESSION=1`, o transcript foi criado nos
dois casos. A causa real segue desconhecida. Importa porque, se for corrigível, o caso do
trabalho deixa de precisar do fallback degradado.

**Hipóteses ainda de pé, em ordem de probabilidade:**
1. O script do `agente-interno:ui` passa `--no-session-persistence` explicitamente.
2. O `agente-interno` usa o Agent SDK em vez do CLI, e o SDK não persiste por padrão.
3. Um `settings.json` do repositório ou da organização desliga a persistência.
4. O comportamento difere por SO ou por versão do Claude Code.

**Dados necessários (segunda máquina, com o agente-interno rodando):**
```
# 1. o script existe e o que ele invoca
#    localizar o script que o agente-interno:ui chama e ler a linha do claude
# 2. o processo real e seus argumentos
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId,CommandLine
# 3. transcript apareceu para aquela sessao?
Get-ChildItem ~/.claude/projects -Recurse -Filter *.jsonl |
  Where-Object LastWriteTime -gt (Get-Date).AddMinutes(-10)
# 4. settings em vigor
Get-Content ~/.claude/settings.json; Get-Content .claude/settings.json
```

**Resposta:** aguardando coleta.

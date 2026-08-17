# Questões abertas

Canal do agente dev (e do revisor) para o PO. Quando a spec não responde, **escreva aqui e
pare a tarefa** — não decida sozinho.

Formato: uma questão por bloco, numerada, com contexto suficiente para o PO responder sem
reabrir o código.

> **Sobre o `agente-interno`.** Várias questões citam um agente de execução autônomo chamado
> aqui de `agente-interno`. Ele é **real** — uma ferramenta interna do outro ambiente do
> autor — e o nome verdadeiro foi trocado por este placeholder de propósito, junto com
> identificadores e caminhos. O comportamento técnico descrito é fiel ao observado; só a origem
> foi omitida. Ao ler, trate como caso real anonimizado, não como cenário hipotético — é a
> diferença entre uma decisão fundamentada e uma especulação.

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

**Resposta:** **FECHADA em 2026-08-17 — opção A para o agente-interno.** O usuário trouxe o comando
exato:

```
claude --dangerously-skip-permissions "/agente-interno:dev [--item X]"
```

**Não tem `-p`.** É uma sessão **interativa** que começa processando um prompt, não headless. E
sessão interativa se registra em `~/.claude/sessions/<pid>.json` — verificado nesta máquina.

Cadeia de evidência: a mensagem `Transcript saving is off` é um banner da TUI (componente
React/Ink no binário 2.1.233, ver Spike D). Só o caminho interativo o renderiza. Se o banner
aparece, a sessão é interativa; se é interativa, está no registro.

**Consequência boa:** o cenário C — "não registra e não dá pista nenhuma" — está descartado, e
com ele a possibilidade de precisarmos de **descoberta por worktree**, que era o risco de um
sprint inteiro. A descoberta por registro (S1-T3) encontra as sessões do agente-interno.

**O que continua valendo:** elas não deixam transcript (marcador de sessão filha herdado,
D-013), então o handoff delas usa git e worktree como fonte, e D-018 informa a correção. A
descoberta por varredura de transcripts (D-016, S1-T8) **não** perde razão de existir: ela cobre
qualquer `claude -p` de verdade, que é o que o Spike D mostrou não se registrar.

**Nota lateral que importa para D-002:** o `--dangerously-skip-permissions` indica sessão
autônoma trabalhando sem confirmação humana. Encerrar processo dessas é mais arriscado que o
normal — o default de D-002 (só capturar e avisar) é o certo aqui, e marcar `podeEncerrar: true`
num projeto que roda agente-interno merece pensar duas vezes.

**REABERTA em 2026-08-17 — a inferência acima estava ERRADA.** O usuário rodou
`claude agents --json --all` na segunda máquina: a **única** sessão do agente-interno listada é a
**pai**, a que subiu a UI (`kind: "background"`, `state: "blocked"`,
`cwd: …/.claude/agente-interno/ui`). As sessões **filhas**, as que rodam `/agente-interno:dev`, **não
aparecem**.

Ou seja: ser interativa não garantiu registro visível, e minha cadeia de raciocínio tinha um furo.
O cenário de sessão invisível voltou.

**O que a saída real já ensinou, independente da questão:** existe uma segunda forma de entrada,
a de background, sem `pid` e com `state` em vez de `status`. Ela quebra o schema atual e derrubaria
a lista inteira → D-022 e S1-T0c.

**A medição que decide, e ela é de um comando.** Falta distinguir dois mundos muito diferentes:

| Se… | Então |
|---|---|
| a filha ESTÁ em `~/.claude/sessions/` mas `claude agents --json` a filtra | o `seeya` lê o **diretório direto**, não o CLI. D-016 funciona e nada muda de arquitetura. |
| a filha NÃO está no diretório | cenário C: descoberta por registro é cega para ela. Aí sobra descoberta por **worktree**, que é trabalho novo e provavelmente um sprint. |

**Descartado em 2026-08-17: não é janela de tempo.** O Spike E mostrou que o registro é efêmero
(a entrada é apagada na saída graciosa), e a primeira hipótese foi que as filhas já teriam
terminado. **O usuário confirmou que havia sessões ativas** quando rodou o comando. A ephemeralidade
é real mas não explica a ausência.

**A medição de três fontes, que é o que decide.** O SO é a verdade; registro e CLI são o que o
Claude Code escolhe expor. Rodar no Linux, com uma filha do agente-interno trabalhando:

```bash
ps -ef | grep -i '[c]laude'                                  # 1. o que existe de verdade
ls -la ~/.claude/sessions/ && cat ~/.claude/sessions/*.json  # 2. o que está no registro
claude agents --json --all                                   # 3. o que o CLI mostra
ls -l /proc/<PID>/cwd && tr '\0' ' ' < /proc/<PID>/cmdline    # 4. para um pid só em 1
```

| Filha aparece em… | Conclusão |
|---|---|
| 1, 2 e 3 | era outra coisa; a questão fecha |
| 1 e 2, não em 3 | o CLI **filtra** → o `seeya` lê o diretório direto e ignora `agents --json` |
| só em 1 | o Claude Code **não registra** → sobra enumerar processos; o passo 4 prova que no Linux `cwd` e linha de comando são acessíveis |

O passo 4 vale por si: no Windows medi que o `cwd` de outro processo **não** é acessível sem
código nativo. Se no Linux for, a terceira estratégia fica viável exatamente na plataforma onde o
problema existe.

**O vão entre as duas estratégias, que só ficou claro agora.** D-016 tem registro e varredura de
transcript, e elas foram desenhadas para se complementar: registro pega interativa, varredura
pega headless. As filhas do agente-interno caem **no vão**: não têm transcript para varrer, e
aparentemente não têm entrada visível no registro. A redundância do D-016 não ajuda aqui.

**Terceira estratégia possível, se a medição der no pior caso: enumerar processos do SO.** O
sistema operacional sabe que existe um `claude` rodando, independente de o Claude Code o ter
registrado. Medido nesta máquina, a capacidade é assimétrica:

| | pid | linha de comando | cwd |
|---|---|---|---|
| Linux | sim | sim | sim — `/proc/<pid>/cwd` |
| macOS | sim | sim | sim, via `lsof -p <pid> -a -d cwd` |
| **Windows** | sim | sim | **não** — `Win32_Process` não expõe; exigiria ler o PEB via `NtQueryInformationProcess`, código nativo |

A assimetria é aceitável porque o cenário existe no Linux, que é onde a capacidade é
completa. No Windows as sessões se registram normalmente e a estratégia não é necessária.

Bônus: a própria linha de comando carrega informação útil para o handoff —
`claude --dangerously-skip-permissions "/agente-interno:dev --item X"` já diz o que a sessão está
fazendo e em qual item, mesmo sem transcript.

Complicação para a deduplicação do D-016: essa origem **não** fornece `sessionId`. A dedução
teria de ser por `pid`, que as duas origens têm para sessão viva.

**Ordem de decisão, para não construir o que não precisa:**
1. medir se a filha está em `~/.claude/sessions/`
2. se estiver → ler o diretório direto, nada de novo
3. se não estiver → enumerar processos é mais barato que varrer worktrees, porque não exige saber
   quais repositórios olhar

**Resposta:** aguardando a comparação entre o diretório e a saída do `agents --json`.

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

**Resposta:** **FECHADA em 2026-08-16 — a hipótese original estava certa.** O usuário trouxe a
mensagem exibida pela sessão da UI:

> Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker
> · restart with `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` to keep future transcripts

O Spike D não reproduziu porque rodou o CLI 2.1.201, que **não tem o mecanismo**; a sessão da UI
roda 2.1.233, que tem. Inspeção dos dois binários confirma (`nested_marker`,
`tengu_persistence_suppressed` e `transcript-writer-degraded` só existem na 2.1.233).

Descobriu-se um terceiro estado degradado não previsto: **transcript incompleto** por falha de
escrita, indetectável de fora. Gerou D-017 e D-018, e esse cenário tem correção imediata
sem depender do `seeya`: definir `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` no ambiente do script
do `agente-interno:ui`.

# Questões abertas

Canal do agente dev (e do revisor) para o PO. Quando a spec não responde, **escreva aqui e
pare a tarefa** — não decida sozinho.

Formato: uma questão por bloco, numerada, com contexto suficiente para o PO responder sem
reabrir o código.

> **Sobre o `agente-interno`.** Várias questões citam um agente de execução autônomo,
> referido como `agente-interno`: um processo que roda o Claude Code sem supervisão, escreve o
> resultado num rastreador de issues e deixa o trabalho num worktree. É uma **classe de sessão
> que o app precisa tratar**, e o comportamento descrito vem de observação, não de suposição —
> os números e as saídas brutas estão nos spikes.

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

**Resposta:** **FECHADA em 2026-08-17 — cenário 3 confirmado, e a solução é mais barata do que eu
estimava.** A medição de três fontes foi feita. O que ela mostrou:

O SO lista as sessões autônomas vivas, cada uma filha de um script:
```
bash -c /<caminho>/.<agente>-run.sh; ...
  └─ /bin/bash /<caminho>/.<agente>-run.sh
       └─ claude --dangerously-skip-permissions /<comando>:triage --item <N>
```

Cruzando os PIDs dessas sessões com o diretório `~/.claude/sessions/`:

| PID | `<pid>.json` | `<pid>.<hash>.key` |
|---|---|---|
| interativas comuns | **sim** | às vezes |
| **as duas autônomas ativas** | **não** | **sim** |

**Elas não são invisíveis — registram-se de outra forma.** Só o `.key`, sem o `.json`. Eu havia
visto esses dois `.key` sem par e os descartei como "resíduo órfão de limpeza incompleta". Estava
errado: eram exatamente as sessões vivas, PID a PID.

Isso descarta a necessidade de descoberta por worktree, que eu tinha estimado em um sprint. A
solução é D-023: `.key` sem `.json` dá o PID por listagem de diretório; a enumeração de processos
confirma que está vivo e entrega `cwd` e linha de comando. E a linha de comando traz o item de
trabalho, que é handoff de verdade para uma sessão sem transcript.

**Uma divergência que fica registrada e não resolvida:** no Spike E, a mesma topologia no Windows
— script chamando `claude` com prompt e sem `-p` — **criou** `<pid>.json`. No Linux, não cria.
Pode ser diferença de plataforma, de versão, ou de como o prompt é passado. Não bloqueia nada:
D-023 usa o SO como fonte de verdade justamente por não depender de qual arquivo o Claude Code
decidiu escrever. Fica anotado para quem implementar S1-T3 não se surpreender.

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

---

## Q-004 — Quatro pontos não-bloqueantes encontrados implementando S1-T1
**Tarefa:** S1-T1
**Bloqueia:** não — nenhum dos quatro impediu a implementação; registrados para visibilidade do
review, conforme "perguntar custa uma mensagem".
**Contexto:** implementando `nucleo/tipos.ts`, `nucleo/classificacao.ts` e
`nucleo/elegibilidade.ts`, encontrei quatro pontos onde os documentos divergem entre si ou onde a
spec não decide sozinha o suficiente para codificar sem uma escolha explícita. Em nenhum dos
quatro a implementação exigiu inventar comportamento novo não ancorado em texto — são escolhas de
representação/grafia, ou um recorte de escopo já anunciado. Registro aqui para o review confirmar
ou corrigir.

**1) `docs/TESTES.md` diz "quatro condições" de elegibilidade; `docs/ESPECIFICACAO.md` lista
cinco.** A seção "Elegibilidade" de ESPECIFICACAO tem cinco marcadores em "e": fonte de evidência,
atividade recente, não é fork, `cwd` não ignorado, anti-duplicidade. TESTES.md § "Unidade" diz
"cada uma das quatro condições da spec isolada". Implementei as cinco (`avaliarElegibilidade` em
`nucleo/elegibilidade.ts`), porque ESPECIFICACAO tem autoridade maior que TESTES.md na ordem do
CLAUDE.md, e testei as cinco isoladamente. TESTES.md parece só não ter sido atualizado quando a
quinta condição (anti-duplicidade) entrou na spec.
**Opções:** A) TESTES.md está desatualizado, sem consequência — só corrigir "quatro" para "cinco"
num review de doc. B) alguma das cinco não deveria ser uma condição independente (ex.: deveria
estar fundida com outra) e o "quatro" é intencional — nesse caso `avaliarElegibilidade` precisa
mudar.
**Resposta:** **FECHADA — opção A.** `docs/TESTES.md` corrigido para "cinco condições".

**2) `SessaoDescoberta` ainda não cobre a sessão de D-023 (`pid` sem `sessionId`).** D-024 pede
uma união discriminada por PID — duas formas. Implementei exatamente essas duas
(`SessaoComPid`/`SessaoSemPid`, ambas com `sessionId` obrigatório). Mas D-023 (S1-T10, ainda não
implementada) descreve uma **terceira** origem: PID confirmado pelo SO, sem `sessionId` nenhum —
o inverso do que `SessaoSemPid` cobre hoje (`sessionId` presente, sem `pid`). Deixei isso fora de
propósito, para não adiantar escopo de uma tarefa que ainda nem começou, e documentei a lacuna em
comentário no tipo. Quando S1-T10 chegar, `SessaoDescoberta` provavelmente precisa de uma terceira
forma (ou `sessionId` vira nullable em `SessaoComPid`) — decisão de quem implementar aquela
tarefa, não modificação retroativa desta.
**Opções:** A) confirma o adiamento — o tipo muda em S1-T10. B) o tipo já deveria nascer pronto
para as três origens, e a tarefa deveria ter sido escopada maior.
**Resposta:** **FECHADA — opção A.** `docs/PLANO-DE-ENTREGA.md` S1-T10 ganhou o aviso explícito de
que a união de tipos vai precisar crescer para a forma com `pid` e sem `sessionId` — esperado, não
retrabalho.

**3) `EstadoDaSessao` ganha um quarto valor (`desconhecida`) que não existe no enum do handoff em
ESPECIFICACAO.** D-016 diz literalmente que uma sessão vista só pela varredura de transcript
"entra com `pid: null` e estado desconhecido". Mas o formato do handoff em ESPECIFICACAO §
"Formato do handoff" declara `"estadoDaSessao": "viva" | "ociosa" | "encerrada"` — só três
valores, sem `"desconhecida"`. Implementei os quatro em `nucleo/tipos.ts#EstadoDaSessao`, porque
a tarefa pede literalmente os quatro e D-016 tem autoridade maior que o JSON de exemplo do handoff
(que, aliás, é escopo de S2-T3/S2-T4, não desta tarefa). Mas o handoff formal em algum momento vai
precisar decidir se `estadoDaSessao` aceita o quarto valor ou se sessões `SessaoSemPid`
simplesmente não geram esse campo da mesma forma.
**Opções:** A) ESPECIFICACAO está incompleta nesse enum — ganha o quarto valor quando o handoff
for implementado (S2-T3/S2-T4). B) sessão sem PID nunca chega a ter `estadoDaSessao` no handoff —
o campo é específico de sessão com PID, e o handoff resolve isso de outro jeito.
**Resposta:** **FECHADA — opção A.** `docs/ESPECIFICACAO.md` § "Formato do handoff" corrigido:
`"estadoDaSessao": "viva" | "ociosa" | "encerrada" | "desconhecida"`.

**4) Sessão viva sem nenhuma escrita de transcript conhecida: classifiquei como `ociosa`, não
`viva`.** O glossário define "sessão ociosa" como "sessão viva sem escrita no transcript há mais
de `minutosParaOcioso`". Quando `ultimaEscritaNoTranscript` é `null` (sem transcript — D-013, ou
transcript nunca escreveu), não há um "há quanto tempo" para medir. Escolhi tratar isso como
`ociosa`: a leitura mais literal é que "sem escrita há mais de X minutos" vale trivialmente quando
não há escrita nenhuma. A alternativa — tratar como `viva` por falta de evidência em contrário —
também é defensável e eu não encontrei texto que decida entre as duas. Como isso não afeta
elegibilidade (que não depende do estado, só de `ultimaAtividade`), o risco é só cosmético
(`seeya sessions` mostraria "ociosa" em vez de "viva" para uma sessão sem transcript), mas quero
confirmação antes de S1-T6 depender disso na exibição.
**Opções:** A) confirma `ociosa` como o default correto. B) `viva` é o default certo quando não há
transcript para julgar.
**Resposta:** **FECHADA — opção B, e a escolha original (A) estava errada, não só arriscada.**
Ver `docs/DECISOES.md` D-025: `viva` é o estado padrão de processo vivo, e `ociosa` só se aplica
com evidência positiva de silêncio (timestamp real além do limite) — nunca por ausência de
transcript. `null` é ausência de dado, não uma afirmação sobre inatividade; converter uma na
outra é o erro que D-025 nomeia. Importa mais do que "cosmético": é precisamente o caso do agente
de execução autônomo (D-013), a sessão com maior chance de estar trabalhando invisível.
`classificarEstado` corrigido; ver também D-026, que generaliza o mesmo princípio para a
anti-duplicidade da elegibilidade.

---

## Q-005 — Nomes que faltam no glossário, encontrados fazendo S1-T0g
**Tarefa:** S1-T0g
**Bloqueia:** não — nenhum dos três impediu a tarefa; deixados como estão, registrados para
visibilidade do review, conforme "perguntar custa uma mensagem" e "se faltar algum nome, pare e
pergunte, não invente".
**Contexto:** traduzindo os identificadores de `docs/ARQUITETURA.md`, `docs/PLANO-DE-ENTREGA.md`,
`docs/TESTES.md` e `docs/FORA-DE-ESCOPO.md` pelo glossário de `AGENTS.md` § Idioma, encontrei três
pontos onde o glossário não decide sozinho.

**1) O bloco de Portas de `docs/ARQUITETURA.md` (§ "Portas") só foi traduzido parcialmente.**
Das sete interfaces do esboço, três já existem de verdade em `src/core/ports.ts`
(`ProvedorDeSessoes`, `ControleDeProcesso`, `Relogio`) — traduzi essas três, nome de interface e
de método, copiando exatamente o código real (`SessionProvider.list()`, `ProcessControl.isAlive`/
`terminateGracefully`, `Clock.now()`). As outras quatro (`LeitorDeTranscricao`, `GeradorDeHandoff`,
`Notificador`, `Armazenamento`) ainda não existem em código — o próprio `ports.ts` explica que
declará-las agora seria inventar cedo demais. O glossário (tabela 2 de `AGENTS.md`) já fixa o nome
em inglês dos **tipos** (`TranscriptReader`, `SessionFacts`, `HandoffGenerator`,
`GeneratedUnderstanding`, `Notifier`/`Notice`, `Storage`, `DayState`), mas não dos **métodos**
(`lerFatos`, `gerar`, `notificar`, `salvarHandoff`, `lerBriefing`, `lerConfig`, `salvarEstado`) nem
de parâmetros como `Dia`. Traduzir só os tipos e deixar os métodos em português ficaria pior que
deixar a interface inteira como está — por isso as quatro interfaces não-implementadas ficaram
100% como estavam. Também não toquei `estaDisponivel()` e `suportaAcoes()` em
`notification/`, pelo mesmo motivo: método de porta que ainda não existe em código.
**Opções:** A) fica como está — quando cada porta for implementada (S1-T4, S2-T2, S4-T1, S1-T5),
quem implementar decide o nome do método e atualiza o esboço junto. B) o PO fixa agora os nomes de
método no glossário, e eu volto para completar a tradução do bloco.
**Resposta:** (a preencher pelo PO)

**2) `capturaProfunda` (flag de `politicaPorProjeto`) não está em nenhuma tabela do glossário.**
Aparece em `docs/DECISOES.md` D-011 linha 155, ainda em português — e como não posso alterar
`DECISOES.md`, e o termo não está fixado em `AGENTS.md`, mantive `capturaProfunda: true` como
estava em `docs/TESTES.md` (linha do teste "sessão suprimida não tenta captura profunda"), para não
inventar um nome que divergiria do que `DECISOES.md` já tem escrito.
**Opções:** A) fica em português até virar campo real de código (S1-T5/S2-T2), quando quem
implementar decide o nome. B) o PO fixa `capturaProfunda` → `?` no glossário agora.
**Resposta:** (a preencher pelo PO)

**3) `seeya ontem` (comando ainda não decidido, listado em "Ideias boas guardadas para depois") e
`capturarSessao` (nome de caso de uso em `docs/ARQUITETURA.md` linha 17) não estão literalmente na
lista de comandos/casos de uso do glossário.** Traduzi os dois por composição direta de peças já
fixadas — `capturarSessao` → `captureSession` (verbo "capturar" → `capture`, já em tabela 1,
compondo com "Sessão" no mesmo padrão de `endDay`/`startDay`); `seeya ontem` → `seeya yesterday`
(tradução literal de uma palavra comum, não um termo de domínio). Risco baixo, mas registrando
porque nenhum dos dois estava literal no glossário.
**Opções:** A) as duas traduções ficam confirmadas — acrescentar ao glossário para não haver
deriva. B) alguma das duas está errada.
**Resposta:** (a preencher pelo PO)

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
**Resposta:** **FECHADA em 2026-08-18 — opção B, e a opção A estava errada, não só arriscada.**
O ponto de "não inventar" não se aplicava aqui: esses métodos já tinham sido inventados, em
português, quando o documento foi escrito — traduzir uma invenção existente não é inventar de
novo, é aplicar a mesma invenção no idioma que já estava decidido (D-028). Um bloco de código em
dois idiomas ao mesmo tempo é pior que qualquer um dos dois extremos, e `LeitorDeTranscricao`
sobrevivendo ao lado de `TranscriptReader` (o nome que o próprio glossário já reservava) era
exatamente a deriva que o glossário existe para impedir — só que dentro do repositório. As quatro
interfaces foram traduzidas por inteiro, tipo e método, e os nomes de método entraram na tabela 2
de `AGENTS.md` § Idioma:

| pt | en |
|---|---|
| `LeitorDeTranscricao.lerFatos(sessao)` | `TranscriptReader.readFacts(session)` |
| `GeradorDeHandoff.gerar(fatos)` | `HandoffGenerator.generate(facts)` |
| `Notificador.notificar(aviso)` | `Notifier.notify(notice)` |
| `Armazenamento.salvarHandoff(dia, handoff)` | `Storage.saveHandoff(day, handoff)` |
| `Armazenamento.lerBriefing(dia)` | `Storage.readBriefing(day)` |
| `Armazenamento.lerConfig()` | `Storage.readConfig()` |
| `Armazenamento.salvarEstado(estado)` | `Storage.saveState(state)` |
| `Dia` | `Day` |
| `estaDisponivel()` | `isAvailable()` |
| `suportaAcoes()` | `supportsActions()` |

Ver `docs/ARQUITETURA.md` § "Portas" — o bloco inteiro está em inglês agora.

**2) `capturaProfunda` (flag de `politicaPorProjeto`) não está em nenhuma tabela do glossário.**
Aparece em `docs/DECISOES.md` D-011 linha 155, ainda em português — e como não posso alterar
`DECISOES.md`, e o termo não está fixado em `AGENTS.md`, mantive `capturaProfunda: true` como
estava em `docs/TESTES.md` (linha do teste "sessão suprimida não tenta captura profunda"), para não
inventar um nome que divergiria do que `DECISOES.md` já tem escrito.
**Opções:** A) fica em português até virar campo real de código (S1-T5/S2-T2), quando quem
implementar decide o nome. B) o PO fixa `capturaProfunda` → `?` no glossário agora.
**Resposta:** **FECHADA em 2026-08-18 — opção B.** `capturaProfunda` é flag de `projectPolicy`,
ou seja, é identificador que vai para disco — pertence à tabela 3 (identificadores persistidos),
que o PO tinha esquecido dela ao escrever o glossário original em S1-T0g. `capturaProfunda` →
`deepCapture`, acrescentado à tabela 3 de `AGENTS.md` § Idioma e aplicado em `docs/TESTES.md`.
`docs/DECISOES.md` D-011 continua com `capturaProfunda` em português — é arquivo do PO, corrigido
por ele depois de integrar este branch, fora do escopo desta tarefa.

**3) `seeya ontem` (comando ainda não decidido, listado em "Ideias boas guardadas para depois") e
`capturarSessao` (nome de caso de uso em `docs/ARQUITETURA.md` linha 17) não estão literalmente na
lista de comandos/casos de uso do glossário.** Traduzi os dois por composição direta de peças já
fixadas — `capturarSessao` → `captureSession` (verbo "capturar" → `capture`, já em tabela 1,
compondo com "Sessão" no mesmo padrão de `endDay`/`startDay`); `seeya ontem` → `seeya yesterday`
(tradução literal de uma palavra comum, não um termo de domínio). Risco baixo, mas registrando
porque nenhum dos dois estava literal no glossário.
**Opções:** A) as duas traduções ficam confirmadas — acrescentar ao glossário para não haver
deriva. B) alguma das duas está errada.
**Resposta:** **FECHADA em 2026-08-18 — opção A, as duas confirmadas.** `capturarSessao` →
`captureSession` estava certo porque a *regra* (verbo "capturar" → `capture`, compondo no mesmo
padrão de `endDay`/`startDay`) já estava no glossário, mesmo a linha não estando literal — é essa
regra que o PO tinha em mente ao afirmar "todos estão no glossário" em S1-T0g. `seeya ontem` →
`seeya yesterday` estava certo por ser tradução literal de palavra comum, não termo de domínio.
`captureSession` acrescentado à tabela 1 de `AGENTS.md` § Idioma, junto de `endDay`/`startDay`.

---

## Q-006 — O schema rejeita todo `procStart` de macOS
**Tarefa:** encontrada no S1-T2, mas o defeito está em código de S1-T3 já integrado.
**Bloqueia:** não hoje — o projeto só roda em Windows nesta máquina. Bloqueia o primeiro uso real
em macOS, e bloqueia qualquer teste de descoberta em macOS antes disso.
**Contexto:** `src/adapters/discovery/schemas.ts` declara
`procStart: z.string().regex(/^\d+$/, 'procStart must be a digits-only string')`. O comentário
acima explica bem por que o campo é `string` e não `number` (os valores reais passam de
`Number.MAX_SAFE_INTEGER`), e isso continua certo. O problema é o `regex`.

O Spike F rastreou como o Claude Code produz esse valor em cada plataforma, lendo os três builds
da mesma versão. No macOS ele vem de `ps -o lstart=`, ou seja, uma **data legível** como
`Mon Aug 17 14:23:01 2026` — não dígitos. O `regex` reprova, e por D-022 a validação é por item,
então o efeito não é um crash: **a sessão simplesmente some da lista**, em silêncio, no SO inteiro.

Isso é exatamente o modo de falha que D-021 e D-025 existem para impedir — dado que não bate com o
esperado virando invisibilidade em vez de aviso. E o pior detalhe: só apareceria quando alguém
rodasse em macOS, provavelmente concluindo que o app "não acha sessão nenhuma".

**Opções:** A) o `regex` vira uma validação por plataforma — dígitos em Windows e Linux, formato
de data no macOS. B) o campo perde o `regex` e vira `z.string().min(1)`, deixando a interpretação
para quem compara (o adapter de processo), que é quem sabe a forma do seu próprio SO. C) o campo
aceita os dois formatos numa união, sem saber de plataforma.
**Resposta:** **FECHADA — opção B.** `procStart` vira `z.string().min(1)`, e quem compara
decide a forma.

O motivo não é preferência de estilo: **este schema não tem como saber em que SO o registro foi
escrito.** Ele valida a forma de um arquivo externo; a plataforma é conhecimento do adapter de
processo, que observa o valor atual na máquina onde está rodando. Codificar aqui um formato
específico de plataforma faz o schema reprovar registro legítimo de um SO em que ninguém pensou na
hora de escrever a linha — e por D-022 a validação é por item, então o efeito é a sessão sumir da
lista **em silêncio**, no SO inteiro. É o modo de falha que D-021 e D-025 existem para impedir.

A opção A (validação por plataforma) espalha o mesmo conhecimento por dois lugares que teriam de
concordar para sempre. A opção C (união dos dois formatos) fixa no schema a suposição de que só
existem dois, que é justamente a suposição que produziu este defeito.

Isso encaixa com o que S1-T2 já construiu: um `procStart` que o adapter não sabe comparar vira
`unavailable`, e por D-025 `unavailable` **nunca** vira `false`. Ou seja, valor inesperado degrada
para "não sei desempatar", que é seguro — em vez de "sessão não existe", que não é.

Comentário do campo deve dizer por que não há `regex`, senão alguém "conserta" isso de volta.

---

## Q-007 — Não existe encerramento gracioso no Windows sem dependência nova; `canTerminate` fica sem efeito lá em v1
**Tarefa:** S1-T2
**Bloqueia:** não a entrega desta tarefa (o comportamento abaixo é consequência direta de D-002 já
aplicado ao que foi medido) — **bloqueia**, na prática, o recurso `canTerminate: true` (D-002) para
qualquer sessão Windows, hoje e enquanto isto não mudar.
**Contexto:** a tarefa pedia investigar, com medição, o que existe de fato no Windows para pedir
encerramento gracioso a um processo de console — e parar para avisar se a conclusão fosse "não
existe". A conclusão foi essa. Testado nesta máquina, contra um processo Node real (console comum,
com e sem console próprio/grupo de processo), com um handler de `SIGTERM` instalado que grava um
arquivo antes de sair (prova de que o handler rodou até o fim, não só que o processo morreu):

| Caminho tentado | Resultado medido |
|---|---|
| `process.kill(pid, 'SIGTERM')` (PID externo, sem `ChildProcess`) | `TerminateProcess` na hora — handler nunca roda, arquivo nunca é gravado. É exatamente a armadilha 1 da tarefa, reproduzida. |
| `process.kill(pid, 'SIGBREAK')` (PID externo) | lança `ENOSYS` — o `uv_kill` do libuv não suporta esse sinal para um PID arbitrário. |
| `child.kill('SIGBREAK')` (via handle do `ChildProcess`, processo criado com `detached: true`) | também mata na hora, sem rodar o handler — e de qualquer forma não se aplica ao caso real: as sessões que este port termina nunca foram criadas pelo `seeya`, foram descobertas já em execução. |
| `taskkill /PID <pid>` sem `/F` | o próprio Windows recusa: *"A finalização deste processo só pode ser forçada (com a opção /F)"*. Reproduzido duas vezes (processo com console próprio e processo compartilhando console com o pai) — mesma recusa, mesmo texto. |
| `Stop-Process -Id <pid>` sem `-Force` (PowerShell) | mesmo comportamento de `TerminateProcess` por baixo — sem atraso, sem handler. |
| `GenerateConsoleCtrlEvent` via P/Invoke (mesma técnica já usada em `notification/` para o toast, sem dependência nova) | **não dá para mirar um único processo arbitrário**: o parâmetro é um *grupo* de processos — `0` manda para todo mundo anexado ao console (atingiria o shell do usuário inteiro), e um grupo específico só existe se o processo alvo tiver sido criado com `CREATE_NEW_PROCESS_GROUP`, decisão de quem abriu o Claude Code (o shell do usuário), não do `seeya`. |

Não há caminho gracioso confiável para um PID que o `seeya` não criou, sem dependência nativa nova
(FFI ou addon). Isso não é o Node sendo limitado por acidente: é o próprio Windows não ter
sinais POSIX, e as ferramentas que existem para "pedir para fechar" (WM_CLOSE via `taskkill`,
`GenerateConsoleCtrlEvent`) dependerem de janela própria ou de grupo de processo próprio — nenhum
dos dois existe para uma sessão de console comum aberta pelo usuário.

**O que a implementação faz com essa conclusão.** D-002 proíbe kill forçado na v1. Sem caminho
gracioso e com o forçado banido, não sobra nada que `terminateGracefully` tenha permissão de fazer
com uma sessão Windows: `src/adapters/process/termination.ts` não envia sinal nenhum lá, só
relata se o processo já estava morto (`false` quando ainda está vivo — nunca finge sucesso, nunca
força). Em Linux/macOS o `SIGTERM` real é enviado normalmente e é gracioso de verdade (POSIX).

**Pergunta para o PO:** o comportamento acima (retornar sempre `false` no Windows enquanto o
processo estiver vivo) é o default aceitável para a v1, ou o produto deveria impedir
`canTerminate: true` de ser configurado para sessões Windows de forma mais explícita (erro na
config, ou aviso no `seeya config`), em vez de deixar a opção existir sabendo que nunca fará
efeito lá? Não decidi isso sozinho porque é política de produto, não implementação.
**Opções que enxergo:** A) fica como está — `canTerminate: true` é aceito em qualquer plataforma,
e no Windows simplesmente nunca termina nada (o usuário percebe pelo handoff/log, quando existir
logger). B) a config ou o `seeya config` avisam/recusam `canTerminate: true` quando a sessão é
Windows. C) documentar a limitação no README e não mexer em mais nada agora — v2 fica livre para
resolver com dependência nativa (ex.: um pequeno addon nativo ou `bun:ffi` se o projeto migrar de
runtime, o que o próprio Claude Code faz).
> **CORREÇÃO (2026-08-18), posterior à resposta abaixo.** A premissa desta questão — "não existe
> encerramento gracioso no Windows" — **estava errada**, e o erro foi do PO. Existe: um evento de
> console `CTRL_BREAK_EVENT`, entregue por `AttachConsole` + `GenerateConsoleCtrlEvent`, faz o
> Claude Code sair graciosamente. Medido contra sessões reais em **dois hospedeiros** — `cmd.exe` e
> **Git Bash** —, com o mesmo resultado nos dois: ele descarrega estado no caminho da saída, deixa o
> transcript íntegro e limpa o próprio registro de sessão, que são os três sinais de saída graciosa
> segundo o Spike E. O shell interativo do usuário sobrevive em ambos. Sem dependência nova: é a
> mesma técnica de P/Invoke que o adapter de notificação já usa.
>
> Cuidado ao reler essa medição: no Git Bash o pai direto do `claude` é um bash transitório do
> `fork`+`exec` do MSYS, não o shell do usuário. Ele morre junto e isso é inofensivo — mas quem
> olhar só o pai imediato conclui que o terminal do usuário caiu. Foi o que eu concluí antes de
> olhar a árvore inteira.
>
> **A retomada foi verificada pelo mantenedor:** `claude --resume` sobre uma sessão encerrada por
> Ctrl+Break volta normalmente. Era a última pergunta em aberto, e sem ela o resto provaria apenas
> que o processo morre de forma organizada — não que o trabalho ficou preservado, que é o que o
> produto promete.
>
> A ideia foi do mantenedor. O S1-T2 tinha descartado essa via **por raciocínio, não por medição** —
> alegando dano colateral ao shell — e o raciocínio não sobreviveu ao teste. Ver
> `docs/spikes/G-ctrl-break-no-windows.md`.
>
> **O que continua valendo da resposta abaixo:** a exigência de o app **dizer** quando não conseguir
> encerrar. Ela não some — só muda de frequência. Deixa de ser "sempre no Windows" e passa a ser o
> caso em que não há console para anexar (sessão iniciada com `DETACHED_PROCESS`), onde o
> `AttachConsole` falha e a resposta honesta segue sendo "não encerrei".

**Resposta:** **FECHADA — opção A, com a correção que a torna aceitável: o app avisa na hora.**
Decisão do mantenedor.

A config continua aceitando `canTerminate: true` em qualquer plataforma — não vale empurrar
conhecimento de plataforma para a camada de config, que ainda nem existe, para resolver algo que só
se manifesta no momento do encerramento. Mas o comportamento de hoje sozinho (retornar `false` e
seguir) não pode ficar: é exatamente o modo de falha que este projeto combate em todo lugar —
silêncio lido como sucesso. Quem marcou a opção acredita que a sessão vai fechar, e nada acontece.

**O que fica exigido, e onde:** quando `canTerminate: true` estiver ligado e
`terminateGracefully` devolver `false` com o processo ainda vivo, o encerramento do dia **diz
isso explicitamente** — qual sessão não foi encerrada e por quê. Não é erro nem falha da captura: o
handoff foi gravado normalmente, só a terminação não aconteceu. Registrado em S2-T3 (`endDay`) e
S4-T1 (notificação).

A limitação em si é do Windows, não do Node: o SO não tem sinais POSIX, e as vias que existem para
"pedir para fechar" dependem de janela própria ou de grupo de processo próprio — nenhuma das duas
existe para uma sessão de console comum aberta pelo usuário. A v2 fica livre para resolver com
dependência nativa.

**Nota lateral, sem relação com o Windows:** ao implementar isto encontrei
`tsconfig.build.json` (usado por `npm run build`) resolvendo sem `@types/node`, enquanto
`tsconfig.json` (usado pelo `tsc --noEmit` avulso do `verificar`) resolvia com — porque
`tsconfig.json` inclui `vitest.config.ts`, e algo nessa cadeia de import puxa `@types/node`
para dentro do programa; `tsconfig.build.json` restringe `include` a `src` e não herda esse
acaso. Nenhum adapter usava `node:*`/`process`/`Buffer` de verdade antes desta tarefa, então o
`build` nunca tinha exercitado isso. Corrigido com `"types": ["node"]` explícito no
`tsconfig.json` raiz (herdado por `tsconfig.build.json`) — remove a dependência de qual arquivo
não relacionado calha de estar no programa. Não abro isso como bloqueante porque já está
corrigido e coberto por `npm run verificar`/`verificar:linux`, só registrando para quem revisar
não estranhar o diff em `tsconfig.json`.

**Nota lateral sobre macOS:** a captura de `procStart` ali (`ps -o lstart= -p <pid>` com
`LC_ALL=C`/`TZ=UTC`) segue exatamente o que o Spike F documentou, mas **não foi verificada nesta
tarefa** — não havia máquina macOS disponível. Only Linux (container Docker) e Windows (esta
máquina) foram confirmados por medição direta. Ver o relatório da tarefa para o que foi
confirmado e como.

---

## Q-008 — Formato de `~/.seeya/forks.json` ainda não fixado; S1-T3 assumiu um mínimo
**Tarefa:** S1-T3
**Bloqueia:** não esta tarefa — bloqueia (na prática, precisa de confirmação antes de) S2-T2 (quem
escreve o arquivo pela primeira vez) e S2-T6 (limpeza de forks, que lê `forkCleanupDays`).
**Contexto:** D-012 exige que a descoberta exclua `sessionId`s listados em `~/.seeya/forks.json`
(retomado explicitamente no item de escopo de S1-T3 do plano). Nenhuma tarefa anterior a esta
fixou o **formato** do arquivo — D-012 só diz "todo `sessionId` de fork é registrado", sem dizer
lista ou mapa, nem quais outros campos existem. `forks.json` só ganha um escritor de verdade em
S2-T2, e um segundo leitor (para idade, via `forkCleanupDays`) em S2-T6.

Para cumprir a exclusão agora, `src/adapters/discovery/fork-registry.ts` assumiu o formato mínimo
que a própria exclusão precisa: um array JSON no nível raiz, cada item pelo menos com
`sessionId` (uuid), validado item a item (tolerante a campos desconhecidos, no espírito de
D-021) — para que S2-T2 possa acrescentar `createdAt` (necessário para `forkCleanupDays`) sem
quebrar esta leitura:

```jsonc
[{ "sessionId": "uuid-do-fork" }]
```

Arquivo ausente é tratado como "nenhum fork registrado ainda" (caso normal, não corrompido) — faz
sentido hoje porque nenhum escritor existe. Arquivo presente mas malformado (JSON inválido, não é
array, item sem `sessionId`) é reportado como rejeição visível (mesmo padrão `{accepted,
rejected}` do resto do projeto), nunca faz a leitura falhar silenciosamente nem derruba a
descoberta das sessões de verdade.

**Por que isso é uma questão, não só uma implementação.** D-027 registra o princípio: "nome de
diretório, arquivo de estado ou chave persistida é decisão barata antes do primeiro byte gravado
e cara depois." Este é literalmente o primeiro byte deste arquivo em qualquer máquina — hoje
nenhum `forks.json` real existe, então o formato ainda pode mudar de graça. Sigo com o mínimo
acima (não parei a tarefa, D-012 exigia a exclusão agora), mas não decidi o formato final sozinho:
é exatamente o tipo de decisão que `AGENTS.md` pede para não inventar sem registrar.

**Opções que enxergo:** A) confirmar o formato acima como definitivo, deixando S2-T2 apenas
acrescentar campos tolerados (`createdAt` etc.), sem mudar a forma raiz. B) preferir um objeto no
nível raiz (`{ "schemaVersion": 1, "forks": [...] }`), seguindo o padrão de `schemaVersion em todo
documento persistido` que `docs/ARQUITETURA.md` § `storage/` já define para outros documentos de
`~/.seeya/` — mais consistente, mas ainda não confirmado que `forks.json` conta como um desses
documentos "versionáveis" (ele nunca migra sozinho na spec atual). C) outro formato, definido por
quem torna isto decisão em `docs/DECISOES.md`.
**Resposta:** **FECHADA — opção B.**

Você levantou a opção certa e a dúvida certa, então respondo a dúvida: o `forks.json` **conta**
como documento versionável. A regra do `docs/ARQUITETURA.md` — `schemaVersion` em todo documento
persistido, com migração explícita — não abre exceção por arquivo. E o argumento de que "ele
nunca migra sozinho na spec atual" é exatamente o que deixa de valer no dia em que precisar
migrar: um array na raiz não tem onde carregar a versão, e acrescentá-la depois é a migração
cara que a regra existe para evitar. Somado ao D-027 (antes do primeiro byte é de graça), a
hora de acertar é agora.

```jsonc
{
  "schemaVersion": 1,
  "forks": [{ "sessionId": "uuid-do-fork", "createdAt": "2026-08-18T21:00:00.000Z" }]
}
```

`createdAt` entra **agora**, mesmo sem leitor hoje: S2-T6 vai precisar dele para
`forkCleanupDays`, e declarar uma linha agora é mais barato que migrar um arquivo que já
existe na máquina de alguém.

O resto do seu desenho fica: a descoberta exige **só** `sessionId` e ignora o resto, item a item;
arquivo ausente é "nenhum fork ainda", não corrupção; arquivo presente e malformado vira
rejeição **visível**, nunca falha silenciosa nem derruba a descoberta das sessões reais.

`schemaVersion` ausente ou diferente de `1` é rejeição **visível** do arquivo inteiro, no mesmo
padrão de `forks` ausente ou não-array. Implementado em
`src/adapters/discovery/fork-registry.ts`.

Anotado em S2-T2, que escreve o arquivo pela primeira vez.

---

## Q-009 — Transcript sem `cwd` legível em nenhuma linha: rejeitar, ou descobrir sessão sem `cwd`?
**Tarefa:** S1-T8
**Bloqueia:** não esta tarefa — decidi seguir com a opção A (rejeitar) para não parar a entrega,
mas é decisão de tipo de domínio, não só de adapter, e por isso registro em vez de manter
implícita no código.
**Contexto:** D-016 diz que a estratégia de varredura "reconstrói o `cwd` a partir do conteúdo do
transcript". Na prática, isso significa ler linha a linha até achar uma entrada com campo `cwd`
(implementado em `src/adapters/discovery/transcript-cwd.ts`). Três casos fazem essa leitura
terminar sem `cwd`: arquivo vazio, arquivo cujas linhas são só tipos sem `cwd` (ex.:
`queue-operation` sozinho), e — o caso que a tarefa pediu explicitamente para tolerar — arquivo
cuja única linha é uma escrita truncada em andamento, sem nenhuma entrada completa ainda.

`CommonSessionFields.cwd` (`src/core/types.ts`, S1-T1) é `string`, não `string | null` — é campo
obrigatório tanto em `SessionWithPid` quanto em `SessionWithoutPid`. Não dá para montar um
`SessionWithoutPid` sem inventar um `cwd` (violaria D-025: "ausência de dado não vira afirmação")
nem sem mudar o tipo de domínio, que é escopo de S1-T1 (já `[x]`), não desta tarefa.

**O que implementei:** um transcript nessas condições é **rejeitado** — entra em `rejected[]` com
o motivo, no mesmo padrão `{accepted, rejected}` de D-022, nunca vira sessão inventada (`cwd:
""` ou similar) nem some da contagem em silêncio. A sessão "existiu" no sentido de que o arquivo
existe e está dentro de `relevanceHours`, mas o `seeya` não tem como identificá-la de forma útil
sem um `cwd` — e um `cwd` inventado seria pior que não descobrir a sessão, porque poluiria
qualquer decisão downstream que dependa dele (nome de exibição, elegibilidade por `ignore`,
eventual captura via git).

**Por que isso é uma questão, não só uma implementação.** É o mesmo tipo de escolha que gerou
D-024/D-025: "o que fazer quando falta um dado que o tipo exige". Nos dois casos anteriores a
resposta foi "não inventar, e não descartar em silêncio" — o que fiz aqui segue esse padrão, mas
existe uma alternativa que também é defensável e que muda o tipo de domínio:

**Opções que enxergo:**
A) confirma o que implementei — transcript sem `cwd` legível é uma rejeição visível, contável, e
   nunca vira `SessionWithoutPid`. O tipo de domínio não muda.
B) `cwd` passa a `string | null` em `SessionWithoutPid` (ou uma terceira forma da união) — a
   sessão é descoberta mesmo sem `cwd`, com o campo `null`, e quem consome decide o que fazer
   (ex.: mostrar "cwd desconhecido" em vez de nome derivado). Mais fiel ao "a sessão existiu",
   mas exigiria alterar `core/types.ts` (S1-T1, já fechada) e provavelmente `CommonSessionFields`
   inteiro, com efeito em `session-mapping.ts` e em toda a S1-T9 (fusão).
**Resposta:** **FECHADA — opção A, confirmada.**

Você seguiu o padrão certo (não inventar, não descartar em silêncio) e apresentou a alternativa
de forma justa. O que decide entre as duas é uma coisa que a opção B esconde: ela produz uma
sessão **descobrível mas inacionável**.

Sem `cwd`, a sessão não pode ser conferida contra a lista `ignore` da config, não tem árvore git
para capturar, não tem de onde derivar nome de exibição, e o `start-day` não tem diretório para
retomar. Ela apareceria na lista e falharia em todo passo seguinte — e cada consumidor ganharia
um ramo "e se não tiver cwd" para tratar um caso que nunca vai render trabalho útil. Isso é pior
que uma rejeição visível: troca um número honesto por uma entrada que promete algo que não
entrega.

Some-se que o caso realista é **transitório por natureza**. Um transcript truncado na primeira
escrita é uma sessão que começou há segundos; na próxima varredura ela já terá linhas completas
e será descoberta normalmente. Perder uma sessão de segundos de idade custa quase nada; mudar o
tipo de domínio inteiro para acomodá-la custa em toda a S1-T9 e em tudo que vier depois.

**A condição da confirmação:** a rejeição tem de continuar **visível e contável**, nunca
silenciosa — é isso que impede esta decisão de virar o modo de falha que D-021 e D-025 combatem.
O usuário poder ler "3 sessões, 1 transcript ignorado" é o que torna a opção A honesta.

Se um dia aparecer um transcript **persistente** sem `cwd` — que continue assim entre varreduras —,
isso é sinal novo e reabre a questão. Transitório é aceitável; permanente seria um formato que
não entendemos.

---

## Q-010 — `SessionWithoutSessionId` não tem `procStart`: PID não é identidade estável entre duas varreduras
**Tarefa:** S1-T10
**Bloqueia:** não esta tarefa; **sim** a S1-T9, que precisa saber disto antes de deduplicar por PID
**Contexto:** a terceira estratégia de descoberta (D-023) identifica uma sessão só pelo PID
confirmado vivo agora — não existe `<pid>.json` prévio para dar um `procStart` de referência, e
por isso `SessionWithoutSessionId` (`src/core/types.ts`) não carrega esse campo. Toda outra forma
com PID (`SessionWithPid`) desempata um PID reciclado comparando o `procStart` gravado no
registro contra o observado agora (`core/classification.ts#pidRepresentsSameProcess`) — aqui não
há registro prévio nenhum para comparar.

A consequência: entre duas varreduras desta estratégia, não há como distinguir "o mesmo processo
autônomo continua vivo" de "aquele PID morreu, o SO reciclou para um processo qualquer não
relacionado, e o `.key` antigo ainda está no diretório". A segunda leitura confirmaria liveness e
leria `cwd`/linha de comando do processo **errado**, sem nenhum sinal de que algo mudou.

D-023 já decide que essa origem é deduplicada **por PID** (não por `sessionId`, que ela não tem).
Quem implementar a S1-T9 precisa saber, antes de escrever essa deduplicação, que "mesmo PID em
duas varreduras" não é garantia de "mesma sessão" para esta origem especificamente — ao contrário
de `SessionWithPid`, que tem o `procStart` para provar isso.

**Por que não resolvido agora:** a janela é estreita (o PID precisaria morrer e ser reciclado por
um processo não relacionado dentro do intervalo entre duas varreduras do `seeya`) e D-023 não pede
desempate para esta origem — só pede liveness, que já está coberta. Inventar um `procStart` sem
fonte violaria D-025. Resolver de verdade provavelmente significa capturar *algum* sinal adicional
do processo (horário de início, por exemplo, via as mesmas ferramentas de `adapters/process/proc-
start.ts`) especificamente para esta estratégia — escopo novo, não pedido pela tarefa atual.

**Opções que enxergo, para quem fechar a S1-T9 decidir:**
A) aceitar a janela estreita como está, documentada — dedupe por PID simples, sem tie-break, e se
   um caso real de colisão aparecer, ele vira dado para uma decisão melhor depois.
B) `adapters/process/inspection.ts` ganha uma captura de horário de início (mesma técnica de
   `proc-start.ts`, reaproveitando `runForStdout`), e `SessionWithoutSessionId` passa a carregar
   algo equivalente a `procStart`, ainda sem fonte prévia para comparar na primeira varredura, mas
   comparável entre a varredura N e N+1 do próprio `seeya` (que passaria a persistir o valor visto
   por sessão, não só usá-lo dentro de uma única chamada).
**Resposta:** **FECHADA — aceito na v1, e a anotação vai para a S1-T9, que é onde ela morde.**

Você identificou bem e endereçou no lugar errado da primeira vez; a correção que pedi era
exatamente esta: comentário dentro do seu adapter não chega em quem vai usar o PID como
identidade. Agora chega.

A janela é estreita — o processo teria de morrer **e** o SO reciclar aquele PID **entre duas**
varreduras, com o `.key` antigo ainda no diretório. Numa ferramenta que varre no fim do dia,
isso é raro o bastante para não pagar código na v1.

O que **não** é aceitável é a S1-T9 deduplicar por PID sem saber disso. Anotado no plano, na
S1-T9: para esta origem, "mesmo PID em duas varreduras" **não** prova "mesma sessão" — ao
contrário de `SessionWithPid`, que tem o `procStart` para provar. Quem escrever a fusão decide
o que fazer com isso sabendo; se concluir que precisa de defesa, aí vira decisão nova.

Se um dia esta estratégia passar a rodar em varredura periódica em vez de uma vez por dia, a
janela deixa de ser estreita e isto reabre.

---

> **PREJUDICADA em 2026-08-19 (D-029).** A resposta acima continua correta para o desenho que
> existia, mas ficou sem objeto: o D-029 revoga o D-023 e a terceira estratégia sai. Sem ela não
> há origem deduplicada por PID, e a S1-T9 volta a deduplicar só por `sessionId`. Fica como
> registro de um raciocínio correto sobre um desenho que saiu.

## Q-011 — Linha de comando como fonte de handoff: mascarar padrão de segredo antes de persistir, ou aceitar o risco documentado?
**Tarefa:** S1-T10
**Bloqueia:** não esta tarefa (o dado já nasce como `string | null` opaco, sem parsing); talvez
bloqueie S2 quando a linha de comando vira conteúdo de handoff gravado em `~/.seeya/`
**Contexto:** D-023 é explícito que a linha de comando de uma sessão desta origem é **fonte de
handoff, não só de identificação** — `/<comando> --item 2990` diz o que a sessão está fazendo, e é
a única informação de primeira ordem disponível para uma sessão sem transcript nenhum.

Mas linha de comando é também um lugar clássico onde segredo aparece: chave passada por
argumento, token, senha — nada incomum em scripts de automação, exatamente a classe de processo
que esta estratégia descobre. E o valor lido aqui eventualmente vai **para disco**, num handoff
que o usuário lê no dia seguinte (e que, por ser conteúdo de projeto, poderia até acabar versionado
ou compartilhado sem que ninguém tenha pensado nisso como "dado sensível").

**O que já mitiguei nesta tarefa, sem esperar resposta:** `adapters/process/inspection.ts` só lê a
linha de comando dos PIDs **candidatos** (os que vieram de um `.key` sem `.json` e foram
confirmados vivos) — nunca enumera nem loga a linha de comando de todo processo da máquina. Isso
reduz a superfície de exposição em vez de só tratar o sintoma, mas não resolve o problema de fundo:
o valor de um PID candidato genuíno ainda pode conter um segredo, e ele ainda vai para
`SessionWithoutSessionId.commandLine` tal como veio do SO.

**Opções que enxergo:**
A) aceitar o risco na v1, documentado — `commandLine` é gravado como veio, sem transformação. Mais
   simples, mais fiel ao dado real, mas expõe o usuário a gravar um segredo em disco sem saber.
B) mascarar padrões suspeitos antes de persistir (ex.: `--token`, `--password`, `--api-key`,
   sequências que parecem `sk-...`/JWT) numa camada de saneamento antes do handoff. Reduz o risco,
   mas é uma heurística — vai errar nos dois sentidos (mascara texto legítimo que só *parece*
   segredo; deixa passar um formato de segredo que a lista não previu), e cria uma falsa sensação
   de segurança se alguém achar que ela "resolve" o problema.
C) não persistir `commandLine` bruto no handoff — só um resumo derivado (ex.: primeiro token do
   comando, sem os argumentos) — mais seguro, mas perde exatamente a informação que D-023
   descreveu como o valor desta origem ("qual item de trabalho").
**Resposta:** **PREJUDICADA — não há mais captura de linha de comando (D-029).**

A pergunta era se o `seeya` deveria mascarar padrões de segredo antes de gravar a linha de
comando no handoff. Com o D-029 nenhuma linha de comando é lida nem persistida, então o risco
desaparece **na origem**, em vez de ser mitigado.

Registro a inclinação, caso o assunto volte: **não mascarar**. Máscara por heurística erra nos
dois sentidos e, pior, **parece** resolver — quem confia nela para de tomar cuidado, e o dia em
que a lista não cobre o formato é o dia em que ninguém está olhando. Proteção incompleta que
passa por completa troca um risco conhecido por um invisível. Se um dia for preciso, o caminho
é **não capturar**, não capturar-e-limpar.

---

## Q-012 — `SessionProvider.list()` mudou de forma; e uma regra de fusão que assumi sem fonte
**Tarefa:** S1-T9
**Bloqueia:** não esta tarefa (segui com a solução mínima, como `AGENTS.md` pede quando o efeito
passa da própria tarefa); **pode bloquear** S1-T6, que é quem primeiro consome o retorno de
`list()` para montar a saída de `seeya sessions`.
**Contexto:** dois pontos, registrados juntos por serem da mesma tarefa.

**1) `SessionProvider.list()` passou a devolver `{ sessions, rejected }`, não mais
`Promise<DiscoveredSession[]>`.** O texto da tarefa exige que "as rejeições das duas [estratégias]
aparecem somadas" no resultado da fusão, e D-022 é explícito que toda coleção de fonte externa
declara os dois lados justamente para que `seeya sessions` possa dizer "3 sessões, 1 entrada
ignorada" em vez de mentir por omissão. Só que a assinatura literal do método na porta (e no
esboço de `docs/ARQUITETURA.md § "Portas"`) era `list(): Promise<DiscoveredSession[]>` — sem
`rejected` nenhum. Não achei como cumprir os dois ao mesmo tempo: ou `rejected` se perde na
fronteira do port (violando D-022 exatamente no ponto em que o usuário finalmente veria, como o
próprio texto da tarefa nomeia), ou a assinatura muda.

Mudei a assinatura — `list()` agora devolve `DiscoveryResult` (`{ sessions, rejected }`,
declarado em `src/core/ports.ts`) — porque a alternativa era cumprir a letra do esboço e descumprir
o `D-022`, que tem autoridade maior. Não alterei `docs/ARQUITETURA.md` (exige aprovação do PO,
`AGENTS.md § "Ordem de autoridade"`); o comentário em `core/ports.ts` aponta para esta questão.
**Opções que enxergo:** A) confirma a mudança de assinatura; `docs/ARQUITETURA.md § "Portas"` é
atualizado pelo PO para refletir `DiscoveryResult`. B) `list()` volta a devolver só
`DiscoveredSession[]`, e as rejeições ficam disponíveis por outro caminho (um segundo método na
porta, ou um evento/registro fora do retorno) — não construí essa alternativa porque me pareceu
mais invasiva que alargar o tipo de retorno, sem ter certeza de que é essa a preferência do PO.
**Resposta:** **FECHADA — a porta alargada está certa; o documento é que estava atrasado.**

Devolver só `DiscoveredSession[]` obrigaria a fusão a jogar fora as rejeições, e aí a
visibilidade que a S1-T3 e a S1-T8 construíram morreria exatamente no ponto em que o usuário
finalmente a veria. O contrato do D-022 não é só "valide por item" — é "a rejeição é contável
**e chega a quem lê**". Uma porta que devolve apenas o que deu certo quebra a segunda metade.

`docs/ARQUITETURA.md` § Portas atualizado para `Promise<DiscoveryResult>`. Aquele bloco é
esboço; quando ele e o código divergem sem motivo, quem está errado é o esboço.

**2) Quando `cwd` ou `name` divergem entre as duas origens para o mesmo `sessionId`, escolhi
sempre o valor do registro — mas não tenho fonte para isso, é minha melhor suposição.** O
`cwd` do registro vem direto do `.json` que o Claude Code escreve; o `cwd` da varredura de
transcript é reconstruído lendo o conteúdo do próprio transcript (D-016, S1-T8) — não é o mesmo
tipo de evidência. Na prática as duas deveriam sempre concordar (é o mesmo diretório de trabalho,
a mesma sessão), então esperava tratar isso como "nunca diverge de verdade" — mas se um dia
divergir (dado corrompido, bug num dos dois lados), meu código silenciosamente escolhe o
registro e segue, sem avisar que havia uma divergência para investigar. `name` recebe o mesmo
tratamento pelo mesmo motivo (o nome da varredura é sempre derivado do `cwd`, nunca mais rico que
o do registro).
**Opções que enxergo:** A) confirma a preferência pelo registro nos dois campos, calada — a
divergência é considerada anomalia rara demais para valer código extra. B) uma divergência real
de `cwd` entre as duas origens deveria virar uma rejeição visível (ou um aviso) em vez de ser
resolvida em silêncio, porque uma sessão com `cwd` inconsistente entre fontes é sinal de que algo
está errado em uma delas.
**Resposta:** **FECHADA — preferir o registro não é silenciar conflito, é usar a evidência melhor.**

A dúvida seria legítima se as duas origens fossem pares. Não são: o `cwd` do registro é o que o
Claude Code **escreveu**; o da varredura é **reconstruído** do conteúdo do transcript, porque
aquela estratégia não tem nada melhor — o slug do diretório não é reversível com segurança.
Derivado perdendo para original não é resolver disputa em silêncio: é hierarquia de evidência, e
ela deve valer sempre, não caso a caso.

Não vale um terceiro canal de saída para isso. Se as duas leituras divergirem de verdade, o sinal
útil não é "as origens discordam" — é que **uma das duas está com defeito**, e um aviso de
divergência não ajudaria a achar qual.

Eu ia pedir que o comentário do `merge.ts` registrasse isso nesses termos — e fui conferir antes
de pedir: **já registra**. Ele diz que o `cwd` da varredura é reconstruído "precisely because it
has no better source", que o do registro vem "straight from the record Claude Code itself wrote",
e conclui que "the direct declaration wins over the reconstruction". Ainda acrescenta que uma
divergência real seria anomalia, não caso que a função resolve.

Nada a fazer, então. Registro aqui porque a formulação importa: escrita como "o registro é mais
confiável", a regra pareceria preferência arbitrária, e alguém tentaria "melhorar" com uma
heurística mais esperta — que é como se estraga uma regra que estava certa.

---

## Q-013 — Duas lacunas de `config.json` encontradas fazendo S1-T5: `endOfDayTime` default e `forkCleanupDays` sem chave fixada
**Tarefa:** S1-T5
**Bloqueia:** não esta tarefa (segui com a solução mínima, como `AGENTS.md` pede quando o efeito
passa da própria tarefa); **pode bloquear** S4-T4/S5-T2 (quem primeiro escreve `config.json`) e
S2-T6 (limpeza de forks, que precisa ler `forkCleanupDays`).
**Contexto:** duas lacunas da mesma natureza, registradas juntas por serem da mesma tarefa —
"config com defaults" pedia uma resposta para cada chave, e a documentação não fixa uma para
nenhuma das duas.

**1) O bloco de `config.json` em `docs/ARQUITETURA.md § "Config"` é um exemplo ilustrativo, não
uma tabela de defaults — e para `endOfDayTime` isso importa de verdade.** Conferi as chaves uma a
uma: só `relevanceHours` (12h) tem seu default afirmado em prosa
(`docs/ESPECIFICACAO.md § "Elegibilidade"`). As demais numéricas/estruturais
(`leadTimesInMinutes`, `idleMinutes`, `captureModel`, `budgetPerSessionUsd`,
`captureConcurrency`) eu tomei os valores do exemplo como default — são plausíveis e não mudam o
comportamento do produto na ausência de config (o `endOfDayTime` do exemplo,
`"19:30"`, dispararia o encerramento automático do dia todo dia às 19:30 **sem o usuário nunca ter
escolhido esse horário** — numa máquina sem `config.json`, antes de existir `seeya init` (S5-T2).
Implementei `null` (só manual) como default, seguindo o espírito opt-in que já aparece em D-002 e
D-011 (terminação e captura profunda são opt-in por padrão) — mas é uma leitura minha do
princípio, não uma decisão escrita em lugar nenhum para `endOfDayTime` especificamente.
**Opções que enxergo:** A) confirma `null` como default de `endOfDayTime` — sem config, o
agendador nunca dispara sozinho, só via comando manual, até o usuário rodar `seeya init` ou editar
o arquivo. B) o exemplo de `docs/ARQUITETURA.md` já **é** a decisão de default, e `"19:30"` deveria
valer também na ausência de arquivo — meu código está errado. C) outro valor.
**Resposta:** **FECHADA — as duas escolhas confirmadas.**

**1) `endOfDayTime: null` por padrão está certo, e o seu argumento é o argumento.** Uma máquina
sem config não deve disparar encerramento num horário que ninguém escolheu. O `"19:30"` do
`ARQUITETURA.md` é ilustração de formato, não default — vou deixar isso explícito lá, porque
exemplo sem rótulo vira especificação por acidente.

Isso segue a mesma linha do D-002 e do D-011: o que age sozinho é opt-in.

**2) `forkCleanupDays` faltava mesmo no glossário — lacuna minha.** O D-012 cita o termo e o
default 7, e eu não o levei para a tabela dos identificadores que vão para disco quando a
escrevi. Acrescentado agora, para a S2-T6 não precisar inventar.

Você fez certo em **não** acrescentá-lo ao `Config` sem chave fixada: inventar nome de chave que
vai para disco é exatamente o que o D-027 diz ser barato agora e caro depois.

**2) `forkCleanupDays` (D-012: "Forks com mais de `forkCleanupDays` (default 7) são apagados") não
está na tabela de "Identificadores que vão para disco" do `AGENTS.md § "Idioma"`, nem no exemplo de
`docs/ARQUITETURA.md § "Config"`.** É exatamente o caso que `AGENTS.md` pede para não inventar: "se
faltar alguma [chave], pergunte; não invente". Como o exemplo de config desta tarefa também não a
lista, e nenhum leitor de `forkCleanupDays` existe ainda (chega só em S2-T6), **não acrescentei a
chave ao tipo `Config`** — ficaria sem uso, e inventar o nome antes do glossário fixá-lo é
exatamente o risco de deriva que a tabela existe para evitar.
**Opções que enxergo:** A) fixar `forkCleanupDays: number` (default 7, conforme D-012) na tabela do
glossário agora, para a S2-T6 já encontrar o nome certo. B) esperar a S2-T6 abrir a própria questão
quando chegar lá.
**Resposta:** _(em aberto)_

---

## Q-014 — Cinco pontos não-bloqueantes encontrados implementando S1-T4
**Tarefa:** S1-T4
**Bloqueia:** não — nenhum dos cinco impediu a entrega; registro para o review confirmar ou
corrigir, no mesmo espírito de Q-004 e Q-009.
**Contexto:** implementando `adapters/transcript/{schemas,facts,reader,index}.ts` e a porta
`TranscriptReader`/tipo `SessionFacts` em `core/`, encontrei cinco pontos onde a spec é silenciosa
o suficiente para exigir uma escolha explícita, sem ancoragem em texto. Documento a decisão que
tomei e por quê, para o review confirmar.

**1) `TranscriptReader.readFacts()` devolve `TranscriptReadResult` (`{ facts, rejected,
unknownEntryTypeCount }`), não `SessionFacts` puro.** `docs/ARQUITETURA.md` § "Portas" esboça
`readFacts(session): Promise<SessionFacts>`. D-022 exige "as entradas do `.jsonl` de transcript"
validadas item a item, com aceitos **e** rejeitados visíveis — um `SessionFacts` puro não tem onde
carregar o lado rejeitado. Segui o mesmo precedente que `DiscoveryResult` já abriu para
`SessionProvider.list()` (S1-T9, Q-012): o esboço do `ARQUITETURA.md` é anterior a essa decisão da
mesma forma que é anterior a esta.
**Opções:** A) confirma o padrão — o esboço de `ARQUITETURA.md` para `readFacts` também está
desatualizado, mesmo caso do Q-012. B) `SessionFacts` deveria carregar `rejected` internamente, e
`TranscriptReadResult` é indireção desnecessária.
**Resposta:** **FECHADA — os cinco confirmados, com uma ressalva no ponto 3.**

**1) `TranscriptReadResult` está certo**, pelo mesmo motivo do `DiscoveryResult` na Q-012: uma
forma que só devolve o que deu certo não tem onde carregar o lado rejeitado, e aí a visibilidade
que o D-022 exige morre na assinatura. O esboço do `ARQUITETURA.md` é anterior à decisão, como
já era no caso da descoberta.

**2) `MAX_LAST_PROMPTS = 10` fica.** É limite de resumo, não de correção — errar para mais ou
para menos deixa o handoff mais gordo ou mais magro, nunca errado. Quando houver handoff real
para julgar, o número vira evidência; até lá, escolher e registrar é melhor que discutir sem
dado. Se um dia virar config, entra pelo glossário como qualquer chave que vai para disco.

**3) O conjunto de ferramentas de escrita fica — mas você mesmo disse o que me preocupa: não foi
confirmado contra transcript real.** Isso é dedução, não medição, e a diferença importa aqui
porque o nome de ferramenta é **dado externo** que muda entre versões do Claude Code.

O risco tem forma ruim: se aparecer uma ferramenta de escrita nova, `touchedFiles` passa a
sub-relatar **em silêncio** — a lista continua parecendo completa. É a família de falha que o
D-021 e o D-025 combatem, e não dá para detectar de dentro, porque ignorar ferramenta que não
escreve é o comportamento correto na maioria dos casos.

Não vou pedir maquinaria para isso agora. O que eu quero é que **o comentário no código diga que
a lista é deduzida e não verificada**, e nomeie o sintoma — se `touchedFiles` um dia parecer
incompleto, esta lista é a primeira suspeita. A faixa de contrato (`tests/contract/`), que roda
contra o binário de verdade, é o lugar natural para pegar essa deriva quando alguém estiver ali.

**4) Sub-agente conta para arquivo tocado e não para prompt: certo, e a distinção é boa.** O
prompt de um sub-agente não é o que **o usuário** pediu — poluiria "últimos prompts" com texto
que a pessoa nunca escreveu. Mas o arquivo que ele mexeu **está mexido**, e omitir isso faria o
handoff mentir sobre o estado da árvore. Registre esse raciocínio no comentário; é o tipo de
assimetria que parece inconsistência para quem chega depois.

**5) `locateTranscriptFile` como função irmã, sem alargar a `findTranscript`: certo.** Alargar
tocaria um ponto de chamada fora do seu escopo, e escopo que vaza é como uma tarefa vira três.
As duas devem ser reconciliadas quando alguém estiver naquele arquivo por outro motivo — não
vale uma tarefa própria.

**2) `MAX_LAST_PROMPTS = 10` é um número escolhido, não medido nem especificado.**
`docs/ESPECIFICACAO.md` e `docs/TESTES.md` dizem "últimos prompts", sem quantidade. Escolhi 10 em
`adapters/transcript/facts.ts` como uma janela que parece razoável para o handoff de amanhã, sem
nenhuma medição por trás.
**Opções:** A) 10 fica, é só um valor inicial e pode virar config (`config.json`) mais adiante se
algum dia importar. B) o número deveria vir de `config.json` desde já, na mesma família de
`relevanceHours`/`idleMinutes`.
**Resposta:** (preenchida pelo PO)

**3) "Arquivos tocados" = `file_path` de chamadas `tool_use` para `Edit`, `Write` e
`NotebookEdit`, excluindo ferramentas de leitura (`Read`, `Grep`, `Glob`, ...).** Nenhum documento
diz que "tocado" significa "escrito" em vez de "lido" — decidi por analogia com `git diff
--name-only` (o que mudou, não o que foi consultado), porque é isso que ajuda a retomar o dia
seguinte. Esse conjunto de três ferramentas também não vem de nenhuma fixture real — este projeto
não tem, hoje, uma amostra confirmada do conjunto completo de ferramentas do Claude Code (ao
contrário de `KNOWN_ENTRY_TYPES`, que foi confirmado contra 2808 entradas reais em S0-T5). Um
nome de ferramenta de escrita que exista na realidade e não esteja nesta lista (ou um nome que eu
supus errado) faria um arquivo realmente editado desaparecer de `touchedFiles` sem nenhum sinal —
`writeToolUseBlockSchema` simplesmente cai no `contentBlockSchema` genérico, silenciosamente.
**Opções:** A) o conjunto fica, é a leitura mais razoável de "tocado" sem dado melhor. B)
"tocado" deveria incluir leitura também (mais fiel ao nome, mais ruidoso). C) o conjunto de
ferramentas deveria ser confirmado contra uma amostra real antes de travar (mas isso reabriria a
questão de anonimização que motivou fixtures sintéticas nesta tarefa).
**Resposta:** (preenchida pelo PO)

**4) Turnos de sub-agente (`isSidechain: true`) contam para `touchedFiles` mas não para
`lastPrompts`.** A leitura que fiz: um `tool_use` dentro de um sub-agente é trabalho real da
sessão (D-013 trata o trabalho de um agente autônomo como pertencendo à sessão que o lançou), mas
o *prompt* de um sub-agente não foi digitado pelo usuário, então não é "o que você pediu" no
sentido que `lastPrompts` existe para responder. Nenhum documento distingue os dois campos dessa
forma — é inferência minha a partir do que cada campo serve para responder no handoff.
**Opções:** A) a assimetria fica, cada campo segue a pergunta que responde. B) `isSidechain`
deveria excluir a entrada de ambos os fatos, por simetria e simplicidade. C) deveria excluir de
nenhum dos dois — todo conteúdo do transcript é "da sessão".
**Resposta:** (preenchida pelo PO)

**5) `adapters/transcript/index.ts` localiza o `.jsonl` chamando `locateTranscriptFile`, uma
função nova em `adapters/discovery/transcript-lookup.ts`, em vez de reaproveitar `findTranscript`
(já existente, mesma varredura de slugs).** Não dava para simplesmente ler o `path` de
`findTranscript`: seu retorno (`TranscriptLookup`) é espalhado num objeto literal
(`{ processIsAlive, ...transcript }` em `registry.ts`) passado como argumento tipado para
`buildSessionWithPid`, e um campo `path` novo ali dispararia checagem de propriedade excedente do
TypeScript no `session-mapping.ts` de S1-T3 — mudaria um módulo fora do escopo desta tarefa só
para caber uma leitura nova. Optei por uma função irmã, reaproveitando o `statTranscriptCandidate`
já existente para o teste por candidato, aceitando pequena duplicação (o laço de `readdir` mais o
`for`) documentada no próprio comentário da função. É a mesma classe de escolha que Q-004 já
tratou para `SessaoDescoberta`: preferir não adiantar mudança em módulo de tarefa já aprovada.
**Opções:** A) fica — a duplicação é pequena e o comentário deixa a razão rastreável. B)
`DiscoveredSession` deveria carregar o `transcriptPath` resolvido desde a descoberta (S1-T3/S1-T8),
e `TranscriptReader.readFacts` deixaria de precisar localizar o arquivo de novo — mudança de tipo
de domínio, fora do escopo desta tarefa. C) `findTranscript` deveria ganhar o campo `path` mesmo
assim, e `session-mapping.ts` ajustado para não espalhar o objeto inteiro.
**Resposta:** (preenchida pelo PO)

---

## Q-015 — `seeya status` implementado com escopo reduzido: falta horário de verão/adiamentos, daemon e histórico de captura
**Tarefa:** S1-T6
**Bloqueia:** não — a solução mínima seguida já está implementada e testada; registro para o
review confirmar o recorte, no mesmo espírito de Q-004/Q-009/Q-014.
**Contexto:** `docs/ESPECIFICACAO.md` § "seeya status" pede: horário de encerramento configurado,
**quanto falta**, adiamentos aplicados, se o dia foi pulado, se o **daemon** está rodando, e
quantas sessões estão elegíveis. Nenhuma dessas peças, além do próprio `config.json` e da
descoberta, existe ainda nesta sprint:

- "quanto falta" e adiamentos dependem de `core/schedule` (S4-T2) — que é explicitamente onde
  moram os casos de horário de verão e máquina suspensa. Calcular isso agora em `cli/` seria
  duplicar essa lógica sensível a fuso fora do lugar que o próprio plano reserva para ela.
- "dia pulado"/adiamentos persistidos dependem de `seeya snooze`/`skip-today` (S4-T4), que ainda
  não gravam estado nenhum.
- "daemon rodando" depende do daemon (S4-T3), que não existe.
- a contagem de sessões elegíveis usa `evaluateEligibility` (`core/eligibility.ts`) com escopo
  reduzido: `knownForks` sempre vazio (D-012 já exclui forks na descoberta, antes de qualquer
  `DiscoveredSession` chegar aqui — não sobra nada para excluir de novo) e
  `previousCaptureToday` sempre `null` (nenhum handoff jamais foi gravado por este build —
  `endDay`/S2-T3 não existe — então "nenhuma captura hoje" é literalmente verdade, não um atalho).

**O que implementei:** `seeya status` mostra só o que é responderível honestamente hoje —
`endOfDayTime` configurado (ou "not configured"), a contagem de sessões elegíveis/descobertas
(com o escopo acima), e uma linha fixa "Daemon: not implemented yet" em vez de inventar
rodando/parado. Nada de `--dry-run` fictício, nada de adiamento calculado sem estado persistido.

**Opções que enxergo:** A) o recorte fica como está até S4-T2/S4-T3/S4-T4 existirem, e cada uma
delas estende `formatStatusReport`/`eligibility-view.ts` quando sua peça ficar disponível — sem
duplicar lógica de agendamento em `cli/` antes da hora. B) `seeya status` deveria já calcular
"quanto falta" com uma versão simplificada (sem DST) só para não sair vazio, aceitando que S4-T2
a substitua depois. C) `seeya status` não deveria existir ainda nesta tarefa — só `seeya sessions`
— e o comando entraria completo quando todas as peças estivessem prontas.


**Resposta:** **FECHADA — opção A. O recorte confirmado, e a linha do daemon é o acerto principal.**

Você implementou o que dá para responder com honestidade e escreveu **"Daemon: not implemented
yet"** em vez de fabricar um estado. Isso é a doutrina inteira do projeto numa linha: um
"parado" inventado seria indistinguível de um daemon realmente parado, e o usuário confiaria.

A opção B — calcular "quanto falta" numa versão simplificada, só para não sair vazio — é a
tentadora e a errada. Lógica de agendamento duplicada em `cli/` antes da S4-T2 vira a peça que
ninguém lembra de remover, e o campo preenchido faz o próximo achar que funciona.

A C (adiar o comando inteiro) custaria mais do que rende: o `seeya status` já responde coisa útil
hoje, e o texto atual é o registro honesto de que ele está incompleto de propósito.
---

## Q-016 — Três escolhas feitas fazendo S1-T7, registradas para confirmação
**Tarefa:** S1-T7
**Bloqueia:** não — as três seguiram a solução mínima com o porquê escrito, conforme AGENTS.md
("decida, escreva o porquê, registre se ficar ambíguo"); registro para o review confirmar ou
corrigir, no mesmo espírito de Q-004/Q-005/Q-013.
**Contexto:** implementando a detecção precoce (D-018, estendida por D-029) encontrei três pontos
sem resposta literal em nenhum documento.

**1) `~/.seeya/early-warnings.json` é um documento novo, com duas chaves novas
(`notifiedMissingTranscriptSessionIds`, `notifiedUninspectableSessionKeys`), e nenhuma das duas
está na tabela de "Identificadores que vão para disco" do `AGENTS.md` § Idioma** (fixada em
S1-T0g, antes desta tarefa existir). Segui o mesmo padrão de Q-005/Q-013 para `deepCapture`/
`forkCleanupDays`: nomeei com o raciocínio escrito no comentário de
`src/adapters/storage/early-warning-schema.ts` em vez de inventar em silêncio, e registro aqui em
vez de alterar a tabela do `AGENTS.md` sozinho.
**Opções:** A) os dois nomes ficam, e o PO os acrescenta à tabela do `AGENTS.md`. B) outro nome
para o arquivo ou para uma das chaves.
**Resposta:** **CONFIRMADO — e melhor do que eu teria pedido.**

Eu listei "nome, PID ou dia" sem resolver. Sua análise resolve: com o PID, um `.key` órfão de
sessão morta há muito **suprimiria para sempre** o aviso de uma sessão nova que reusasse aquele
PID — o aviso silenciaria exatamente quando passasse a ser verdadeiro. O hash distinto por
sessão é o que faz o nome completo não colidir nem com PID reciclado.

Registre esse raciocínio no comentário se ainda não estiver: é escolha que parece arbitrária
depois e convida alguém a "simplificar" para o PID.

**2) Chave de deduplicação do segundo gatilho (`.key` sem `.json`): o nome do arquivo inteiro
(`<pid>.<hash>.key`), não o PID.** O PID sozinho tem um problema mensurável: o SO recicla PID, e
um `.key` obsoleto deixado para trás (sessão morta há muito tempo, arquivo nunca limpo — nada
neste projeto apaga `.key`) suprimiria para sempre o aviso de uma sessão **genuinamente nova** que
mais tarde reutilizasse aquele mesmo PID. O nome completo do arquivo não tem esse problema: o
Claude Code gera um hash novo por sessão (confirmado pelo `process-key.ts` histórico, commit
`e45b348`), então uma sessão nova nunca colide com o nome de um arquivo antigo mesmo com PID
reciclado. O custo aceito: um `.key` que nunca é limpo continua "já avisado" para sempre — mas é
a mesma troca que `notifiedMissingTranscriptSessionIds` já faz para `sessionId` (uma vez por
artefato, para sempre, não uma vez por dia). Raciocínio completo em
`src/core/early-warnings.ts`, no comentário de topo.
**Opções:** A) confirma o nome do arquivo como chave. B) o PID seria melhor apesar do risco de
reciclagem (ex.: se `.key` órfão for raro o bastante na prática para não importar). C) outra
chave (ex.: dia da descoberta) — decidi contra esta porque perderia visibilidade de um segundo
`.key` diferente aparecendo no mesmo dia.
**Resposta:** **CONFIRMADO — e a decisão se pagou na prática.**

Você manteve a orquestração fora do `DiscoverySessionProvider` para não tocar num construtor
que a S1-T6 podia estar compondo em paralelo. O merge das duas teve **zero conflito em código**
— só a numeração das questões colidiu. Respeitar a fronteira valeu mais que a elegância de
juntar tudo num objeto.

**3) A orquestração (ler o `Storage`, listar os `.key`, chamar a regra pura, salvar o estado) foi
para `adapters/discovery/early-warnings.ts`, como função nova e separada — não dentro de
`DiscoverySessionProvider` (S1-T9, `session-provider.ts`).** O `docs/ARQUITETURA.md` § `discovery/`
já dizia, antes desta tarefa, que é a descoberta quem "dispara a notificação de detecção precoce,
uma vez por `sessionId`" — o que sugere colocar isso dentro da mesma classe que já compõe as duas
estratégias de D-016. Não fiz isso porque `DiscoverySessionProvider` já tem uma assinatura de
construtor fixa (`claudeHome`, `seeyaHome`, `processControl`, `clock`, `relevanceHours`) que a
S1-T6 (rodando em paralelo, dona de `cli/`) pode já estar instanciando; acrescentar `storage` a
esse construtor mudaria um contrato que outra tarefa em voo depende, e a fronteira que me foi dada
explicitamente pede para eu não mexer em nada que toque `cli/` nem force a S1-T6 a se adaptar a
mim. A função nova recebe as sessões já descobertas por parâmetro em vez de rodar a descoberta de
novo, e quem compor depois (o PO, "eu faço a ligação") chama as duas em sequência.
**Opções:** A) confirma a função separada — mais seguro para a integração em paralelo, ainda que
o `ARQUITETURA.md` sugerisse outro lugar. B) `DiscoverySessionProvider` deveria mesmo crescer um
parâmetro `storage` opcional, e a S1-T6 se ajusta na integração.
**Resposta:** **CONFIRMADO — as duas chaves entram no glossário, e a lacuna era minha.**

Chave que vai para disco é barata agora e cara depois (D-027), e você fez certo em não inventar
sozinho. Acrescentadas ao `AGENTS.md` junto desta resposta.

---

## Q-017 — Quatro escolhas feitas fazendo S2-T1 (`adapters/git`), registradas para confirmação
**Tarefa:** S2-T1
**Bloqueia:** não — as quatro seguiram a solução mínima com o porquê escrito no comentário do
código (mesmo espírito de Q-004/Q-005/Q-013/Q-016); registro para o review confirmar ou corrigir.
**Contexto:** implementando branch/status/commits/worktrees do adapter de git encontrei quatro
pontos sem resposta literal em nenhum documento.

**1) Nome da porta e do método: `GitReader`/`readFacts`, sem entrada correspondente no glossário
do `AGENTS.md`.** `docs/ESPECIFICACAO.md` fixa os nomes de campo que vão para disco
(`branch`, `dirty`, `modifiedFiles`, `commitsToday`, `worktrees`), mas não fixa o nome da porta
nem do tipo de retorno — diferente de `TranscriptReader`/`readFacts`/`SessionFacts`, que já
estavam na tabela "ainda não existem no código" antes desta tarefa chegar. Escolhi espelhar
exatamente esse par (`GitReader`/`readFacts`, retornando `GitReadResult`), porque as duas portas
respondem a mesma pergunta (fatos de evidência da D-013) com o mesmo formato "dois lados"
(`RejectedDiscoveryRecord` para o que falhou por item). Comentário em `src/core/ports.ts` cita
esta questão.
**Opções:** A) confirma `GitReader`/`readFacts`/`GitReadResult`/`GitFacts`/`GitCommit`/
`WorktreeFacts` e entram no glossário. B) outro nome.
**Resposta:** (preenchida pelo PO)

**2) Assimetria de `commitsToday`: array de `{ sha, title }` no nível superior, contagem simples
(`number`) dentro de `worktrees[]`.** O exemplo de `docs/ESPECIFICACAO.md` já mostra essa
assimetria (`"commitsToday": [{ "sha": ..., "title": ... }]` no topo, `"commitsToday": 3` dentro de
`worktrees[]`), mas nenhuma prosa explica se é intencional ou um descuido de quem escreveu o
exemplo. Segui o exemplo ao pé da letra — os outros worktrees são um sinal secundário ("algo
aconteceu lá"), o `cwd` principal é o assunto do handoff — mas é uma leitura, não uma citação.
**Opções:** A) confirma a assimetria como está no exemplo (a que implementei). B) `worktrees[]`
também deveria carregar `GitCommit[]` completo, e o exemplo do `ESPECIFICACAO.md` está incompleto.
**Resposta:** (preenchida pelo PO)

**3) "Commits do dia" comparado por data de committer (`%cI`), não de autor (`%aI`).** Nem
`docs/ESPECIFICACAO.md` nem `docs/DECISOES.md` dizem qual data usar, e as duas divergem depois de
um rebase/cherry-pick. Escolhi committer porque "o trabalho apareceu hoje" (o que um handoff de
fim de dia precisa saber) é mais próximo de "quando foi registrado" do que de "quando foi
originalmente escrito, possivelmente semanas atrás, possivelmente em outra máquina". Raciocínio
completo no comentário de `src/adapters/git/commits.ts`.
**Opções:** A) confirma data de committer. B) data de autor é mais correta para este caso de uso.
**Resposta:** (preenchida pelo PO)

**4) `branch: string | null` (em vez de sempre `string`) para representar `HEAD` destacada
(detached).** Nem `docs/ESPECIFICACAO.md` nem `docs/DECISOES.md` mencionam o caso de um worktree
ou do `cwd` principal estarem em HEAD destacada — o exemplo do handoff só mostra `"branch":
"main"`. Segui D-025 (ausência de dado não vira afirmação: HEAD destacada não tem nome de branch
de verdade, e inventar um seria pior que `null`) em vez de forçar sempre uma string. Isso é uma
mudança de tipo sobre um campo cujo nome já está fixado para o disco — o *nome* do campo
(`branch`) não muda, só o tipo TypeScript que o produz antes de virar JSON — em disco, `null` só
aparece quando `HEAD` está destacada; ainda assim, registro por tocar um campo já fixado.
**Opções:** A) confirma `string | null`. B) HEAD destacada deveria virar outro valor (ex.: o sha
curto do commit) em vez de `null`.
**Resposta:** (preenchida pelo PO)


**Resposta:** **FECHADA — três confirmados, um muda, e o que muda é defeito da minha spec.**

**1) `GitReader`/`readFacts`: confirmado.** Espelhar o `TranscriptReader` foi o certo —
consistência entre portas vale mais que originalidade. Acrescentados ao glossário.

**2) A assimetria do `commitsToday` muda, e você fez certo em não improvisar.** Você seguiu o
exemplo da especificação literalmente; o exemplo é que está errado. O mesmo nome carregava
**array de objetos** no nível de cima e **número** dentro de `worktrees[]` — e isso vai para
disco. Nome igual com dois tipos no mesmo documento é armadilha para quem parsear o handoff
depois, inclusive para a S2-T4.

Vira `commitsTodayCount` dentro de `worktrees[]`. Pelo D-027, barato agora e caro depois do
primeiro byte. `ESPECIFICACAO.md` e glossário corrigidos aqui.

**3) Data de committer (`%cI`), não de autor: confirmado, e o motivo é o seu.** "O que eu fiz
hoje" é sobre quando o commit entrou **nesta** árvore. Rebase reescreve a data de autor, e um
commit antigo apareceria como de hoje — ou o contrário.

**4) `branch: string | null` para `HEAD` destacado: confirmado.** É o D-025 aplicado: ausência de
branch é ausência de dado, não `"HEAD"` nem string vazia. O exemplo da especificação não
mostrava o caso; acrescentei a anotação lá.

**Fora dos quatro, o que você encontrou de raspão virou conserto:** o guard de termos locais
barrava qualquer coisa com forma de e-mail, sem exceção. Isso cobrava atrito real — fixture de
git precisa de `user.email` — sem proteger nada, porque agora ele libera os domínios que a
IETF **reserva** para documentação e teste (RFC 2606 e RFC 6761). Endereço nesses domínios é de
ninguém por definição. O que continua barrado é o que sempre esteve: endereço em domínio real.

---

## Q-019 — `HandoffGenerator.generate()` precisou do `DiscoveredSession` inteiro, não só de `SessionFacts`
**Tarefa:** S2-T2
**Bloqueia:** não esta tarefa (segui com a solução mínima, como `AGENTS.md` pede quando o efeito
passa da própria tarefa); pode importar para S2-T3, que é quem primeiro chama `generate()` de
dentro do caso de uso `endDay`.
**Contexto:** `docs/ARQUITETURA.md § "Portas"` esboça `generate(facts: SessionFacts):
Promise<GeneratedUnderstanding>`. A implementação profunda (D-011) precisa de
`claude -p --resume <sessionId> --fork-session` — e `sessionId` não existe em `SessionFacts`
(S1-T4: só o que o transcript sozinho responde). Não achei como cumprir a letra do esboço sem
inventar um segundo parâmetro fora da porta (o que quebraria D-020: só `cli/`/`application/`
saberiam montar a chamada) ou sem alargar a assinatura.

Alarguei: `generate(session: DiscoveredSession, facts: SessionFacts)`. Mesmo formato de divergência
já registrado e fechado em Q-012 (`SessionProvider.list()` → `DiscoveryResult`) e Q-014
(`TranscriptReader.readFacts()` → `TranscriptReadResult`) — o esboço do `ARQUITETURA.md` é anterior
à restrição que a tarefa encontrou. Não editei `docs/ARQUITETURA.md` diretamente (exige aprovação do
PO); o comentário em `core/ports.ts` aponta para esta questão.
**Opções que enxergo:** A) confirma a assinatura alargada — `docs/ARQUITETURA.md § "Portas"` é
atualizado pelo PO para refletir `generate(session, facts)`, mesmo padrão de resolução de Q-012/Q-014.
B) a porta deveria continuar recebendo só `facts`, e o `sessionId` chega por outro caminho (um
terceiro parâmetro em `SessionFacts` mesmo não vindo do transcript, ou o adapter profundo recebe o
`sessionId` por outro mecanismo que não a chamada de `generate()`) — não construí essa alternativa
por parecer mais invasiva sem necessidade clara.
**Resposta:** **FECHADA — a porta está certa, o esboço estava atrasado. Terceira vez.**

O modo profundo precisa do `sessionId` para retomar, e `SessionFacts` não carrega identidade de
sessão nenhuma — é extração de transcript, por construção. Passar só os fatos tornaria o modo
profundo impossível de implementar sem inventar um canal lateral.

Você reconheceu o padrão sozinho, e ele já é padrão mesmo: Q-012 (`DiscoveryResult`) e Q-014
(`TranscriptReadResult`) terminaram do mesmo jeito. O esboço de `ARQUITETURA.md` § Portas foi
escrito antes de qualquer implementação existir; quando ele e o código divergem por uma
restrição que a implementação descobriu, quem está errado é o esboço.

Atualizado lá. E fez certo em **não** editar aquele arquivo por conta própria — ele é documento
de autoridade e a mudança é minha.

---

## Q-020 — Medição real: `--json-schema` não reduz o piso de tokens, aumenta — junto de `--tools ""`
**Tarefa:** S2-T2
**Bloqueia:** não esta tarefa; pode importar para o `budgetPerSessionUsd` default (D-011,
atualmente US$ 0,25) e para uma futura revisão de custo do modo enxuto.
**Contexto:** D-011 e o Spike C listam `--tools ""`, `--system-prompt` curto e `--json-schema`
juntos como a forma de "derrubar o piso de tokens e domar a saída". Medi os três separadamente
numa chamada real (`claude -p`, modelo haiku, 2026-08-29, claude 2.1.235 — sem tocar a suíte de
testes, que nunca chama a API de verdade), mesmo contexto e `--system-prompt` fixos entre as três:

| Flags | `cache_creation_input_tokens` | custo |
|---|---|---|
| nenhuma (`--tools` padrão) | 23.607 | US$ 0,0488 |
| `--tools ""` | 7.136 | US$ 0,0159 |
| `--tools ""` + `--json-schema` | 40.076 | US$ 0,0831 |

`--tools ""` sozinho cumpre a promessa (~70% de redução). Mas somar `--json-schema` **não** reduz
mais — ele **mais que quintuplica** o piso em relação a só `--tools ""`, e fica **acima** até da
chamada sem otimização nenhuma. A saída confirma o motivo: com `--json-schema`, `stop_reason` vira
`"tool_use"` e `num_turns` vira `2` — a saída estruturada parece ser implementada como uma chamada
de ferramenta forçada internamente, que `--tools ""` não consegue desligar. Em compensação,
`--json-schema` entrega `structured_output` (o objeto já parseado, confirmado real) — saída mais
confiável de extrair do que torcer para o modelo devolver JSON válido em prosa livre.

Seguido com a solução mínima: `adapters/generation` usa os três mesmo assim (`--tools ""` +
`--system-prompt` + `--json-schema`), porque D-011 pede e a confiabilidade da extração pesa mais
que o custo marginal — e o `--max-budget-usd` já limita o estouro. Mas o **piso real do modo
enxuto com captura estruturada está mais perto de US$ 0,08–0,09 (haiku) que dos US$ 0,15 do Spike
C** (que não usava `--json-schema`), e a comparação de custo enxuto-vs-profundo de D-011 foi feita
sem essa flag. Com sonnet (o `captureModel` default), a proporção deve ser pior em dólares
absolutos.
**Opções que enxergo:** A) confirma manter os três flags como estão; o `budgetPerSessionUsd`
default é revisto à parte, com medição em sonnet. B) `--json-schema` sai do modo enxuto (fica só
`--tools ""` + `--system-prompt`, parseando o JSON da prosa por conta própria, com o risco de saída
malformada que o Spike C já mostrou); `--json-schema` continua só no modo profundo, onde o custo
marginal pesa menos sobre o total. C) outra combinação.
**Resposta:** **FECHADA — mantenha os três flags, e a medição corrige o D-011.**

Esta é a medição mais valiosa desta tarefa, e ela derruba uma premissa que estava escrita como
se fosse fato. O D-011 e o Spike C listam `--tools ""`, `--system-prompt` curto e `--json-schema`
juntos como "a forma de derrubar o piso de tokens", sugerindo que compõem. **Não compõem.** Dois
derrubam; o terceiro mais que desfaz o ganho, deixando o piso **acima** da chamada sem
otimização nenhuma.

E você não parou no número — achou o mecanismo: com `--json-schema` o `stop_reason` vira
`tool_use` e o `num_turns` vira 2. A saída estruturada é uma chamada de ferramenta forçada
internamente, que o `--tools ""` não alcança. Isso é o que transforma a medição em explicação, e
é o que impede alguém de "otimizar" isso de novo daqui a meses somando mais flags.

**Mantém os três.** O motivo é o seu: extração confiável pesa mais que o custo marginal aqui. Um
handoff que falha ao parsear cai para determinístico e perde a camada de entendimento — que é o
único motivo de chamar o modelo. Torcer para o modelo devolver JSON válido em prosa livre é
trocar custo por confiabilidade na direção errada.

E o custo real cabe: US$ 0,083 contra um `budgetPerSessionUsd` de 0,25, com o `--max-budget-usd`
como teto duro.

**O que muda é o texto do D-011**, que passa a registrar a medição em vez de sugerir composição.
Corrigido junto desta resposta.

---

## Q-021 — Cinco escolhas de S2-T3 (`endDay`) sem resposta literal na spec
**Tarefa:** S2-T3
**Bloqueia:** não a entrega desta tarefa — seguida a solução mínima em cada uma, registrando aqui
para confirmação, no mesmo padrão de Q-012/Q-017/Q-019/Q-020.
**Contexto:** implementar o caso de uso que finalmente une `discovery`, `transcript`, `git`,
`generation` e `storage` expôs cinco pontos que a spec e as decisões deixam implícitos ou
silenciosos. Nenhum bloqueou a tarefa; documento a decisão tomada e o raciocínio, para o PO
confirmar ou corrigir.

**1) `source: "noTranscript"` prevalece sobre o resultado da geração, não só sobre a tentativa.**
D-013 diz "Marcação: `source: "noTranscript"`" para sessão sem transcript, e
`adapters/generation/prompt.ts` já documentava (escrito na S2-T2) que a sessão sem transcript
"ainda é roteada pelo gerador enxuto quando alguma evidência justifica chamá-lo" — ou seja, o
modelo **é** chamado, só que nunca com o modo profundo (D-018: `--resume` não encontraria a
sessão). Isso deixa em aberto o que `source` registra quando essa chamada roteada para o enxuto
**tem sucesso**: `"model"` (a chamada funcionou) ou `"noTranscript"` (a evidência de entrada
nunca incluiu o transcript)? Decidi que `"noTranscript"` **sempre** vence, sucesso ou falha —
`application/generation-policy.ts#generateUnderstanding`. Meu raciocínio: o campo existe para
dizer ao leitor "que evidência esta captura tinha", não "o modelo respondeu". Se marcasse
`"model"` num sucesso, dois handoffs idênticos em confiabilidade de entrada (um com transcript
raso, outro sem transcript algum) ficariam indistinguíveis pelo campo que a spec desenhou
exatamente para essa distinção.
**2) `EndDayDeps` recebe os dois geradores (`leanGenerator` e `deepGenerator`), não um só.**
D-011 diz "a escolha é config, não `if` espalhado", e o comentário do `HandoffGenerator` em
`core/ports.ts` (escrito na S2-T2) dizia que "`cli/`... é quem escolhe qual implementação a
política de um projeto usa". Mas a escolha real depende de **dois** fatos: `deepCapture` (config,
por `cwd`) **e** `session.hasTranscript` (só conhecido em tempo de execução, por sessão) — ver
ponto 1. `cli/` não tem como pré-resolver isso por sessão antes de descobrir as sessões. Decidi
que `endDay` recebe os dois geradores já construídos e escolhe por sessão
(`application/generation-policy.ts#selectCaptureMode`); `cli/` continua sendo a única raiz que
nomeia `LeanHandoffGenerator`/`DeepHandoffGenerator` (D-020 preservado), só que instancia os dois
em vez de um. Não editei o comentário do `HandoffGenerator` em `core/ports.ts` para refletir isso
— mudar a redação de outra tarefa (S2-T2) no meio desta não parecia certo; deixo a nota aqui em
vez disso, para quem revisar as duas tarefas juntas.
**3) Assinatura de evidência (D-026) não vira campo novo no disco — é recalculada do `facts`
persistido.** D-026 deixa o formato exato para "quando houver handoff de verdade", e o exemplo de
`docs/ESPECIFICACAO.md` § "Formato do handoff" não mostra nenhum campo de assinatura. Somar um
campo novo (`evidenceSignature`, por exemplo) seria inventar uma chave de disco fora da tabela do
`AGENTS.md` § Idioma. Decidi que `core/evidence.ts#buildEvidenceSignature(facts)` é chamada duas
vezes — sobre os fatos recém-coletados e sobre `facts` do handoff de ontem/hoje já persistido — em
vez de persistir a assinatura em separado. Funciona porque a assinatura é uma função pura dos
mesmos fatos que já vão para o disco; sobra caro só se alguém precisar comparar assinatura sem
reconstruir os fatos completos, o que não é o caso hoje.
**4) `Storage` ganhou `saveHandoff`/`readHandoff`, e `readHandoff` não está no esboço de
`docs/ARQUITETURA.md` § "Portas".** O esboço só lista `readBriefing(day)` — o `summary.md`
consolidado (S2-T4), markdown para leitura humana, sem onde extrair de volta os `facts` exatos de
uma sessão. D-026 exige comparar evidência por sessão, então implementei `readHandoff(day,
sessionId)` além do que o esboço previa — mesmo padrão de divergência já registrado para
`DiscoveryResult`/`TranscriptReadResult`/`GitReadResult` (Q-012/Q-014/Q-019).
**5) `knownForks` sempre vazio em `endDay`.** `core/eligibility.ts#EligibilityCriteria.knownForks`
existe para a condição `ownSeeyaFork` (D-012), mas as duas estratégias de descoberta (S1-T3,
S1-T8) já excluem forks de `forks.json` antes de `SessionProvider.list()` devolver qualquer coisa
— nenhum fork chega até `endDay`. Reler `forks.json` em `endDay` para preencher um conjunto que
nunca muda o resultado seria I/O gasto provando algo que a descoberta já garante. A regra pura
continua correta e testada isoladamente (`tests/unit/core/eligibility.test.ts`); só o lado do
`endDay` nunca a exercita de verdade.
**Opções que enxergo, por item:** 1) manter como está, ou `source: "model"` no sucesso mesmo sem
transcript (perde a distinção que a spec pediu). 2) manter os dois geradores em `EndDayDeps`, ou
mover a decisão lean/deep inteira para dentro de um único `HandoffGenerator` composto que recebe
os dois por injeção (mais indireção, sem ganho visível). 3) manter a reconstrução, ou persistir a
assinatura como campo novo (`evidenceSignature`) — exige decisão de nome antes de existir em
disco, como toda chave nova (AGENTS.md). 4) manter `readHandoff` fora do esboço, com a nota
"sketch desatualizado" já é o padrão do projeto; ou pedir aprovação para editar
`docs/ARQUITETURA.md` diretamente (exige o PO, por "Ordem de autoridade"). 5) manter vazio,
documentado; ou fazer `endDay` ler `forks.json` mesmo assim, por simetria com o resto do código,
mesmo sendo I/O comprovadamente inútil.


**Resposta:** **FECHADA — quatro confirmados, o primeiro muda.**

**1) `source: "noTranscript"` NÃO vence quando o modelo rodou e respondeu.** É o único que muda,
e o argumento é o campo vizinho: `source` e `sources[]` convivem no mesmo handoff, e o `sources[]`
**já** registra que o transcript não respondeu. Marcar `source: "noTranscript"` para uma captura
em que o modelo produziu entendimento de verdade não acrescenta informação — apaga.

O teste é a pergunta que o leitor faz primeiro: **"este handoff tem entendimento escrito pelo
modelo?"** Com a sua regra, um handoff que tem seria rotulado `noTranscript`, e quem varre a
lista o pularia.

O enum passa a descrever **a procedência da camada de entendimento**:
- `model` — o modelo produziu.
- `deterministic` — o modelo foi tentado e falhou; caiu para os fatos (D-003).
- `noTranscript` — o modelo **não foi chamado**, e o motivo foi ausência de transcript.

Hoje o terceiro provavelmente não é produzido, já que o gerador enxuto é chamado mesmo sem
transcript. **Isso é aceitável e honesto**: o valor existe na spec, e um enum com um caso ainda
não alcançado é melhor que um rótulo que mente sobre os outros dois.

**2) Dois geradores em `EndDayDeps`: confirmado.** A escolha enxuto/profundo depende de
`session.hasTranscript`, que só existe em tempo de execução. O `cli/` continua sendo a única raiz
de composição — instanciar duas classes em vez de uma não muda isso.

**3) Assinatura de evidência reconstruída dos fatos persistidos: confirmado**, e com uma
condição. Não inventar campo de disco fora da spec foi o certo (D-027). Mas isso amarra a
anti-duplicidade à **estabilidade da reconstrução**: se um dia os fatos persistidos deixarem de
permitir remontar a mesma assinatura, o D-026 passa a comparar coisas diferentes em silêncio.
Registre isso em comentário, apontando que virar campo em disco é a saída se acontecer.

**4) `Storage.readHandoff` além do esboço: confirmado.** Quarta vez que o esboço de
`ARQUITETURA.md` § Portas perde para uma restrição que a implementação descobriu (Q-012, Q-014,
Q-019, agora esta). E aqui o método não é conveniência: é ele que **verifica que o handoff está
em disco antes de terminar o processo** (D-002). Atualizo o esboço.

**5) `knownForks` sempre vazio: confirmado como observação, e vira comentário.** Você está certo
que as duas estratégias já excluem forks antes do `list()` devolver. O risco é de segunda ordem:
se um dia uma estratégia parar de excluir, a elegibilidade deixa de filtrar **sem nada falhar**.
Deixe escrito onde o conjunto é montado, para quem mexer saber que o filtro vive rio acima.

---

## Q-022 — Três escolhas feitas fazendo S2-T4 (briefing), registradas para confirmação

**Tarefa:** S2-T4
**Bloqueia:** não esta tarefa — segui com a solução mínima nos três casos (AGENTS.md: "abra a
questão e siga com a solução mínima").

**1) Nome do método de escrita: `Storage.saveBriefing`, que não está na tabela de
`AGENTS.md § Idioma`.** A tabela fixa `readBriefing` (reservado para S3-T1, ainda não
implementado) mas nunca nomeou o lado de escrita — a tarefa que introduziria esse método
(entender que seria esta) parece ter ficado de fora da fixação em S1-T0g. Escolhi `saveBriefing`
por ser exatamente o padrão já em uso duas vezes no mesmo arquivo: `saveHandoff`/`readHandoff` e
`saveEarlyWarningState`/`readEarlyWarningState`. Não inventei verbo novo; apliquei o par que já
existia com o substantivo que a tabela já reservou.

**2) `Storage` cresceu por um SEGUNDO bloco `export interface Storage { ... }`, mesclado pelo
TypeScript com o original, em vez de editado no corpo da interface já existente.** S1-T7 e S2-T3
cresceram esta mesma porta editando o corpo original diretamente — é o padrão do projeto até
aqui. Diverjo aqui porque `core/ports.ts` está sendo tocado por outra tarefa do mesmo sprint ao
mesmo tempo, e o histórico deste arquivo já registra merge quebrado por corte de conflito no meio
de uma interface mais de uma vez. Merge de interface do TypeScript deixa a adição inteiramente no
fim do arquivo, sem tocar o texto original — elimina essa classe de conflito, ao custo de a porta
`Storage` agora existir como dois blocos de texto em vez de um. Se isso for considerado estilo
ruim para o arquivo definitivo (depois que as duas tarefas convergirem), um commit de limpeza
depois pode fundir os dois blocos manualmente sem risco, já que o compilador já garante que o
resultado é idêntico.

**3) O briefing é montado a partir de `Storage#listHandoffs(day)` (uma releitura do disco), não a
partir do `EndDayResult` que o próprio `endDay` acabou de produzir em memória.** A
`docs/ESPECIFICACAO.md` diz "consolidando **todos** os handoffs" — não só os desta chamada. Como
`seeya end-day --session <id>` (S2-T5) ainda vai permitir capturar uma sessão de cada vez, uma
segunda chamada no mesmo dia precisa que o `summary.md` continue refletindo as sessões capturadas
antes. Reler do disco também é o que torna D-022 aplicável aqui pela primeira vez a handoffs (a
tabela de D-022 já cita "os handoffs lidos de `~/.seeya/`" como coleção externa a validar item a
item) — um handoff corrompido ou editado à mão nunca existiria no `EndDayResult` em memória, só
aparece relendo o arquivo.

**Opções que enxergo, por item:** 1) manter `saveBriefing`, ou aguardar confirmação do PO antes de
gravar em disco pela primeira vez (o nome do método não vai a disco, só a chave `summary.md`, que
já está fixada — risco baixo de errar para sempre). 2) manter os dois blocos mesclados, ou fundir
manualmente agora e aceitar o risco de conflito que a S2-T6 paralela poderia gerar. 3) manter a
releitura do disco a cada `endDay`, ou passar a montar o briefing a partir do `EndDayResult` em
memória e perder a consolidação entre execuções + a cobertura de D-022 para handoffs.

**Resposta:** (preenchida pelo PO)


**Resposta:** **FECHADA — dois confirmados, o segundo se desfaz assim que puder.**

**Antes dos três: o briefing ficou bom, e é o produto.** Ele trata as três armadilhas de
ausência que eu tinha nomeado, e trata em **prosa**, que é onde elas escapam mais fácil. O
`Evidence: git (missing: transcript, registry)` diz o que **não** respondeu em vez de omitir; o
handoff sem entendimento vem com "The model call failed during capture", deixando claro que
faltou entendimento e não trabalho; e o dia vazio diz "No sessions were captured today" — nada
foi **capturado**, não "nada foi feito".

**1) `saveBriefing`/`listHandoffs` fora do glossário: confirmado, e a lacuna era minha.** O
padrão `save<Nome>`/`read<Nome>` que você seguiu já estava estabelecido. Acrescentados agora.

**2) O `Storage` em dois blocos: aceito por hoje, e se desfaz depois.** Você fez isso para
obedecer minha instrução de não inserir nada no meio de interface enquanto outro agente mexia no
mesmo arquivo — a intenção foi certa e o resultado é engenhoso.

Mas a conta não fecha no prazo longo: **o risco de conflito expira hoje; o custo de leitura é
permanente.** Quem abrir a porta na linha 121 vê um retrato incompleto, sem nenhum sinal de que
há mais métodos 200 linhas abaixo. Fusão de declarações é recurso legítimo da linguagem e péssimo
lugar para esconder a forma de um contrato.

Consolido em um bloco só assim que a S2-T6 aterrissar. Não é crítica do que você fez — é a
segunda metade de uma decisão que só podia ser tomada depois.

**3) Reler os handoffs do disco em vez de usar o resultado em memória: confirmado, e pelos dois
motivos que você deu.** O segundo é o mais forte e eu não teria pensado nele: a validação por
item do D-022 **só morde no que volta do disco**. Um handoff corrompido nunca apareceria num
resultado em memória, então construir o briefing a partir dele deixaria a rejeição sem caminho
até o leitor — exatamente o contrato que atravessou o Sprint 1 inteiro.

E o primeiro motivo cobre o caso real de uma segunda execução com `--session` no mesmo dia.

---

## Q-023 — Duas escolhas feitas fazendo S2-T6 (limpeza de forks), sem resposta literal em D-012
**Tarefa:** S2-T6
**Bloqueia:** não — nenhuma bloqueou a entrega; registro para o PO confirmar ou corrigir, no mesmo
padrão de Q-012/Q-017/Q-019/Q-020/Q-021.
**Contexto:** D-012 fixa a regra de negócio ("forks com mais de `forkCleanupDays` são apagados") mas
não diz o que acontece com a **entrada em `forks.json`** depois, nem como tratar um fork registrado
cujo arquivo já não existe no disco. A tarefa pediu explicitamente para decidir as duas e escrever
o porquê.

**1) A entrada em `forks.json` é removida quando o arquivo é apagado com sucesso (ou já estava
ausente); é mantida quando a exclusão falha de verdade.** Alternativa descartada: nunca remover
entradas, só marcar como "processada" de algum jeito. Motivo da escolha: o registro existe
unicamente para sustentar a exclusão de D-012 (impedir que um fork seja redescoberto e refeito em
laço). Uma vez que o `.jsonl` não existe mais, não há mais nada em disco que a exclusão precise
proteger — nem a estratégia de registro nem a de varredura de transcript conseguem redescobrir um
arquivo que sumiu. Manter a entrada para sempre faria `forks.json` crescer sem limite e faria toda
execução futura tentar apagar um arquivo que já não existe. Já uma entrada cuja exclusão **falhou**
de verdade (erro real, não ausência) é mantida de propósito: é o único jeito de a próxima execução
tentar de novo, e removê-la aqui esconderia um fork que ainda ocupa espaço em
`~/.claude/projects/` sem ninguém saber. A reescrita do arquivo é atômica (`writeFileAtomic`,
mesmo mecanismo do S1-T5) e só acontece quando pelo menos uma entrada foi de fato resolvida —
uma passagem que não encontra nada para limpar nunca toca `forks.json`.

**2) Fork registrado com arquivo ausente não é erro — é o mesmo desfecho de "apagado com
sucesso" (`alreadyAbsent`), nunca interrompe a limpeza dos demais.** D-025 ("ausência de dado não
vira afirmação") aplicado aqui: o usuário pode ter apagado o arquivo à mão, e isso não é corrupção
nem falha do `seeya` — é exatamente o estado que a exclusão de D-012 gostaria de garantir de
qualquer forma. Tratar como erro faria uma limpeza manual do usuário aparecer como falha do
programa; tratar como "sucesso silencioso, sem remover a entrada" deixaria o registro crescendo
para sempre pelo mesmo motivo do item 1. A implementação (`adapters/discovery/fork-cleanup.ts`)
trata "`locateTranscriptFile` não encontrou nada" e "`unlink` falhou com `ENOENT`" como o mesmo
caso, e cada fork é resolvido de forma independente (`Promise.all` com `try`/`catch` por item,
D-022) — a falha real de um não impede a exclusão dos outros.

**Terceira decisão, correlata, sem pedido explícito na tarefa mas necessária para não violar
D-025:** uma entrada de `forks.json` sem `createdAt` (`ForkRegistryEntry.createdAt` é opcional,
Q-008) é sempre mantida (`kept`), nunca tratada como "óbvia candidata por não ter idade
comprovada". `core/fork-cleanup.ts#planForkCleanup` documenta o raciocínio: ausência de idade não é
evidência de idade, e apagar de forma irreversível com base numa suposição seria exatamente o erro
que D-025 nomeia.

**Opções que enxergo:** A) confirmar as três decisões acima como estão. B) para o item 1, manter a
entrada até o usuário rodar alguma limpeza manual de registro (não implementado hoje, não pedido
pela tarefa). C) para o item 2, tratar `alreadyAbsent` como uma categoria própria e visível
separada de `deleted` no retorno (já é — `ForkCleanupOutcome` é uma união discriminada com os dois
rótulos — mas cabe confirmar que "mesmo efeito sobre o registro, rótulo diferente no retorno" é o
nível certo de distinção).
**Resposta:** _(em aberto)_


**Resposta:** **FECHADA — as duas confirmadas, e a terceira que você não perguntou é a melhor.**

**A) Tirar a entrada quando o arquivo sumiu, manter quando a exclusão falhou: certo.** O critério
que você usou é o que importa — a entrada existe para o D-012 impedir **redescoberta**, e nada
que já não está em disco pode ser redescoberto. Manter a entrada de uma exclusão que falhou faz a
próxima execução tentar de novo, que é o comportamento certo para permissão negada ou arquivo
travado.

**B) Fork registrado com arquivo ausente não é erro: certo (D-025).** O usuário pode ter apagado
à mão, e a guarda do D-012 já está satisfeita de qualquer jeito.

**C) A que você decidiu sem eu perguntar: entrada sem `createdAt` é sempre mantida, nunca
presumida velha.** Essa é a melhor das três, e é D-025 numa forma que eu não tinha antecipado:
**ausência de idade não é evidência de idade**. Presumir velha apagaria arquivo por falta de
informação — e apagar é irreversível. A assimetria está certa: na dúvida, mantém.

**Sobre a contenção:** o instrumento é o certo. Instantâneo da árvore inteira com conteúdo **e**
mtime, afirmando que a única diferença é o fork obsoleto sumindo — com transcript de sessão real
e fork ainda no prazo saindo byte a byte idênticos. Numa tarefa que abre a **única exceção** do
projeto à regra de não tocar em arquivo do usuário, provar o que **não** foi tocado vale mais
que provar o que foi.

---

## Q-024 — As duas peças desligadas de S1-T7/S2-T6: uma ligada em `end-day`, a outra não

**Tarefa:** S2-T5
**Bloqueia:** não — as duas decisões seguiram, com o argumento abaixo; registro para confirmação.
**Contexto:** a tarefa pediu explicitamente para decidir onde ligar duas peças que ficaram prontas
e desligadas: os avisos precoces (S1-T7) e a limpeza de forks (S2-T6). Nenhuma das duas tinha
consumidor em `cli/` até aqui.

**1) Limpeza de forks (D-012) — ligada aqui, em `seeya end-day`.** `ForkCleanup` entrou em
`EndDayDeps` (campo obrigatório, não opcional — D-020 quer toda dependência explícita) e
`endDay()` chama `deps.forkCleanup.cleanup(config.forkCleanupDays)` como um passo próprio, depois
da captura e do briefing, isolado do resto do resultado (`EndDayResult.forkCleanup`/
`forkCleanupError`, no mesmo espírito de `failedCaptures`: uma falha na limpeza nunca invalida
capturas que já tinham sido gravadas com sucesso na mesma execução). O argumento decisivo é
literalmente o que a tarefa apontou: `end-day` é a única rotina diária que este produto já executa
— `seeya sessions`/`status` são diagnóstico sob demanda, sem cadência —, e D-012 fala em "forks com
mais de `forkCleanupDays`", uma condição pensada para ser reavaliada uma vez por dia, não a cada
consulta de diagnóstico.

**`--dry-run` NUNCA chama `cleanup()`, nem para pré-visualizar — só pula, com aviso explícito.**
Apagar o arquivo de um fork obsoleto é exatamente o tipo de escrita que `--dry-run` existe para
nunca fazer, e `ForkCleanup` não tem hoje um modo "só planejar" que leia `forks.json` sem apagar
nada — só a função pura `core/fork-cleanup.ts#planForkCleanup` decide isso, e ela não é alcançável
daqui sem duplicar a leitura de `forks.json` que `DiscoveryForkCleanup` já faz. Prefiro reportar
"pulado" a inventar um segundo caminho de leitura só para a pré-visualização. Se quiser um preview
de verdade aqui também, a peça que falta é dar ao port `ForkCleanup` um segundo método
somente-leitura — não fiz isso sem perguntar, por ser mudança de porta, não de fiação.

**2) Avisos precoces (D-018/D-029) — decidido que pertencem a `seeya sessions`, mas NÃO
implementado nesta tarefa.** D-018 é explícito: o aviso sai "assim que a sessão é vista", e "ver"
uma sessão é o que a descoberta faz — não o encerramento do dia. `seeya end-day` também descobre
sessões, mas só uma vez por dia (ou sob comando manual); `seeya sessions` é o comando que roda a
qualquer momento, inclusive de forma repetida ao longo do dia, exatamente o padrão "avisa a
primeira vez que vê, nunca de novo" que S1-T7 implementou. Ligar em `end-day` faria um usuário que
só roda `end-day` à noite descobrir às 21h que uma sessão está sem transcript desde as 9h da manhã
— o oposto do que D-018 quer ("quando ainda dá para reagir").

**Por que não implementei a fiação, mesmo concordando que é ali que ela pertence.**
`discoverEarlyWarnings` (S1-T7) grava `~/.seeya/early-warnings.json` quando há aviso novo — e
`docs/ESPECIFICACAO.md` § `seeya sessions` diz textualmente "Não escreve nada." As duas coisas
coexistem sob uma leitura (a que considero correta): "não escreve nada" descreve o **propósito**
do comando — ele não participa da escrita de dados de domínio (handoffs, config, `forks.json`) —,
e a marca de "já avisado" é bookkeeping de diagnóstico, do mesmo tipo que um log, não dado de
produto. Mas é uma leitura, não a única possível, e ligar isso muda o comportamento de um comando
já aprovado (S1-T6) e sua suíte de testes — six arquivos de teste (`sessions-command.test.ts`,
`composition.test.ts`, o e2e nº1, mais os testes unitários de `format-sessions`/`session-view`)
que não pediram esse escopo. Prefiro registrar a decisão com o argumento completo e deixar a
fiação para quem confirmar a leitura acima, a forçar uma mudança de contrato num comando de outra
tarefa dentro do orçamento desta.

**Opções que enxergo:** A) confirmar as duas decisões como estão — fork cleanup ligado em
`end-day`, avisos precoces decididos para `seeya sessions` mas ainda desligados. B) para os avisos,
pedir a fiação agora mesmo, como extensão desta tarefa. C) para a limpeza de forks, pedir o segundo
método somente-leitura em `ForkCleanup` para que `--dry-run` também pré-visualize a limpeza, em vez
de só reportar "pulado".
**Resposta:** _(em aberto)_

**Resposta:** **FECHADA — a primeira confirmada; na segunda concordo com o seu argumento e
discordo do seu destino.**

**1) Limpeza de forks no `end-day`: confirmado.** É a única rotina com cadência que o produto
roda. `sessions` e `status` são diagnóstico sob demanda, e pendurar manutenção neles significaria
que quem não os roda nunca limpa nada. E pular a limpeza inteira no `--dry-run`, em vez de
pré-visualizar, está certo: apagar arquivo é exatamente o que um ensaio não faz.

**2) Avisos precoces: seu argumento contra o `end-day` está certo e é decisivo.** Quem só roda
`end-day` à noite descobriria de manhã um problema da manhã — só à noite. Um aviso "precoce" que
chega no fim do dia não é precoce, é autópsia.

**Mas o `seeya sessions` também não é a casa.** Dois motivos, e o segundo é o que decide:

A tensão que você registrou é real, não interpretação — a `ESPECIFICACAO.md` diz que o `sessions`
**não escreve nada**, e `discoverEarlyWarnings` grava. Sua leitura ("não escreve dado de
domínio") é defensável, mas eu não quero resolver uma contradição de especificação por leitura
quando existe saída que não contradiz nada.

E o motivo mais forte: o `sessions` é **sob demanda**. Quem nunca o roda nunca é avisado — e o
usuário que mais precisa do aviso é justamente o que não fica inspecionando sessão.

**A casa é o daemon (S4-T3).** Ele é a única coisa no produto que **vê sessões continuamente**,
que é o que o D-018 quer dizer com "assim que a sessão é vista". Um aviso precoce precisa de
cadência, e o daemon é a cadência.

Isso também dissolve a tensão de especificação em vez de reinterpretá-la: o `sessions` continua
sem escrever nada. Se um dia fizer sentido ele **mostrar** avisos já registrados, mostrar é
leitura e não conflita.

**Você fez certo em não fiar.** Mudar o contrato de um comando já aprovado por conta própria
seria pior que deixar a peça desligada com o argumento escrito. Anotado na S4-T3.

**Sobre a limpeza sem modo somente-leitura:** aceito como está. O `--dry-run` dizer "skipped (a
dry run never deletes files)" é honesto e informa. Estender a porta para pré-visualizar exclusão
custa mais do que rende; se alguém pedir, vira decisão nova.

---

## Q-025 — S2-T8: uma terceira causa de vermelho no Windows CI, encontrada só medindo no runner

**Tarefa:** S2-T8
**Bloqueia:** não bloqueou a entrega — resolvida com a mesma técnica já usada para a primeira
causa —, mas registro porque muda a contagem que a própria tarefa afirmava ("duas causas
distintas") e porque a correção alcança dois arquivos de teste que a tarefa não citava.

**Contexto.** A tarefa nomeava duas causas para o CI vermelho só no Windows, as duas medidas na
máquina de desenvolvimento. Depois de corrigir a primeira (compilar o shim `.exe` uma vez por
execução via `globalSetup`, não uma vez por arquivo de teste — `tests/integration/generation/
_windows-shim-global-setup.ts`) e abrir um PR de rascunho só para medir no runner de verdade
(`gh run watch`, autorizado pela própria tarefa), o Windows **ainda** ficou vermelho — mas num
teste que nenhuma das duas causas descritas explica: `tests/integration/cli/composition.test.ts
> buildCliContext > the real ProcessControl reports this test process itself as alive`, com
"Test timed out in 5000ms" (o padrão do vitest, esse teste nunca teve orçamento explícito).

**Achado.** O único passo lento desse teste é `captureObservedProcStart` no Windows
(`src/adapters/process/proc-start.ts#captureWindows`), que spawna
`powershell.exe -NoProfile -Command "(Get-Process -Id <pid>).StartTime.ToFileTimeUtc()"` — um
processo real, não um fake. `tests/integration/process/liveness.test.ts` (mesma função) e o bloco
Windows de `termination.test.ts` (via `console-signal.ts`) chamam o mesmo binário. Num runner
recém-iniciado, a **primeira** vez que `powershell.exe` sobe paga um custo real de carregar
`System.Management.Automation.dll` e afins do disco — a mesma forma de problema que o `csc.exe`
do shim, e pela mesma razão que S1-T13/S2-T7 já tinham medido esse binário como caro no bloco
Windows de `termination.test.ts`: ali o custo já estava embutido num orçamento generoso, mas
`composition.test.ts` nunca teve orçamento nenhum, porque nunca tinha sido medido sob a mesma
lente.

**Conserto aplicado (mesma família B da causa 1): aquecer `powershell.exe` uma vez, em
`globalSetup`, antes de qualquer worker subir** — `tests/integration/process/
_powershell-warmup-global-setup.ts`, adicionado ao `globalSetup` do projeto `integration` ao lado
do do shim. O comando executado (`exit`) não importa; o custo que se está pagando de propósito é
subir o processo `powershell.exe`, não um cmdlet específico. Isso remove a loteria de "qual
arquivo de teste chega primeiro no binário frio" para os três consumidores
(`composition.test.ts`, `liveness.test.ts`, `termination.test.ts`) de uma vez, em vez de dar
orçamento explícito a cada um separadamente.

**Por que registro em vez de só consertar e seguir.** A tarefa afirmava "duas causas distintas,
as duas medidas". Era uma afirmação factual específica, e uma terceira causa real a contradiz —
não é uma opção de design em aberto, é a premissa "eu já sei quais são as causas" tendo saído
incompleta mesmo depois de pedir medição no lugar certo. Reporto para quem escreveu a tarefa
confirmar que o raciocínio (cold-start de processo real, não código deste projeto) está certo, e
não é só uma tampa nova sobre um sintoma diferente.

**Opções que enxergo:** A) aceitar o aquecimento único como está, cobrindo os três consumidores
atuais de `powershell.exe`. B) além do aquecimento, dar a `composition.test.ts` e a
`liveness.test.ts` um orçamento explícito próprio (hoje seguem no default do vitest), como
segunda camada de margem caso o aquecimento por algum motivo não baste num runner ainda mais
lento. C) mover o aquecimento para fora do projeto `integration` (por exemplo, um `globalSetup` na
raiz do `vitest.config.ts`, compartilhado por `unit`/`guards` também), caso apareça um quarto
consumidor de `powershell.exe` fora de `tests/integration/`.
**Resposta:** **FECHADA — o aquecimento sobe para a raiz (opção C). Orçamento continua no
default, avaliado caso a caso (nem A puro nem B).**

Seu raciocínio sobre o aquecimento está certo e é o motivo certo: enquanto ele estiver preso ao
projeto `integration`, todo teste novo que tocar `powershell.exe` reabre esta decisão do zero. E
`powershell.exe` é alcançável a partir de `src/adapters/process/` em geral — não há nada que
prenda um consumidor futuro a `tests/integration/`.

**Medido antes de mexer (duas sondas descartáveis, apagadas depois):**

- um `globalSetup` declarado na **raiz** roda para um projeto que não declara nenhum;
- raiz e projeto **coexistem** — os dois disparam, o da raiz não substitui o do projeto.

Então o aquecimento foi para `tests/_powershell-warmup-global-setup.ts`, na raiz do
`vitest.config.ts`, e passa a valer para `unit`, `guards`, `e2e`, `contract` e para qualquer projeto
que venha depois — sem passo de fiação que alguém possa esquecer. O irmão dele, o shim de
`csc.exe`, **não** foi junto de propósito: aquele custa segundos (compila), não milissegundos, e
o único consumidor dele é um fixture que é estruturalmente de integração.

**Agora a parte que você disse não conseguir julgar sozinho: o default basta?**

**Basta — e com folga de ~7×.** Achei a medição por teste que já existe no próprio CI: uma
execução da S2-T8 rodou um passo temporário com `--reporter=verbose` no `windows-latest`, **com o
aquecimento já em vigor**:

| teste (Windows CI, aquecido) | duração |
| --- | --- |
| `composition.test.ts > the real ProcessControl reports this test process itself as alive` | **723ms** |
| `liveness.test.ts > real procStart capture round-trips` | 648ms |
| `liveness.test.ts > the captured procStart matches this platform's documented shape` | 437ms |
| `liveness.test.ts > a live PID with a genuinely divergent procStart` | 331ms |

O primeiro é **exatamente o teste que estourou os 5000ms** e abriu esta questão. Aquecido, ele
gasta 723ms.

Conferi que não foi sorte de uma execução: nas 8 execuções verdes mais recentes do
`windows-latest`, o arquivo inteiro fica entre **762ms e 2495ms** (`composition`, 7 testes) e entre
**1488ms e 2460ms** (`liveness`, 5 testes). O total do arquivo é limite superior rígido para
qualquer teste dentro dele — o pior arquivo observado ainda cabe em metade do default.

**Por isso não entra orçamento explícito, e a razão importa mais que a conclusão.** Um orçamento
em cima de 723ms medidos seria um número inventado sem medição que o sustente — a mesma coisa
que a Q-026 acabou de tirar do código. Sua regra ("avaliar caso a caso, fugir do default só
quando aquele caso pedir") é a certa, e este caso não pede: ele já **é** o default com folga.

**A dependência que precisa ficar explícita.** Essa folga de 7× existe **por causa do
aquecimento**. Frio, o mesmo teste passou de 5000ms — não é hipótese, é a falha medida que
gerou esta questão. Ou seja: "o default basta" é uma afirmação **condicionada** a o aquecimento
rodar. É por isso que ele tinha mesmo que sair do projeto e ir para a raiz: a condição precisa
valer em todo lugar, automaticamente, e não por alguém lembrar de ligar.

**O que fecha a porta para a decisão reabrir.** Com o aquecimento na raiz não existe mais passo
de fiação para um teste novo perder — a única forma de perdê-lo é apagar a linha da raiz, que é
ato deliberado, não esquecimento. Por isso **não** acrescentei um teste de guarda para vigiar a
fiação: não sobrou fiação para vigiar.

**Custo de cobrir quem não precisa:** uma subida quente de `powershell.exe` por execução —
**~450ms** medidos nesta máquina Windows (5 repetições: 459/420/463/476/487ms), no-op no POSIX.
Barato perto dos >5s que o caminho frio produziu.

**Sobre a contagem que a S2-T8 errou:** sim, o raciocínio está certo — cold-start de processo
real, não código deste projeto. A tarefa afirmava "duas causas distintas, as duas medidas", e
eram três. A terceira só apareceu medindo no runner, que é o lugar onde a afirmação podia ser
checada. Fica registrado como o que era: uma premissa minha entregue incompleta, não uma
medição do agente que falhou.

---

## Q-026 — S3-T1: o que "briefing mais recente que ainda tem pendências" significa, sem estado de "retomado"

**Tarefa:** S3-T1
**Bloqueia:** não — segui com a solução mínima documentada abaixo (AGENTS.md: "abra a questão e
siga com a solução mínima"), mas as duas escolhas são behaviorais (não só nomes de disco) e a
tarefa pediu explicitamente para registrar o raciocínio aqui.

**Contexto.** `docs/ESPECIFICACAO.md` § `seeya start-day` diz, sem definir: "Lê o briefing mais
recente que ainda tem pendências." A própria tarefa levantou duas perguntas sem resposta literal:

1. "Mais recente" é o mais recente que existe, ou o mais recente **ainda não retomado**? O passo
   5 ("marca o briefing como retomado") sugere que existe estado de retomada — mas esse estado
   **não existe em lugar nenhum hoje**. Nada persiste "este dia já foi retomado": `DayState`
   (S4-T2) ainda não existe, e implementar essa marcação é o passo 5, fora do escopo desta
   tarefa (S3-T2/S3-T3 seguem no plano). Inventar uma chave nova em disco só para viabilizar essa
   distinção agora seria exatamente o risco que D-027 pede para evitar ("chave que vai para disco
   é barata agora e cara depois") — e faria esta tarefa decidir sozinha um formato que pertence à
   tarefa que de fato vai gravá-lo.
2. Um briefing de três semanas atrás ainda é "pendente"? Retomar um handoff tão velho como se
   fosse de ontem pode ser pior que não retomar (`cwd` pode ter mudado, branch pode ter sumido).

**Decisão 1 — "ainda tem pendências" é uma pergunta sobre CONTEÚDO, não sobre bookkeeping.**
`core/pending-briefing.ts#handoffStillPending`: um handoff com `source !== "model"`
(`"deterministic"` ou `"noTranscript"`) **sempre** conta como pendente, não importa quão vazios
estejam `pendingItems`/`tomorrowPlan` — porque esses campos vêm vazios por *falha* nesse caso
(`application/generation-policy.ts`), não por um veredito real do modelo. Só um handoff
`source: "model"` — onde o modelo foi de fato perguntado e respondeu — pode contar como resolvido,
e só quando ele **explicitamente** não relatou nada pendente. Isso é D-025 aplicado literalmente:
ausência de veredito não é veredito de "concluído". Consequência prática: reexecutar
`seeya start-day` no mesmo dia, sem que nada tenha sido marcado como retomado ainda, encontra o
mesmo briefing de novo — esse é o gap que o passo 5, fora desta tarefa, fecha depois.

**Decisão 2 (texto original, revogado pelo PO — ver Resposta abaixo) — a busca era limitada a
`MAX_BRIEFING_LOOKBACK_DAYS = 7` dias** (`application/find-pending-briefing.ts`), o mesmo número
já usado neste projeto para "até quando uma evidência velha ainda vale a pena agir em cima"
(`Config.forkCleanupDays`, default 7, D-012) — em vez de inventar um segundo número não
relacionado só para isto. Passado esse horizonte, "nenhum briefing pendente" era a resposta
(aceite #5: caso normal, não erro), não esticar a busca para achar *algo*.

**O que ficou explicitamente ambíguo, sem solução minha:** não sei se 7 dias é o número certo do
ponto de vista de produto — é uma analogia com `forkCleanupDays`, não uma medição ou uma regra da
spec. Também não sei se a definição de "pendência" deveria olhar além de
`pendingItems`/`tomorrowPlan` — por exemplo, um `sessionState` que não é `ended`, ou git sujo sem
commit — mas isso exigiria inventar uma segunda noção de "pendente" (nível de sessão) além da que
já existe implicitamente no vocabulário do handoff, e preferi não fazer isso sem confirmação.

**Opções que enxergo:** 1) manter a busca puramente por conteúdo (como está), ou bloquear esta
tarefa até S4-T2 (`DayState`) existir e usar um flag "retomado" de verdade — mas isso empurraria
S3-T1 para depois de S4-T2, fora da ordem do plano. 2) manter os 7 dias por analogia com
`forkCleanupDays`, ou escolher outro número (ex.: 3, alinhado a "um fim de semana normal sem
rodar `seeya`") — não tenho medição para decidir entre os dois. 3) manter "pendência" só como
`pendingItems`/`tomorrowPlan`/ausência de veredito do modelo, ou ampliar para considerar
`sessionState`/git sujo também.
**Resposta:** **FECHADA — a regra de conteúdo é confirmada como interina; o corte de 7 dias sai.**

**1) Handoff com `source !== "model"` sempre conta como pendente: certo, e é D-025 bem aplicado.**
Um `pendingItems` vazio num handoff determinístico é artefato do caminho de falha, não veredito.
Ninguém analisou; concluir "não sobrou nada" a partir disso seria transformar ausência de análise
em afirmação de conclusão — exatamente o que o D-025 nomeia.

**Mas é interina, e isso precisa ficar escrito para não virar permanente por acidente.** A regra
existe porque **ainda não há marcação de "retomado"** — o passo 5 da especificação. Enquanto não
houver, um handoff determinístico fica pendente para sempre, mesmo que a pessoa tenha retomado e
concluído. Quando a S3-T3 introduzir a marcação, "pendente" passa a ser **não retomado E com
conteúdo**, e esta regra deixa de carregar sozinha o peso.

**2) O corte de 7 dias sai, e o motivo é o seu próprio aviso: é analogia, não medição.** Você
tirou o número do `forkCleanupDays`, que existe para outra coisa — apagar arquivo velho, onde
errar para mais custa disco e errar para menos custa dado. Aqui a conta é outra.

Pense em quem volta de duas semanas de férias. O briefing de antes da viagem **é** onde a pessoa
parou; descartá-lo por idade não a protege de nada — só esconde a única coisa que responderia
"onde eu estava?". E retomar trabalho antigo é decisão dela, não nossa.

**A regra passa a ser: sem corte de produto por idade — ache o briefing pendente mais recente e
diga a idade dele quando não for de ontem.** Superfície de exibição resolve o risco melhor que
omissão — o usuário vê "3 semanas atrás" e decide.

Mantenha um limite **de varredura**, para não caminhar disco indefinidamente. Escolha um número
generoso (30 dias serve) e escreva no comentário que ele é **limite de E/S, não julgamento de
produto** — a diferença importa para quem for mexer depois.

**3) Se "pendente" deveria pesar `sessionState` ou árvore suja:** não agora. `pendingItems` e
`tomorrowPlan` são o que o handoff **afirma** sobre o que falta; árvore suja é indício e pode ser
lixo esquecido. Misturar os dois torna a regra difícil de explicar sem melhorar a resposta.

**Como ficou implementado.** `findPendingBriefing` acha o pendente mais recente a qualquer
distância e devolve `daysAgo`; `MAX_BRIEFING_SCAN_DAYS` (30) é limite de varredura, rotulado no
código como E/S e não julgamento de produto. Um pendente mais velho que a varredura devolve
`found: false` **com `daysSearched`** — a função é honesta sobre o próprio alcance em vez de
afirmar que não existe nada (D-025).

**Nota à parte, para não se perder:** o `Storage` ganhou um segundo bloco
`export interface Storage {}` mesclado porque a minha orientação ("aditivo no fim do arquivo")
não dava caminho para acrescentar **método a interface que já existe** — a instrução estava
incompleta, a execução não. Já corrigida no `FLUXO-DE-AGENTES.md`. A consolidação dos dois
blocos acontece quando a S3-T2 aterrissar, que está com o `ports.ts` em paralelo.

## Q-027 — Seis escolhas feitas fazendo S3-T2 (retomada), registradas para confirmação
**Tarefa:** S3-T2
**Bloqueia:** não — a tarefa foi entregue com a solução mínima em cada ponto; registro no mesmo
padrão de Q-017/Q-019/Q-021/Q-022/Q-023.
**Contexto:** D-004 e D-015 (corrigida por docs/spikes/H-retomada-interativa.md) dão a forma geral
do mecanismo de retomada, mas várias escolhas de nome e de comportamento não têm resposta literal
em nenhum documento.

**1) Nomes novos, ainda fora do glossário de `AGENTS.md`:** porta `SessionResumer`/método
`resume`, tipos `ResumeOutcome`/`ResumeFallbackReason`, adapter `ClaudeSessionResumer`
(`adapters/resumption/`). Escolhidos para ecoar o padrão já existente (`HandoffGenerator`/
`generate`, `GitReader`/`readFacts`) em vez de inventar uma forma nova. `resumption` como nome de
diretório (não `retomada` nem `resume`) segue a mesma tradução fixa que `discovery`/`generation`/
`transcript` já usam para os outros substantivos de adapter.

**2) O teto de tamanho do argumento (`RESUME_PROMPT_ARG_LIMIT_CHARS = 4096`) é uma constante de
`adapters/resumption/args.ts`, não uma chave de `config.json`.** Alternativa descartada: torná-lo
configurável. Motivo: é um limite técnico do SO (linha de comando do Windows), não uma preferência
de produto — o mesmo raciocínio que mantém `FAST_FAILURE_GRACE_MS` como constante de código, não
como config.

**3) O fallback usa `--append-system-prompt-file`, nunca `--system-prompt-file`.** Os dois existem
no binário (achados no Spike H, nenhum documentado em `--help`) mas têm semânticas diferentes:
`--system-prompt-file` SUBSTITUI o prompt de sistema padrão do Claude Code inteiro;
`--append-system-prompt-file` só adiciona. Substituir o padrão poderia remover comportamento que o
usuário espera de qualquer sessão nova do `claude`; `seeya` não tem negócio nenhum decidindo isso.

**4) O "resumeFailed" nunca tenta distinguir a causa (sessão expirada vs. projeto movido, as duas
que D-004 cita por nome).** Com `stdio: 'inherit'`, `seeya` nunca lê o stderr real do `--resume`
que falhou — ele foi para a tela do usuário, não para um pipe. D-025 aplicado: nomear uma causa
específica sem ter como confirmá-la seria inventar precisão que a evidência (só o código de saída)
não sustenta. O aviso (`core/resume-notice.ts`) diz "não foi possível retomar", com o código de
saída, nunca "sessão expirada" nem "projeto movido".

**5) Uma falha rápida (`failedFast && exitCode !== 0`) do PRÓPRIO fallback lança exceção, em vez de
devolver um `ResumeOutcome` alegando que uma sessão nova abriu.** Não há terceiro mecanismo para
tentar: se o mesmo binário falha das duas vezes com o mesmo `cwd`, o problema é de infraestrutura
(binário ausente do PATH, `cwd` que sumiu de verdade) e mentir dizendo "sessão nova aberta" violaria
D-025 aplicado a uma ação, não a um fato. Quem chama (`cli/`, na S3-T3) decide o que fazer com a
exceção — provavelmente parar de tentar as sessões seguintes de `--all` e reportar, mas essa
decisão pertence à S3-T3, não a esta tarefa.

**6) O período de graça contra falha rápida (`FAST_FAILURE_GRACE_MS = 5000`) é o mesmo para a
tentativa de `--resume` e para a tentativa de fallback**, mesmo as duas tendo perfis de risco
diferentes (a primeira pode falhar por sessão inexistente; a segunda, teoricamente, só por
problema de infraestrutura). Não há medição que justifique dois números diferentes, e um só
constante é mais simples de explicar e de testar.

**Opções que enxergo:** A) confirmar as seis como estão. B) para o item 3, cogitar que
`--append-system-prompt-file` é um flag não documentado e pode mudar de comportamento entre
versões sem aviso — vale um teste de contrato (`npm run test:contrato`) que confirme a semântica
"append, não replace" contra o `claude` real da máquina, não coberto ainda por nenhuma suíte. C)
para o item 4, se algum dia `seeya` capturar stderr por outro canal (por exemplo, um modo
`--dry-run` de retomada que não herda TTY), reconsiderar se um terceiro `ResumeFallbackReason` mais
específico vale a pena então — não antes, para não guardar código especulativo.
**Resposta:** **FECHADA — 2, 5 e 6 confirmadas como estão; 3 confirmada com teste de contrato
a fazer; 4 confirmada e só reavaliada se algum dia fizer sentido; 1 confirmada, com uma decisão
nova escrita por trás dela (D-030).**

**3) `--append-system-prompt-file`: confirmado, e pelo motivo que você deu.** O comportamento
padrão do Claude Code é mantido e o plano só **acrescenta** informação. Substituir o prompt de
sistema inteiro seria o `seeya` decidindo, sem pedir, que a sessão de fallback abre sem o
comportamento que a pessoa espera de qualquer sessão.

**O teste de contrato entra.** Os dois flags foram achados varrendo strings do binário e
**nenhum aparece no `--help`** — a semântica está medida hoje, na 2.1.235, e pode mudar numa
versão sem aviso nenhum. Entra no plano como tarefa própria (S3-T4), na suíte de contrato, que é
exatamente a suíte que existe para casar suposição nossa com binário real.

**Escopo do que o fallback é, porque isso define o alcance do item 3.** O fallback dispara em
**duas** situações: prompt acima do teto (`promptTooLarge` — o `--resume` nem é tentado) e
`--resume` que fechou dentro dos 5s de graça com código ≠ 0 (`resumeFailed`). Nos dois casos ele
é o **mesmo** mecanismo: sessão nova no mesmo `cwd`, sem histórico, com o plano viajando por
arquivo. O item 3 só toca esse caminho.

**4) Não distinguir a causa do `resumeFailed`: confirmado, e revisitado só se fizer sentido.** A
evidência disponível é código de saída e tempo; nomear "sessão expirada" ou "projeto movido"
seria precisão inventada (D-025). Se algum dia existir um canal que leia o stderr de verdade,
a conversa se reabre — não antes, para não guardar código especulativo.

**1) `ClaudeSessionResumer`: o nome fica, e a razão é que a costura agnóstica já existe — ela é
a porta, não o nome da classe.**

`core/ports.ts` declara `SessionResumer` sem citar claude em lugar nenhum. `ClaudeSessionResumer`
é o **adaptador**, nomeado pelo que ele de fato amarra. Esse é o padrão hexagonal já aplicado, e
é o mesmo dos outros cinco adaptadores do projeto.

**Renomear para `HarnessSessionResumer` deixaria o nome menos exato, não mais agnóstico:** a
classe spawna `claude --resume`, usa `--append-system-prompt-file` e depende de flags achados
varrendo o binário. Chamar isso de "Harness" esconderia justamente o que ela é.

**E uma classe-base `HarnessResumer` com uma subclasse só é a abstração que eu recusaria** — e
não só por ser especulativa: é provavelmente a **costura errada**. O que muda entre harnesses
não é um algoritmo comum com dois ganchos; é se `--resume` existe, como sessão é identificada, se
dá para reatar sessão. Um segundo harness não compartilharia quase nada com este — exceto a
assinatura da porta, que ele já ganha de graça implementando `SessionResumer`. Quando o segundo
chegar, o movimento é **um segundo adaptador escolhido no `cli/`** (D-020), não herança.

**Mas o seu ponto de fundo está certo, e fui ver onde ele morde de verdade.** Auditei
`src/core/` atrás de vazamento de harness. O vocabulário de tipos já é neutro
(`SessionProvider`, `TranscriptReader`, `HandoffGenerator`, `SessionResumer`, `ProcessControl`,
`Storage`). Só **dois** pontos citam claude no núcleo, e os dois em **texto para humano**, nunca
em tipo, ramo de decisão ou caminho de arquivo:

- `core/early-warnings.ts` — conselho que nomeia `CLAUDE_CODE_SKIP_PROMPT_HISTORY` e
  `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE`;
- `core/resume-notice.ts` — "the original session could not be resumed (claude exited with...)".

Ficam como estão: são texto de aviso, e hoje existe exatamente um harness. O que **não** pode
ficar implícito é a fronteira — por isso escrevi a **D-030**, que registra onde está a costura,
o que o núcleo pode e não pode citar, e que a chegada de um segundo harness é um adaptador novo,
não uma hierarquia. Sem isso escrito, alguém renomeia o adaptador "para ficar genérico" daqui a
três meses e a costura some.

**2, 5 e 6: confirmadas como estão.** Teto como constante e não config (limite de SO, não
preferência de produto — mesmo raciocínio que a Q-025 acabou de usar para o orçamento de teste);
falha rápida do próprio fallback lança em vez de mentir que abriu sessão; um período de graça só,
porque não há medição que sustente dois.

---

## Q-028 — Cinco escolhas feitas fazendo S3-T3 (`seeya start-day`), registradas para confirmação
**Tarefa:** S3-T3
**Bloqueia:** não — a tarefa foi entregue com a solução mínima em cada ponto; registro no mesmo
padrão de Q-017/Q-021/Q-022/Q-023/Q-027.
**Contexto:** a especificação e as decisões que o mantenedor passou para esta tarefa (passo 5 por
sessão, seleção interativa por `node:readline/promises`, laço para no primeiro `resume()` que
lança) dão a forma geral, mas várias escolhas de nome e de comportamento não têm resposta literal.

**1) Formato de `~/.seeya/days/<day>/resumed.json`: `{ schemaVersion, sessionIds: string[] }`.**
Nome novo em disco (`resumed.json`, `sessionIds`), ainda fora da tabela "Identificadores que vão
para disco" de `AGENTS.md` § Idioma — mesmo padrão não-bloqueante que Q-005/Q-013 já usaram para
`deepCapture`/`forkCleanupDays`, e que S1-T7 usou para `early-warnings.json`. Escolhido em vez de
(a) um campo dentro do próprio handoff — o handoff é escrito uma vez, no `end-day`, por um comando
diferente, e reabrir/reescrever cada um dos arquivos de um dia só para marcar uma sessão tocaria
documentos que `start-day` não tem outro motivo para escrever — e em vez de (b) um arquivo por
sessão — um conjunto pequeno, lido e regravado inteiro, é mais simples que N arquivos pequenos para
o que é, no máximo, um punhado de sessões por dia.

**2) `saveResumedSessionIds` grava o conjunto INTEIRO, não incrementa.** Mesmo desenho de
`saveEarlyWarningState`: quem decide o que é novo e quando persistir é `application/start-day.ts`
(lê o conjunto atual, acrescenta o `sessionId` que acabou de terminar, grava o conjunto todo) — a
porta `Storage` não tem lógica de diff, só persiste o que recebe.

**3) `--session` casa contra TODOS os handoffs do briefing, não só os ainda não retomados.** Uma
sessão já marcada resumida pode ser re-selecionada explicitamente por `--session <id>` — intenção
explícita vence o filtro de conveniência que `--all`/a seleção interativa usam por padrão, mesma
convenção que `end-day --session` já segue (pode recapturar uma sessão já capturada hoje). Um
`--session` sem match sai com código 0 e mensagem, não erro — consistência com
`end-day-command.ts#formatNoMatchMessage`, não uma leitura literal de nenhum documento.

**4) `--session` vence `--all` quando os dois são passados juntos.** O `commander` não impede
digitar as duas flags ao mesmo tempo; escolhida a interpretação "pedido mais específico vence",
sem outra base documentada.

**5) Resposta inválida no seletor interativo não tenta de novo — reporta o problema e não retoma
nada.** Alternativa descartada: um laço de nova pergunta até receber algo válido. Escolhida a
solução mínima porque a spec não menciona novas tentativas, e um laço de I/O interativo é mais uma
coisa para testar sem ganho óbvio na v1 — a pessoa só roda `seeya start-day` de novo.

**Opções que enxergo:** A) confirmar as cinco como estão. B) para o item 1, se `resumed.json`
ganhar leitor fora deste projeto algum dia, reconsiderar o par `save<Nome>`/`read<Nome>` — não
antes. C) para o item 5, se um retorno real de usuários mostrar que digitar errado é comum, um
laço de nova tentativa vira tarefa própria.
**Resposta:** **FECHADA — 1, 2, 3 e 4 confirmadas como estão. A 5 muda: sem laço, mas a saída
precisa dizer que abortou.**

**1) O formato do `resumed.json`:** confirmado, e as duas alternativas foram descartadas pelos
motivos certos. Um campo dentro do handoff faria o `start-day` reabrir e reescrever documentos
que ele não tem outro motivo para tocar — o handoff é escrito uma vez, por outro comando. E um
arquivo por sessão seria N arquivos para o que é, no máximo, um punhado por dia. Os nomes novos
já foram dobrados na tabela de identificadores de disco do `AGENTS.md`.

**2) Gravar o conjunto inteiro em vez de incrementar:** confirmado. Mantém a porta `Storage` sem
lógica de diff, igual ao `saveEarlyWarningState`. Quem decide o que mudou é a camada de
aplicação, que é onde essa decisão pode ser testada sem disco.

**3) `--session` casando contra todos os handoffs, inclusive já retomados:** confirmado.
Intenção explícita vencendo filtro de conveniência é a regra certa, e é a mesma que o
`end-day --session` já segue. E sim, sem match sai com 0 — não é erro, é um pedido que não
encontrou alvo.

**4) `--session` vencendo `--all`:** confirmado. Pedido mais específico vence o mais amplo.

**5) Resposta inválida no seletor: sem laço, mas a mensagem muda.** O mantenedor confirmou que
**não quer retentativa** — a pessoa roda `seeya start-day` de novo. Mas pediu, com as palavras
dele, que a saída diga **explicitamente que a resposta foi inválida e que o comando foi
abortado**.

O que falta hoje é a **segunda metade**. A mensagem atual explica o formato esperado
(`"x" is not a valid option (expected a number from 1 to 3, "all", or blank for none)`) e não diz
a consequência. Para quem acabou de ver uma lista de sessões na tela e digitou algo, **"nada foi
retomado" não é óbvio** — dá para ficar em dúvida se o comando seguiu com alguma escolha parcial.
Duas informações, não uma: não entendi, e por isso não retomei nada.

**E uma terceira, sugerida por ele: apontar o `--help`.** É barato e explicativo — quem errou a
resposta do seletor provavelmente também não sabe que `--all` e `--session` existem e evitariam
a pergunta inteira. Melhor que repetir a sintaxe aceita numa mensagem de erro cada vez mais
longa: a mensagem diz o que houve, e o `--help` carrega o resto, que já é mantido em um lugar só.

**O código de saída continua 0, e essa parte é decisão minha, não pedido dele.** É o mesmo que o
`--session` sem match devolve (item 3 acima); um código diferente aqui criaria duas convenções
para "não fiz nada" dentro do mesmo comando. O argumento contrário — abortar não é o mesmo que
concluir sem trabalho — é legítimo, e fica registrado aqui em vez de descartado: se aparecer
razão concreta, muda numa tarefa própria.

Encaminhado à **S3-T6**, que é dona de `cli/start-day-command.ts` e `cli/format-start-day.ts` —
a mudança é de texto de saída, e a S3-T5 foi instruída a não tocar nesses arquivos.

---


---

## Q-029 — Resultado do teste de contrato de `--append-system-prompt-file` (S3-T4)
**Tarefa:** S3-T4
**Bloqueia:** não — a tarefa foi entregue; registro do que foi medido e das duas limitações que o
teste não cobre, no mesmo padrão de Q-017/Q-021/Q-022/Q-023/Q-027/Q-028.

**Resultado, em uma linha: a distinção "append, não replace" É observável de fora, e agora o teste
tem o braço negativo que fecha o argumento de verdade — o review do mantenedor pegou, com razão,
que a primeira versão só tinha o braço positivo, e "os dois fatos chegam" é compatível com as duas
semânticas até alguém medir o que o replace de fato faz.**

**O que foi medido (claude 2.1.251, mais nova que a 2.1.235 do Spike H — já é sinal de que a versão
instalada muda sem aviso, exatamente o risco que a tarefa existe para cobrir).**

1. `claude --help` nesta máquina: nenhum dos dois flags (`--append-system-prompt-file`,
   `--system-prompt-file`) tem entrada própria — igual ao Spike H. **Achado novo:** agora existe
   uma menção **indireta**, dentro da descrição do flag `--bare`: "Explicitly provide context via:
   `--system-prompt[-file]`, `--append-system-prompt[-file]`, ...". Isso é mais fraco que
   documentado — não há descrição do que a variante `-file` faz sozinha, só confirmação de que ela
   existe como forma aceita. Não muda a conclusão da S3-T4 (a semântica continua não-documentada),
   mas vale registrar para quem for reler o Spike H achando que "nenhum aparece" ainda é
   literalmente verdade em toda leitura do `--help`.

2. **Método usado, com o braço negativo:** três chamadas reais de `claude -p` por execução do
   teste (nunca mais, ver comentário no topo do arquivo) — uma sem flag nenhum (controle), uma com
   `--append-system-prompt-file <arquivo>` (o caso real), e uma com `--system-prompt-file
   <arquivo>` (o flag que de fato SUBSTITUI — o braço negativo que faltava). As três pedem, no
   mesmo turno, duas coisas via `--json-schema`: (a) o nome do produto de CLI em que o modelo está
   rodando, e (b) o token secreto anexado (`SEEYA-CONTRACT-K7QF2`). `--no-session-persistence` +
   `--max-budget-usd 0.10` limitam custo e não deixam sessão persistida; `cwd` é `mkdtemp`
   descartável em `%TEMP%`; ambiente saneado reaproveitando
   `adapters/generation/env.ts#buildGenerationEnv(..., 'lean')` (mesma lista D-017, sem duplicar).

3. **Resultado, com `--model haiku`: o braço negativo discrimina.** Controle (sem flag) e
   `--append-system-prompt-file`: nome do produto = "Claude Code". `--system-prompt-file`
   (replace): nome do produto = `UNKNOWN`, marcador ainda presente (`SEEYA-CONTRACT-K7QF2`) — ou
   seja, o conteúdo do arquivo chegou nos dois casos, mas o fato do prompt padrão só sobreviveu
   no caso append. **Isto é a prova que faltava**: o observável realmente discrimina entre as duas
   semânticas, porque foi medido o que o replace faz de verdade, não só assumido a partir do nome
   dos flags.

4. **Achado grande e não previsto: `--model sonnet` NÃO discrimina, e por um motivo sério.**
   Medido uma vez, com as três chamadas: (a) custo disparou para ~US$0,13 por chamada — acima do
   teto de US$0,10 — e duas das três chamadas (controle, append) saíram com
   `error_max_budget_usd` antes de completar. A causa aparece no `modelUsage` bruto: `--model
   sonnet` aqui passa por uma chamada interna de classificação em `claude-haiku-4-5-*` **antes**
   do turno de verdade em `claude-sonnet-5`, e cada uma paga criação de cache nova
   (`cache_creation_input_tokens`) sob `--no-session-persistence`, porque não há sessão persistida
   para reaproveitar cache entre chamadas. (b) **Mais grave:** a ÚNICA chamada de sonnet que
   completou foi exatamente a de replace, e ela respondeu `"Claude Code"` mesmo com o prompt de
   sistema padrão inteiramente substituído por um arquivo que nunca menciona nome de produto
   nenhum. Ou seja: com sonnet, o autorrelato de identidade **não depende do prompt de sistema** —
   vem de conhecimento geral do modelo ou de outro sinal do ambiente, e o observável que este
   arquivo inteiro usa deixa de discriminar por completo. `sonnet` foi descartado pelas duas
   razões, independentemente uma da outra; o teste final usa só `haiku`, a única configuração
   medida a discriminar de verdade.

**Limitação 1 — a primeira formulação da pergunta deu falso negativo, e por que isso importa mais
do que parece.** A primeira versão pedia um booleano direto ("você sabe seu próprio nome de
produto? true/false") — na chamada de CONTROLE, sem flag nenhum, o modelo respondeu `false`. Não
é evidência de que o prompt padrão não tem a informação: é forma de recusa a uma pergunta
meta sobre as próprias instruções, o mesmo tipo de cautela treinada que faz um modelo hesitar em
"confirmar" fatos sobre si mesmo mesmo quando os tem. Trocar a pergunta para pedir o fato
diretamente ("qual é o nome do produto — responda UNKNOWN só se não souber mesmo") resolveu.

**Limitação 1b — NOVA, achada só depois de acrescentar o braço negativo: mesmo a formulação
corrigida tem uma taxa de falha mensurada na chamada de CONTROLE especificamente.** Rodando o
arquivo final (haiku, três chamadas) uma segunda vez, sem mudar nada, a chamada sem flag nenhum
respondeu `UNKNOWN` de novo — enquanto a chamada de append e a de replace, nas mesmas duas rodadas
completas, **nunca** falharam (append sempre "Claude Code", replace sempre `UNKNOWN`, sustentando a
discriminação nos dois casos). Isto é ruído de amostragem do haiku especificamente nesta pergunta
de autorrelato, isolado à chamada de controle — não foi observado no par que sustenta a alegação
central (append vs. replace). A mensagem de falha do teste de controle documenta isso explicitamente:
uma falha isolada ali, com os outros três testes verdes, é ruído até prova em contrário (rodar de
novo antes de escalar); falha repetida, ou falha junto com o teste "append, not replace", já não é
ruído. Registrado em vez de escondido — é exatamente o tipo de garantia que D-025 pede para não
inflar.

**Limitação 2 — o modo medido é `-p` (headless), não o modo que `adapters/resumption` usa de
verdade.** `resumer.ts` chama o fallback (`buildFallbackArgs`) em modo **interativo puro** (sem
`-p`), com `stdio: 'inherit'`, porque é isso que dá ao usuário uma sessão retomável de verdade
(Spike H). O teste de contrato não pode inspecionar esse caminho por dentro: com `stdio: 'inherit'`
o `seeya` nunca vê o stdout do processo filho (vai direto para a tela), e reproduzir o `stdio:
'pipe'` sem TTY reintroduziria a degradação "responde uma vez e sai" que o próprio Spike H mediu —
que é exatamente o comportamento usado aqui, só que via `-p` (mecanismo suportado e determinístico
por design, em vez de uma degradação por ausência de TTY). **Suposição não verificada
diretamente:** que a construção do prompt de sistema (onde `--append-system-prompt-file` entra) é
a mesma rotina para os dois modos, e que o flag não muda de semântica entre `-p` e interativo. É
uma suposição de engenharia razoável — um único ponto de tratamento de flag, não dois — mas não é
medição, e fica registrada como tal em vez de virar afirmação.

**O que o teste NÃO tenta provar, para não inflar a garantia (D-025):** que o texto completo do
prompt de sistema padrão do Claude Code é preservado byte a byte; só que pelo menos um fato que só
ele contém (o nome do produto) continua respondível, e que esse fato **de fato depende** do
conteúdo do prompt (provado pelo braço negativo). Não prova nada sobre o modo interativo com TTY
real. Não prova nada sobre modelos além de `haiku` — ao contrário, o achado 4 é evidência direta de
que **não dá para supor** que outro modelo (`sonnet`, pelo menos) se comporta igual: o autorrelato
de identidade pode vir de um lugar que não é o prompt de sistema, dependendo do modelo.

**Invocações reais totais usadas para chegar a este resultado: 11** — 4 na fase original (duas
tentativas de formulação de pergunta, só controle+append, antes do braço negativo existir); 1 sonda
avulsa testando `--system-prompt-file` isoladamente antes de integrar ao arquivo; 3 na primeira
integração completa do braço negativo (haiku, as três chamadas — controle flakou, append e replace
discriminaram corretamente); 3 tentando `--model sonnet` (achado 4, acima — duas chamadas estouraram
orçamento, a terceira revelou que sonnet não discrimina). **O arquivo final roda exatamente 3 por
execução, para sempre depois disso.**

**Opções que enxergo:** A) aceitar o resultado como está — o braço negativo prova a discriminação
com `haiku`; a flakiness isolada do controle está documentada na própria mensagem de falha do
teste, e não há orçamento (nem de invocação real, nem de tempo) para perseguir uma pergunta 100%
determinística contra um modelo estatístico. B) se algum dia `adapters/resumption` ganhar um modo
de depuração que capture stdout do modo interativo por outro canal, revisitar se vale medir os
dois modos separadamente — não antes, para não guardar escopo especulativo (mesmo raciocínio da
Q-027 item 4/opção C). C) o achado 4 (sonnet não discrimina) pode valer uma nota à parte em
D-004/Q-027 sobre não confiar em autorrelato de modelo para decisões de produto — hoje o `seeya`
não faz isso em lugar nenhum, mas fica como risco conhecido caso surja a tentação.
**Resposta:** **FECHADO — o teste fica, mas o que se afirma a partir dele desce de garantia para
medição re-executável. E a proteção de verdade vai para outro lugar.**

**A dúvida do mantenedor é justa, e o argumento mais forte a favor dela é um que o próprio
relatório já tinha admitido:** o teste mede o modo **headless `-p`**, e o fallback real roda
**interativo com stdio herdado**. Se os dois modos divergirem na montagem do prompt de sistema,
o teste passa e a produção quebra. Ele valida um modo que a gente não usa — isso não é detalhe,
é o teto do que ele pode provar.

Some a isso o que ele levantou: o Claude Code muda rápido, e não há garantia de que o flag exista
daqui a um mês. Tratar esse teste como rede de segurança seria confiança mal colocada.

**Mesmo assim ele não sai, e a razão é outra que não "garantia".** Ele custa **zero** no trabalho
normal: roda só por `npm run test:contrato`, que não está no CI padrão. E o valor dele é ser uma
**medição re-executável**: daqui a seis meses, quando alguém perguntar "por que `--append` e não
`--system-prompt-file`?", um comando responde em trinta segundos — em vez de refazer as 11
invocações que esta tarefa gastou para descobrir. Deixar de tratá-lo como portão não é motivo
para jogar fora a medição.

**A proteção de verdade vai para onde a quebra vai aparecer.** Se o flag sumir, hoje acontece o
seguinte: o `claude` recusa o argumento, sai rápido com código ≠ 0, e o
`adapters/resumption/resumer.ts` trata falha rápida do fallback como exceção — com a mensagem
*"Check that `claude` is on PATH and that `<cwd>` still exists"*. **Que estaria errada.** O
`claude` está no PATH e o `cwd` existe; o que sumiu foi o flag. Mandar a pessoa investigar PATH
quando a causa é outra é pior que não dizer nada.

**Vira tarefa própria: a mensagem de falha do fallback precisa mostrar o argv que foi tentado.**
Aí, no dia em que o flag mudar de nome ou sumir, a mensagem carrega a evidência em vez de apontar
para o lugar errado. É barato, não custa chamada de modelo nenhuma, e cobre exatamente o cenário
que o mantenedor descreveu ("continuar até quebrar em algum momento") — fazendo com que, quando
quebrar, dê para saber por quê.

**A limitação do modo fica escrita no topo do teste**, não só aqui: quem for lê-lo precisa saber,
antes de confiar, que ele mede `-p` e o produto usa interativo.

---


---

## Q-030 — Cinco escolhas feitas fazendo S3-T5 (identificar a sessão na listagem e no `--session`), registradas para confirmação
**Tarefa:** S3-T5
**Bloqueia:** não — a tarefa foi entregue com a solução mínima em cada ponto, mesmo padrão de
Q-017/Q-021/Q-022/Q-023/Q-027/Q-028.

**1) Normalização de caminho vira função pura em `core/cwd-normalization.ts`, com a plataforma
como parâmetro — não lida do `process.platform` ali dentro.** `core/eligibility.ts` já dizia que
normalizar é "responsabilidade de quem monta o objeto, fora do núcleo", mas isso deixava em aberto
**onde** essa normalização deveria morar fisicamente. Duas leituras possíveis: (a) fora de `core/`
inteiramente (em cada adapter/cli que precisa dela, duplicada), ou (b) uma função pura dentro de
`core/`, já que ela não importa `node:*` nem faz I/O — só string, igual a
`adapters/discovery/session-mapping.ts#deriveNameFromCwd`, que já vive fora do núcleo por lidar com
`cwd` mas é puramente string. Escolhi (b), com a plataforma **injetada como parâmetro** (mesma
disciplina do `Clock`, D-019): a função nunca lê `process.platform`, então dá para testar a
ramificação Windows inteira rodando em qualquer SO — é literalmente o requisito do aceite ("não
depende de rodar no Windows para valer"). `application/eligibility-assembly.ts` e
`cli/session-reference.ts`/`cli/end-day-command.ts`/`cli/eligibility-view.ts` são quem lê o
`process.platform` real, uma vez cada, e passam a dica adiante. Isto é um padrão novo (nenhuma
decisão fala de "porta de plataforma" explicitamente) — se o PO preferir tratar isto como uma porta
formal (`core/ports.ts`) em vez de parâmetro simples, é reversível a baixo custo agora, antes de um
segundo lugar copiar o padrão errado.

**2) Prefixo de exibição do `sessionId`: 8 caracteres (primeiro grupo do UUID), escalando por
fronteira de grupo (`8`, `13`, `18`, `23`, `36`) só para os que colidem.** Matemática registrada no
docstring de `cli/session-id-display.ts`: para N sessões, a chance de colisão no primeiro grupo é
~N²/2^33 — para 40 sessões, ~1,9e-7. Não tratei isso como "nunca acontece": a função sempre
recalcula por lote e nunca deixa duas sessões com o mesmo prefixo exibido, subindo para o próximo
grupo só para o par que colidiu. Alternativa descartada: hash curto sintético (perderia a leitura
direta do `sessionId` real, que é o que a pessoa vai colar de volta em `--session`).

**3) `--session` que casa mais de uma sessão é `ambiguous`, nunca processa todas.** Antes desta
tarefa, `end-day --session <cwd>` que casasse várias sessões (o cenário que motivou a S3-T5)
processava **todas elas em silêncio** — a igualdade de string exata nunca impedia isso, só nunca
tinha acontecido de propósito. Isto é uma mudança de comportamento, não só uma extensão: agora
`end-day-command.ts` resolve o `--session` contra uma descoberta própria **antes** de chamar
`application/endDay`, e recusa se houver mais de um casamento (por qualquer método — prefixo, nome
ou `cwd`), nomeando as sessões encontradas. A leitura literal da spec ("`--session` limita a uma
sessão") sustenta isso, e a regra dura que o mantenedor escreveu na tarefa ("prefixo ambíguo nunca
escolhe sozinho... se duas sessões casam, a saída diz quais e pede desambiguação") deixa pouca
margem para a leitura antiga. Se o comportamento anterior (processar todas as que casarem por
`cwd`) era intencional para outro caso de uso, isto reverte um comportamento que ninguém tinha
testado — registrado aqui para o PO confirmar que a leitura nova é a certa.

**4) A resolução do `--session` custa uma segunda chamada de descoberta.** Para recusar
ambiguidade **antes** de `endDay` processar (e potencialmente encerrar) qualquer sessão,
`end-day-command.ts` chama `deps.sessionProvider.list()` uma vez para resolver o valor, e `endDay`
chama de novo, por conta própria, na sua própria execução. Isso abre uma corrida pequena e rara
(uma sessão que existia na primeira leitura já não existe mais na segunda) — tratada com uma
mensagem própria (`formatVanishedMatchMessage`) em vez de um "0 in scope" mudo, mas o custo de duas
leituras por invocação de `--session` é real, ainda que barato (é um comando manual, não um laço
quente). Alternativa que evitaria a segunda leitura: `EndDayResult` devolver a lista de sessões
que o filtro deixou passar, não só a contagem — mudança maior em `application/types.ts` que não fiz
por não estar no escopo de arquivos desta tarefa.

**5) `start-day`: ambíguo vira a mesma mensagem que "não encontrado" — sem detalhe.**
`cli/start-day-selection.ts#findHandoffBySessionReference` já devolve `ambiguous` com a lista
completa de casamentos, mas `start-day-command.ts` colapsa `ambiguous` em `blocked` usando a MESMA
`formatNoSessionMatch` que já existia — porque uma mensagem que nomeasse as sessões ambíguas
precisaria mexer em `format-start-day.ts`, que é do S3-T6 e está fora do meu alcance nesta tarefa
(instrução explícita do mantenedor). A regra dura ("nunca resolve sozinho") está cumprida — uma
sessão nunca é retomada por adivinhação —, mas a pessoa recebe menos informação em `start-day` do
que em `end-day` para o mesmo tipo de erro. Fica para o mantenedor costurar (ou para uma tarefa
nova) uma mensagem própria de ambiguidade em `format-start-day.ts`.

**Opções que enxergo:** A) confirmar as cinco como estão. B) para o item 1, formalizar uma porta de
plataforma em vez do parâmetro simples, se o padrão se repetir em uma terceira tarefa. C) para o
item 3, se o comportamento antigo (processar todas as sessões de um `cwd` compartilhado) for
desejado em algum fluxo, ele precisaria de uma flag própria (`--all-matching`?), não do
`--session` que hoje promete "uma sessão". D) para o item 5, o mantenedor decide quando costurar a
mensagem de ambiguidade em `format-start-day.ts`.
**Resposta:** **FECHADA — os cinco pontos confirmados pelo mantenedor em 2026-08-30.**

**Item 3, que era o que precisava de aval, tem uma correção de premissa que vale registrar.** A
questão tratava "capturar todas as sessões daquele `cwd`" como comportamento existente que
estava sendo removido. O mantenedor foi direto: **resolver todas as sessões nunca foi objetivo.**
Ou seja, aquilo não era comportamento que alguém decidiu e agora perdemos — era **efeito
colateral de comparar `cwd` por igualdade de string** numa flag cujo próprio texto de ajuda diz
"limit to a single session". A mudança não tira uma capacidade; alinha o comportamento com o
contrato que já estava escrito.

Isso muda a leitura do risco. Não é "mudança de comportamento a compensar depois" — é conserto,
e um que sob a D-031 também fecha um buraco de custo: uma flag, vinte capturas.

**Ideia registrada para não se perder, e explicitamente NÃO para agora:** um `--sessions` que
aceite uma lista, para quem realmente quiser várias de uma vez. Sugestão do mantenedor, com a
ressalva dele mesmo de que não entra neste momento. Fica anotado no Sprint 5 como possibilidade
a avaliar, não como tarefa aceita — se aparecer necessidade real de uso, ela se justifica
sozinha; se não aparecer, some sem custo.

**Os outros quatro** — onde a normalização mora (pura, no `core/`, plataforma injetada), o
prefixo de 8 caracteres com escalonamento só para os que colidem, a segunda chamada de descoberta
para resolver antes de capturar, e a mensagem faltante do `start-day` ambíguo — confirmados como
estão. A última foi fechada pela S3-T6, que é dona daquele arquivo.

---

## Q-030a — Achado ortogonal: `verificar:linux` ficou intermitente ao rodar a suíte `guards` completa, mesmo sem relação com o código desta tarefa
**Tarefa:** S3-T5 (achado incidental, não é o escopo da tarefa)
**Bloqueia:** não — `verificar` e `verificar:linux` fecharam verdes antes de eu parar (ver
"Aceite" no relatório da tarefa), mas o padrão vale registro porque pode morder a próxima tarefa
que acrescentar arquivo a `src/`.

**O que medi.** `node scripts/verificar-linux.mjs`, rodado 6 vezes com o código desta tarefa: 4
verdes, 2 vermelhos — os dois vermelhos sempre no mesmo lugar,
`tests/integration/guards/eslint-restrictions.test.ts`, nos casos `rejects setTimeout`/`rejects
setInterval` outside `src/adapters/clock/`, com a mensagem `"[guard child process exceeded its own
30000ms budget (CHILD_PROCESS_BUDGET_MS) and was killed (SIGTERM) before finishing]"` — não uma
falha de asserção, um estouro do orçamento do processo filho (`tests/integration/guards/_support.ts`,
constante fixada na S2-T7). Rodei o MESMO script 3 vezes com as minhas mudanças guardadas
(`git stash`, voltando ao código anterior a esta tarefa): **3 de 3 verdes**. Rodando só
`eslint-restrictions.test.ts` sozinho (sem o resto da suíte `guards` por perto) dentro do mesmo
container, cada `eslint` real terminou em 6-12s, bem dentro do orçamento — a lentidão só aparece
quando a suíte inteira de `guards` roda junto (`layer-matrix.test.ts` e `dependency-cruiser.test.ts`
já são pesados sozinhos, cada um com 20 asserções que sobem um processo real).

**O que infiro, sem ter medido a fundo.** O padrão bate com o que a S2-T7/S2-T8 já escreveram: o
orçamento de 30s foi medido nesta máquina Windows, fora de container, e o S2-T8 já tinha
encontrado o mesmo tipo de problema (orçamento medido no lugar errado) para outro teste. O container
Docker parece ter menos folga que a máquina local sob concorrência real da suíte `guards` inteira, e
os três arquivos novos que esta tarefa acrescentou a `src/` (mais os seis em `tests/`) parecem ser o
suficiente para empurrar a contenção — que já estava perto da borda — para cima do limite, com
alguma frequência. Não medi o suficiente para separar "é sempre assim, eu só tive azar nas execuções
sem meu código" de "meu código genuinamente aumenta a contenção" — as duas hipóteses são compatíveis
com os números que tenho.

**Por que não mexi no orçamento.** `CHILD_PROCESS_BUDGET_MS` é infraestrutura compartilhada por toda
a suíte `guards`, não desta tarefa, e a própria S2-T8 registrou a lição de que subir um número sem
medir no ambiente real ("medir na máquina do desenvolvedor e publicar é o mesmo erro de sempre, com
outra roupa") é pior que não mexer. Mudar isso exigiria a mesma disciplina de medição da S2-T7/S2-T8,
que não é o escopo desta tarefa.
**Resposta:** **Não mexer no orçamento agora. A amostra está confundida, e a confusão é
identificável.**

Os números levantados (3 de 3 verdes sem as mudanças, 4 de 6 com) foram colhidos enquanto **três
agentes rodavam em paralelo** na mesma máquina, cada um com o seu próprio contêiner Docker. A
contenção de CPU que produziu os vermelhos é dessa carga, não do CI — onde cada job tem o runner
inteiro. E o CI ficou **verde em todas as execuções do dia**, incluindo as três dos merges destas
mesmas tarefas.

Comparar 3 execuções de linha de base contra 6 com mudanças, sob carga variável e sem controlar
quantos agentes rodavam em cada uma, não sustenta a conclusão de que os arquivos novos pioraram
a folga. É a mesma forma de erro que já quase entrou numa decisão antes (D-029, onde a causa
atribuída não reproduziu quando a versão foi controlada).

**A decisão certa foi a que o agente tomou: não tocar na constante.** Mexer no
`CHILD_PROCESS_BUDGET_MS` exige a mesma disciplina que a S2-T7 e a S2-T8 estabeleceram — medir no
ambiente que de fato falha, que é o runner, e consertar a causa em vez de aumentar o número. A
S2-T8 ganhou margem **baixando** orçamentos, não subindo, porque atacou o cold start.

**O que fazer:** nada agora. Se o `verificar:linux` ficar vermelho **sem agentes em paralelo**,
ou se o CI ficar vermelho nesse teste, aí existe sinal para medir. Registrado aqui para que o
próximo vermelho não seja tratado como novidade.

---

## Q-031 — S3-T6: legibilidade do `start-day`, a costura para S3-T5, e escolhas sem resposta literal

**Tarefa:** S3-T6
**Bloqueia:** não — as três correções pedidas (item por linha, sem markdown, respiro antes da
pergunta) e o acréscimo do mantenedor (resposta inválida diz o que houve) foram entregues com a
solução mínima em cada ponto; registro no mesmo padrão de Q-021/Q-022/Q-023/Q-027/Q-028.

**1) Formato da lista item-por-linha: `label:` numa linha, cada item em `      - item` (6
espaços).** A tarefa pediu "item por linha" sem fixar indentação. Escolhido 4 espaços para
`pending:`/`plan:` (mesmo nível que as linhas de status já usavam, ex.: `already resumed today`)
e mais 2 para o marcador `- ` de cada item — um nível visual a mais que sinaliza "isto está
dentro do rótulo acima", sem inventar um quarto nível de aninhamento. Nenhuma outra convenção do
projeto fixava isto (a saída de `end-day` é markdown, `core/briefing.ts`, e não serve de
precedente para texto puro de terminal).

**2) A costura para S3-T5 em `formatNoSessionMatch` ficou só a assinatura, sem dado real.**
`formatNoSessionMatch(received, matchedAgainst?)` mostra os dois valores quando divergem, mas
hoje `start-day-command.ts` só chama com um argumento — não existe, ainda, nenhuma normalização
de caminho produzindo um segundo valor para oferecer (D-025: não fabricar o valor que falta). A
função está pronta para o momento em que S3-T5 (ou uma tarefa seguinte) tiver um valor
normalizado para passar; até lá, a mensagem é exatamente a de antes. **Não sei se `start-day-
command.ts` é o arquivo certo para essa fiação** quando o normalizador existir — ele não está na
lista de arquivos que S3-T5 mexe, mas também não foi declarado como reservado para S3-T6 além
desta tarefa. Se isso gerar disputa de arquivo entre tarefas futuras, é uma decisão de escopo, não
uma que eu deva antecipar aqui.

**3) Resposta inválida no seletor: novo formatador (`formatInvalidSelection`) em vez de mudar
`parsed.reason` em `start-day-selection.ts`.** O mantenedor pediu duas informações adicionais (nada
foi retomado; ver `--help`) sem dizer onde. Escolhido um formatador novo em `format-start-day.ts`
que envolve o `reason` já produzido por `start-day-selection.ts` (arquivo da S3-T5, que não pode
tocar nos meus) em vez de alterar a string na origem — mantém a mensagem "formato esperado" como
responsabilidade de quem parseia a resposta, e a mensagem "o que isso significa para o comando"
como responsabilidade de quem orquestra o comando. Código de saída continua 0, confirmado pelo
mantenedor; não implementei laço de nova tentativa (também confirmado).

**4) O texto de `--help` de `start-day` não foi alterado.** Rodei
`seeya start-day --help` e as descrições atuais de `--all`
("Resume every still-unresumed session in the found briefing.") e `--session`
("Resume only the session matching this sessionId or cwd.") já dizem, na minha leitura, o
suficiente para sustentar o ponteiro "veja --help" que a resposta inválida agora imprime — dão a
entender que as duas flags substituem a pergunta interativa. Julgamento meu, não medição; se o
mantenedor achar as descrições insuficientes lendo a saída real, ajustá-las cai no mesmo escopo
("saída do mesmo comando") e não precisa de tarefa nova.

**5) Nenhuma ideia boa sobre a redundância `pending`/`plan` (D-011, fora de escopo por decisão do
plano).** Considerei e descartei: deduplicar frases parecidas no formatador esconderia o sintoma
que a reavaliação da D-011 sob a D-031 precisa ver. Não tenho proposta melhor que a já registrada
no plano de entrega (mais evidência na captura, não menos texto na exibição) — registrando aqui só
para não parecer que a omissão foi esquecimento.

**Opções que enxergo:** A) confirmar as quatro primeiras escolhas como estão. B) para o item 2, se
uma tarefa futura de normalização de caminho preferir fiar `matchedAgainst` em outro arquivo que
não `start-day-command.ts`, mover a chamada não quebra a assinatura de `formatNoSessionMatch` —
só avisando aqui para não ser surpresa. C) para o item 4, medir com o mantenedor se o texto de
`--help` precisa mesmo dizer explicitamente "skips the interactive picker" em vez de deixar
implícito.
**Resposta:** **FECHADA — as cinco confirmadas pelo mantenedor em 2026-08-30.**

Inclui o julgamento sobre o `--help`: você conferiu a saída real antes de apontar para ela, em
vez de assumir, e concluiu que as descrições de `--all`/`--session` sustentam o ponteiro. É a
ordem certa — ponteiro para documentação que não explica o que promete é pior que nenhum.

A costura do `formatNoSessionMatch` foi fechada pela S3-T5, que já passa o valor recebido e a
forma normalizada quando diferem.

---

## Q-032 — Na v2, com o `seeya` sendo dono das sessões, a captura pega carona no cache?

**Tarefa:** nenhuma — pergunta do mantenedor em 2026-08-30, ao ler o Spike I.
**Bloqueia:** não. É desenho de v2; registro agora porque a resposta muda o formato do Sprint 4.

**A pergunta.** Se numa v2 o `seeya` "abraçar" o Claude Code — lançando e sendo dono das sessões
—, teríamos acesso a um cache que tornasse a captura mais barata?

**Primeiro, desfazer o enquadramento.** Não existe "ter acesso ao cache". Cache de prompt é
**endereçado por prefixo**: você não recebe permissão, você recebe acerto quando o começo da sua
chamada bate, token a token, com algo cacheado recentemente. Pelo preço público, leitura de cache
sai por volta de **10% do preço de entrada**; escrita sai **mais caro** que entrada normal. (Números
a reconferir antes de decidir qualquer coisa — não medi.)

**Por que a nossa captura erra o cache hoje, e é por desenho.** O modo profundo chama
`claude -p --resume <id> --fork-session` com o **nosso** prompt de sistema curto, `--tools ""` e
`--json-schema` (D-011). Cada um desses muda o prefixo. A conversa é a mesma, mas o começo da
chamada não é — então não há acerto, e os ~82k tokens são **escritos** no cache, não lidos. O
"reescritos no cache" que a D-011 registra é consistente com escrita.

**E aqui está a tensão que precisa ficar escrita:** as otimizações que derrubam o piso de tokens
(`--tools ""`, prompt de sistema próprio) são **exatamente** o que quebra a identidade de prefixo.
Barato por um caminho, caro pelo outro. Não dá para ter os dois sem medir qual pesa mais.

**O corte que provavelmente decide, e não é o prefixo: é o relógio.** A validade do cache é de
minutos a uma hora, não de horas. Uma captura às 19h sobre uma sessão parada desde as 10h acha
cache frio **independentemente** de prefixo. Isso não é detalhe de implementação — é o que
inutiliza a ideia inteira no desenho atual.

**A consequência interessante, e é a razão de registrar isto agora.** Se o cache é a alavanca,
então a resposta não é "captura mais barata às 19h" — é **capturar enquanto está quente**, em
passagens ao longo do dia, quando a sessão fica ociosa.

E há evidência de que esse é o desenho certo: **o Claude Code já resolve o mesmo problema assim.**
O away summary do Spike I dispara por **ociosidade de 5 minutos**, não por horário. Ele é barato
porque roda quando o contexto ainda está quente, não porque alguém achou um prompt esperto.

Isso reformula o **Sprint 4**. O daemon, hoje, é "acorda no horário e captura tudo". A alternativa
é "acompanha as sessões e captura cada uma quando ela esfria", com o encerramento do dia virando
**consolidação do que já foi capturado** em vez de uma passada cara. Não estou propondo a troca —
estou registrando que a pergunta do cache aponta para lá, e que decidir o daemon sem responder isto
seria construir a forma cara por omissão.

**Proximidade perigosa com a D-001.** Reproduzir o prefixo da sessão viva para acertar o cache é
chegar perto de "gerar por dentro". A D-001 continua valendo pelos motivos que sobrevivem — não
gastar o contexto da sessão viva, não interromper o turno. Qualquer desenho que persiga o cache
precisa mostrar que não faz nenhuma das duas coisas.

**O que mediria, antes de desenhar qualquer coisa:**

1. O custo real de uma captura profunda **logo depois** de um turno da sessão, contra a mesma
   captura horas depois — isolando o efeito do relógio.
2. Se remover `--tools ""`/`--json-schema` (recuperando identidade de prefixo) paga por si, contra
   o piso que a correção medida da D-011 já mostrou serem eles que derrubam.
3. Qual é a validade efetiva na prática, não na documentação.

**Opções que enxergo:** A) responder no Sprint 4, antes de fixar a forma do daemon — é onde a
resposta muda o desenho. B) deixar para a v2 e aceitar que o Sprint 4 nasça com a passada cara,
sabendo que vai ser refeita. C) medir só o item 1, que é barato e sozinho já diz se vale continuar.
**Resposta:** **FECHADO — medir no início do Sprint 4, antes de fixar a forma do daemon.**

Decisão do mantenedor em 2026-08-30: "acho importante saber disso desde já". Concordo, e o motivo
é o que já está escrito acima — o daemon é a peça que a resposta muda. "Acorda no horário e
captura tudo" e "acompanha as sessões e captura cada uma quando esfria" não são variações de
implementação: são formas diferentes, e escolher sem medir é escolher a cara por omissão.

**Escopo da medição: o item 1 sozinho, primeiro.** O custo de uma captura profunda **logo depois**
de um turno da sessão, contra a mesma captura horas depois. Isola o efeito do relógio, que é o que
provavelmente decide antes do prefixo — cache com validade de minutos a uma hora torna irrelevante
qualquer identidade de prefixo numa captura às 19h sobre sessão parada desde as 10h.

Se o item 1 mostrar diferença grande, os itens 2 e 3 (identidade de prefixo, validade efetiva)
passam a valer a pena. Se não mostrar, a ideia morre barato e o daemon segue como está desenhado.

Entra como **S4-T00**, antes da S4-T0 e da S4-T1.

---

## Q-034 — Identidade de prefixo economiza de verdade, mas devolve o problema que a D-011 resolveu. Como reconciliar?

**Tarefa:** S4-T00 (spike, `docs/spikes/J-cache-na-captura.md`).
**Bloqueia:** não. Bloqueia um desenho futuro (S4-T0/S4-T1) que queira perseguir a economia
medida, não a S4-T00 em si — que termina neste registro.

**Contexto.** O Spike J mediu, com uma sessão sintética descartável e cinco chamadas reais
(US$ 0,048 no total), os três itens que a Q-032 tinha deixado em aberto. Dois resultados centrais:

1. Remover os três flags que moldam o prefixo da captura profunda (`--tools ""`,
   `--system-prompt`, `--json-schema`) recupera identidade de prefixo com a sessão original e
   consegue acerto de cache **quase total** — 23.879 de 24.080 tokens vieram de cache no braço que
   testou isso, contra a configuração atual (que lê bem menos, proporcionalmente, do que escreve).
   Custou **4,3x menos** rodando a mesma tarefa segundos depois.
2. Mas esses três flags existem precisamente porque, sem eles, a saída volta a ser a persona
   conversacional padrão do Claude Code — o Spike C mediu isso produzindo 2.349 tokens de prosa
   livre terminando numa oferta de "transformar isto num artefato", e a saída sem os flags neste
   spike (`docs/spikes/j-cache-na-captura-raw/arm2.json`) confirma o padrão: Markdown livre, não
   o JSON estruturado que `--json-schema` garante e que `extractUnderstanding`
   (`run-generation.ts`) depende para funcionar sem cair para o handoff determinístico.

**A pergunta.** Existe alguma forma de conseguir os dois — identidade de prefixo (barata, lê
cache) **e** saída estruturada e confiável (D-003, D-011) — na mesma captura? Ou são
mutuamente exclusivas por desenho, e a decisão é escolher uma?

**Ideias que enxergo, nenhuma medida:**

A) **Duas chamadas.** Uma barata, com prefixo padrão (sem os três flags), só para obter o texto
livre de entendimento; uma segunda, pequena, que pega esse texto e pede a ele mesmo (ou a um
modelo ainda mais barato) para estruturá-lo em JSON. Dobra o número de chamadas por captura, mas
cada uma é menor; não medido se o total fica abaixo do custo de uma chamada só com os três flags
e cache frio.

B) **Aceitar prosa e fazer parsing tolerante no `seeya`**, sem exigir JSON do modelo — abandona a
garantia de schema que `--json-schema` dá, trocando por um extrator de texto livre mais frágil
(regex/heurística) rodando fora do modelo. Vai contra o espírito da D-003 ("entendimento pelo
modelo", não heurística nossa tentando reconstruir estrutura de prosa).

C) **Testar se `--json-schema` sozinho (sem `--system-prompt`/`--tools ""`) preserva identidade de
prefixo o bastante para valer o desconto**, já que o Achado 4 do Spike J mostrou a config completa
lendo mais cache do que o esperado por um mecanismo ainda não explicado — pode ser que só o
`--json-schema` isolado já capture parte do ganho sem abrir mão de tanto.

D) **Não perseguir isto agora** — aceitar que a captura profunda continua com os três flags (D-011
como está), e usar só o Achado 3 (o relógio é mais generoso que 5 minutos) para informar a
cadência do daemon, sem tentar também ganhar o desconto de prefixo nesta rodada do Sprint 4.

**Resposta:** em aberto — decisão do mantenedor/PO, não do agente de medição.

**Atualização S4-T00b (2026-08-31), acrescentada — não substitui o que está acima.** A ideia C
desta lista foi testada: **a troca sobrevive, não desaparece.** A hipótese de que só o
`--system-prompt` quebrava a identidade de prefixo — o que abriria uma saída barata sem
sacrificar a estrutura, largando só ele e movendo a instrução de extração para o prompt do
usuário — **foi medida e refutada** (`docs/spikes/J-cache-na-captura.md`, seção "S4-T00b").
Largar só o `--system-prompt` (mantendo `--tools ""` e `--json-schema`) leu **zero** cache contra
a sessão viva, o mesmo resultado que largar só o `--tools ""` ou só o `--json-schema` sozinhos
também produziu — os três, em qualquer par que sobre dois deles, já bastam para perder o cache
por completo. Um braço de controle (largando os três, mesma sessão, mesma janela de tempo) leu o
cache quase por inteiro, confirmando que os zeros acima são sinal real, não ambiente frio.

Isso fecha a ideia C: não há atalho barato escondido em largar um flag só. As opções que
continuam de pé são A, B e D, sem novidade medida sobre elas nesta rodada. A pergunta original
("existe forma de conseguir os dois na mesma captura?") continua **em aberto** para decisão do
mantenedor/PO — o que mudou é que a resposta não vem de graça: qualquer caminho que preserve os
dois vai precisar de algo mais elaborado que "largar um flag" (as ideias A/B), não de um ajuste
de posição do prompt.

**Resposta:** **FECHADA — a troca é real, e a otimização fica engavetada. Mantém-se a
configuração atual (prefixo próprio, saída estruturada).**

**O que decide não é o preço unitário, é a D-031.** Ela encolhe o conjunto candidato de ~40
sessões por dia para um punhado de sessões vivas. Nessa escala, 4,3x sobre um custo que já é de
centavos por sessão não paga o que custaria conquistá-lo: o único caminho medido para o cache
é abrir mão da saída estruturada, e recuperá-la exigiria **uma segunda chamada** de extração.
Isso é um segundo mecanismo — e este projeto já recusou exatamente essa forma na D-004, onde a
regra ficou sendo **um fallback, não dois**.

**A S4-T00b fechou a saída de escape que eu tinha esperança de achar.** A ideia era largar só o
`--system-prompt` e manter `--tools ""`/`--json-schema` — barato **e** estruturado. Medido:
largar **qualquer um dos três sozinho** já zera o acerto. Não havia dilema falso a dissolver.

**O que fica registrado como restrição de desenho, e vale mais que a economia:** a configuração
atual leu 70.260 tokens de cache numa rodada e **zero** na seguinte, com a mesma forma de
chamada. Ou seja, **ela às vezes se beneficia de cache por atividade não relacionada da conta, e
nunca de forma confiável.** Nenhum redesenho pode assumir que a captura parte quente.

**Quando reabrir:** se o custo de captura passar a doer na escala real da D-031 — isto é, se as
sessões vivas de um dia de trabalho somarem o suficiente para alguém reparar. Aí a medição já
está feita, com números dos dois lados, e a conversa começa de onde parou em vez do zero.

**O que realmente decide a qualidade da captura não é isto.** É a **D-011 sob a D-031** — enxuto
contra profundo —, e essa reavaliação é o próximo passo. O cache era otimização de custo em cima
dela; a cegueira do modo enxuto é o que muda o produto.

## Q-035 — Por que `--system-prompt` e `--tools ""` juntos custam menos cache do que a soma dos dois isolados?

**Tarefa:** S4-T00b (spike, `docs/spikes/J-cache-na-captura.md`, seção "S4-T00b").
**Bloqueia:** não. É uma curiosidade de mecanismo que sobrou da medição, não uma decisão pendente
de produto.

**Contexto.** Ao decompor os 36.968 tokens que a configuração completa (`--tools ""` +
`--system-prompt` + `--json-schema`) escreve de novo quando não há cache para ler, os deltas
marginais de cada flag não somam ao total observado:

- `--system-prompt` sozinho (contra o par tools+schema): **26.691** tokens de diferença.
- `--tools ""` sozinho (contra o par system-prompt+schema): **19.101** tokens de diferença.
- Soma dos dois: 45.792 — **8.824 tokens a mais** que o total real da configuração completa
  (36.968).

Ou seja, ter os dois presentes ao mesmo tempo custa **menos** do que a soma do que cada um custa
isoladamente (contra o par que já tem o terceiro). Há uma interação real entre `--system-prompt` e
`--tools ""`, mas o mecanismo não foi isolado — faltariam medições com cada flag **totalmente
sozinho** (sem os outros dois) para decompor o efeito por completo, e o orçamento de 6 chamadas da
S4-T00b já estava no teto quando isso apareceu.

**A pergunta.** O que exatamente `--system-prompt` e `--tools ""` compartilham ou disputam no
aparato interno do Claude Code que faz a combinação dos dois custar menos que a soma? É constante
o suficiente para valer a pena medir com mais precisão antes de qualquer desenho que dependa do
tamanho exato do prefixo (ex.: estimar custo de captura por sessão), ou é ruído de uma amostra de
uma sessão sintética pequena?

**Resposta:** em aberto — não bloqueia nada hoje; vale revisitar se um desenho futuro precisar de
uma estimativa de custo de prefixo mais precisa que "a ordem de grandeza medida aqui".

---

## Q-036 — Volume de texto do assistente no prompt enxuto: custo não discrimina; e falta decidir se persiste

**Tarefa:** S4-T00c (`docs/PLANO-DE-ENTREGA.md`, saída da reavaliação da D-011 sob a D-031).
**Bloqueia:** não. A implementação seguiu sem persistir (ver abaixo); a pergunta de persistência
fica para o mantenedor decidir quando/se quiser.

**Contexto.** A tarefa pedia para medir o custo do prompt enxuto com e sem o texto do assistente,
em pelo menos dois volumes, antes de escolher qualquer número — histórico direto da própria D-011,
que já errou uma vez estimando sem medir (Spike C: US$ 0,15 estimado; S2-T2 mediu US$ 0,08–0,09 e
um `--json-schema` que quintuplica o piso em vez de baixá-lo).

**Medido: 4 chamadas reais** (`claude`, `--model haiku`, sessão sintética descartável em
`%TEMP%`, ambiente saneado D-017, teto de US$ 0,20 por chamada — bem abaixo do teto de 6 do
brief), com a forma real do gerador enxuto (`--tools ""` + `--system-prompt` + `--json-schema` +
`--no-session-persistence`, nunca `--resume`). Saída bruta sanitizada em
`docs/spikes/j-cache-na-captura-raw/lean-*.json`, seção "S4-T00c" do Spike J tem a tabela e o
método completos.

| chamada | conteúdo do assistente | `cache_read` | `cache_creation` | custo (US$) |
|---|---|---:|---:|---:|
| `lean-baseline` (1ª vez) | nenhum | 0 | 0 | 0,0061 |
| `lean-assistant-small` | 3 msgs, truncadas a 400 car. (~1,7 KB) | 0 | 34.573 | 0,0754 |
| `lean-assistant-large` | 10 msgs, inteiras (~3,6 KB) | 68.428 | 2.826 | 0,0213 |
| `lean-baseline` (repetida, mesmo conteúdo da 1ª) | nenhum | 67.821 | 2.463 | 0,0212 |

**Achado principal: volume de texto do assistente não prediz custo.** A chamada com MAIS
conteúdo (`lean-assistant-large`) saiu mais barata que a com MENOS (`lean-assistant-small`), e
repetir a chamada MAIS BARATA original (`lean-baseline`, conteúdo idêntico) na sequência ficou
**3,5× mais cara** que a primeira vez. O que decide o custo aqui não é o que este prompt manda —
é um efeito de cache compartilhado e por-janela-de-tempo sobre o aparato fixo
`--tools ""`/`--system-prompt`/`--json-schema`, o mesmo mecanismo que o Achado 4 do Spike J já
tinha sinalizado como não totalmente explicado (lá, no caminho `--resume`; aqui, reproduzido
também no caminho enxuto, que nunca usa `--resume`). A primeira chamada "fria" do dia é a mais
barata (~US$ 0,006); qualquer chamada seguinte dentro de ~1h (Achado 3 do Spike J) parece pegar
esse aparato já quente e cobra por ele (na forma de `cache_read`, mais barato por token, mas em
volume suficiente para dominar o custo total) — **independente de quanto texto de assistente
foi enviado**.

**Consequência para a decisão de volume:** como custo não discrimina entre os volumes testados,
`MAX_ASSISTANT_MESSAGES = 10` e `MAX_ASSISTANT_MESSAGE_CHARS = 500`
(`adapters/transcript/facts.ts`) foram escolhidos por qualidade de prompt — simetria com
`MAX_LAST_PROMPTS` e limitar um turno verboso isolado — não por custo. Documentado no comentário
das constantes, com esta medição citada.

**Isto não é a mesma pergunta da Q-034/Q-035** (que tratam do `--resume`/captura profunda e da
interação `--system-prompt`×`--tools ""`), mas é evidência de que o mesmo mecanismo não explicado
aparece também no caminho enxuto, que a D-011/D-031 tratam como o caminho barato e "sem
cache". Vale registrar: **não dá para assumir que o enxuto sempre custa o piso de ~US$ 0,006** —
qualquer captura que não seja a primeira do dia/da janela pode custar de US$ 0,02 a US$ 0,08 pelo
mesmo motivo, independentemente deste recurso novo. Isso é maior que a S4-T00c sozinha: se o
`end-day` captura várias sessões numa mesma passada, a segunda em diante pode já estar pagando
esse custo hoje, antes desta tarefa. Não medido a fundo aqui — o orçamento de chamadas foi usado
na pergunta desta tarefa — mas fica registrado como suspeita para quem for estimar custo de
captura em lote.

**A pergunta de persistência, em aberto.** `SessionFacts.assistantMessages` foi implementado para
alimentar `buildLeanPrompt`, mas **deliberadamente não foi adicionado** a
`handoffFactsSchema`/`serializeHandoff` (`adapters/storage/handoff-schema.ts`) — não vira chave
nova em disco. Isso foi uma restrição dada para esta tarefa, não uma conclusão minha. Pode valer
a pena persistir mais tarde: um handoff salvo hoje não guarda nenhum rastro do texto do
assistente que alimentou o modelo, então uma auditoria futura ("por que o handoff disse isso?")
não teria como conferir contra a evidência bruta. Contra persistir: é conteúdo de trabalho real
(D-027 — chave nova em disco é barata agora, cara depois — mais ainda quando o conteúdo é texto
livre do assistente, que carrega mais superfície de privacidade que uma lista de prompts do
usuário). **Resposta:** em aberto — decisão do mantenedor, não do agente.

---


---

## Q-037 — Seis escolhas feitas fazendo S4-T2 (`core/schedule.ts`), registradas para confirmação

**Tarefa:** S4-T2
**Bloqueia:** não — as seis seguiram a solução mínima com o porquê escrito no próprio código
(comentários citados abaixo), conforme AGENTS.md ("decida, escreva o porquê, registre se ficar
ambíguo"); registro para o review confirmar ou corrigir, no mesmo espírito de Q-016/Q-017/Q-021.

**Contexto.** `docs/ESPECIFICACAO.md` § "Comportamento do daemon" descreve o QUE deve acontecer
(aviso prévio, encerramento, atraso por suspensão) mas é silenciosa sobre vários detalhes de
implementação que uma regra pura precisa decidir para existir. As seis abaixo:

**1) Hora que não existe (entrada do horário de verão) — não rejeito, deixo a plataforma
normalizar, e documento o resultado medido.** `resolveEndOfDayInstant("02:30", diaDeEntrada)`
com um `"02:30"` que nunca acontece naquele dia (relógios pulam de 02:00 para 03:00) — medido no
Node/V8 deste projeto (`TZ=America/New_York`, 2026-03-08): o resultado é **03:30**, não 01:30 e
não uma exceção. `docs/ARQUITETURA.md` § "Fusos e horários" já diz que a conversão para instante
"trata mudança de horário de verão de graça" delegando ao fuso do sistema — interpretei isso como
"não construa uma tabela de transições própria dentro do `core/`", e documentei o comportamento
medido em vez de tentar corrigi-lo ou rejeitá-lo. Raciocínio completo no comentário de
`resolveEndOfDayInstant` (`src/core/schedule.ts`).
**Opções:** A) aceitar a normalização nativa (avança para depois do buraco) como o comportamento
do produto, documentada e testada. B) `core/` deveria detectar a hora inexistente e escolher
outra regra (ex.: usar sempre o instante ANTES do buraco). C) deveria ser erro de config, recusado
na leitura (mas isso pertenceria a `adapters/storage/config-schema.ts`, não a este módulo, e o
`"02:30"` só se torna "impossível" em função do calendário — não dá para essa validação viver
onde a config é lida, sem repetir a tabela de transições que a opção A evita).
**Minha escolha:** A.

**2) Hora que acontece duas vezes (saída do horário de verão) — mesma resposta: aceito a
escolha nativa (a ocorrência mais cedo, ainda em horário de verão) em vez de desambiguar
sozinho.** Medido (`TZ=America/New_York`, 2026-11-01, `"01:30"`): resolve para a instância às
05:30 UTC (UTC-4, ainda DST), nunca a das 06:30 UTC (UTC-5). Não há informação disponível numa
string `"HH:MM"` que justificasse escolher a ocorrência tardia em vez da nativa.
**Opções:** A) aceitar a escolha nativa (mais cedo). B) uma config adicional para desambiguar
("primeira ou segunda ocorrência").
**Minha escolha:** A — B seria uma chave de config nova para um caso que ocorre uma vez por ano,
sem pedido na spec.

**3) `delayMs`, não `late: boolean`, no caso `endOfDay`.** A spec pede "aviso de que houve atraso"
quando a máquina estava suspensa, mas não define o que conta como "atraso" (30s de folga do poll
normal já seria "atraso" tecnicamente). Em vez de escolher um limiar arbitrário dentro do
`core/`, devolvo o `delayMs` bruto (`now - effectiveEndOfDay`) e deixo quem consome (a notificação,
S4-T1/S4-T3) decidir a partir do número real se e como avisar. Ver o comentário de
`ScheduleDecision` em `src/core/schedule.ts`.
**Opções:** A) `delayMs` bruto (o que implementei). B) `core/` escolhe um limiar (ex.: >2min =
atraso) e devolve um booleano ou um terceiro `kind` (`endOfDayLate`).
**Minha escolha:** A — um limiar exige um número que não está em documento nenhum, e um booleano
apagaria a distinção que a spec pede para preservar (instrução literal da tarefa recebida).

**4) Ordem de prioridade quando mais de uma antecedência está vencida ao mesmo tempo (máquina
suspensa através de duas marcas de aviso).** A spec não cobre o caso. Decidi por ordem
**decrescente de minutos** (30 antes de 15), independente da ordem em `leadTimesInMinutes` na
config — é a ordem em que os dois teriam disparado de verdade se o daemon não tivesse dormido.
Cada chamada dispara só UMA antecedência vencida; a próxima chamada (poll seguinte) pega a outra.
Ver `findDueLeadTime` em `src/core/schedule.ts`.
**Opções:** A) ordem decrescente por minutos (o que implementei). B) ordem literal do array de
config. C) disparar todas de uma vez (mudaria `ScheduleDecision` para carregar uma lista).
**Minha escolha:** A — C mudaria a forma do tipo para um caso raro (só acontece com suspensão
cobrindo duas marcas), e o "poll seguinte pega a outra" já resolve sem essa complexidade.

**5) `endOfDayFired` é permanente pelo resto do dia local, mesmo com adiamento pedido depois.**
Uma vez que o encerramento de fato ocorreu, nenhum adiamento subsequente reabre o dia (não há
como desencerrar sessões já capturadas). `docs/TESTES.md` não pede esse caso explicitamente, mas
me pareceu a única leitura consistente de D-006 ("não há limite de adiamentos") — o limite não é
de quantidade, é de que adiar só faz sentido **antes** do encerramento acontecer. Testado em
`schedule.test.ts` ("a snooze requested after already closing cannot reopen the day").
**Opções:** A) `alreadyEnded` é permanente e ignora adiamento (o que implementei). B) um adiamento
depois do encerramento deveria de alguma forma reverter/reabrir (não vejo como isso faria sentido
sem re-executar `endDay`, fora do escopo deste módulo).
**Minha escolha:** A.

**6) A virada de meia-noite (reset de `DayState`) é resolvida DENTRO do `core/`, comparando
`state.day` com `core/day.ts#localDayString(now)`, em vez de esperar que a S4-T3/S4-T4 façam o
reset ao ler de disco (ex.: um arquivo por dia, como `resumed.json`).** `docs/TESTES.md` lista
"virada de meia-noite zerando o estado do dia" como um caso obrigatório de teste **de unidade**
(sem I/O) — isso só é possível se o reset for lógica pura, e não uma consequência de como o
armazenamento futuro chaveia o arquivo em disco. `DayState` carrega seu próprio campo `day` para
isso (ver o comentário em `core/types.ts`); nenhum método de `Storage` foi acrescentado
(`saveState`/`readState` ficam para S4-T3/S4-T4, conforme a tarefa pediu explicitamente para não
inventar chave em disco).
**Opções:** A) reset dentro do `core/`, com `day` embutido no tipo (o que implementei). B) esperar
a S4-T3/S4-T4 decidirem a chave de disco e fazer o reset lá (mas isso deixaria o caso obrigatório
do `docs/TESTES.md` sem como ser testado nesta tarefa).
**Minha escolha:** A.

**Nomes novos, ainda fora do glossário do `AGENTS.md`:** `DayState`, `ScheduleDecision`,
`decideSchedule`, `applySnooze`, `applySkipToday`, `computeEffectiveEndOfDay`,
`resolveEndOfDayInstant`, `emptyDayState`. `DayState` já estava reservado (chega em S4-T2,
tabela de "Identificadores que vão para disco" cita só o conceito, não os nomes de campo) — os
campos (`skipped`, `snoozeMinutesTotal`, `firedLeadTimesInMinutes`, `endOfDayFired`) e os nomes de
função são meus, sem correspondente literal em nenhum documento. Nenhum dos dois vira chave em
disco nesta tarefa (ver item 6).

---


---

## Q-038 — Sete escolhas feitas fazendo S4-T1 (`adapters/notification`), registradas para confirmação

**Tarefa:** S4-T1
**Bloqueia:** não — nenhuma das sete impediu a entrega; `npm run verificar` e
`npm run verificar:linux` estão verdes com a cadeia de fallback completa e a Q-007 implementada.
Registro aqui porque cada uma tem uma leitura alternativa razoável, e "perguntar custa uma
mensagem".

**1) Spike B previa um backend "nativo" e um "degradado" por SO (e `terminal-notifier` no macOS);
implementei só UM backend nativo por SO.** O Spike B propôs, para o macOS, `terminal-notifier`
(com ações) como tier 1 e `osascript display notification` (sem ações) como tier 2 degradado — e
listava `notify-send -A` (com ações) como o caminho "certo" no Linux. A única vantagem de
`terminal-notifier`/`-A` sobre a alternativa mais simples é a ação clicável, e o contrato desta
tarefa é explicitamente **sem ações**. Trazer `terminal-notifier` — "binário externo, pode não
estar instalado", nas palavras do próprio spike — para uma capacidade que nada usa pareceria
complexidade adiantada (AGENTS.md: "escopo adiantado é defeito"). Implementei um backend nativo
só por SO: `WindowsToastBackend` (WinRT), `MacOsascriptBackend` (`osascript`, sem `terminal-
notifier`), `LinuxNotifySendBackend` (`notify-send`, sem `-A`). A cadeia de 3 níveis do spike
(nativo → degradado → stderr) vira, na prática, 2 níveis (nativo do SO → stderr), porque o nível
"degradado" só existia para separar ações caras de ações baratas.
**Opções:** A) confirma o corte — se ações se provarem (validação manual pendente, ver item 7),
`terminal-notifier`/`notify-send -A` entram como um SEGUNDO backend nativo por SO nessa hora,
não uma correção retroativa desta tarefa. B) o spike deveria ter sido seguido à risca mesmo sem
uso imediato, para não precisar revisitar a cadeia depois.
**Resposta:** _(aguardando)_

**2) Nenhum backend real é exercitado via "binário externo falsificado em `PATH`" nos testes de
unidade/integração — usei um `CommandRunner` injetável.** `docs/TESTES.md` § `notification/` diz
literalmente "cada backend com o binário externo falsificado". Segui essa letra para `generation/`
e `resumption/` (que a copiam de `claude`) por um motivo concreto que não se aplica aqui: D-015
exige provar que conteúdo de tamanho variável sobrevive a uma fronteira de processo REAL sem
mutilação de shell — e essa prova só é honesta com um processo de verdade do outro lado. O
conteúdo do toast nunca atravessa um shell: vai de string JS para base64 (`-EncodedCommand` no
Windows) ou para um elemento de array `argv` (POSIX, `shell:false`) — a montagem é 100%
determinística e não tem "do outro lado de um processo real" para corromper algo. Testei a
montagem dos argumentos com um `CommandRunner` injetado (nomeado, `RecordingCommandRunner`) e
adicionei um teste de integração à parte (`tests/integration/notification/spawn-command.test.ts`)
que exercita o `spawnCommand` genérico contra um processo REAL inofensivo (o próprio `node
--version`) — nunca `powershell.exe`/`notify-send`/`osascript` de verdade, que é exatamente o que
a tarefa pediu para nunca acontecer durante o teste. `docs/TESTES.md` foi atualizado com essa
justificativa.
**Opções:** A) confirma a leitura — a letra de `docs/TESTES.md` valia para o motivo (D-015), não
para a forma (arquivo em PATH), e este caso não tem o motivo. B) a letra é a regra, e cada backend
deveria ter seu próprio binário falso em `PATH`, com o mesmo custo de engenharia que
`generation/`/`resumption/` pagaram (um `.exe` compilado via `csc.exe` no Windows).
**Resposta:** _(aguardando)_

**3) Notificar o resultado do `end-day` (passo 5 da spec) foi ligado no `cli/`, não dentro de
`application/endDay`.** O próprio `application/end-day.ts` (S2-T3) já dizia no comentário: "step
5 — notifying the result — is S4-T1", sem dizer ONDE. Escolhi `cli/end-day-command.ts` (nova
função `notifyEndDayResult`, novo módulo `cli/end-day-notice.ts` para o texto) em vez de crescer
`EndDayDeps`/`endDay()` com mais uma porta, por três motivos: (a) manteria `application/endDay`
puro de um efeito colateral que nada no pipeline de captura precisa saber sobre; (b)
`EndDayDeps`/`endDay()` são usados por muitos testes existentes (S2-T3/S2-T5), e um novo campo
obrigatório teria um raio de alcance grande para uma tarefa que deveria ficar isolada de
`core/`/`application/`; (c) é exatamente o padrão D-020 pede — a fiação fica no `cli/`. Sessões
que não passam por um `endDay(...)` real (o caso `--session` sem correspondência, e o caso "sessão
sumiu entre a resolução e o `endDay`") não notificam — nada de real aconteceu para relatar.
`--dry-run` também não notifica (é uma prévia, não "encerramento executado").
**Opções:** A) confirma a escolha de camada. B) `Notifier` deveria ter entrado em `EndDayDeps`
mesmo, para que `seeya end-day` notifique de forma idêntica não importa quem o chame (hoje só
`cli/index.ts` chama `runEndDayCommand`, mas o daemon em S4-T3 pode vir a chamar `endDay`
diretamente).
**Resposta:** _(aguardando)_

**4) `runEndDayCommand` ganhou um 4º parâmetro `notifier` OPCIONAL, com um `SilentNotifier` como
default.** Consequência direta da escolha do item 3: `EndDayCommandOptions`/`EndDayOptions` já
usam exatamente este padrão (parâmetro novo opcional, docstring explicando que é para manter todo
call site existente compilando). Segui o mesmo, em vez de tornar `notifier` obrigatório e editar os
~15 call sites de teste já existentes em `tests/unit/cli/end-day-command.test.ts` (que não são
desta tarefa).
**Opções:** A) confirma o padrão — consistente com o precedente já aceito. B) `notifier`
deveria ser obrigatório, forçando cada chamador a decidir explicitamente, e os call sites
antigos deveriam ter sido atualizados.
**Resposta:** _(aguardando)_

**5) O e2e (`tests/e2e/_harness.ts`) ganhou um binário nativo de notificação FALSO em `PATH`, para
todo teste, não só os de `end-day`.** Medi (não deduzi) que sem isso, `npm run test:e2e` mostraria
uma notificação REAL na tela de quem roda o portão nesta máquina Windows: o `cli/composition.ts`
agora liga o `Notifier` real de produção (`adapters/notification/index.ts`), e todo e2e de
`end-day` sem `--dry-run` chama `notify()` de verdade. `tests/e2e/_fake-notification-commands.ts`
instala um `powershell.exe` (Windows, `.exe` compilado via `csc.exe`, mesma técnica de
`tests/integration/generation/_fixtures.ts`) ou `notify-send`/`osascript` (POSIX, script `#!/bin/sh
exit 0`) na frente do `PATH`, para os três SOs uniformemente — mesmo sabendo que só um dos três é
resolvido de fato em cada execução. Confirmado rodando `npm run test:e2e` real nesta máquina antes
e depois: sem o fake, nenhum teste falhava (a suíte não afirma nada sobre notificação), mas o
processo abria um toast de verdade — comportamento que não aparece em nenhuma asserção, só na
tela. Depois do fake, os mesmos testes passam sem nenhum toast.
**Opções:** A) confirma a mudança no harness compartilhado — o risco (mostrar notificação real
durante `npm test`) é concreto e a tarefa pede explicitamente para evitá-lo. B) o fake deveria
viver só nos testes de `end-day`, não em TODOS os e2e (hoje ele instala para os três SOs
incondicionalmente, mesmo em `sessions.test.ts`/`start-day.test.ts`, que nunca chamam `end-day`).
**Resposta:** _(aguardando)_

**6) Removi a citação a "docs/QUESTOES.md Q-004" do comentário de topo de `core/ports.ts`.**
Editando esse parágrafo (para tirar `Notifier` da lista de "ainda faltando"), reparei que a
citação "Open question about this scope cut: docs/QUESTOES.md Q-004" não bate com o conteúdo real
de Q-004 (que é sobre quatro achados de S1-T1 — elegibilidade, união discriminada, estado
`unknown`, sessão viva sem transcript — nada sobre `Notifier`). Não investiguei a origem do
descompasso (pode ser um número que mudou de dono numa reorganização anterior). Removi a citação
em vez de corrigi-la para outro número, por não saber qual seria o certo.
**Opções:** A) confirma a remoção — citação quebrada é pior que nenhuma. B) havia uma Q-004
"original" sobre `Notifier` que foi sobrescrita por engano, e vale investigar o histórico do
arquivo para recuperar o texto perdido.
**Resposta:** _(aguardando)_

**7) Achado ortogonal, não desta tarefa: `tests/e2e/end-day.test.ts` já tinha uma asserção
quebrada antes desta tarefa, sem relação com notificação.** `describe('e2e: seeya end-day (nº3)...
--session', () => { it('a --session value matching no discovered session says so...') })` espera
`'1 session(s) were discovered in total'`, mas `src/cli/end-day-command.ts#formatNoMatchMessage`
sempre produziu `'1 session was discovered in total'` (singular sem `"(s)"`, plural vira `"sessions
were"`) — nunca a forma `"session(s)"` que o teste procura. Confirmado com `git show HEAD` no
próprio arquivo de teste: o descompasso já existia antes de eu tocar em qualquer coisa, não é
regressão desta tarefa. Não toquei nele — não é escopo desta tarefa e a mensagem de produção em si
parece correta (concorda em número). `npm run verificar`/`verificar:linux` não rodam
`test:e2e` (script separado), então isso não bloqueia o portão desta tarefa, mas fica registrado
porque `npm run test:e2e` está vermelho por este motivo hoje.
**Opções:** A) corrigir a asserção do teste para "1 session was discovered in total" (produção
está certa). B) investigar se a intenção original era outra forma de mensagem.
**Resposta:** _(aguardando)_

---

## Q-039 — Três escolhas feitas fazendo S4-T00d (leitura do envelope em saída ≠ 0), e um segundo lugar onde evidência já em mãos é descartada

**Tarefa:** S4-T00d
**Bloqueia:** não — as três escolhas seguiram a solução mínima com o porquê no próprio código
(`src/adapters/generation/errors.ts`, `src/adapters/generation/run-generation.ts`); registro para
confirmação, no mesmo espírito de Q-021/Q-023/Q-037. O achado adicional (último item) não foi
consertado, por pedido explícito da tarefa de não ampliar o alcance sem decisão do mantenedor.

**Contexto.** A tarefa pedia para, em saída ≠ 0, tentar ler o `stdout` como envelope
`--output-format json` antes de desistir para `nonZeroExit`, e deixava três decisões comigo.

**1) `modelReportedError` ganhou `exitCode: number`, sempre presente, nunca opcional.** Cheguei a
considerar campo opcional (só preenchido quando a chamada veio do ramo de saída ≠ 0), mas as duas
chamadas de `runGeneration` (a de saída limpa e a nova, de saída ≠ 0) sempre têm o código de saída
em mãos — não é dado às vezes ausente, é dado sempre conhecido. Um campo opcional para algo sempre
conhecido teria sido exatamente o anti-padrão que D-024 pede para evitar (campo opcional cobrindo
uma distinção que devia estar no tipo). A mensagem final passou a nomear o `exitCode` nos dois
casos, sem afirmar qual dos dois "explica" o outro (D-025) — só relata os dois fatos observados,
lado a lado.
**Opções:** A) `exitCode` obrigatório, sempre o valor real (o que implementei). B) campo opcional,
presente só no caminho de saída ≠ 0. C) não distinguir os dois casos (perderia a distinção que o
próprio pedido da tarefa levantou como possivelmente relevante).
**Minha escolha:** A.

**2) O corte de tamanho do `result` mora em `errors.ts#describe()`, não em `run-generation.ts`.**
A tarefa alertava que `result` pode carregar saída do modelo e vai parar em `generationError`, que
é gravado no handoff em disco. Cortei em 500 caracteres, mas o corte acontece ao RENDERIZAR a
mensagem (`describe()`), não ao construir o `GenerationFailureReason`. Assim, `error.reason.result`
continua carregando o valor completo e sem corte para quem faz pattern-matching programático
(`error.reason.kind === 'modelReportedError'`), e só o texto que efetivamente vai para o disco
(`error.message`, usado por `application/generation-policy.ts#deterministicOutcome`) fica limitado.
O limite e o motivo estão comentados em `errors.ts`, em cima da constante `MAX_MODEL_RESULT_CHARS`.
**Opções:** A) truncar em `describe()`, preservando `reason.result` íntegro (o que implementei).
B) truncar já em `run-generation.ts`, armazenando a versão cortada dentro do `reason` — mais simples,
mas perde o `result` completo para sempre, mesmo para quem só quer inspecionar a estrutura, não a
mensagem.
**Minha escolha:** A — nenhum teste ou caller hoje precisa do `result` completo, mas cortá-lo na
origem destruiria informação que `describe()` sozinho já resolve sem destruir nada.

**3) O `stdout` bruto de `nonZeroExit` ficou SEM corte de tamanho, ao contrário do `result` de
`modelReportedError`.** A tarefa só pediu limite explicitamente para o `result` (que carrega saída
do MODELO); o `stdout` ilegível de `nonZeroExit` seguiu o mesmo padrão que `invalidJson#raw` já
tinha antes desta tarefa — incluído por inteiro, sem corte. Não medi o quão grande esse `stdout`
pode ficar na prática (é justamente o caso em que não conseguimos nem interpretá-lo como o
envelope conhecido), então não tenho evidência para escolher um limite — inventar um agora seria
o mesmo erro que a D-011 já cometeu uma vez (estimar sem medir).
**Opções:** A) sem corte, igual a `invalidJson` (o que implementei). B) mesmo corte de 500
caracteres do `result`. C) um limite maior, específico para stdout bruto.
**Minha escolha:** A — por consistência com o precedente já existente e por falta de medição que
justifique um número diferente.

**Achado à parte, não consertado: `spawn-claude.ts`'s `timeout` reason descarta o mesmo tipo de
evidência que esta tarefa concertou para `nonZeroExit`.** Ao ler os quatro arquivos pedidos, notei
que `spawnClaude` acumula `stdout`/`stderr` em variáveis de closure enquanto o processo roda, mas o
ramo de timeout (`AbortSignal.timeout` disparando o evento `'error'` como abort) rejeita só com
`{ kind: 'timeout', timeoutMs }` — o que quer que já tivesse chegado em `stdout`/`stderr` antes do
`SIGTERM` é descartado, exatamente a mesma classe de "saída ≠ 0 descarta o envelope antes de olhar"
que motivou esta tarefa, só que no caminho de timeout em vez do de saída ≠ 0. Uma chamada que
estourou o orçamento de tempo perto do fim de um turno longo (o cenário de hipótese de orçamento
que esta própria tarefa foi instruída a NÃO perseguir) é justamente o tipo de falha em que já
existiria stdout parcial útil para diagnóstico. Não consertei — está fora do que a tarefa pediu, e
o próprio `AGENTS.md` pede para abrir questão em vez de ampliar escopo sozinho. Registro aqui para
o mantenedor decidir se `timeout` também deveria carregar o `stdout`/`stderr` parcial coletado até
o abort.

**Nota à parte, não é pergunta:** `npm run verificar:linux` oscilou verde/vermelho três vezes
seguidas nesta tarefa (vermelho, vermelho — desta vez também `layer-matrix.test.ts`, não só
`eslint-restrictions.test.ts` —, verde), sempre com a mesma assinatura de Q-030a
(`CHILD_PROCESS_BUDGET_MS` estourado em arquivos de `guards/` sem relação nenhuma com
`adapters/generation/`). Bate exactly com o cenário que a Q-030a já previu: **esta tarefa rodou em
paralelo com a S4-T1**, então a contenção de CPU entre os dois contêineres Docker é exatamente a
causa já registrada lá. Não abri questão nova — Q-030a já cobre o padrão e já diz o que fazer (nada,
a menos que fique vermelho sem agente em paralelo ou no CI).

---


---

## Q-040 — S4-T00e: onde a distinção de `source` mora, por que `noTranscript` leva o mesmo tratamento de `deterministic`, e onde o limite de retentativas do daemon vai encaixar

**Tarefa:** S4-T00e
**Bloqueia:** não — a tarefa deixou as duas escolhas comigo, com o critério; registro do
raciocínio, não pedido de decisão.

**1) Onde a distinção mora: dentro do `core/eligibility.ts`, não em `eligibility-assembly.ts`.**
`PreviousCaptureToday` ganhou um campo `source: HandoffSource`, e a condição 5
(`duplicateToday`) só dispara quando `previousCaptureToday.source === 'model'`. A alternativa óbvia
era filtrar na montagem — se `previousHandoff.source !== 'model'`, passar `previousCaptureToday:
null` para o núcleo, que continuaria sem saber que `source` existe.

Escolhi o núcleo pelo mesmo motivo que o próprio arquivo já documenta para as outras quatro
condições: `evaluateEligibility` é o lugar único onde as cinco condições da elegibilidade (D-026
inclusa) vivem juntas, testáveis como regra pura, sem precisar de um `Storage` fake para exercitar
cada combinação. "Quais handoffs contam como captura para efeito de duplicidade" não é resolução
de I/O — é parte da própria regra de anti-duplicidade, do mesmo jeito que "qual assinatura comparar"
já é. Filtrar na montagem esconderia essa metade da regra num `? :` sem teste direto de núcleo, e
o dia em que alguém precisasse explicar a regra completa (por exemplo, para o `seeya sessions`)
teria que ler dois arquivos em vez de um.

Contra-argumento que considerei e descartei: manter o núcleo "sem saber de `source`" o deixaria
mais simples de ler. Não me convenceu — `HandoffSource` já é um tipo do próprio `core/types.ts`
(não é um conceito de infraestrutura vindo de fora), então importá-lo não fere a regra de pureza
do núcleo (sem I/O, sem `node:*`, sem adapter). É dado de domínio, não de mundo.
`application/eligibility-assembly.ts` ficou só repassando o campo do handoff lido — nenhuma decisão
nova mora lá, e o comentário da função diz isso explicitamente.

**2) `noTranscript` leva exatamente o mesmo tratamento que `deterministic` — não distingui.**
Os dois valores significam "o modelo não analisou esta sessão", só que por motivos diferentes:
`deterministic` é tentativa que falhou (orçamento, rede, timeout — `GenerationError`);
`noTranscript` é tentativa que **nunca aconteceu** (hoje um valor morto — `types.ts` documenta que
`application/generation-policy.ts` não o produz ainda, reservado para uma política futura de "pular
o modelo quando não há transcript"). Considerei tratá-los diferente — por exemplo, um poderia
"contar menos" que o outro para uma retentativa futura mais cautelosa — mas não achei razão para
isso na regra de elegibilidade: para efeito de "isto é um veredito sobre a sessão?", a resposta é
não nos dois casos, pela mesma razão (D-025 — ausência de análise não é veredito, não importa se a
ausência veio de falha ou de nunca ter sido tentada). Qualquer distinção de tratamento entre os
dois seria uma decisão de produto sobre a política de retentativa (por exemplo, "não vale a pena
tentar de novo uma sessão sem transcript"), não uma decisão de elegibilidade — e essa política nem
existe ainda no código (`noTranscript` é inalcançável hoje). Inventá-la agora seria decidir por
antecipação um comportamento que ninguém pediu.

**3) Onde o limite de retentativas do daemon (S4-T3) vai ter que encaixar — registrado como a
tarefa pediu, não implementado.** Lendo `application/eligibility-assembly.ts#evaluateFullEligibility`
e `application/end-day.ts`, o ponto de encaixe mais natural é **antes** da chamada a
`evaluateFullEligibility` (ou dentro dela, como um sexto critério que o núcleo NÃO deveria ganhar
sozinho — ver abaixo): o daemon vai precisar contar, por `sessionId` e por dia, quantas vezes já
tentou gerar um handoff `model` e falhou, e comparar com um teto antes de sequer chamar a
elegibilidade de novo. Dois formatos de dependência que vejo, para quem for fazer a S4-T3 escolher:

- **Um contador em `DayState`** (S4-T2, já existe o tipo) seria o lugar natural para persistir
  "tentativas de captura de `sessionId` X hoje" — evita inventar uma chave nova solta em disco
  (D-027), já que `DayState` é exatamente o registro de progresso do dia.
- **Alternativa sem estado novo:** contar handoffs `deterministic` já gravados hoje para o mesmo
  `sessionId` lendo o histórico existente (se `Storage` algum dia guardar mais de um handoff por
  sessão por dia — hoje só guarda o último, `saveHandoff` sobrescreve). Essa opção não funciona com
  o formato atual de armazenamento sem mudança adicional, então tende a empurrar para a primeira.

**Não implementei nenhuma das duas** — nem contador, nem chave nova em disco — porque a própria
tarefa proibiu isso explicitamente e o limite é do daemon, não desta tarefa. Deixo aqui só o
apontamento de onde o gancho fica, para a S4-T3 não descobrir isso do zero.

**O que não se sustentou ao encostar no código:** nada. A causa descrita na tarefa bateu exatamente
com o código lido (`evaluateFullEligibility` monta `previousCaptureToday` só a partir de
`previousHandoff.facts`, ignorando `previousHandoff.source`) — não houve necessidade de corrigir
nenhuma premissa da tarefa.

**Opções que enxergo, para quem revisar:** A) manter a distinção dentro do núcleo, como implementei.
B) mover para a montagem, deixando o núcleo cego a `source` — mais simples de explicar em uma
frase, mais fraco como documentação executável da regra completa.
**Minha escolha:** A, pelos motivos acima.

---

## Q-041 — Sete escolhas feitas fazendo S4-T0b (implementar a D-031), registradas para confirmação

**Tarefa:** S4-T0b
**Bloqueia:** não — todas seguiram a solução mínima com o porquê no próprio código; registro para
confirmação, no mesmo espírito de Q-021/Q-023/Q-037/Q-039.

**Contexto.** A D-031 dizia "capture o que está vivo e o que morreu por acidente, liste o que
fechou com carinho", mas deixava comigo onde o corte de escopo mora, como a listagem se encaixa no
briefing persistido, e o que fazer quando a leitura do título falha. Registro as sete abaixo.

**1) O corte de escopo é `session.hasPid`, sem campo novo em `DiscoveredSession` nem em
`DiscoveryResult`.** Antes de escrever código, conferi se as três populações da D-031 já
correspondiam a um discriminante existente — e correspondem: `adapters/discovery/registry.ts`
exige `pid` no schema, então toda sessão que vem do registro é `SessionWithPid`, viva ou morta
(`processIsAlive` decide `alive`/`idle` vs `ended`, nunca o tipo); a varredura de transcript
(`transcript-scan.ts`) só produz `SessionWithoutPid`; e a fusão (`merge.ts#fuseSession`) só
promove para `SessionWithPid` quando o registro de fato viu a sessão. `core/classification.ts`
já usava exatamente essa mesma checagem para decidir `unknown` vs as outras três. Criei
`core/capture-scope.ts#isCaptureCandidate(session) = session.hasPid` como nome só para isso não
ficar implícito e para não obrigar cada consumidor futuro (`seeya sessions`, por exemplo) a
redescobrir a regra por conta própria.
**Opções:** A) predicado puro sobre o discriminante existente (o que implementei). B) campo novo
`captureEligible: boolean` em `DiscoveredSession` — redundante com `hasPid`, e D-024 pede tipo
sem redundância representável. C) duas listas dentro de `DiscoveryResult` — misturaria "fora de
escopo" com "rejeitado" (D-022 trata rejeitado como registro inválido, coisa diferente), e o
enunciado da tarefa pediu explicitamente para não misturar as duas.
**Minha escolha:** A.

**2) O corte acontece em `application/end-day.ts`, antes de `evaluateCheapEligibility`, nunca
dentro de `core/eligibility.ts`.** `discovery.sessions` é particionado em `captureCandidates` e
`outOfScopeSessions` logo após a descoberta; só `captureCandidates` (depois filtrado por
`--session`, se houver) chega a `mapWithConcurrencyLimit`/`runSession`. Não toquei
`core/eligibility.ts` nem `application/eligibility-assembly.ts` (S4-T00e).
**Minha escolha:** única opção compatível com a instrução da tarefa ("ponha o corte antes da
elegibilidade... se não couber assim, pare e reporte") — coube, sem invadir os dois arquivos.

**3) `SessionListing` é tipo próprio em `core/types.ts`, não um `Handoff` enxuto nem um campo a
mais em `SessionFacts`.** Uma sessão listada nunca foi capturada — não tem `understanding`,
`pendingItems` nem `tomorrowPlan` — e misturar os dois tipos faria "isto foi capturado ou só
listado?" virar uma pergunta que o leitor infere pelos campos vazios em vez de o próprio tipo já
responder (mesma lógica da D-024 aplicada a um par de conceitos bem menor). `aiTitle`/`lastPrompt`
saem por um método novo do `TranscriptReader` (`readListingInfo`), não por `readFacts` +
campos novos em `SessionFacts`: uma sessão listada nunca entra no pipeline de captura que
`readFacts` alimenta, então dar ao tipo orientado a handoff dois campos que ele nunca usa
confundiria por que eles estão lá.
**Termos novos, para o glossário de `AGENTS.md`:** `SessionListing` (core/types.ts),
`TranscriptListingInfo` e `readListingInfo` (core/ports.ts), `isCaptureCandidate`
(core/capture-scope.ts). Nenhum vai para disco — ver item 4.

**4) A listagem nunca é persistida — nem em `Handoff`, nem em `resumed.json`, nem em artefato
novo.** `application/end-day.ts` recalcula `outOfScopeSessions`/`listedSessions` a cada execução, a
partir da descoberta fresca daquela chamada, e passa isso direto para
`writeDailyBriefing`/`previewDailyBriefing` → `generateBriefingMarkdown`. **Consequência que quero
que fique visível:** ao contrário dos handoffs (que `Storage#listHandoffs` acumula do dia inteiro,
mesmo entre execuções de `seeya end-day --session <id>` separadas), a seção "Not captured" do
`summary.md` reflete só a ÚLTIMA execução — se a sessão A apareceu como fechada numa execução das
14h e a sessão B só ficou "unknown" numa execução das 18h, o `summary.md` das 18h não mostra A a
menos que ela ainda esteja "unknown" na descoberta das 18h. Não implementei acumulação (um
`listed.json` por dia, no estilo de `early-warnings.json`/`resumed.json`) porque a D-031 não pede
histórico, só identificação no momento — mas é uma divergência real de comportamento entre as duas
seções da mesma página, e vale a pena o PO confirmar que é aceitável.
**Opções:** A) sem persistência, sempre a foto da última descoberta (o que implementei). B) arquivo
`~/.seeya/days/<day>/listed.json` acumulando por `sessionId`, igual aos outros dois casos citados.
**Minha escolha:** A — menor superfície nova, e nada na D-031 ou no item de plano pedia histórico.

**5) Falha ao ler `ai-title`/`last-prompt` de UMA sessão listada nunca aborta o restante, e
também não vira um balde "rejeitado" visível (diferente de D-022).**
`application/session-listing.ts#buildOneListing` captura qualquer rejeição de
`readListingInfo` e degrada para `{ aiTitle: null, lastPrompt: null }` — mesmo "sem título",
nunca "erro". Decidi não dar a isso um bucket próprio em `EndDayResult` (como
`failedCaptures`/`forkCleanupError` têm) porque a listagem é só identificação para humano, nunca
o trabalho de verdade do comando — a mesma razão que `core/ports.ts#Notifier.notify()` já usa para
nunca rejeitar. Se um dia isso incomodar (por exemplo, alguém querendo saber SE havia erro de
permissão nalgum `.jsonl`), dá para adicionar sem quebrar nada, porque hoje a informação
simplesmente não é gravada em lugar nenhum.
**Opções:** A) degrada silenciosamente para nulo (o que implementei). B) novo campo
`listingErrors: readonly { sessionId, reason }[]` em `EndDayResult`, no espírito de D-022.
**Minha escolha:** A, por proporcionalidade ao que a D-031 pede — mas B é barato de acrescentar se o
PO preferir a simetria com o resto do arquivo.

**6) `listedSessions` nunca é filtrado por `--session`/`sessionFilter` — reflete sempre a
descoberta inteira, mesmo quando `--session` restringe a captura a uma sessão só.** O raciocínio:
`--session` é uma flag de ESCOPO DE CAPTURA (D-002 é quem a justifica — ela também decide qual
sessão pode ser terminada), não uma flag de "o que você quer saber". Testei isso explicitamente
(`tests/unit/application/end-day.test.ts`, "listedSessions is unaffected by --session"). Não é
óbvio que seja o comportamento certo — dá para argumentar que `--session <id-de-uma-sessão-viva>`
não deveria imprimir a listagem de TODAS as fechadas do dia, só para reduzir ruído.
**Opções:** A) listagem sempre completa, independente de `--session` (o que implementei). B)
`--session` também filtra a listagem, mostrando zero linhas quando o valor casa uma sessão viva.
**Minha escolha:** A — `seeya sessions` (o comando de diagnóstico) já mostra tudo sem filtro, e
tratar a listagem como diagnóstico, não como parte do que `--session` recorta, pareceu mais
consistente com esse precedente.

**7) Ressalva da D-031 sobre teste de contrato para `ai-title`/`last-prompt`: não abri um.**
A ressalva compara explicitamente com o `--append-system-prompt-file` (Q-029) e diz "se valer,
abra questão em vez de construir" — mas diferente daquele caso, aqui a superfície já é tolerante
por construção: `aiTitleEntrySchema`/`lastPromptEntrySchema` só validam o campo que leem, um
`z.object()` sem `.strict()` ignora campos desconhecidos (D-021), e se o Claude Code um dia mudar
a FORMA da entrada (não só acrescentar campo), a pior consequência é `aiTitle`/`lastPrompt`
voltarem `null` — a mesma "listagem sem título" que a D-031 já pede para o caso de ausência. Não
há travamento nem exceção possível, ao contrário do `--append-system-prompt-file` (onde a semântica
errada silenciosamente trocaria o prompt de sistema do fallback de retomada, um bug ativo, não uma
degradação honesta). Julguei que isso não atinge a barra "merece teste de contrato" — mas registro
aqui, como a ressalva pede, para o PO decidir se quer um mesmo assim (rodaria contra o
`~/.claude` real, fora do CI padrão, confirmando que as duas entradas ainda existem com esses
nomes de campo na versão instalada).
**Minha escolha:** não construí. Se o PO achar que vale, é um teste pequeno e me diz o formato de
"Bloqueia" que prefere para tarefa futura.

**Achado à parte, não é pergunta:** dois testes existentes de `end-day.test.ts` usavam
`createSessionWithoutPid` para exercitar aceites que não têm nada a ver com D-031 ("sessão sem
nenhuma evidência" e "sessão só com git respondendo") — e que, depois do corte de escopo, deixaram
de alcançar `core/eligibility.ts` de verdade, porque toda `SessionWithoutPid` agora nem chega lá.
Troquei os dois fixtures para `createSessionWithPid` (preservando o que cada teste realmente prova:
`noEvidence` com `lastActivity: null`, e "só git responde" com `hasTranscript: false` — o cenário
real do agente-interno, D-013), e documentei a troca com um comentário citando esta tarefa. Nenhum
dos dois testes mudou de propósito, só de fixture; acho que vale a atenção do revisor mesmo assim,
porque um diff que troca `createSessionWithoutPid` por `createSessionWithPid` sem contexto parece
suspeito de estar escondendo alguma coisa.


**Resposta:** **FECHADA — e a pergunta do `--session` revelou um defeito maior que ela mesma.**

**1) `--session` deveria estreitar a listagem? Nem uma coisa nem outra: o problema é outro.**

O mantenedor levantou, em 2026-09-01, que escolher deliberadamente **uma** sessão e receber a
lista completa das fechadas não parece respeitar a escolha. E ele mesmo apontou o contra: **não
há como correlacionar** sessão fechada com a que foi escolhida.

**O contra é mais forte do que parece.** Filtrar a listagem por `--session` daria quase sempre
**vazio** — o valor casa com a sessão selecionada, e essa, por definição, está *em escopo de
captura*, então nunca aparece na listagem. Filtrar não seria "mostrar menos", seria "não mostrar
nada". Nenhuma das duas opções óbvias serve.

**O defeito real, verificado no código:** `core/briefing.ts` **não tem noção nenhuma de ter sido
uma execução filtrada.** Nada no `summary.md` registra que o dia foi recortado.

Consequência: um `seeya end-day --session X` produz um `summary.md` **indistinguível** de um dia
completo que por acaso tinha uma sessão só. Quem abrir aquele arquivo amanhã vê um handoff e
conclui que o dia teve uma sessão relevante — quando cinco sessões vivas podem nunca ter sido
olhadas. **É o D-025 no nível do dia:** ausência de handoff lendo como "aquela sessão não tinha
nada", quando o correto é "ninguém olhou".

E é isso que torna a listagem estranha: ela é a **única parte do documento que se comporta como
visão do dia inteiro**, dentro de um documento que é recorte e não se declara recorte.

> **CORREÇÃO (2026-09-01, apontada pelo mantenedor).** Esta resposta afirmou, e o brief da
> S4-T0c repetiu, que *"o comando não sabe quais sessões deixaram de ser capturadas por causa do
> filtro, só que houve filtro"*. **Está errado, e verificado no código:**
> `application/end-day.ts#applyCaptureScope` calcula `captureCandidates` e `sessionsInScope` na
> **mesma função, lado a lado**. No instante em que o filtro roda, as duas listas estão em mãos —
> o total de candidatas, quantas sobraram, e por diferença **quantas** e **quais** foram
> descartadas. Não é inferência; é subtração de dois arrays que o código já segurou.
>
> **A consequência foi um texto fraco, implementado obedecendo a premissa errada:** *"Other
> sessions discovered today **may not** have been looked at"*. "May not" onde existe número
> disponível é vago sem necessidade, e soa como incerteza técnica quando é só a nota não contar o
> que já foi contado. É o inverso do erro que este projeto persegue: em vez de afirmar o que a
> evidência não sustenta, **deixar de afirmar o que ela sustenta**.
>
> **A nota passa a trazer o número.** Algo na forma "1 de 4 candidatas foi considerada; 3 foram
> descartadas pelo filtro" — mais honesto, mais curto e mais útil que o texto atual.
>
> **Cuidado de aritmética, para não trocar um erro por outro:** o denominador é **candidatas a
> captura**, não "sessões descobertas". Descobertas inclui as fechadas, que aparecem na listagem e
> **não** foram descartadas pelo filtro — eram outra população desde o começo. Misturar as duas
> faria a nota mentir na direção oposta.
>
> **Listar quais** sessões foram descartadas fica em aberto de propósito: pode virar ruído, e
> `--session` costuma ser deliberado. O **total**, não — esse não tem defesa. Ver **S4-T0d**.

**Decisão: a listagem continua completa, e o artefato passa a registrar que a execução foi
recortada.** Com isso escrito, listagem completa vira coerente — contexto do dia, rotulado como
tal, dentro de um documento que se declara parcial. Vira a **S4-T0c**.

Isso também cobre um caso sem relação com listagem: `--session` usado por engano, ou usado às 14h
com intenção de rodar o dia completo depois e a pessoa esquecendo. Hoje nada no arquivo denuncia.

**2) Persistir a listagem por dia, como os handoffs? Não.**

Ela é derivável do transcript a **custo zero de modelo**, e persistir criaria chave em disco que a
D-027 avisa ser barata agora e cara depois. E o sintoma descrito — sessão listada às 14h somindo
do `summary.md` das 18h — **é o comportamento correto**: se ela deixou de ser `unknown`, voltou a
ser capturável, e sair da listagem é justamente a informação certa.

**3) Falha ao ler a listagem merece balde visível? Sim.**

Mesmo raciocínio da D-022. Hoje "sem título" significa **duas coisas diferentes**: não havia
`ai-title`, ou a leitura falhou. Achatar as duas é o que o D-025 proíbe — e a segunda é a única
que pede ação de alguém. Entra na S4-T0c, junto com o recorte declarado.

**4) Teste de contrato para `ai-title`? Não agora.**

Mesma conclusão da Q-029, e pelo motivo oposto ao que a justificou lá. Se o `ai-title` sumir, a
listagem degrada para "sem título" e **nada quebra** — o custo de errar é baixo. No
`--append-system-prompt-file` era caro: a sessão de fallback abriria sem o prompt de sistema
padrão, sem ninguém perceber.

**Os outros três registros da Q-041** (o corte de escopo ser o `hasPid` que já existia, a troca
de fixtures nos dois testes do `end-day`, e o teto de identificação que a listagem herda da
D-031) ficam confirmados como estão. A troca de fixtures em especial foi bem sinalizada: sem
aquela nota, um diff trocando construtor por construtor pareceria suspeito na revisão.

## Q-042 — Seis escolhas fazendo S4-T0c (recorte declarado + leitura de título distinguível), registradas para confirmação

**Tarefa:** S4-T0c
**Bloqueia:** não — todas seguiram a solução mínima com o porquê no próprio código; registro para
confirmação, no mesmo espírito de Q-021/Q-023/Q-037/Q-039/Q-041.

**Contexto.** A resposta da Q-041 deixou dois escopos comigo: declarar o recorte de `--session` no
artefato (Escopo 1) e separar "sem título" de "leitura falhou" na listagem (Escopo 2). Registro as
seis escolhas de forma abaixo.

**1) Tipo novo `core/types.ts#EndDayScope`, união discriminada, nunca um `sessionValue?: string`
solto.** `{ kind: 'fullDay' } | { kind: 'singleSession'; sessionValue: string }`. Testei a
alternativa mais simples (um campo opcional) e ela reintroduz exatamente o problema que a Q-041
apontou: "ausência do campo" viraria o significado de "dia completo", o mesmo erro que o D-025
proíbe em qualquer outro dado do projeto. `sessionValue` carrega o valor CRU de `--session`, nunca
o `sessionId` resolvido — mesmo raciocínio que `formatNoMatchMessage`
(`cli/end-day-command.ts`) já usa: o `seeya` não sabe o que a pessoa digitou, só o que chegou, e
mostrar isso sem tradução é o que deixa a pessoa reconhecer a própria execução dias depois.
**Termo novo para o glossário:** `EndDayScope` (`core/types.ts`), campo `sessionValue`.
**Opções:** A) união discriminada, obrigatória em todo lugar que o valor final é consumido (o que
implementei). B) `sessionValue?: string`, com `undefined` significando "dia completo" — rejeitada
pelo motivo acima.
**Minha escolha:** A.

**2) `EndDayScope` viaja como campo OPCIONAL em `EndDayOptions.scope` (a entrada de `endDay`), mas
como campo OBRIGATÓRIO, já resolvido, em `EndDayResult.scope` e em todo parâmetro de
`core/briefing.ts`/`application/briefing.ts`.** A costura acontece uma vez, dentro do próprio
`endDay()`: `options.scope ?? { kind: 'fullDay' }`. Considerei derivar o escopo diretamente da
presença de `options.sessionFilter` (economizaria um campo), mas `sessionFilter` é um predicado
livre — vários testes existentes passam um sem exercitar `--session` de verdade (`() => false`,
comparando por campo não relacionado) — e inferir "isto foi um recorte" a partir de "um predicado
foi passado" faria um teste não relacionado começar a declarar um recorte que nunca quis declarar.
Mantive os dois campos independentes; só `cli/end-day-command.ts` (a única chamada real de
produção com `--session`) os define juntos, a partir do mesmo `resolvedSessionId`/valor cru.
**Opções:** A) campo independente em `EndDayOptions`, resolvido dentro de `endDay` (o que
implementei). B) derivar de `sessionFilter !== undefined` — rejeitada pelo motivo acima. C) exigir
`scope` sempre, sem default, em `EndDayOptions` — quebraria todo teste existente que não é sobre
este recurso, custo desproporcional ao ganho.
**Minha escolha:** A.

**3) O aviso de escopo aparece no topo do `summary.md`, logo após o timestamp e ANTES da linha de
resumo (`N sessions captured today`), e afirma os dois casos por igual — nunca só o recortado.**
Um `end-day` completo agora imprime **"Scope: full day — every discovered session was considered
for capture."** explicitamente, porque o enunciado da tarefa foi direto: "a ausência de marcação
não pode ser o que significa 'completo'". O texto do recorte nunca promete o que o comando não
sabe: não lista quais sessões deixaram de ser olhadas, só que um filtro rodou e qual valor.
Repeti a mesma frase (adaptada para texto simples) no relatório do terminal
(`cli/format-end-day.ts#formatScopeLine`), logo abaixo do cabeçalho — as duas superfícies citadas
no aceite da tarefa.
**Minha escolha:** sem alternativa real considerada — a tarefa já apontava "perto do topo" e "sem
prometer o que não sabe"; o texto exato é a única coisa que fica aberta para o PO ajustar.

**4) `scope` nunca é persistido separadamente — é recomputado a cada `end-day`, igual à
`listedSessions` (Q-041 item 4).** Uma execução completa mais tarde no mesmo dia sobrescreve o
`summary.md` inteiro, inclusive a nota de escopo da execução anterior — o arquivo sempre reflete a
ÚLTIMA geração, nunca uma mistura. Escrevi isso explicitamente no docstring de
`generateBriefingMarkdown` porque não é óbvio à primeira leitura: o resto do documento (`handoffs`)
é cumulativo entre execuções do dia (via `Storage#listHandoffs`), mas o aviso de escopo não é — ele
descreve como ESTA chamada específica enxergou o mundo, não o dia inteiro.
**Minha escolha:** sem persistência — nenhuma decisão nova pede isso, e criar uma chave em disco só
para isto repetiria o custo que a D-027 já avisa.

**5) `core/types.ts#SessionListing.aiTitle`/`lastPrompt` (campos soltos) viram
`core/types.ts#SessionListingInfo` (união discriminada: `{ kind: 'read'; aiTitle; lastPrompt }` ou
`{ kind: 'unreadable'; reason }`), embutida em `SessionListing.info`.** Considerei a alternativa
mais barata — manter os dois campos e acrescentar um terceiro, `readError: string | null` — mas ela
deixa representável o estado inconsistente "`aiTitle` preenchido E `readError` setado ao mesmo
tempo", que na prática nunca acontece; a união discriminada torna isso irrepresentável (D-024), no
mesmo espírito do resto do projeto. O custo foi maior (a mudança toca `core/types.ts`,
`core/briefing.ts`, `application/session-listing.ts`, `cli/format-end-day.ts` e cinco arquivos de
teste), mas nenhum formato em disco foi afetado — a listagem nunca é persistida (item 4 acima e
Q-041 item 4), então isto é só um tipo em memória.
**Termo novo para o glossário:** `SessionListingInfo` (`core/types.ts`).
**Opções:** A) união discriminada, embutida em `info` (o que implementei). B) campo
`readError: string | null` solto ao lado de `aiTitle`/`lastPrompt` — mais barato de tocar, mas
deixa um estado inválido representável.
**Minha escolha:** A.

**6) Falha de leitura vira visível E contável, mas sem um balde novo em `EndDayResult` (ao
contrário de `failedCaptures`/`forkCleanupError`).** "Visível": cada linha da listagem cujo
`info.kind === 'unreadable'` imprime "title unavailable — could not read the transcript (motivo)"
em vez de "(no title)" — em `summary.md` e no relatório do terminal, com o texto compartilhado por
`core/briefing.ts#formatSessionListingLine` (exportado, reaproveitado por
`cli/format-end-day.ts`, mesmo padrão de `renderGitBlock`). "Contável": a introdução da seção "Not
captured" ganha uma nota agregada — "N entries could not be read for title/prompt" — quando
`N > 0`, e nada quando `N === 0` (para não transformar toda sessão sem título num alarme, como a
tarefa pediu). Não criei um campo `listingErrors` em `EndDayResult`: a informação já está inteira
dentro de `listedSessions[].info`, e um balde paralelo duplicaria o dado em vez de expor algo novo.
**Opções:** A) visível inline + nota agregada na seção, sem novo campo em `EndDayResult` (o que
implementei). B) campo `listingErrors: readonly { sessionId, reason }[]` em `EndDayResult`, no
espírito literal de `failedCaptures`.
**Minha escolha:** A — mas B é barata de acrescentar se o PO preferir a simetria com o resto do
`EndDayResult`.

**Achado à parte, não é pergunta:** o teste de aceite (`tests/unit/application/end-day.test.ts`,
"aceite: a --session-scoped run and a later full-day run...") roda `endDay` duas vezes contra o
MESMO `FakeStorage`, com a mesma sessão. A segunda chamada (dia completo) pode ou não recapturar a
sessão de novo — depende da anti-duplicidade (D-026), que compara evidência, não veio ao caso
mudar aqui. Por isso o teste não afirma `captured.length` na segunda chamada, só que o texto de
escopo dos dois `summary.md` difere — exatamente a frase do próprio aceite da tarefa ("sem precisar
comparar contagens"). Acho que vale a atenção do revisor: não é um teste fraco por acidente, é
proposital.

## Q-043 — Quatro escolhas fazendo S4-T0d (o número do descarte), registradas para confirmação

**Tarefa:** S4-T0d
**Bloqueia:** não — solução mínima com o porquê no próprio código; registro para confirmação, no
mesmo espírito de Q-021/Q-023/Q-037/Q-039/Q-041/Q-042.

**Contexto.** A CORREÇÃO da Q-041 (e a S4-T0d que ela abriu) apontou que a premissa "o comando não
sabe quais sessões o filtro descartou" estava errada: `application/end-day.ts#applyCaptureScope`
já segura `captureCandidates` e `sessionsInScope` lado a lado, então "quantas" é uma subtração de
dois arrays que já estavam em mãos. A tarefa pediu o número (não a lista) na nota de recorte, com
o denominador certo (candidatas a captura, D-031, nunca "descobertas").

**1) Tipo novo `core/types.ts#ResolvedEndDayScope`, irmão de `EndDayScope`, não o mesmo tipo com
campos novos.** Testei esticar `EndDayScope` para carregar `captureCandidateCount`/
`consideredCount` direto no `kind: 'singleSession'` e não fecha: `cli/end-day-command.ts` monta
esse valor **antes** de `endDay` rodar a própria descoberta (`EndDayOptions.scope`), e as
contagens não existem nesse instante — exigir os campos ali forçaria um placeholder (`0`?) que
pareceria dado real sem ser, o mesmo erro que a D-025 já proíbe para um fato dentro de um handoff,
agora aplicado à forma do próprio escopo. `ResolvedEndDayScope` é só o valor de saída: nunca a
forma de `EndDayOptions.scope`, sempre a de `EndDayResult.scope` e de tudo que renderiza (D-024:
dois tipos em vez de um com campo condicionalmente significativo).
**Termo novo para o glossário:** `ResolvedEndDayScope` (`core/types.ts`), campos
`captureCandidateCount`/`consideredCount`.
**Opções:** A) tipo novo, irmão de `EndDayScope` (o que implementei). B) esticar `EndDayScope` com
os dois campos, opcionais nos dois lugares — reintroduz "ausência de campo = dia completo" (o
mesmo erro que a Q-042 já tinha corrigido para o `scope` inteiro) e ainda deixa representável um
`EndDayOptions.scope` com contagens inventadas.
**Minha escolha:** A.

**2) `EndDayResult.sessionsInScope: number` não foi removido nem unificado com
`scope.consideredCount`, mesmo os dois sendo o mesmo número numa execução recortada.** Considerei
apagar `sessionsInScope` e fazer `formatDiscoverySummary`/`formatVanishedMatchMessage` lerem
`scope.consideredCount` — mas `sessionsInScope` também precisa existir e fazer sentido no caso
`fullDay`, onde `scope` não carrega contagem nenhuma (união discriminada, de propósito, item 1
acima). Manter os dois é uma pequena duplicação de valor numa execução recortada, mas os dois vêm
da MESMA chamada a `applyCaptureScope` dentro de `endDay` — nunca calculados duas vezes,
nunca podem divergir por construção, só por dois consumidores diferentes (um sempre presente, um
só no caso recortado).
**Opções:** A) manter os dois campos, aceitando a duplicação de valor no caso recortado (o que
implementei). B) remover `sessionsInScope` e fazer todo consumidor derivar de `scope`, com um
`if` para o caso `fullDay` nos dois lugares que hoje só leem um número. C) remover
`consideredCount` de `ResolvedEndDayScope` e passar `sessionsInScope` como parâmetro extra para
`core/briefing.ts`/`cli/format-end-day.ts` — rejeitada porque separa os dois números que
`renderScopeNote` precisa juntos para a mesma subtração, abrindo espaço para alguém passar um sem
o outro.
**Minha escolha:** A — a duplicação é pequena, documentada, e nunca pode ficar inconsistente
porque vem de um cálculo só.

**3) Texto escolhido: "N of M capture candidates considered; K discarded by the filter."** (e o
equivalente no terminal). Testei a forma sugerida na tarefa ("1 of 4 candidates was considered")
e trombei com concordância verbal em inglês (`was`/`were` dependendo de `consideredCount` ser 1
ou não) — o resto do arquivo (`renderSummaryLine`: "3 sessions captured today.") já evita esse
problema usando particípio sem auxiliar. Seguí o mesmo estilo: nenhuma das duas cláusulas precisa
de "was"/"were", então o texto nunca erra concordância nem para `consideredCount: 0` (deveria ser
raro em produção — `formatVanishedMatchMessage` já intercepta esse caso antes do relatório — mas
`generateBriefingMarkdown` é testável direto, sem essa proteção).
**Minha escolha:** sem alternativa forte considerada — a tarefa já dizia "forma sugerida, não
obrigatória"; abre para o PO trocar a redação se preferir outra.

**4) Não implementei listar QUAIS sessões foram descartadas — registrado aqui como a tarefa
pediu, não como pergunta que bloqueia.** Ficaria fácil de errar de duas formas: (a) misturar
identidade de sessão descartada com a listagem de fechadas (populações diferentes, D-031), ou (b)
nomear sessões que o usuário filtrou de propósito, que é ruído na maioria dos usos reais de
`--session`. Se o PO achar que vale, é escopo novo, não uma correção desta tarefa.
**Minha escolha:** não implementei, como o item "Fora de escopo" da tarefa já antecipava.
---

## Q-044 — O corte em 500 caracteres trunca pelo fim, e conclusão costuma morar no fim

**Tarefa:** nenhuma — achado do mantenedor em 2026-09-02, comparando capturas reais.
**Bloqueia:** não. Mas mexe num número que foi escolhido **sem** medição, e agora tem um caso
concreto contra ele.

**O caso.** Uma captura com haiku produziu, no `understanding`, a afirmação de que os
identificadores inventados numa captura anterior **não eram alucinação** — que teriam vindo da
documentação. É o **inverso** do que se estabeleceu: eles só existem no `PLANO-DE-ENTREGA.md`
porque foram escritos lá **citando-os como invenções**.

**A causa provável, e é hipótese, não medição.** A explicação da busca — incluindo a conclusão
"os IDs não existiam antes de eu documentar" — estava numa **mensagem de assistente longa**. O
`MAX_ASSISTANT_MESSAGE_CHARS` (`adapters/transcript/facts.ts`) corta em **500 caracteres**, **pelo
fim**, marcando com `[…]`. A conclusão vinha depois do corte.

Se for isso, o modelo recebeu a premissa ("os IDs aparecem no documento") **sem o desfecho**, e
completou sozinho — na direção errada, mas plausível a partir do que sobrou.

**Por que isto é mais que "aumentar o número".** Truncar **pelo fim** é o pior corte possível para
o gênero de texto em questão. Mensagem de assistente costuma abrir com contexto e **fechar com a
conclusão** — é a forma que o próprio prompt do away summary do Claude Code prescreve (Spike I:
*"Lead with the overall goal and current task, then the one next action"*, com a ação no fim).
Cortar os últimos caracteres remove sistematicamente a parte mais informativa.

**E o número não tem medição por trás.** A **Q-036** registra: o custo **não discriminou** volume
(a chamada com mais conteúdo saiu 3,5x mais barata que a com menos), então 500 foi escolhido por
**qualidade de prompt** — simetria com `MAX_LAST_PROMPTS`, limitar um turno verboso. Escolha
honesta na época, e agora há um caso onde ela custou uma inversão de conclusão.

**Opções que enxergo:**

**A) Aumentar o limite.** Simples e não ataca a causa: continua cortando pelo fim, só que mais
tarde. E a Q-036 mostrou que não dá para justificar um número novo por custo.

**B) Cortar pelo meio, preservando começo e fim.** Ataca a causa: mantém a abertura (contexto) e o
fecho (conclusão), marcando o buraco. Mais código, e a marca do corte precisa ser visível para o
modelo não ler os dois pedaços como texto contínuo — o que criaria um terceiro tipo de invenção,
pior que os dois já observados.

**C) Não truncar mensagem, truncar quantidade.** Menos mensagens inteiras em vez de mais mensagens
mutiladas. Preserva a estrutura de cada uma; perde as mais antigas.

**D) Deixar como está e tratar na instrução.** A **S4-T0e** já vai proibir afirmar conclusão sobre
coisa vista pela metade. Se a instrução funcionar, o modelo diria "a busca foi inconclusiva" em vez
de inverter. **Mais barato, e não resolve a perda de informação — só a mentira sobre ela.**

**Minha inclinação, para registro:** (D) primeiro, porque a S4-T0e já está sendo feita e cobre a
consequência mais perigosa; depois medir se (B) ou (C) vale, **com o caso na mão** em vez de por
analogia — que é exatamente o erro que a D-011 já cometeu duas vezes.

**Um cuidado, para não trocar um problema por outro:** qualquer uma das opções aumenta o texto que
vai para o modelo, e a Q-036 registra que **o custo não é previsível pelo volume** neste caminho.
Medir antes de assumir que "um pouco mais" é barato.
**Resposta:** _(em aberto)_

---


---

## Q-045 — S4-T0e entregue: prompt fecha as duas portas, mas a validação real ainda não aconteceu

**Tarefa:** S4-T0e (`docs/PLANO-DE-ENTREGA.md`, incluindo a EMENDA de 2026-09-02).
**Bloqueia:** não a entrega desta tarefa — o texto está no prompt e coberto por teste. Bloqueia
**fechar o assunto**: a única prova que importaria (o modelo parar de cometer as duas formas do
defeito) não foi observada.

**O que foi feito.** `GENERATION_SYSTEM_PROMPT`
(`src/adapters/generation/system-prompt.ts`) ganhou duas frases novas, uma para cada forma medida:

1. *"If you can tell a category of things exists but not which specific ones, name the category —
   not invented items."* — fecha a forma do sonnet (nomear cinco worktrees inexistentes a partir
   de caminhos vistos em `touchedFiles`).
2. *"If your evidence is partial — an unfinished search, a cut-off message — say it is partial
   instead of stating what it proves."* — fecha a forma do haiku (conclusão invertida a partir de
   uma busca/mensagem incompleta).

Tamanho do prompt: **463 → 701 caracteres** (string em `GENERATION_SYSTEM_PROMPT`, sem contar
aspas/concatenação do código-fonte) — cresceu **51%**. Ainda curto o suficiente para caber como
argumento de `--system-prompt` (D-015 só restringe texto de tamanho variável); D-011 pede atenção
a cada caractere aqui porque é piso pago em toda chamada de geração — registrado no comentário
acima da constante e num teste-tripwire (`length < 1000`) para que uma futura adição não cresça
sem alguém perceber e medir.

**Por que não é maior nem menor.** Testei formulações mais curtas ("não invente nada", genérico) e
mais longas (citando termos como "search" e "cut-off message" com mais contexto). A tarefa pediu
explicitamente instrução calibrada às **duas formas observadas**, não um "não alucine" genérico —
então o texto ficou específico o bastante para descrever "categoria vs. item nomeado" e "evidência
parcial vs. conclusão", sem citar os IDs reais nem o incidente (o prompt é texto de produção, não
registro — AGENTS.md § Comentários: "nunca cite a mensagem que despachou a tarefa").

**O que a cobertura de teste prova, e o que ela NÃO prova.**
`tests/unit/adapters/generation/system-prompt.test.ts` prova que: (a) as duas frases existem
literalmente na constante exportada; (b) a constante preserva a instrução original ("say so
plainly instead of inventing activity"); (c) é exatamente essa string, e não outra, que
`buildLeanArgs`/`buildDeepArgs` (`args.ts`) passam como valor de `--system-prompt` — ou seja, o
texto não fica esquecido num arquivo que ninguém importa. **Isso é tudo que um teste de unidade
pode provar sobre uma string.** Nenhum teste aqui chama o modelo real, então nenhum teste prova
que o modelo passa a obedecer — depende do modelo, é o ponto central que a tarefa pediu para não
maquiar.

**Não construí o candidato "chamar o modelo de verdade e checar que ele não inventa".** Seria
exatamente o padrão que a **Q-029** já reprovou para o `--append-system-prompt-file`: flaky por
natureza (depende de amostra de um modelo não determinístico), e um teste que "parece" provar
ausência de alucinação dá **falsa confiança** — pior que não ter teste nenhum, porque quem ler o
verde para de desconfiar.

**A validação real, registrada e pendente: observar capturas reais.** O jeito honesto de saber se
isto funcionou é o mesmo que achou o defeito: rodar `end-day` de verdade (sonnet e haiku, os dois
modelos que já erraram, cada um de um jeito) sobre sessões com a mesma forma de evidência ambígua
— caminhos de categoria conhecida sem nomes confirmáveis, buscas/mensagens que terminam antes da
conclusão — e checar o `pendingItems`/`understanding` resultante à mão. **Isso ainda não
aconteceu.** Não virou tarefa nem spike porque exigiria chamadas reais de `claude` (custo real) e
não há ainda um roteiro de "qual evidência ambígua reproduzir" que não seja recriar os dois casos
reais do mantenedor — decisão de quando/como fazer isso fica para o mantenedor, não para este
agente decidir sozinho.

**Candidato mecânico, registrado e explicitamente NÃO construído agora:** verificar por código se
todo identificador que aparece na saída (`pendingItems`, `understanding`, `tomorrowPlan`) também
aparece em algum lugar da entrada (`touchedFiles`, prompts, fatos de git). Pegaria a forma 1
(identificador inventado) com certeza mecânica — um `grep` da saída contra a entrada, sem
depender do modelo se comportar. **Por que não construir agora:** o risco simétrico é pior que o
defeito — uma paráfrase legítima (o modelo reescrevendo `agent-a85a4e2e822435fcc` como "a
worktree do S4-T0e", ou resumindo um caminho longo) reprovaria um handoff **bom**, e um handoff
bom marcado como suspeito é o tipo de falso positivo que o D-025 já identificou como pior que a
ausência de dado. Fica registrado aqui para o caso de a forma 1 **reaparecer** depois desta
emenda — aí a medição teria um caso concreto para calibrar o que conta como "identificador" (UUID,
caminho, nome de arquivo?) e o que conta como paráfrase aceitável, em vez de adivinhar a regra
antes de ver um exemplo real de falso positivo.

**Resposta:** _(em aberto — pendente de observação de capturas reais pelo mantenedor)_

---

> **EVIDÊNCIA PARCIAL (2026-09-05), e é parcial de propósito — não marque como validada.**
>
> O mantenedor rodou capturas reais antes e depois da emenda, e as três formas ficam
> comparáveis porque o mesmo trecho de sessão foi capturado várias vezes:
>
> | captura | modelo | inventou ID | conclusão invertida |
> |---|---|---|---|
> | 02/09 `bak2` | sonnet @0,50 | **SIM** | não |
> | 02/09 | haiku @0,25, **antes** | não | **SIM** |
> | 05/09 `bak` | haiku @0,25, **depois** | não | não |
> | 05/09 | sonnet @0,50, **depois** | não | não |
>
> **O dado mais forte é a última linha:** o sonnet foi quem inventou os cinco identificadores no
> dia 02, e depois da emenda não inventou. Mesmo modelo, mesmo orçamento, prompt diferente.
>
> **E há um sinal direto da segunda cláusula funcionando.** A captura da sessão
> `seeya-todo-test` escreveu, por conta própria: *"its explanation was cut off mid-sentence, so
> full details are unknown/partial"*. É exatamente o caso da **Q-044** — mensagem de assistente
> truncada — sendo **reportada como parcial** em vez de completada por invenção. A outra captura
> registrou não saber qual modelo gerou uma medição anterior, em vez de escolher um.
>
> **Por que isto ainda não é validação.** As duas falhas precisaram de **gatilhos específicos**:
> uma categoria conhecida sem a lista (as worktrees) e um resultado de busca visto pela metade.
> Nas sessões de 05/09 esses gatilhos **não estavam claramente presentes** — a armadilha pode
> simplesmente não ter sido armada. Concluir "funciona" a partir disto seria cometer, na leitura
> da evidência, o mesmo erro que a emenda existe para impedir no modelo.
>
> **O que fecharia:** uma captura de uma sessão que **arme a armadilha** — em que se discuta uma
> categoria sem enumerá-la, ou se deixe uma busca inconclusiva. Aí a instrução resiste ou não, e
> a resposta vale. Até lá: **encorajador, inconclusivo.**

## Q-046 — Nove escolhas fazendo S4-T0 (D-032: evidência de git por repositório, e a migração), registradas para confirmação

**Tarefa:** S4-T0
**Bloqueia:** não — a tarefa foi entregue com a solução mínima em cada ponto, mesmo padrão de
Q-017/Q-019/Q-021/Q-022/Q-023/Q-027.

**1) Nomes novos, ainda fora do glossário do `AGENTS.md` § "Idioma".** `RepositoryGitFacts`
(`core/types.ts`), `readEvidenceAcrossRepos`/`GitEvidenceAcrossRepos` (`core/ports.ts`), e as duas
chaves novas que vão para disco em `facts`: `filesOutsideRepository`, `reposNotVisited`. Segui o
padrão já estabelecido (`GitFacts`/`readFacts`, `save<Nome>`/`read<Nome>`) em vez de inventar
convenção nova. **Minha escolha:** os nomes ficam como estão até confirmação; se algum divergir do
que o mantenedor teria escolhido, é troca de string, não de desenho.

**2) `root` como o nome do campo que identifica o repositório em `RepositoryGitFacts`**, em vez de
reaproveitar `cwd` ou `path` (`WorktreeFacts` já usa `path` para outra coisa — o diretório de um
*worktree*, não de um repositório — então usar o mesmo nome para os dois níveis pareceu mais
confuso que um nome novo). **Minha escolha:** `root`, por ser o termo que a própria D-032 usa na
prosa ("raiz de repositório").

**3) `filesOutsideRepository`/`reposNotVisited` viraram `number | null` em `HandoffFacts`, não
`number` com `0` como default para o handoff migrado.** Um v1 nunca mediu nenhum dos dois — `0`
alegaria uma medição que não existiu (D-025). O custo é que todo consumidor de `HandoffFacts` que
algum dia quiser somar/exibir esses campos precisa tratar `null` explicitamente; achei que o custo
vale a honestidade, e é o mesmo tipo de escolha que `SessionListingInfo`/`EndDayScope` já fizeram
com união discriminada em vez de sentinela. **Minha escolha:** `number | null`, `null` só na saída
da migração, nunca produzido por uma captura de verdade.

**4) `MAX_GIT_ROOTS_TO_VISIT = 8`, sem medição — mesma classe de risco que a Q-025 já nomeou para
`MAX_BRIEFING_SCAN_DAYS`.** O raciocínio: cada raiz visitada custa de 4 a 6 processos `git`
(`readFacts` sozinho spawna 4, mais um par por worktree que encontrar), e o caso comum que a D-032
descreve — frontend + backend na mesma sessão — é 2. Escolhi uma folga generosa (4x o caso comum)
sem crunching de números reais, porque não há hoje uma sessão real que tenha tocado mais de dois
repositórios para medir contra. **Minha escolha:** 8, exportado e com parâmetro de override no
método (`readEvidenceAcrossRepos(cwd, touchedFiles, maxRootsToVisit?)`) — se o número estiver
errado, é uma constante para trocar, não um redesenho.

**5) A ordem de prioridade quando o limite corta: a raiz do `cwd` sempre entra primeiro na lista a
visitar**, e as raízes vindas de `touchedFiles` entram na ordem em que os arquivos aparecem (sem
reordenar por frequência de arquivo por repositório). A D-032 (item 6) só exige que o `cwd` nunca
seja descartado; não diz nada sobre qual dos demais repositórios "ganha" quando há mais do que o
limite permite. **Minha escolha:** ordem de chegada em `touchedFiles`, por ser a mais simples e não
introduzir um critério de "importância" que a decisão não pediu.

**6) A raiz é resolvida por `fs.stat` de um `.git` subindo diretório por diretório
(`adapters/git/repo-roots.ts#findRepoRoot`), nunca por `git rev-parse --show-toplevel`.** Mais
barato por arquivo (sem spawnar processo), e correto pela mesma razão que `isInsideWorkTree`
confia na presença do marcador em vez de interpretar saída do `git`. **Risco aceito e registrado no
comentário:** um `.git` que seja um arquivo apontando para outro lugar (worktree/submódulo) é
tratado como raiz **onde o arquivo `.git` está**, não onde ele aponta — suficiente para dizer "isto
é uma raiz de repositório", insuficiente para saber se duas raízes assim resolvidas são,
internamente, o mesmo repositório físico (um worktree e seu principal apareceriam como duas
entradas). Não é o caso que a D-032 mediu (a sessão real tocou um repositório comum e o resto fora
de qualquer repo), então não bloqueei nisso — mas fica registrado para quem for medir sessões reais
com worktree.

**7) `gatherEvidence` deixou de rodar transcript e git em paralelo (`Promise.all`) e passou a
rodar sequencial.** Não é uma escolha entre alternativas equivalentes: git agora depende de
`touchedFiles`, que só existe depois que o transcript resolve (ou seu padrão vazio, quando não há
transcript). **Custo aceito:** uma sessão com transcript grande paga a leitura antes de começar a
falar com o `git`, em vez de sobrepor as duas I/Os. Não medi o impacto em tempo de captura — a
config atual não tem orçamento de tempo por fonte, só por sessão inteira (`budgetPerSessionUsd` é
custo de modelo, não tempo de evidência), então não havia contra o que medir.

**8) O `root` de um handoff migrado de v1 é preenchido com o `cwd` de topo do próprio documento**,
não com um valor sintético nem deixado ausente. Antes de `root` existir, "o repositório" de um
handoff v1 sempre foi implicitamente "o que está em `cwd`" — backfillar com o próprio `cwd` é
reafirmar exatamente essa leitura antiga, não inventar uma nova. **Minha escolha:** `document.cwd`,
com o caso de um `cwd` que não seja string deixado para a validação normal do schema pegar depois
(a migração não tenta consertar um documento que já estava malformado antes dela).

**9) A migração vive no schema (`adapters/storage/handoff-schema.ts#HANDOFF_SCHEMA_MIGRATIONS`),
registrada no mecanismo já genérico de `resolveSchemaVersion`, e nunca reescreve o arquivo em
disco.** A tarefa deixava as três decisões (onde mora, se reescreve) para quem implementasse.
Escolhi o schema porque é onde a forma v1/v2 já está descrita lado a lado (os dois zod schemas), e
"nunca reescreve" porque `resolveSchemaVersion` já era uma função pura recebendo o documento
parseado — fazer diferente exigiria `StorageAdapter` gravar de volta a cada leitura, o que quebraria
`--dry-run` (que promete não escrever nada) e complicaria _quem lê o mesmo handoff duas vezes_
(cada `seeya end-day --session` do dia relê e regrava `summary.md` a partir de `listHandoffs`) sem
ganho nenhum — a tradução em memória custa a mesma migração de novo a cada leitura, e é barata o
suficiente (nenhum I/O extra) para não valer a complexidade de cache. **Testado de propósito:**
`tests/integration/storage/handoff.test.ts`, "reading the same v1 file twice produces the identical
result both times" — o arquivo em disco é conferido *entre* as duas leituras e continua
`schemaVersion: 1`.

**Resposta:** _(em aberto)_

---


---

## Q-047 — S4-T0f: seam nova para tirar o spawn real do teste de unidade, e uma varredura de outros testes com I/O real

**Tarefa:** S4-T0f
**Bloqueia:** não — a tarefa foi entregue com a solução mínima (mesmo padrão de Q-017/Q-019/
Q-021/Q-022/Q-023/Q-027/Q-046), mas registro porque abre um parâmetro novo em
`captureObservedProcStart` e porque a varredura pedida achou dois casos que não conserto aqui.

**O que motivou.** `tests/unit/adapters/process/proc-start.test.ts`, caso `win32: recheck says
the PID is gone`, chamava `captureObservedProcStart(pid, recheck, 'win32')` de verdade, que
spawna `powershell.exe`. Medido nesta máquina antes do conserto: 761–815ms por chamada, duas por
arquivo (`npx vitest run ... --reporter=verbose`, números na seção "Relatório" abaixo). Isso é
exatamente o que `docs/PLANO-DE-ENTREGA.md` já tinha registrado como achado ao abrir a tarefa
(500–880ms), e é o motivo do `Test timed out in 5000ms` de uma das oito execuções.

**O conserto.** Segui a pista do próprio docstring do teste: o que se prova é só a rotulagem
(`processGone` × `unavailable`), decidida pelo `recheck` injetado — o spawn é incidental. Em vez
de extrair essa lógica para fora de `captureObservedProcStart` (o que exigiria expor `afterFailure`
como API pública só para o teste alcançar), injetei o **comando em si**: `captureWindows`
(`src/adapters/process/proc-start.ts`) agora recebe um `run: CommandRunner` (tipo novo em
`src/adapters/process/spawn-stdout.ts`, `(command, args, env?) => Promise<string | undefined>`) em
vez de chamar `runForStdout` por import global. `captureObservedProcStart` ganhou um quarto
parâmetro, `run = runForStdout`, no mesmo espírito do `platform = process.platform` que já
existia: todo chamador de produção (`adapters/process/index.ts`, `tests/e2e/sessions.test.ts`,
`tests/integration/*`) continua passando só `(pid, recheck)` e recebe o `run` real por default; só
o teste de unidade substitui um fake que resolve na hora, e só para o caso `win32`.

**Por que só `captureWindows`, não `captureDarwin` também — e um achado no caminho.** Minha
primeira versão injetou `run` nos dois, por simetria. `npm run cobertura` (rodado antes de
declarar a tarefa pronta, não depois) mostrou por quê isso era exagero: `adapters/process` caiu de
80,88% para **79,71%** de branches, abaixo do piso de 80% de `docs/TESTES.md`/`vitest.config.ts`.
Causa: o `ps` real que `captureDarwin` spawnava no teste de unidade (via `IMPOSSIBLE_PID`, 27–29ms
medidos) era a **única** cobertura real, em toda a suíte, do branch de falha de
`spawn-stdout.ts#runForStdout` (código de saída ≠ 0 / evento `error`) — a suíte de integração só
cobre o caminho de sucesso (processo vivo de verdade), nunca o de falha. Trocar esse `ps` real por
um fake apagou essa cobertura de vez. Vale registrar como achado à parte, do mesmo tipo que a
S4-T0g mediu hoje para o CI: **a hipótese "isto também precisa do seam" não se sustentou quando
medida**, e a medição (não a simetria) é que decidiu. Versão final: só `captureWindows` recebe
`run` — é a única chamada que era realmente lenta (500–880ms de `powershell.exe`, contra 27–29ms
de `ps`) —, `captureDarwin` continua chamando `runForStdout` direto, e a cobertura voltou a
81,15%.

**Por que não é costura só-de-teste, na minha leitura.** É a mesma forma que
`adapters/notification/backend.ts` já usa (`CommandRunner`, injetado como `options.run`,
default `spawnCommand`) pelo motivo que aquele arquivo documenta: "verificar os argumentos
montados... sem nunca iniciar um `powershell.exe`/`notify-send`/`osascript` real" — e é também
a regra geral do `AGENTS.md` ("biblioteca de terceiro que faz I/O fica atrás de uma porta...
injeção por parâmetro, nunca por import global"), que `captureWindows` violava antes desta tarefa.
Se o mantenedor achar que isto é forte demais para uma tarefa "pequena", a alternativa que eu
tinha na manga era expor `afterFailure` publicamente e testar só ela, direto — mais simples, mas
perde a cobertura da condição real dentro de `captureWindows` (`stdout === undefined`, regex
falhando), que hoje só é exercitada pelo teste de unidade (a suíte de integração só cobre o
caminho de sucesso, processo vivo de verdade).

**Escolhas que fiz e que gostaria de confirmar:**

**1) Dois tipos `CommandRunner`, mesmo nome, formas diferentes, em dois módulos diferentes**
(`adapters/notification/backend.ts`: `(command, args) => Promise<SpawnResult>`;
`adapters/process/spawn-stdout.ts`, novo: `(command, args, env?) => Promise<string | undefined>`).
Não tentei unificar: o de notificação carrega `exitCode`/`stdout`/`stderr` porque os backends
precisam do código de saída para decidir sucesso; o de `proc-start.ts` mantém a forma simples que
`runForStdout` já tinha (`undefined` em qualquer falha), que é exatamente o que `captureWindows`
já esperava antes desta tarefa — mudar a forma teria efeito fora do escopo. **Minha escolha:**
manter os dois, mesmo nome, sem lugar comum — se isso incomodar por deriva de nome, é candidato a
entrar no glossário do `AGENTS.md` como termo de porta.

**2) `captureLinux` continua lendo `/proc/<pid>/stat` de verdade (`fs.readFile`), não ganhou
seam.** Não é o achado original (a fragilidade medida era só `powershell.exe`), e uma leitura de
`fs` contra um caminho inexistente falha na hora (`ENOENT`), sem custo perceptível — não é I/O
lento, é I/O. Pela letra de `docs/TESTES.md` ("unidade... sem I/O"), ainda sobra um `readFile`
real no teste de unidade depois desta tarefa. **Minha escolha:** deixar como está — injetar leitura
de arquivo também exigiria um segundo tipo de seam (`FileReader`-like) só para fechar uma lacuna
que nunca causou vermelho, e a tarefa pede resistir a crescer. Acho que a letra da faixa fica
tecnicamente incompleta; a fragilidade que ela existe para evitar, não.

**A varredura de `tests/unit/` (pedida, não consertada aqui).** Além do arquivo desta tarefa, achei
dois testes que dependem do relógio real (`setTimeout` de verdade, não um `Clock` injetado):

- `tests/unit/application/concurrency.test.ts` — dois casos (`returns results in the same order...`
  e `never runs more than limit tasks at once`) usam `setTimeout` real com atrasos de 5–30ms para
  criar sobreposição observável entre tarefas assíncronas concorrentes.
- `tests/unit/application/end-day.test.ts` — a classe `ConcurrencyTrackingStorage` (linhas 46–57)
  usa `setTimeout(resolve, 5)` real pelo mesmo motivo (prova de concorrência limitada, aceite da
  S2-T3).

Nenhum dos dois spawna processo — são atrasos de dezenas de milissegundos dentro do próprio
processo do teste, uma classe de risco bem menor que `powershell.exe` —, mas ainda são "relógio
real" pela letra de `docs/TESTES.md` ("nenhum teste depende do relógio real: `Clock` é sempre
injetado"), e a técnica (atraso real para forçar sobreposição) é exatamente o tipo de coisa que
fica mais lenta e mais instável conforme a máquina de CI fica mais carregada — a mesma forma de
risco que motivou esta tarefa, só que ainda não mordeu. Não abri conserto para nenhum dos dois:
a tarefa pediu para listar, não resolver, e resolver exigiria decidir como simular concorrência
sem relógio real (fake timers do vitest, ou uma barreira controlada por promessas em vez de
tempo) — decisão de desenho, não achado.
`tests/unit/guards/node-types.test.ts` importa `node:fs` mas documenta explicitamente que nunca
chama `existsSync` de verdade (só referencia o símbolo para forçar a checagem de tipo) — não é um
achado, é o comportamento já pretendido.

**Relatório de medição (antes/depois), arquivo isolado
(`npx vitest run --project unit tests/unit/adapters/process/proc-start.test.ts --reporter=verbose`,
mesma máquina, duas a três execuções cada, faixa observada):**

| Caso | Antes | Depois |
|---|---|---|
| `win32: recheck says the PID is gone` | 815ms | 0-1ms |
| `win32: recheck says the PID still exists` | 761ms | 0ms |
| `darwin` (as duas variantes — **sem mudança**: continua chamando `runForStdout` real, ver acima) | 27–29ms | 19–26ms |
| Arquivo inteiro, tempo de execução dos testes (`tests` no resumo do vitest) | 1.64s | 55ms |
| Arquivo inteiro, `Duration` total reportada (inclui transform/import) | 3.41s | 988ms |

**Cobertura (`npm run cobertura`, `adapters/process`, branches — o número mais apertado):**
antes da tarefa, 80,88%; com o seam nos dois (`captureDarwin`+`captureWindows`), 79,71% (**quebra
o portão**, achado acima); com o seam só em `captureWindows` (versão entregue), 81,15%.

---

## Q-048 — S4-T0g: a hipótese do `createGitFixture` caiu — os "9min42" eram `npm ci` travado, não teste

**Tarefa:** S4-T0g
**Bloqueia:** não — mas muda a ação da própria tarefa: **nenhum código foi alterado** (nem
`tests/integration/git/`, nem `vitest.config.ts`), porque a medição não sustenta que havia algo
para consertar ali.

**O que a tarefa pedia medir.** O plano registrava `windows-latest` em 582s (9min42) no merge da
S4-T0, contra ~120-160s nos sete merges/commits anteriores, com a suspeita principal de que
`createGitFixture` (repositório git real por teste, em `tmpdir`) fosse a causa — testes cresceram
1,4x, o tempo "cresceu" 4,3x.

**Medido, passo 1 — local, nesta máquina Windows (dev), `--reporter=verbose`.**
`npx vitest run --project unit --project integration --project guards` (o que
`npm run cobertura`/`verificar` roda), 1126 testes, soma de durações por arquivo:

| diretório | soma (ms) | % do total |
|---|---:|---:|
| `tests/integration/guards/` | 263.597 | 79% |
| `tests/integration/git/` | 17.964 | 5,4% |
| `tests/integration/process/` | 12.919 | 3,9% |
| resto | ~38.000 | ~11% |
| **total (soma de todos os testes)** | **333.696** | 100% |

Dentro de `guards/`: `eslint-restrictions.test.ts` (123.650ms/9 testes, incluindo um estouro de
orçamento por contenção — a mesma assinatura da Q-030a), `dependency-cruiser.test.ts`
(63.894ms/21 testes), `layer-matrix.test.ts` (62.403ms/22 testes). Dentro de `git/`:
`git-adapter.test.ts` sozinho soma 17.295ms em 14 testes (até 3,4s no pior teste), `primitives.test.ts`
669ms em 6 testes. **Já aqui a suspeita do `createGitFixture` fica fraca**: o diretório inteiro que
ela habita é ~20x menor que `guards/`, que já existe desde o Sprint 0 e não cresceu com a S4-T0.

**Medido, passo 2 — o runner real (`gh run view --log`), não esta máquina.** Em vez de confiar no
número total do job (que mistura infraestrutura com teste), separei os passos do workflow em 7
execuções recentes do `windows-latest`:

| execução | `Instala as dependências` (`npm ci`) | `Roda o portão` (tsc+lint+depcruise+build+cobertura) | total do job |
|---|---:|---:|---:|
| S4-T0c merge | 10s | 105s | 134s |
| Q-041 correct docs | 11s | 106s | 138s |
| S4-T0d merge | 10s | 98s | 137s |
| D-032 docs | 8s | 95s | 121s |
| S4-T0e merge | 13s | 103s | 144s |
| **S4-T0 merge** | **427s** | **135s** | **582s** |
| plan S4-T0f/g (falhou, mesmo código pós-S4-T0) | 8s | 102s* | ~124s |

*a etapa falhou no meio (ver abaixo), mas o próprio vitest reportou `Duration 70.76s` antes da
falha — a mesma ordem de grandeza dos outros.

**O achado central: o passo que de fato roda testes (`Roda o portão`) nunca saiu de ~95-135s em
nenhuma das 7 execuções — nem antes nem depois da S4-T0.** O salto de 582s inteiro vem de
`Instala as dependências`: 8-13s em toda execução, exceto na do merge S4-T0, onde levou **427s**
(7 minutos) para instalar as mesmas 217 dependências, com cache do npm restaurado com sucesso
(`Cache restored successfully`, log da própria etapa) e **nenhuma mensagem de erro, retry ou aviso
no meio** — só silêncio entre `npm ci` e `added 217 packages in 7m`. `package-lock.json` não mudou
nesse commit (conferido via `gh api .../commits/<sha>`), então não é invalidação de cache. É o
formato clássico de uma rede/registro travando por trás de um `npm ci` sem produzir log — uma
falha de infraestrutura do runner, não deste projeto.

**Medido, passo 3 — reporter verbose do próprio runner, arquivo por arquivo, na execução seguinte
à S4-T0 (`docs: plan S4-T0f e S4-T0g`, já com os 1124 testes pós-S4-T0).** Essa execução falhou
em `termination.test.ts` (Windows: CTRL_BREAK_EVENT via console attach), sem relação nenhuma com
git — não abro questão nova para essa falha, só registro que o log dela é a fonte destes números,
porque foi a única execução recente com `--reporter` verboso o bastante para isolar por arquivo:

| arquivo (Windows CI real) | duração | nº testes |
|---|---:|---:|
| `guards/eslint-restrictions.test.ts` | 47.351ms | 9 |
| `guards/dependency-cruiser.test.ts` | 38.317ms | 21 |
| `guards/layer-matrix.test.ts` | 36.423ms | 22 |
| `guards/test-projects.test.ts` | 4.728ms | 6 |
| `guards/coverage.test.ts` | 3.180ms | 2 |
| `guards/child-process-timeout.test.ts` | 419ms | 2 |
| `guards/coverage-directories.test.ts` | 17ms | 15 |
| **soma `guards/`** | **~130.435ms** | **77** |
| `git/git-adapter.test.ts` | 10.223ms | 14 |
| `git/primitives.test.ts` | 348ms | 6 |
| **soma `git/` (o suspeito)** | **~10.571ms** | **20** |

Duração agregada de testes reportada pelo vitest nessa execução: 161,19s. `guards/` é ~81% disso;
`git/` (`createGitFixture` incluído) é ~6,6%. No pior teste individual de `git-adapter.test.ts`
(o que monta dois repositórios com worktree + commits datados), o tempo foi 1.429ms — real, mas
nem perto de explicar 4x coisa nenhuma.

**Conclusão, dita como a tarefa pediu: a hipótese do `createGitFixture` caiu, e a "desproporção" em
si não existe onde o número fazia parecer que existia.**

1. O passo que executa testes de verdade no Windows CI está estável em ~95-135s há pelo menos 7
   execuções, crescendo proporcionalmente ao crescimento de 1,4x nos testes (134s→135s a
   105s→135s, uma faixa de +15 a +40%) — **não 4,3x**.
2. O número que assustou (582s / 9min42) foi 73% consumido por um `npm ci` que travou uma única
   vez, sem relação com `package-lock.json`, com código de teste, ou com `tmpdir`/git. É reprodutível
   como "às vezes `npm ci` trava no `windows-latest`", não como "este projeto ficou mais lento".
3. Mesmo isolando só o passo de teste, `git/` (o suspeito) nunca foi o maior consumidor —
   `guards/` (que spawna `eslint`/`depcruise` reais por teste, arquitetura de Sprint 0, sem
   relação com a S4-T0) sempre foi 10-12x mais caro, e já está documentado como tal desde a Q-025
   (S2-T8) e a Q-030a (S3-T5) — este projeto já sabia que processo real do Windows é caro, só não
   tinha juntado os dois fatos (esse custo é de `guards/`, não do que a S4-T0 acrescentou).

**O que eu NÃO fiz, e por quê.** Não toquei `tests/integration/git/_fixtures.ts` nem
`vitest.config.ts`: não há medição que sustente um problema ali para consertar. Mexer em
`createGitFixture` "para resolver a lentidão do Windows" seria consertar um sintoma que não existe
à custa de arriscar cobertura real de git por uma economia de ~10s num job que já está na ordem de
grandeza esperada em 6 das últimas 7 execuções. Isso seria exatamente o erro que a S2-T8 se recusou
a cometer, na direção oposta: trocar tempo de manutenção por uma melhora que a medição não pede.

Também não toquei `tests/integration/guards/` — é onde o tempo realmente está, mas está fora do
escopo que esta tarefa me deu (`tests/integration/` git e `vitest.config.ts`, por suspeita
específica do `createGitFixture`) e é um custo **pré-existente**, já registrado duas vezes
(Q-025, Q-030a), não uma regressão da S4-T0. Registro aqui como achado, não como conserto: se o
mantenedor quiser reduzir o custo de `guards/` (~130s de ~161s agregados no Windows), é uma tarefa
nova, com o mesmo cuidado de medição no runner real que a Q-025 usou para `powershell.exe` — não
um adendo a esta.

**Opções que enxergo:** A) fechar S4-T0g sem mudança de código — o "aceite" (job na ordem de
grandeza anterior, ~2min, sem perder cobertura) já está cumprido em 6 das 7 execuções medidas, e a
sétima foi uma falha de infraestrutura fora do controle do repositório. B) abrir uma issue/nota
separada para o custo de `guards/` no Windows (não urgente — já é aceito desde a Q-025/Q-030a — mas
agora com número atualizado: ~130s). C) investigar por que `npm ci` travou naquela execução
específica (cache do `actions/setup-node`, versão do npm no runner, etc.) — mas sem outra ocorrência
igual nas 6 execuções vizinhas, não há o que reproduzir; monitorar é a única ação disponível.

**Resposta:** _(em aberto)_

---

## Q-050 — S4-T0h: reuso do `renderItemList`, e truncar em vez de quebrar o `understanding`

**Tarefa:** S4-T0h
**Bloqueia:** não — as duas partes do escopo (lista visível, prosa que para de ser parede) foram
entregues com a solução mínima em cada ponto; registro no mesmo padrão de Q-041/Q-042/Q-043.

**1) `core/consolidated-plan.ts#renderItemList` virou export, em vez de uma cópia em `cli/`.**
A tarefa pediu para avaliar reuso "com o cuidado de não arrastar `core/` para uma responsabilidade
de `cli/`". A função não tinha essa responsabilidade para começar: é formatação pura de texto (uma
label + itens indentados), sem I/O, sem conhecer `start-day` nem `end-day` — o nome já era
genérico antes desta tarefa. Adicionei só `export` e um parágrafo no docstring apontando o novo
consumidor, sem mudar assinatura nem comportamento. `cli/format-end-day.ts` já importava de
`core/briefing.ts` (`countUnreadableListings`, `formatSessionListingLine`), então importar também
de `core/consolidated-plan.ts` não abre precedente novo na matriz de camadas — `cli` → `core` já é
um dos 20 pares permitidos.
**Opções:** A) exportar e reusar (o que fiz). B) copiar as seis linhas para `cli/format-end-day.ts`
— seria a duplicação que AGENTS.md § "Estilo de código" proíbe, pelo ganho zero de isolamento (a
função não tem nada de `start-day` nela). C) mover para um terceiro módulo neutro — pareceu
indireção sem necessidade para uma função de seis linhas.
**Minha escolha:** A.

**2) A prosa não foi quebrada em coluna — foi cortada para um resumo curto, com aviso explícito.**
A tarefa deixou as duas saídas em aberto ("quebra em coluna legível — e considere se ela deve
aparecer inteira... um resumo curto, ou nada, pode ser melhor"). Descartei a quebra de linha pura
(reimplementar um `word-wrap` que ainda reproduziria os 1682 caracteres inteiros, só que em ~20
linhas em vez de uma) porque não resolve o problema para um relatório com várias sessões: a soma
ainda cresce sem limite por sessão capturada. Implementei `excerptUnderstanding` em
`cli/format-end-day.ts`: corta em até 200 caracteres, preferindo o fim de frase (`. `, `! `, `? `)
dentro do orçamento quando ele cai depois de 40% do limite (evita cortar no início de uma frase
maior que o próprio orçamento), com fallback para o último espaço — nunca no meio de uma palavra.
Quando corta, acrescenta `(…, full text in summary.md)`: a D-025/D-022 exigem que encurtar não vire
descarte silencioso, e o texto completo já está no `summary.md` (`core/briefing.ts#renderTextBlock`)
— apontar para lá é diferente de inventar que não há mais nada.
**Por que 200, e por que isto é escolha, não medição.** Não existe uma largura "certa" de terminal.
200 caracteres é perto de 2-3 linhas do soft-wrap que qualquer terminal já faz sozinho — dá para
dizer algo real sem dominar um relatório com várias sessões. Se o mantenedor achar 200 curto ou
longo demais depois de ver a saída real, é uma constante nomeada
(`UNDERSTANDING_EXCERPT_CHARS`) para ajustar, não um redesenho.
**Opções:** A) resumo curto com aviso explícito (o que implementei). B) quebra de linha completa,
preservando o texto inteiro em várias linhas — mantém a informação mas não resolve "N sessões
ainda enchem a tela", só adia o problema de uma linha por sessão para várias. C) omitir
`understanding` inteiramente do terminal, deixando só `summary.md` — descartei porque uma sessão
sem `pendingItems`/`tomorrowPlan` (handoff determinístico ou "nada pendente") ficaria sem nenhuma
narrativa no terminal, e um resumo curto ainda é mais barato que abrir o arquivo para saber do que
se tratava a sessão.
**Minha escolha:** A.

**3) A lista de pendências só aparece para `source: "model"`, com "nothing pending recorded"
quando o modelo confirmou que não há nada — nunca para `deterministic`/`noTranscript`.** Não estava
no escopo literal da tarefa (que falava só em "a lista pendente aparece no terminal"), mas é a
mesma disciplina D-025 que `core/consolidated-plan.ts#renderSessionPlanLine` já aplica ao
`start-day`: um handoff que falhou a geração nunca teve `pendingItems`/`tomorrowPlan` avaliados de
verdade (ficam `[]` como artefato da falha, D-003), então tratar isso como "confirmado limpo"
misturaria "falhou" com "checou e não achou nada". `formatUnderstanding` já nomeia a falha
separadamente ("Understanding not available: ..."); a lista de pendências fica muda nesse caso, em
vez de imprimir um "nothing pending recorded" que soaria como uma segunda afirmação sobre uma
sessão cuja geração não rodou de verdade.
**Opções:** A) gate por `source === 'model'`, com "nothing pending recorded" só nesse caso (o que
implementei). B) mostrar a lista (vazia) para qualquer `source`, sem distinção — reintroduziria a
mesma ambiguidade que a D-025 já resolveu para `start-day`. C) não dizer nada quando as listas
estão vazias, nem para `model` — descartei porque aí ficaria ambíguo se o "nada aqui" é por o
modelo ter confirmado ou por um bug silencioso na formatação.
**Minha escolha:** A.

**Achado à parte, não é pergunta:** o `summary.md` (`core/briefing.ts`) nunca teve o problema do
`understanding` inteiro — ele é markdown escrito para ser lido com calma, e o texto completo
continua lá sem alteração nenhuma desta tarefa. Só o relatório de terminal (`cli/format-end-day.ts`)
mudou.

**Resposta:** _(em aberto)_

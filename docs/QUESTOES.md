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

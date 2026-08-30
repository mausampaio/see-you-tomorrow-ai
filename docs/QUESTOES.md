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
**Resposta:** (preenchida pelo PO)

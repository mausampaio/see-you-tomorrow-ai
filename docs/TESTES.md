# Estratégia de testes

Runner: **vitest**. Toda tarefa do plano de entrega só é considerada pronta com os testes da
sua faixa escritos e passando.

## A pirâmide

```
        ┌───────────────┐
        │   e2e  (~8)   │  binário real, HOME temporário, claude falso no PATH
        ├───────────────┤
        │ integração    │  adapters contra disco/processos reais em tmpdir
        │    (~40)      │
        ├───────────────┤
        │   unidade     │  core/ e transcript/ — sem I/O, sem relógio real
        │    (~200)     │
        └───────────────┘
             + contrato (~5)  ← faixa lateral, roda contra o ~/.claude real
```

## Unidade — a base

Cobre `core/` e a lógica pura de `transcript/`. Sem disco, sem rede, sem processo, sem
`new Date()`. Todas as portas substituídas por duplos em memória.

O que precisa estar coberto com rigor, porque é onde os bugs vão doer:

- **Cálculo do instante de encerramento** a partir de `"19:30"` + data + fuso. Casos
  obrigatórios: dia normal; dia de entrada de horário de verão; dia de saída; horário já
  passado no momento da checagem; `endOfDayTime: null`.
- **Adiamento e pular-hoje**: adiar antes do horário; adiar depois do horário; adiar duas vezes;
  pular depois de já ter adiado; virada de meia-noite zerando o estado do dia.
- **Elegibilidade da sessão**: cada uma das **cinco** condições da spec isolada, e as combinações
  de borda (sessão relevante mas ignorada; sessão com handoff do dia mas transcript alterado).
- **Liveness com PID reciclado**: PID vivo + `procStart` divergente = obsoleta.
- **Cadeia de fallback do notificador**: primeiro disponível vence; nenhum disponível cai para
  stderr sem lançar.
- **Decisão de fallback da geração**: erro do modelo produz handoff `deterministic`, nunca
  exceção que aborte o encerramento.
- **Coleta multi-fonte (D-013)**: handoff continua válido com só git respondendo; com só
  transcript; com só registro; com nenhuma fonte, a sessão é reportada como não capturável, sem
  exceção. O campo `sources[]` reflete exatamente quem respondeu.
- **Exclusão de forks (D-012)**: sessão cujo `sessionId` está em `forks.json` nunca é elegível.
  Este teste é o que impede o laço de realimentação — não pode ser removido.
- **Detecção precoce sem transcript**: notifica na primeira vez que vê o `sessionId`, e não
  notifica de novo nas passagens seguintes. A mensagem inclui a correção (D-018).
- **Sessão suprimida não tenta captura profunda**: sessão registrada sem transcript, com
  `deepCapture: true`, cai para enxuto sem tentar `--resume` (D-018).
- **Sanitização de ambiente (D-017)**: o `env` entregue ao processo filho não contém
  `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID` nem `CLAUDECODE`, mesmo
  quando o processo do `seeya` os tem. Modo enxuto passa `--no-session-persistence`; modo
  profundo define `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`. Este teste é o que impede o modo
  profundo de falhar em silêncio quando o daemon sobe de dentro de uma sessão Claude.
- **Marcação de retomada por sessão, não por dia (S3-T3)**: um dia com dois handoffs pendentes,
  um retomado, continua "pendente" — o outro não pode sumir de `findPendingBriefing` só porque
  algum irmão dele foi retomado. É o teste que garante que o defeito que a decisão evita não volta
  como regressão silenciosa. `resumeSessions` (`application/start-day.ts`) grava a marca **depois**
  de cada `resume()` completar, nunca em lote no fim; um `resume()` que lança para o laço e não
  marca a sessão que falhou.
- **Identificação de sessão com `cwd` repetido (S3-T5)**: duas sessões descobertas com o **mesmo**
  `cwd` (e até o mesmo `name` derivado) precisam continuar distinguíveis — `sessionId` completo
  preservado na `SessionRow`, e um prefixo de exibição diferente para cada uma
  (`computeDisplaySessionIds`). É o caso real que motivou a tarefa e que nenhuma suíte cobria
  antes dela. `--session` casando mais de uma sessão (por prefixo, nome ou `cwd`) é `ambiguous`,
  nunca resolvido escolhendo uma (D-025) — testado tanto em `end-day --session` quanto em
  `start-day --session`.
- **Normalização de caminho nas três plataformas sem depender de rodar nelas (S3-T5)**: separador,
  maiúscula/minúscula (só Windows) e barra final exercitados chamando
  `normalizeCwdForComparison` com a dica de plataforma como argumento explícito — a mesma função
  roda com `'win32'` e `'posix'` no mesmo processo de teste, então o ramo Windows nunca fica
  descoberto só porque a suíte rodou em Linux/macOS (a lição da S2-T1, aplicada de novo).
- **Corte de escopo da D-031 (S4-T0b)**: `isCaptureCandidate` isolado para as três populações —
  viva, `ended` (registro + PID morto, **é** candidata, é a linha que parece concessão e não é) e
  só-transcript (**nunca** candidata). No `endDay` completo: sessão só-transcript nunca chega à
  elegibilidade e aparece em `listedSessions`, com título/último prompt vindos do
  `TranscriptReader.readListingInfo` fake; `--session` nunca filtra `listedSessions` (reflete
  sempre a descoberta inteira); o `summary.md` mostra a seção "Not captured" separada de qualquer
  handoff (nunca um `## <nome>` para sessão listada). `core/briefing.ts` e
  `cli/format-end-day.ts` têm suíte própria para a mesma regra de não-mistura.
- **`EndDayScope` declarado no artefato, nos dois sentidos (S4-T0c)**: `generateBriefingMarkdown`
  sem `scope` (default) e com `{ kind: 'fullDay' }` produzem o mesmo aviso explícito de "dia
  completo" — nunca por omissão; com `{ kind: 'singleSession', sessionValue }` o aviso nomeia o
  valor CRU de `--session`, sem afirmar quais outras sessões deixaram de ser olhadas. Teste de
  aceite dedicado (`tests/unit/application/end-day.test.ts` e
  `tests/unit/core/briefing.test.ts`): um `endDay` com `--session` e um `endDay` completo no
  mesmo dia produzem dois `summary.md` **distinguíveis por leitura**, comparando o texto e não a
  contagem de sessões capturadas (a segunda chamada pode recapturar ou não, dependendo da
  anti-duplicidade D-026 — o teste não depende disso). Mesma nota de escopo também no relatório do
  terminal (`cli/format-end-day.ts`).
- **`SessionListingInfo` distingue "sem `ai-title`" de "leitura falhou" (S4-T0c)**: uma falha real
  de `TranscriptReader.readListingInfo` (`application/session-listing.test.ts`) vira `{ kind:
  'unreadable', reason }`, nunca o mesmo `{ kind: 'read', aiTitle: null, lastPrompt: null }` que
  uma sessão sem título ordinariamente produz. `core/briefing.ts`/`cli/format-end-day.ts` mostram
  texto diferente para os dois casos, e a seção "Not captured" ganha uma nota agregada só quando
  há pelo menos uma entrada não lida — uma sessão comum sem título nunca soa como alarme.
- **A nota de recorte traz o número do descarte, com o denominador certo (S4-T0d)**: teste
  dedicado com as **três populações da D-031 ao mesmo tempo** — uma sessão viva considerada, uma
  viva descartada pelo filtro, uma fechada listada (`tests/unit/application/end-day.test.ts`,
  "endDay — scope note reports the discard count"; mesma prova na função pura em
  `tests/unit/core/briefing.test.ts`). Com só duas populações um denominador errado
  (`discoveredCount`) ainda dá número plausível; com as três, `discoveredCount` fica 3 e o
  `captureCandidateCount` certo (D-031, antes de `--session`) fica 2 — a diferença é exatamente a
  sessão fechada, que nunca foi candidata a captura. Dia completo continua sem nenhum número de
  descarte — testado que a nota nunca contém "discarded"/"candidate" nesse caso, para não inventar
  "0 descartadas" onde não há descarte para reportar.

- **Orçamento de retentativa por sessão (S4-T3, Q-040 item 3)**: `core/capture-retry.ts` isolado —
  contagem abaixo do limite não exclui, exatamente no limite exclui (`MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY`,
  hoje 3), um a menos não exclui (os dois lados da fronteira, nunca só o proibido). Uma lista vazia
  de `sessionId`s devolve o MESMO objeto `DayState` (sem cópia à toa). No `scheduler/`: um poll cujo
  `leanGenerator` sempre falha, chamado repetidamente sobre a MESMA sessão presa em turno ativo
  (`tests/unit/scheduler/poll.test.ts`), mostra a contagem subindo 1 por chamada e, ao atingir o
  limite, um generator que lança se for chamado prova que a próxima chamada nem tenta — sem
  depender de contar invocações, depender de que a chamada erra o teste inteiro se acontecer.
- **Decisão de lock de instância única (D-005)**: `core/daemon-lock.ts#decideLockAcquisition`
  isolada — ausente ou PID morto adquire, PID vivo recusa nomeando o dono. **Com desempate por
  `procStart` (S4-T3b):** PID reciclado é reconhecido como morto, e `procStart` **indisponível
  mantém o lock respeitado** — ausência de evidência não vira licença para um segundo daemon
  (D-025). O caso reciclado é construído no teste escrevendo um lock com PID vivo de verdade e
  `procStart` deliberadamente errado, que é indistinguível de reciclagem para o `resolveIsAlive`. `scheduler/lock.ts` testado por cima disso com `Storage`/`ProcessControl` em memória:
  `checkDaemonLock` nunca escreve; `acquireDaemonLock` só escreve no caso `'acquire'`.
- **O laço do daemon nunca redecide a agenda, só consome (S4-T3)**: `scheduler/poll.ts` exercitado
  com o pipeline REAL de `application/endDay` (não substituído por fake) — aviso de antecedência
  não repete numa segunda chamada no mesmo instante; encerramento no horário e encerramento
  atrasado (`delayMs` cruzando o limiar de 5 min) produzem avisos com título distinguível; uma
  sessão com escrita nos últimos 60s NÃO finaliza o dia (`endOfDayFired` continua `false`) mesmo
  já tendo sido capturada (a spec pede "captura assim mesmo" — o teste prova que o handoff foi
  gravado E que o dia continua em aberto, as duas coisas ao mesmo tempo, porque confundi-las seria
  o bug real); esgotado o orçamento de 5 min, finaliza mesmo com sessão ainda em turno ativo.
- **O laço tolera uma falha de poll sem morrer (S4-T3)**: `scheduler/loop.ts#runDaemon` com um
  poll que lança na primeira chamada e resolve normalmente na segunda — a segunda chamada
  acontece (docs/PLANO-DE-ENTREGA.md S4-T3: "o perigo que só existe em laço"). `shouldStop`
  interrompe o laço entre ciclos, nunca no meio de um, e limpa o lock ao parar de forma limpa.
- **A espera entre polls reage a `shouldStop` em ~1s, não só nos limites de 30s (S4-T5)**:
  `sleepUntilNextPollOrStop` testado com um `Clock.sleep` fake que vira `shouldStop` verdadeiro no
  meio da espera — o teste prova que o laço larga a espera assim que o sinalizador muda, sem
  esperar os 30 pedaços inteiros (`tests/unit/scheduler/loop.test.ts`).
- **`seeya daemon --status`/`--stop` distinguem os quatro estados do lock, nunca achatando em
  "existe arquivo" (S4-T5, D-024)**: sem lock, lock com PID morto (limpo só por `--stop`, nunca por
  `--status` — read-only), PID vivo saudável/com falha em série (texto no presente enquanto vivo,
  no passado depois de morto — nunca "ainda falhando" sobre um processo que já não existe), e a
  checagem de liveness que **lança** (nem "rodando" nem "não rodando" é afirmado — D-025). O
  `--stop` grácil e o abrupto (Windows, ou POSIX depois do prazo gracioso vencer) contra processo
  real ficam em `tests/integration/cli/daemon-command.test.ts`; `terminateAbruptly` isolado (mata
  sem rodar o handler grácil, tolera PID já morto) em `tests/integration/process/termination.test.ts`;
  o ramo de erro não-`ESRCH` (sem processo real para provocar de propósito) em
  `tests/unit/adapters/process/termination.test.ts`, mockando `process.kill`.

Cobertura mínima: **`core/` 95%**, demais diretórios de produção **80%**. Configurado por
diretório no vitest, e o CI falha abaixo disso.

## Integração — os adapters

Cada adapter contra o mundo real, mas num mundo de mentira controlado.

- **`discovery/`**: um `~/.claude` falso montado em `tmpdir`, com registros válidos,
  registros obsoletos, JSON corrompido e campo faltando. Verificar que corrompido é ignorado
  com log, não crash.
- **`transcript/`**: fixtures de `.jsonl` reais **anonimizados**, commitados em
  `tests/fixtures/transcripts/`. Incluir obrigatoriamente: transcript grande (>1 MB), com
  tipos de entrada desconhecidos, com linha truncada no fim (o Claude Code pode estar
  escrevendo enquanto lemos).
  **D-031 (S4-T0b)**: `parseTranscriptListingInfo` mantém a ocorrência mais recente de
  `ai-title`/`last-prompt` (as duas são regravadas conforme a sessão evolui, Spike I), tolera
  linha em branco e linha sem campo `type`, nunca aborta a leitura, e responde `{ aiTitle: null,
  lastPrompt: null }` — nunca lançando — quando nenhuma das duas entradas existe no arquivo.
  `TranscriptFileReader.readListingInfo` tem o mesmo teste de localização de arquivo que
  `readFacts` já tinha.
- **`storage/`**: `tmpdir` real. Testar atomicidade — matar no meio da escrita não pode
  deixar arquivo pela metade; ler documento de `schemaVersion` antiga aciona migração.
  `resumed.json` (S3-T3, por `day`): arquivo ausente é conjunto vazio (D-025), JSON inválido e
  `schemaVersion` desconhecida rejeitam de forma visível, e uma segunda escrita substitui o
  conjunto inteiro (não incrementa) — mesmo padrão de `early-warnings.json`.
  **D-032 (S4-T0), a primeira migração real do projeto:** `tests/integration/storage/
  handoff.test.ts`, describe "D-032 migration from schemaVersion 1" — um documento v1 **bruto**
  (JSON escrito à mão, nunca via `serializeHandoff`, que só grava a versão atual) com `facts.git`
  singular é lido como lista de um elemento, com `root` preenchido a partir do `cwd` de topo do
  documento; `facts.git: null` migra para `[]`; `filesOutsideRepository`/`reposNotVisited` voltam
  `null` (nunca `0` — D-025, um v1 nunca mediu nenhum dos dois); `listHandoffs` (o caminho que o
  briefing do dia usa) migra transparentemente também; e ler o mesmo arquivo duas vezes produz o
  resultado idêntico as duas vezes, com o arquivo em disco inalterado entre as leituras — prova de
  que a migração só traduz em memória, nunca reescreve (seguro para `--dry-run` e para
  `seeya end-day --session` repetido no mesmo dia).
  **S4-T3c, segunda migração real (Q-036): schemaVersion 2 → 3.** Mesmo arquivo, novo describe
  "S4-T3c migration from schemaVersion 2" — documento v2 **bruto** sem a chave
  `facts.assistantMessages` (a chave nunca existiu antes desta tarefa) é lido como `[]`; os campos
  de D-032 já migrados (`filesOutsideRepository`/`reposNotVisited`) continuam corretos depois do
  passo v2→v3, provando que a migração nova não pisa na anterior; `listHandoffs` migra
  transparentemente; ler duas vezes não reescreve. O describe de D-032 ganhou um teste a mais
  provando que um documento v1 encadeia as duas migrações (1→2→3) e chega também em
  `assistantMessages: []`. E o teste que antes provava a **exclusão** do campo (Q-036, resposta
  original) foi invertido: agora prova que um handoff com texto real do assistente é **persistido**
  e volta idêntico. **Verificação adicional, fora da suíte automatizada:** os handoffs reais do
  mantenedor em `~/.seeya/days/` (mistura de v1 e v2, oito diretórios de dia, doze arquivos) foram
  lidos com o código novo antes de a tarefa ser aceita — mesma disciplina da D-032 — e todos
  leram sem erro, com `assistantMessages: []` (nenhum foi capturado com o código novo ainda).
  Detalhe em `docs/QUESTOES.md` Q-055 e `docs/PLANO-DE-ENTREGA.md` S4-T3c.
- **`generation/`**: um script falso de `claude` colocado no PATH do teste, que devolve JSON
  canned, JSON inválido, código de saída != 0, e um que trava (para testar o timeout).
  **Nenhum teste da suíte chama a API de verdade.** Obrigatório: um teste que passa contexto com
  quebra de linha, aspas duplas e simples, acento e `%`, e verifica que o processo filho recebeu
  o texto **íntegro** (D-015 — foi exatamente isso que quebrou no Spike C).
- **`resumption/`** (S3-T2): mesmo script falso de `claude`, mas com `stdio: 'inherit'` de
  verdade — o teste lê de volta o que o processo filho recebeu, nunca inspeciona
  stdout/stderr (que vão para o terminal real, não para este processo). Obrigatório: prompt
  pequeno vira argumento posicional de `--resume` e chega íntegro (mesma disciplina de D-015 do
  `generation/`); `--resume` que sai rápido com código != 0 aciona o fallback — sessão nova via
  `--append-system-prompt-file`, nunca `--resume` de novo; prompt acima do teto medido no Spike H
  pula a tentativa de argumento inteiramente; arquivo de contexto do fallback é apagado depois de
  usado; ambiente saneado (D-017) chega ao processo filho nos dois caminhos. Ver
  `docs/spikes/H-retomada-interativa.md`.
- **`git/`**: repositório de teste construído em `tmpdir` com dois worktrees, um sujo e um
  limpo, commits datados de hoje e de ontem. Verificar enumeração, estado por worktree e o
  recorte de "commits do dia". Mais um caso com `cwd` que não é repositório.
  **D-032 (S4-T0), `readEvidenceAcrossRepos`:** dois repositórios git reais em `tmpdir` mais um
  `cwd` que não é nenhum dos dois — aceite obrigatório de "sessão fora de qualquer repositório,
  arquivos tocados em dois repositórios, produz os dois". Mais: raiz do `cwd` de lançamento
  mantida mesmo sem `touchedFiles` apontando para ela; arquivo tocado fora de qualquer
  repositório contado em `filesOutsideRepository`, nunca descartado em silêncio; o mesmo
  repositório alcançado pelo `cwd` e por um arquivo tocado não é visitado duas vezes (normalizado
  antes de desduplicar, reusando `core/cwd-normalization.ts`); e o excedente de
  `MAX_GIT_ROOTS_TO_VISIT` aparece em `reposNotVisited` — exercitado com um parâmetro de override
  no método (mesmo padrão de `findPendingBriefing#maxScanDays`), para não precisar criar nove
  repositórios reais em disco só para estourar o limite de produção.
- **`process/`**: iniciar um processo filho trivial, verificar liveness, terminar com graça,
  verificar que morreu. Por plataforma.
  **`daemon-launch.ts#spawnDetachedDaemon` (S4-T3)**: spawna um processo real reaproveitando o
  fixture `graceful-child.mjs` (S1-T2), confirma que fica vivo, é alcançável (`processExists`) e
  que `SEEYA_DAEMON_CHILD` chega no ambiente do filho. **O que este teste NÃO prova**: sobrevivência
  ao encerramento do processo que o spawnou — nenhum teste dentro da própria suíte consegue provar
  isso de si mesmo (exigiria morrer e algo de fora checar depois). Ver docs/PLANO-DE-ENTREGA.md
  S4-T3 para a verificação manual que cobre essa lacuna.
- **`storage/` (S4-T3, adição)**: `estado.json` e `daemon.lock` seguem o mesmo roteiro de
  `early-warnings.json` — ausência é `null`/dia vazio (D-025), JSON inválido e `schemaVersion`
  desconhecida rejeitam de forma visível, uma escrita substitui o documento inteiro (nunca
  mescla), e `captureAttemptsToday` ausente no documento (arquivo mais antigo ou editado à mão)
  volta `{}` em vez de falhar a leitura inteira.
- **`notification/`**: cada backend verifica os argumentos montados, nunca o toast aparecendo.
  **Implementado com o comando externo injetável (`CommandRunner`), não um binário falso em
  `PATH`** (S4-T1): ao contrário de `claude` (D-015 exige provar integridade através de um
  processo real de verdade), o conteúdo do toast nunca é reprocessado por um shell entre o
  processo do `seeya` e o comando nativo — `-EncodedCommand` no Windows, array de argumentos sem
  shell nos outros dois —, então não há fronteira de processo cujo comportamento real precise ser
  provado; a montagem do comando é 100% determinística e testável em memória. Ver
  `docs/QUESTOES.md` Q-038. O e2e (`tests/e2e/_fake-notification-commands.ts`) continua
  substituindo o binário nativo de verdade por um falso em `PATH`, porque ali quem spawna é o
  binário `seeya` compilado — sem esse cuidado, `npm run test:e2e` mostraria uma notificação real
  na tela de quem roda o portão.

## Suíte lenta ou instável? Conte os processos antes de investigar o código

**Medido em 2026-09-05, e resolveu um vermelho que já tinha custado duas investigações.** O
guarda `eslint-restrictions.test.ts` falhou duas vezes seguidas estourando o
`CHILD_PROCESS_BUDGET_MS` de 30s — e passava quando rodado isolado. A causa não era a suíte:

```
365 processos node vivos na máquina
  7 de 18/08 · 57 de 29/08 · 170 de 30/08 · 59 de 31/08 · 17 de 01/09 · 31 de hoje
```

Restos de execuções de teste e de agentes, acumulados por semanas. O pico coincide com o dia em
que vários agentes rodaram em paralelo.

**A desproporção que denuncia:** o `eslint` sozinho, num arquivo, leva **4 segundos** (medido). O
orçamento é de 30. Havia folga de **sete vezes** e ele estourava mesmo assim — porque disputava
CPU com centenas de processos.

Depois de matar os 334 antigos, **o portão passou de primeira**, 1218 testes, sem tocar em código.

**A regra, e ela é barata:**

```
powershell -NoProfile -Command '(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count'
```

**Faça isso antes de investigar suíte lenta ou teste instável.** Um número na casa das centenas
explica sozinho qualquer vermelho por tempo, e nenhuma leitura de código vai encontrar a causa —
ela não está no código.

**Por que isto enganou duas vezes.** A **Q-030a** registrou vermelho local que sumia no rerun e
concluiu "contenção, não mexer" — certo por acaso, pelo motivo errado. A **S4-T0g** gastou uma
tarefa inteira procurando regressão no CI e concluiu corretamente que não havia: **o runner do
GitHub nasce limpo a cada execução**, então este problema **nunca** poderia aparecer lá. Vermelho
que só acontece na máquina de quem desenvolve e some no CI é o sintoma exato disto.

**Cuidado ao limpar:** a sessão do Claude Code **é** um processo node. Filtre por data
(`$_.StartTime -lt (Get-Date).Date`) em vez de matar tudo, e use **aspas simples** no Git Bash —
aspas duplas expandem o `$_`, que é variável do próprio bash.

## Contagem de processos deu pouco e o portão ainda estoura tempo? Cheque disputa por lançar processo, não só carga acumulada

**S4-T10, 2026-09-08.** A seção acima ("Conte os processos antes de investigar o código") cobre
**restos acumulados** de execuções antigas — dezenas ou centenas de `node` vivos, sintoma de dias
de agentes rodando sem limpeza. Esta seção cobre um sintoma parecido, mas com causa diferente: a
contagem de `node` estava **baixa** (1 processo, a própria sessão) e o portão ainda estourava
tempo, sempre nos mesmos testes de processo real, com o conjunto de arquivos que falha mudando a
cada rodada.

**Como reconhecer isto, antes de reabrir a investigação do zero:**

1. Conte `node` primeiro (seção acima). Se o número já estiver baixo, a causa não é acúmulo —
   siga para o passo 2 em vez de procurar processos para matar.
2. Os testes que estouram **lançam um processo do sistema operacional de verdade**? No Windows
   deste projeto, isso é quase sempre `powershell.exe` (`adapters/process/proc-start.ts#captureWindows`,
   `adapters/process/console-signal.ts#sendCtrlBreak`) — grep por `captureObservedProcStart(` ou
   `powershell.exe` nos arquivos que falharam. Um teste que só toca um `tmpdir` isolado não é isto.
3. Esses arquivos estão no mesmo projeto vitest (`vitest.config.ts`), sob o paralelismo padrão
   (todo arquivo em seu próprio worker, ao mesmo tempo)? Se sim, e mais de um desses arquivos
   pode cair no mesmo lote, a causa provável é **disputa pela capacidade do SO de lançar
   processo**, cujo custo este projeto já mediu como variável mesmo "quente" (500-880ms por
   `powershell.exe`, `proc-start.ts`) — contra prazos de teste **fixos** (5s/8s). Quando vários
   desses lançamentos caem juntos, o tempo real ultrapassa o prazo sem que nada tenha travado.

**Por que isto muda de arquivo a cada rodada, e some sob carga baixa isolada.** Qual subconjunto
de arquivos "pesados" cai no mesmo lote de workers depende do agendamento do runner naquela
rodada — não é determinístico. E rodando só os arquivos pesados, isolados do resto da suíte, a
disputa ENTRE ELES sozinhos pode não ser grande o bastante para estourar (medido: 5 arquivos, só
entre si, 11s, verde) — é a carga do conjunto inteiro competindo pelas CPUs da máquina que empurra
o lançamento do processo pesado para fora do orçamento. Isolar só os arquivos suspeitos "porque
passam quando rodados sozinhos" pode enganar por este motivo exato.

**A correção, e por que não é a mesma coisa que a `guards/` recusou (comentário em
`vitest.config.ts`, S1-T0).** `guards/` recusou `fileParallelism: false` porque a serialização
naquele caso **escondia** uma corrida real em estado mutável compartilhado — o bug era a corrida.
Aqui a disputa é por um recurso do SO real e medido, não uma fixture mal isolada: separar os
arquivos que realmente lançam processo pesado num projeto vitest à parte
(`integration-process`), com `fileParallelism: false` **só nele**, remove a disputa entre eles sem
impor custo ao resto da suíte (que continua no paralelismo padrão de sempre). Não é serializar
"para não investigar" — é remover a causa real da contenção, deixando o resto do sinal (paralelismo
expõe corrida) intacto em todo o resto do projeto.

**O que NÃO fazer:** alargar os prazos de 5s/8s até "caber". Esses prazos já somam o orçamento
interno da operação **mais** uma folga fixa (3s, ver o comentário em
`tests/integration/process/termination.test.ts`) — a folga é o que ainda pega um travamento real
(um alvo que nunca reage ao sinal enviado). Alargar o prazo para acomodar disputa de recurso
alarga essa mesma folga sobre travamento de verdade, e o próximo travamento real passa
despercebido até alguém notar em produção.

**Medido antes/depois (S4-T10, esta máquina):** portão vermelho, uma rodada, 128s de parede, 3
arquivos estourando prazo. Depois da separação de projeto: portão verde, cinco rodadas seguidas,
126–140s de parede (média 131s) — mesma ordem de grandeza, sem regressão perceptível. Números
completos e o quinto arquivo que a investigação original não tinha nomeado:
`docs/PLANO-DE-ENTREGA.md` S4-T10, `docs/QUESTOES.md` Q-063.

## O runner de CI não se reproduz aqui — leia o log real antes de teorizar

**S4-T11, 2026-09-12.** A seção acima resolveu a contenção por lançamento de processo **nesta
máquina**. Dois pushes de só documentação (`4146faa`, `e9286a5`) ainda derrubaram o job
`windows-latest` com 14-15 testes estourando prazo — e **nesta máquina, isolados, todos os sete
arquivos apontados passam em frações de segundo** (o mais lento, o caso de 500 arquivos de
`transcript-scan.test.ts`, leva 451ms local contra um orçamento explícito de 30 000ms). Não dá
para reproduzir a lentidão do runner tentando de novo localmente — ela não existe aqui. O método
que funcionou: **baixar o log bruto do run que falhou de verdade**, não confiar só no resumo do
despacho.

```
"C:\Program Files\GitHub CLI\gh.exe" run list --repo <owner>/<repo> --limit 30 --json databaseId,conclusion,headSha
"C:\Program Files\GitHub CLI\gh.exe" api repos/<owner>/<repo>/actions/runs/<id>/attempts/1/jobs   # se houve rerun, o attempt 1 é o que falhou
"C:\Program Files\GitHub CLI\gh.exe" api repos/<owner>/<repo>/actions/jobs/<jobId>/logs --allow-escape-sequences > job.log
```

(`gh` não está no PATH desta máquina — chame pelo caminho completo. `--allow-escape-sequences` é
obrigatório: sem ele o PowerShell recusa o log inteiro por causa das cores ANSI do reporter do
vitest.) Rode do PowerShell, não do Git Bash — o Git Bash deste ambiente recusa qualquer comando
cujo nome não seja resolvido estaticamente como não-git, e `gh.exe` cai nessa recusa.

**O que o log bruto mostrou que o resumo do despacho não mostrava: cada teste que estourou tem
DUAS linhas de falha, não uma.** Primeiro `Error: Test timed out in 5000ms.` (ou `30000ms` nos
dois casos com orçamento explícito), depois — para o MESMO teste, com um `rmdir` de um diretório
`seeya-git-XXXXXX` diferente a cada vez (o sufixo aleatório do `mkdtemp` de cada teste) —
`Error: EBUSY: resource busy or locked, rmdir '...\seeya-git-XXXXXX\main'`. Isso não é um teste
diferente falhando por outro motivo: é o `afterEach` do MESMO teste tentando apagar a fixture
poucos milissegundos depois do timeout ter sido declarado.

**Explicação do EBUSY, sustentada pelo próprio mecanismo, não só pelo log.** `git-adapter.test.ts`
e `primitives.test.ts` chamam `GitAdapter.readFacts`/os primitivos de `adapters/git/` dentro do
corpo do teste — funções que fazem `Promise.all` de vários `runGit` (branch, status, log,
worktree-list, mais um par status+log por worktree). Quando o vitest declara o teste "estourado"
aos 5000ms, ele **não cancela** essa cadeia de promises: os processos `git.exe` já lançados
continuam rodando de verdade, sem que nada no teste os aguarde mais. O `afterEach` roda em
seguida e chama `removeGitFixture` → `rm(root, { recursive: true, force: true })` — e no Windows,
apagar um diretório enquanto um processo ainda tem um handle aberto num arquivo dentro dele (o
`git.exe` órfão, ainda lendo `.git/index`, um pack, ou o próprio `cwd` do processo) devolve
`EBUSY`. **Isto é higiene de teste, exatamente como a hipótese do despacho apontou** — mas o gatilho
não é uma corrida entre dois testes escrevendo em fixtures diferentes (cada `mkdtemp` já é
único); é o PRÓPRIO teste correndo contra seu próprio relógio: o timeout do vitest e a limpeza do
`afterEach` não são atômicos entre si.

**O que essa explicação NÃO cobre, e por que a medição não sustenta a hipótese original por
inteiro.** O despacho enquadrou isto como "a mesma classe da S4-T10" (prazo fixo × lançamento de
processo). A evidência do log derruba a generalidade dessa frase: `atomic-write.test.ts > a
normal, uninterrupted write replaces the target in full (control case)` — um teste que **não
lança processo nenhum**, só duas chamadas de `writeFileAtomic` (16ms nesta máquina) — também
apareceu com `Test timed out in 5000ms.` na mesma rodada. Não há `git.exe`/`node.exe` para
disputar lançamento ali. A correlação que o log real mostra: naquela mesma janela de tempo, o
projeto `guards` estava rodando `eslint-restrictions.test.ts` (ESLint de verdade, 70s nessa
rodada, contra ~40s numa rodada mais tranquila) e `dependency-cruiser.test.ts`/`layer-matrix.test.ts`
(~40s cada) — **simultaneamente** ao lote padrão de paralelismo do projeto `integration`, no
mesmo runner windows-latest. Isso é carga de CPU do sistema inteiro, não disputa específica pelo
lançamento de um binário. **Medido, não só teorizado**: os dois testes com orçamento explícito de
30s (`state-concurrent-write`, `config-concurrent-write`) estouraram por pouco (30722ms, 30105ms —
~2-3% acima do orçamento) na MESMA rodada em que o ESLint levou 70s; o caso de 500 arquivos de
`transcript-scan.test.ts` estourou por mais (39090ms contra 30000ms) na outra rodada. Isto sugere
DOIS mecanismos, não um: (a) alguns testes (os que lançam processo, e o caso "control" de
`atomic-write`) pararam de progredir e bateram exatamente no teto do prazo — starvation de
agendamento; (b) os testes de I/O real sustentado (300+300 leituras/escritas reais,
500 `mkdir`+`utimes` concorrentes) progrediram, só que mais devagar — degradação de vazão
proporcional à carga, não paralisação total.

**A correção aplicada, e o que ela deliberadamente não promete resolver.** `vitest.config.ts`
ganhou dois grupos novos dentro do projeto `integration-process` (S4-T10) já serializado:
`REAL_CHILD_PROCESS_GIT_AND_STORAGE_FILES` (git-adapter, primitives, atomic-write — lançam
processo real, mesma classe do S4-T10) e `REAL_FS_IO_HEAVY_INTEGRATION_FILES`
(state-concurrent-write, config-concurrent-write, transcript-scan — não lançam processo, mas
fazem I/O real sustentado). Os dois grupos têm docstrings SEPARADOS no arquivo de config —
lumping os dois sob a mesma alegação de recurso ("lança processo") seria repetir exatamente o
defeito de generalidade falsa que a S4-T10 já corrigiu uma vez (D-025 aplicado a comentário, não só
a dado). **O que essa correção não alcança**, dito explicitamente no próprio comentário do config:
ela remove a disputa que ESTES arquivos geram entre si; não alcança a carga de CPU que o projeto
`guards` gera na mesma janela, num projeto vitest separado que este não agenda. Se o runner ficar
mais ocupado por outro caminho, o mesmo sintoma pode voltar — mesmo residual que a Q-063 já
registrou para a S4-T10, ainda em aberto.

**Contagem de processos por caso, medida com `vi.mock('node:child_process')` interceptando
`spawn` (não estimada por leitura de código sozinha):** fixture de git (`createGitFixture` +
2 commits + 1 worktree) = 6 lançamentos reais de `git.exe`; um `readFacts` sobre um cwd com 1
outro worktree = 7; o teste mais pesado de `git-adapter.test.ts` ("never writes to the
repository", 2 chamadas de `readFacts` mais 4 snapshots somente-leitura) = 32. Somando os 14
casos do arquivo: ~180 lançamentos de `git.exe`, todos concluídos bem abaixo de 1s cada nesta
máquina sem contenção — a tabela completa está em `docs/PLANO-DE-ENTREGA.md` S4-T11.

## Medir custo de chamada real: controle o calor do cache

**Três medições de custo neste projeto já foram confundidas pela mesma coisa**, e a terceira só
foi reconhecida porque as duas anteriores estavam escritas:

| medição | o que aconteceu |
|---|---|
| Spike J, Achado 4 | a configuração de produção leu **70.260** tokens de cache quando a hipótese era zero |
| Spike J, S4-T00b | a **mesma** configuração leu **zero** no dia seguinte |
| Spike J, S4-T00c | duas chamadas de conteúdo **idêntico** custaram US$ 0,0061 e US$ 0,0212 — 3,5x |

**A causa é acerto de cache por atividade não relacionada da conta.** Qualquer chamada anterior
daquele dia — outro teste, outra sessão, outra tarefa — pode deixar quente um bloco que a sua
medição vai ler de graça. E o efeito não é pequeno: ele **inverteu a ordem** de dois braços na
S4-T00c, onde a chamada com **mais** conteúdo saiu **3,5x mais barata** que a com menos.

**Consequência prática: um número de custo isolado não significa nada.** Ao medir custo de
chamada real:

- **repita o braço de referência no fim**, com conteúdo idêntico ao do início — se os dois
  divergirem, o experimento inteiro está confundido e o resto dos números não sustenta
  comparação;
- **leia `usage.cache_read_input_tokens` e `cache_creation_input_tokens`**, não só o custo em
  dólar: eles mostram *por que* o preço foi aquele;
- **rode os braços próximos no tempo**, para o relógio não virar uma segunda variável;
- e diga no documento **se o controle bateu ou não**. Medição confundida, reconhecida, vale;
  medição confundida apresentada como limpa, não.

**O que isto NÃO diz:** que o piso de custo do modo enxuto medido na S2-T2 (US$ 0,08–0,09) esteja
errado. Diz que ele é **um ponto sob condições desconhecidas de calor**, e que planejar custo de
produção em cima dele é mais frágil do que parecia. Ver Q-036.
## E2E — poucos e caros

Rodam o binário `seeya` compilado, com `HOME`/`USERPROFILE` apontando para `tmpdir` e um
`claude` falso no PATH. Um teste por jornada:

1. `seeya sessions` lista corretamente vivas, ociosas e encerradas.
2. `seeya end-day --dry-run` não escreve nada e descreve o que faria.
3. `seeya end-day` gera handoffs + briefing com o conteúdo esperado.
4. `seeya end-day` com o `claude` falso falhando gera handoffs determinísticos e sai com
   sucesso.
5. `seeya start-day --all` invoca `claude --resume` com os argumentos certos (S3-T3,
   `tests/e2e/start-day.test.ts`) — o handoff pendente é escrito direto em disco (`start-day`
   nunca redescobre sessões, D-004), então este teste não depende de rodar `end-day` primeiro. Um
   segundo teste, sem flag e sem TTY (o `stdin` do harness já não é um, de graça), prova a
   decisão de não travar: plano impresso, `--all`/`--session` sugeridos, `claude` nunca invocado.
5. `seeya start-day --all` invoca `claude --resume` com os argumentos certos.
6. Daemon, com relógio injetado, dispara aviso prévio e depois o encerramento.
7. `seeya snooze +30m` empurra o disparo; `seeya skip-today` cancela.
8. Segunda instância do daemon recusa subir por causa do lock.

**S4-T3 (2026-09-05): 6, 7 e 8 continuam sem teste e2e — não é esquecimento, é ordem de
dependência.** O item 7 precisa de `seeya snooze`/`seeya skip-today`, que são a S4-T4, ainda não
implementada. O item 6 precisa de "relógio injetado" no binário **compilado** — hoje
`cli/index.ts` sempre usa `systemClock` real, sem nenhum ponto de injeção, e o laço só dispara em
janelas de 30s de tempo real (`scheduler/loop.ts#POLL_INTERVAL_MS`), o que tornaria este teste
"poucos e caros" em "caro demais": esperar minutos de relógio real por jornada. O item 8 é o único
dos três sem dependência de outra tarefa e SERIA possível hoje (o lock já existe e já foi medido
manualmente contra o binário real, docs/PLANO-DE-ENTREGA.md S4-T3) — deixado para quando os outros
dois entrarem juntos, para o e2e nascer como uma jornada "dia inteiro de uso real" coerente (o
próprio aceite do sprint), em vez de uma peça isolada que a S4-T5 teria que revisitar de qualquer
forma. A cobertura de integração (`tests/integration/process/daemon-launch.test.ts`,
`tests/integration/cli/daemon-command.test.ts`, `tests/unit/scheduler/loop.test.ts`) já prova cada
peça isoladamente contra processo/lock reais; o que falta é só a jornada ponta a ponta pelo
binário compilado.

**S4-T4 (2026-09-06): a dependência do item 7 foi resolvida — `seeya snooze`/`seeya skip-today`
existem agora — mas o item continua sem e2e por escolha, não por bloqueio novo.** O motivo que já
valia para o item 8 continua valendo para o 7: a S4-T3 deixou os três agrupados de propósito, para
o e2e nascer como uma jornada única "dia inteiro" quando o 6 (relógio injetado no binário) também
existir, em vez de uma peça isolada que a S4-T5 revisitaria de qualquer forma. Em compensação, os
cinco casos obrigatórios desta tarefa — adiar antes do horário, adiar depois, adiar duas vezes,
pular depois de já ter adiado, e virada de meia-noite zerando o estado (menos `daemonHealth`, D-035/
S4-T3b) — têm teste próprio nas duas faixas mais baratas: `tests/unit/cli/snooze-command.test.ts`
(estado em memória) e `tests/integration/cli/snooze-command.test.ts` (um `StorageAdapter` real
escrevendo, e uma instância **completamente nova** lendo depois — a prova de "funciona com ou sem o
daemon rodando" que docs/ESPECIFICACAO.md pede, sem precisar do binário compilado nem de relógio
real). `seeya config` ganhou a mesma cobertura em `tests/unit/cli/config-command.test.ts` e
`tests/integration/cli/config-command.test.ts`.

**Achado novo, fora do escopo original desta seção: a corrida de escrita concorrente em
`estado.json`/`config.json` foi medida pela primeira vez** (`tests/integration/storage/
state-concurrent-write.test.ts`, `config-concurrent-write.test.ts`) — `adapters/storage/
atomic-write.ts` já registrava a lacuna ("não há chamador que leia e escreva `config.json`
concorrentemente... até esta tarefa"). 300 iterações de leitura/escrita concorrentes via
`StorageAdapter` real: ~18-20% das escritas colidem com `EPERM` no Windows (o risco que
`atomic-write.ts` já documentava), e nenhuma leitura, em seis execuções, viu documento corrompido.
Sem retry/lock implementado — ver docs/QUESTOES.md Q-056 para as opções registradas ao mantenedor.

**S4-T5 (2026-09-06): o item 8 chegou — segunda instância, `--status` e `--stop` juntos, contra o
binário real (`tests/e2e/daemon.test.ts`).** Sobe um primeiro daemon de verdade, confirma que um
segundo recusa por causa do lock, lê `--status` com o daemon vivo (saudável), pede `--stop` **sem
forçar plataforma** — o único teste do repositório que exercita o despacho real gracioso/abrupto,
não uma versão forçada por parâmetro —, lê `--status` de novo (não rodando) e sobe um terceiro
daemon para provar que o lock não ficou para trás. Espera por arquivo (`daemon.lock` aparecer,
`processExists` sumir), nunca por tempo fixo. **Itens 6 e 7 continuam sem teste, e o motivo não
mudou desde a S4-T3/S4-T4 acima:** o item 6 ainda precisa de um ponto de injeção de relógio que não
existe no binário compilado, e o item 7 continua deliberadamente agrupado com o 6 para nascerem
juntos como uma jornada "dia inteiro" — S4-T5 não resolveu essa dependência, só entregou o que
ficou novo e possível (o 8, agora com `--stop`/`--status` de verdade em vez de isolado). Cobertura
de integração nova nesta mesma tarefa (`tests/integration/process/termination.test.ts`'s
`terminateAbruptly`, `tests/integration/cli/daemon-command.test.ts`'s parada real graciosa/abrupta)
prova cada mecanismo isolado contra processo real; o e2e é só a jornada ponta a ponta.

**S4-T6 (2026-09-06): `windowsHide: true` nos quatro `spawn` que faltavam (captura, evidência de
git, liveness com `procStart`, notificação) — sem teste automatizado que prove a correção, e essa
ausência é deliberada, não descuido.** O defeito (janela de console real roubando o foco a cada
poll de 30s e durante toda a captura) só existe quando o processo pai não tem console (D-005) — e
`vitest` sempre roda com um console próprio, herdado pelo processo filho, então a MESMA suíte que
provaria a ausência de janela nunca teria como reproduzir a presença dela. Uma asserção que
inspecionasse `spawn`'s options via mock (`vi.mock('node:child_process')`) provaria só que a opção
foi passada — o mesmo problema que uma reintrodução acidental do bug (removendo a chave sem tocar
a assinatura da chamada) não seria pega por esse teste, e o projeto não usa `vi.mock` em lugar
nenhum da suíte hoje (duplo é sempre classe/objeto nomeado — AGENTS.md § "Testes"). Os testes de
integração existentes contra processo real (`tests/integration/notification/spawn-command.test.ts`,
`tests/integration/git/`, `tests/integration/generation/lean-generator.test.ts`,
`tests/unit/adapters/process/proc-start.test.ts`) continuam verdes com a opção presente — provam
que `stdout`/`stderr`/código de saída/erro não mudaram, não que a janela sumiu. **O aceite real é
o mantenedor rodando o daemon de verdade no Windows e não vendo janela nenhuma** — ver
docs/PLANO-DE-ENTREGA.md S4-T6.

**S4-T6: `scheduler/notices.ts#buildLeadTimeNotice` agora recebe o tempo restante real, não o nome
da regra configurada — coberto em três faixas.** `core/schedule.ts#minutesRemaining` (pura, dois
`Date`) ganhou suíte própria em `tests/unit/core/schedule.test.ts`, incluindo o caso exato medido
no primeiro ensaio real (30 min configurados, 22 min reais). `tests/unit/scheduler/notices.test.ts`
prova que a função de renderização mostra o número que recebe, com singular/plural corretos.
`tests/unit/scheduler/poll.test.ts` é o teste que prova a composição — um poll atrasado que cruza o
limiar de 30 min com só 20 min reais restantes produz uma notificação que diz "20 min", nunca "30
min" — esse teste falha sem a correção em `scheduler/poll.ts` (regressão de verdade, não só de
unidade isolada).

**S4-T6: `seeya config get/set schemaVersion` distingue "chave inexistente" de "chave existente,
não editável" — `tests/unit/adapters/storage/config-schema.test.ts` e
`tests/unit/cli/config-command.test.ts`.** Antes, as duas caíam na mesma mensagem
(`unknownConfigKeyMessage`); os testes novos provam que a mensagem de `schemaVersion` nunca contém
o texto que a de uma chave forjada contém, e que `get` devolve o valor real
(`CONFIG_SCHEMA_VERSION`) em vez de recusar.

**S4-T7 (2026-09-07): três partes — histerese por tipo, alertas precoces em um aviso só, e prazo
novo devolve avisos. Cobertas em quatro faixas.**

- **`core/lead-time-hysteresis.ts#shouldSuppressLeadTimeWarning` (pura), suíte própria em
  `tests/unit/core/lead-time-hysteresis.test.ts`:** `lastFiredAt: null` nunca suprime (D-025, "o
  primeiro aviso do dia nunca é engolido"); a fronteira `<` vs `<=` — um intervalo de EXATAMENTE
  `minGapMinutes` NÃO é suprimido, só um estritamente menor; `minGapMinutes: 0` nunca suprime
  (config aceita zero como "nunca suprimir", D-035).
- **`core/schedule.ts` — Parte 3, `resolveFiredLeadTimes`/`decideAgainstDeadline`, em
  `tests/unit/core/schedule.test.ts` (novo describe "S4-T7 Part 3"):** o caso medido do despacho
  (avisos de 30/15 disparam para 14:30, `snooze` para 18:00, as regras voltam a valer para o NOVO
  prazo); um prazo INALTERADO nunca redispara, mesmo relido várias vezes seguidas; um edit direto
  em `endOfDayTime` (não só `snooze`) produz o mesmo efeito; e o caso de migração — um
  `firedLeadTimesEffectiveEndOfDay: null` (a forma exata de um `estado.json` gravado antes desta
  tarefa) NÃO força um re-disparo espúrio quando o prazo de fato não mudou.
- **`scheduler/poll.ts`, composição ponta a ponta, em `tests/unit/scheduler/poll.test.ts` (três
  describes novos):** o bug medido reproduzido de verdade através de `pollOnce` (daemon subindo
  atrasado cruza dois limiares na mesma instância real — um aviso, não dois, e o segundo,
  engolido, ainda fica marcado como disparado — cuidado (a)); um encerramento que acontece logo
  depois de um aviso prévio recente CONTINUA notificando (histerese nunca se aplica à classe
  `endOfDay`, porque `scheduler/poll.ts` só consulta o campo de histerese dentro do branch
  `leadTimeWarning`); e a interação Parte 1 + Parte 3 pedida explicitamente no cuidado (b) da parte
  3 — um `snooze` dado segundos antes de um limiar reabre a regra (parte 3) mas a histerese (parte
  1) ainda impede a rajada imediata, e a notificação legítima seguinte só sai quando o prazo dela
  chega de verdade E a janela de histerese já passou.
- **`scheduler/notices.ts#buildEarlyWarningsNotice`, em `tests/unit/scheduler/notices.test.ts`:**
  um warning único vira "1 early warning"; vários viram uma notificação só com a contagem certa;
  um burst além do teto (`MAX_EARLY_WARNINGS_LISTED`, escolhido não medido — mesmo espírito de
  `cli/format-end-day.ts#UNDERSTANDING_EXCERPT_CHARS`) declara o total real no título E quantos
  ficaram de fora no corpo — nunca corta em silêncio (cuidado (e)).
- **`adapters/storage/state-schema.ts`, migração/round-trip, em
  `tests/integration/storage/state.test.ts`:** um `estado.json` sem os dois campos novos (a forma
  exata de um arquivo real já em uso) lê ambos como `null`; um documento com os dois campos
  preenchidos sobrevive round-trip completo.
- **`adapters/storage/config-schema.ts` — `leadTimeHysteresisMinutes`, em
  `tests/unit/adapters/storage/config-schema.test.ts`:** default 3; valor explícito honrado;
  `0` aceito (não é "degenerado", é "nunca suprimir"); negativo e string rejeitados com erro
  visível; coerção via `seeya config set`.

Nenhuma tarefa e2e nova: as três partes são inteiramente de `core/`/`scheduler/`/`adapters/storage/`
— o mesmo daemon real que a S4-T5 já exercita ponta a ponta (`tests/e2e/daemon.test.ts`) não ganhou
cenário próprio aqui, e o aceite real de "o amontoado sumiu" é o mantenedor observando o daemon de
verdade (ver o relatório da tarefa em `docs/PLANO-DE-ENTREGA.md`).

**S4-T9 (2026-09-07): `adapters/process/spawn.ts#spawnHidden` (D-038) — refatoração pura, sem
comportamento novo para testar, mais uma guarda de lint nova para provar.**

- **Nenhum teste de comportamento novo.** `spawnHidden` é um passa-adiante fino para
  `node:child_process.spawn`, forçando `windowsHide: true` — os seis call sites que passaram a
  usá-lo (`spawn-claude.ts`, `run-git.ts`, `spawn-stdout.ts`, as duas chamadas de
  `console-signal.ts`, `notification/backend.ts`) continuam cobertos pelos MESMOS testes de
  integração contra processo real que já existiam antes desta tarefa (Q-059 item 1's lista:
  `tests/integration/notification/spawn-command.test.ts`, `tests/integration/git/`,
  `tests/integration/generation/lean-generator.test.ts`,
  `tests/unit/adapters/process/proc-start.test.ts`, mais `tests/integration/process/` e
  `tests/integration/resumption/spawn-interactive.test.ts` para os três que ficaram de fora do
  embrulho) — rodados antes E depois da troca, sem alteração de asserção, exatamente a prova que
  a S4-T6 já tinha registrado como impossível de reforçar com um teste NOVO (o defeito só existe
  sem console, e `vitest` sempre roda com um).
- **`tests/integration/guards/eslint-restrictions.test.ts`, novo describe: "guard: eslint rejects
  spawn imported straight from node:child_process outside the D-038 wrapper and its
  exceptions"** — seis casos, mesma disciplina do describe de D-019 já existente neste arquivo
  (fixture real, eslint real como processo filho, nunca a API do eslint chamada in-process):
  rejeita `import { spawn }` de `node:child_process` num adapter comum, com a mensagem citando
  `spawnHidden`/D-038; rejeita a mesma coisa com alias (`import { spawn as run }`, prova que
  `importNames` casa o nome ORIGINAL exportado, não o alias local); aprova importar `spawnHidden`
  do embrulho em outro lugar de `src/` (controle: a guarda mira `node:child_process`, não a
  palavra "spawn"); e aprova os quatro arquivos reais da exceção — `adapters/process/spawn.ts` (o
  próprio embrulho), `adapters/process/daemon-launch.ts`, `adapters/process/termination-posix.ts`
  e `adapters/resumption/spawn-interactive.ts` — rodando eslint contra o CAMINHO REAL desses
  arquivos, não uma fixture: a lista de exceção em `eslint.config.js` nomeia cada um pelo caminho
  exato (não um glob de diretório), então uma fixture dentro de `_guard-eslint/` nunca poderia
  provar a isenção mesmo se quisesse — só apontar eslint para o arquivo de produção de verdade
  prova que a isenção existe e vale para o código real, não para uma cópia.
- **Controle de regressão do guard existente:** o mesmo describe de D-019 ("rejects node:* imported
  in src/core/") continua verde depois da mudança em `eslint.config.js` — prova que o novo bloco
  `no-restricted-imports` (com `files: ['src/**/*.ts']`, superset de `src/core/**/*.ts`) NÃO
  substituiu, por sobreposição de merge do flat config, a proibição mais ampla que já existia só
  para `core/`. Ver o relatório da tarefa para o porquê exato desse risco (a exclusão explícita
  de `src/core/**/*.ts` no novo bloco).
- **`npm run dependencias` como controle passivo, não teste novo:** os seis call sites agora
  importam `adapters/process/spawn.ts` de dentro de `adapters/generation`, `adapters/git` e
  `adapters/notification` — import adapter-para-adapter, fora dos 20 pares nomeados na matriz de
  `docs/ARQUITETURA.md` (a diagonal é "—", não um dos pares contados) e sem regra correspondente
  em `.dependency-cruiser.cjs`. O portão real (`depcruise src`) aprovou sem violação; não há teste
  de guarda dedicado a "adapters pode importar adapters" porque isso já é o comportamento PADRÃO
  (ausência de regra = permitido) — só os pares efetivamente proibidos têm teste de reprovação,
  seguindo a mesma lógica de todo o resto de `docs/ARQUITETURA.md` § matriz.

Nenhuma tarefa e2e nova. O aceite real — "nenhuma janela aparece" — já foi verificado à mão pelo
mantenedor na S4-T6 contra o comportamento que esta tarefa apenas reorganiza; o que esta tarefa
pede de verificação manual nova é mais estreito: que o `start-day` interativo continua abrindo a
janela de verdade (a exceção, não a regra) — ver o relatório da tarefa.

## Contrato — a faixa que protege contra o mundo mudar

O app depende de estruturas internas e não documentadas do Claude Code
(`~/.claude/sessions/*.json`, o `.jsonl`, as flags do CLI). Quando o Claude Code mudar, o app
quebra em silêncio se não houver isso aqui.

Testes de contrato, marcados para **não** rodar no CI padrão (`vitest --project contrato`):

- O schema zod de `~/.claude/sessions/*.json` valida os arquivos reais da máquina.
- O `.jsonl` real tem entradas `user` e `assistant` com os campos que o parser usa.
- `claude --help` ainda expõe `--resume`, `--fork-session`, `-p`, `--output-format`,
  `--model`, `--max-budget-usd`, `--no-session-persistence`.
- `claude agents --json` ainda devolve array com `pid`, `sessionId`, `cwd`.
- `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` ainda é reconhecido pela versão instalada.
- `--append-system-prompt-file` ainda **acrescenta** ao prompt de sistema padrão do Claude Code,
  em vez de substituí-lo (D-004 depende disto para o fallback da retomada escolher este flag em
  vez de `--system-prompt-file`, Q-027 item 3). Prova por assimetria observável de fora, **com
  braço negativo**: uma chamada `claude -p --model haiku` com o flag pede, no mesmo turno, o nome
  do produto de CLI (só respondível a partir do prompt padrão) e um marcador sintético só presente
  no arquivo anexado. Uma chamada de controle (sem flag nenhum) e uma chamada com
  `--system-prompt-file` (o flag que de fato SUBSTITUI, mesmo arquivo) fecham o argumento: medido
  na 2.1.251, controle e append respondem com o nome do produto, replace responde `UNKNOWN` —
  mesmo com o marcador do arquivo presente nos dois casos. Sem esse terceiro braço, "os dois fatos
  chegam" seria compatível com as duas semânticas (achado do review, não do desenvolvimento
  original — Q-029 registra a versão anterior, só com controle+append, que não discriminava de
  verdade). **Achado à parte, e sério: `--model sonnet` NÃO discrimina** — respondeu o nome do
  produto mesmo com o prompt inteiramente substituído (autorrelato de identidade não depende do
  prompt de sistema nesse modelo) e ainda estourou o teto de custo via uma chamada de classificação
  interna em haiku antes do turno de sonnet. Por isso o teste final usa só `haiku`, a única
  configuração medida a discriminar. **Exatamente 3 chamadas reais por execução**,
  `--no-session-persistence` + `--max-budget-usd` baixo, `cwd` descartável em `%TEMP%`, ambiente
  saneado (D-017, reaproveitando `adapters/generation/env.ts#buildGenerationEnv`) — nunca mais que
  isso, comentário no topo de `tests/contract/append-system-prompt-file.test.ts` explica o porquê.
  **Flakiness medida e documentada, não escondida:** a chamada de controle especificamente já
  respondeu `UNKNOWN` uma vez sem motivo (ruído de amostragem do haiku nessa pergunta de
  autorrelato) enquanto append e replace nunca flakaram nas mesmas rodadas — a mensagem de falha
  do teste de controle explica que uma falha isolada ali não é, sozinha, evidência de regressão.
  **Limitação registrada em Q-029, não escondida:** a medição usa `-p` (headless); o fallback real
  de `adapters/resumption` roda em modo interativo puro com `stdio: 'inherit'`, que não deixa o
  `seeya` ler o stdout do processo filho — supor que a construção do prompt de sistema é a mesma
  rotina nos dois modos é engenharia razoável, não medição direta.

**Registrar sempre a versão contra a qual o contrato rodou.** O Spike D mostrou que o
comportamento muda entre versões (2.1.201 × 2.1.233) e que **duas versões coexistem na mesma
máquina** — CLI no PATH e a empacotada na extensão do VS Code. Um contrato verde sem a versão
anotada não prova nada.

Rodar antes de cada release e quando o Claude Code atualizar. Falha aqui = issue, não hotfix
às cegas.

## Teste de tipo: cuidado com `const` anotado pela união

Prova de compilação (`@ts-expect-error`, ou o caso positivo "isto só passa depois de estreitar")
é o mecanismo que faz valer D-024 e a recusa de D-023 — e é fácil escrevê-la de forma que ela
**deixe de testar o que afirma, em silêncio**.

A armadilha, achada na S1-T10 e confirmada por experimento:

```ts
const session: DiscoveredSession = createSessionWithPid();
```

Isso **não** dá a `session` o tipo da união para efeito de estreitamento. A análise de fluxo do
TypeScript estreita um `const` recém-inicializado para o tipo do **inicializador**, ignorando a
anotação mais larga. Um `@ts-expect-error` construído em cima disso passa a testar outra coisa,
e nada avisa.

Quem precisa da união de verdade **recebe por parâmetro de função**: o tipo de fluxo de um
parâmetro na entrada é exatamente o declarado, porque não há inicializador de onde estreitar.

## Regras que valem para toda a suíte

- Nenhum teste depende de rede.
- Nenhum teste depende do relógio real: `Clock` é sempre injetado.
- Nenhum teste escreve fora do seu `tmpdir`. Um teste que escreva no `~/.claude` ou no
  `~/.seeya` reais é um bug grave.
- Testes de plataforma usam `describe.skipIf` explícito, nunca ficam silenciosamente verdes.
- Fixtures anonimizadas: nenhum caminho, token, nome de cliente ou trecho de código privado
  vai para o repositório.

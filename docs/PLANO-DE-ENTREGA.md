# Plano de entrega

Uma tarefa por vez, na ordem. Cada tarefa é um branch (`tarefa/S1-T3-descoberta`) e termina
com os testes da sua faixa passando e os guards verdes.

O agente dev **não pula tarefa**, **não agrupa tarefas** e **não começa a próxima** antes do
review aprovar a anterior.

Legenda: `[ ]` a fazer · `[~]` em andamento · `[x]` aprovado no review

---

## Sprint 0 — Fundação e riscos

O objetivo aqui não é entregar produto, é **derrubar as incertezas antes que elas custem caro**.

- [x] **S0-T1 — Scaffold.** Aprovado no review em 2026-08-16. `npm run verificar` verde, CLI
      roda, estrutura de camadas conforme `docs/ARQUITETURA.md`, sem escopo adiantado.

- [x] **S0-T2 — Guards executáveis.** Aprovado no review em 2026-08-16, após três rodadas.
      `dependency-cruiser`, `no-restricted-syntax` conforme D-019, cobertura por diretório,
      husky, lint-staged e CI nos 3 SOs. 25 testes provando reprovação de violação real e
      aprovação dos casos permitidos. Gerou D-019 e D-020.

- [x] **S0-T6 — Fechar a matriz de camadas.** Aprovado no review em 2026-08-16. Os 20 pares
      ordenados cobertos, com o **guard do guard**: um teste dirigido por estrutura de dados
      única (`tests/integracao/guardas/_matriz-de-camadas.ts`), declarada de forma independente
      do `.dependency-cruiser.cjs` de propósito — se ela apenas repetisse o config, um erro
      cometido nos dois lugares passaria batido. Verificado removendo regras: os pares
      afetados falham nomeados individualmente, e uma camada nova em `src/` reprova o teste de
      sanidade. Guards isolados em projeto vitest próprio, serializado porque disputam a árvore
      real de `src/`; a faixa de integração segue paralela.

- [x] **S0-T3 — SPIKE A.** Feito pelo PO em 2026-08-16. Veredito em
      `docs/spikes/A-resume-headless.md`: funciona com a sessão viva, transcript original
      preservado. Gerou D-011, D-012 e D-015.
      *Complemento feito:* `docs/spikes/C-alternativa-barata-e-transcript-desativado.md`.

- [x] **S0-T4 — SPIKE B.** Feito pelo PO em 2026-08-16. Veredito em `docs/spikes/B-notificacoes.md`.
      Windows exibe toast sem dependência nenhuma (WinRT via PowerShell). Ações clicáveis são
      inconsistentes entre SOs: a spec passou a **não depender delas**. macOS e Linux
      documentados, não executados — S5-T4 continua obrigatório.

- [x] **S0-T5 — Schemas e contrato.** Aprovado no review em 2026-08-16. Schemas do registro de
      sessões, do `agents --json`, do transcript e da saída do `claude -p`, escritos depois de
      conferir 2808 entradas reais desta máquina — que já trazem campos não previstos pela spec
      (`status`, `bridgeSessionId`, `nameSource`…), confirmando na prática o princípio de
      tolerar o desconhecido. Suíte de contrato roda contra o `~/.claude` real, imprime a versão
      do Claude Code no caminho feliz, e foi **verificada capaz de falhar** quando o schema
      diverge da realidade. `procStart` fica como string: os valores reais excedem
      `Number.MAX_SAFE_INTEGER`. Gerou D-021.

**Sprint 0 fechado.** As quatro incertezas que podiam custar caro foram derrubadas antes de
existir código de negócio: o `--resume` headless funciona e preserva o transcript (Spike A), a
notificação nativa não precisa de dependência (Spike B), a supressão de transcript tem causa
conhecida e correção (Spike D), e as fronteiras de camada são impostas por ferramenta, não por
boa vontade. Onze decisões nasceram de medição, não de opinião.

---

## Sprint 1 — Enxergar as sessões

- [x] **S1-T0 — Tornar os guards insensíveis ao estado da árvore.** Aprovado no review em
      2026-08-16, após 6 rodadas. Vem antes de tudo: guard instável mina toda tarefa seguinte,
      porque um vermelho que ninguém confia vira um vermelho que todo mundo ignora.
      **O que aconteceu:** no commit `6899f99` o CI falhou em Linux e macOS e passou no Windows.
      O teste que caiu foi o controle de D-019 (`aprova new Date(valor)`), com
      `expected 2 to be +0` — o eslint viu 2 erros onde deveria ver zero.

      **CUIDADO: não é problema de plataforma.** A primeira leitura foi essa e estava errada.
      Reproduzido com paralelismo forçado nos dois sistemas:

      | | com `--file-parallelism` |
      |---|---|
      | Linux (container) | **13 de 54 falham** |
      | Windows (local) | **11 de 54 falham** |

      O Windows nunca foi imune; teve sorte de timing naquela execução do CI. É uma **corrida**,
      e a serialização do S0-T6 a **mascara**, não a corrige.

      **Causa:** os arquivos de guard escrevem fixtures na árvore real de `src/` e as asserções
      de controle exigem "zero erros". Rodando em paralelo, um controle enxerga a violação que
      outro arquivo acabou de escrever. `limparResiduosDeTestesDeGuarda()` piora, varrendo `src/`
      inteiro e apagando tudo com prefixo `_` — inclusive fixture em voo de outro arquivo.

      **Causa raiz final:** o teste que prova a âncora de segmento cria e apaga o diretório
      `src/aplicacao-legado/` **inteiro**; a varredura de outro arquivo de teste o via listado
      em `src/` e sumido antes de conseguir ler.

      **Três soluções erradas morreram no caminho — vale saber quais, para ninguém trazê-las
      de volta achando que são melhoria:**
      1. `fileParallelism: false` (herdado do S0-T6) — mascarava, não corrigia. Removido: o
         paralelismo é mais rápido **e** é o que expõe corrida nova em vez de deixá-la dormir.
      2. Retry de 3× no `dependency-cruiser` — medido: disparava em **4 de 10** execuções, e
         numa delas esgotou as três tentativas e falhou assim mesmo. Descartado.
      3. Pré-listagem ingênua dos arquivos de produção — moveu o TOCTOU para o `readdirSync`
         do próprio teste, derrubando a **suíte** (não uma asserção) com `ENOENT: scandir`.

      **A correção:** tolerar `ENOENT` — e **apenas** `ENOENT` — na varredura, com o argumento
      semântico de que diretório que sumiu é, por definição, não-produção. `ENOTDIR` e `EPERM`
      continuam estourando. Fixtures em subdiretório próprio por arquivo, limpeza restrita a
      ele. Asserções de contagem passaram a imprimir a saída bruta da ferramenta na falha.

      **Estabilidade medida:** 40 rodadas do dev nos dois sistemas + 20 minhas, zero falhas.
      Antes, ~1 em 3.
      *Aceite cumprido:* `npx vitest run --project guards --file-parallelism` passa em Linux e
      Windows, e o guard continua reprovando violação real plantada em `src/` — verificado em
      três camadas diferentes, incluindo o caso `aplicacao-nova`, que um filtro por prefixo
      teria deixado passar.

- [x] **S1-T0b — Pré-voo local em Linux com Docker.** Aprovado no review em 2026-08-16.
      `npm run verificar:linux` roda o portão dentro de `node:22-bookworm` via `spawnSync` com
      array e `shell: false` — caminho do Windows atravessa até o Docker sem shell intermediário
      reescrevendo aspas (D-015 aplicado a ferramental). Propagação de exit code verificada com
      erro de tipo injetado: saiu 2, com a mensagem real do `tsc`. O review tentou forçar
      falso-verde por quatro caminhos e todos falharam alto e correto.
      **Achado do review, corrigido:** volume global compartilhado quebra sob concorrência —
      dois `npm ci` simultâneos de worktrees diferentes, e um perde com `ENOENT`. Passou a ser
      `seeya-node-modules-<hash-do-caminho>`, um por repositório/worktree. Elimina a corrida sem
      lock e preserva o cache (3m06s frio → 1m39s quente).
      **Limite honesto, escrito no README:** cobre Linux, não macOS — não existe container de
      macOS. O CI nos 3 SOs e a bateria manual do S5-T4 continuam obrigatórios.

- [x] **S1-T0c — Corrigir os schemas contra dado real de outra máquina.** Os schemas do S0-T5
      foram escritos contra o `~/.claude` de **uma** máquina (Windows, uso pessoal). Testados
      contra a saída real de uma segunda máquina, Linux, **rejeitam**:
      ```
      esquemaSaidaAgentsJson.safeParse(saidaReal) -> REJEITA
        0.pid : expected number, received undefined
      ```
      A entrada é uma sessão `kind: "background"` com esta forma — diferente das interativas:
      ```jsonc
      { "id": "1a2b3c4d", "cwd": "…/.claude/agente-interno/ui", "kind": "background",
        "startedAt": 1780000000000, "sessionId": "1a2b3c4d-…",
        "name": "pare o ui do agente", "state": "blocked" }   // sem pid; state, não status
      ```
      - `pid` passa a opcional; aceitar `id` e `state` da variante de background
      - validação **por item** conforme D-022: item ruim é descartado com registro, não derruba
        a lista
      - item sem `pid` nunca é candidato a encerramento de processo (igual a D-016)
      - a suíte de contrato passa a incluir esta amostra real como fixture anonimizada, para a
        regressão não voltar
      *Aceite:* a saída real da máquina Linux (fixture) é aceita, com a entrada de background
      preservada; e um array com uma entrada boa e uma inválida devolve a boa e reporta a outra.

- [x] **S1-T1 — `nucleo/` de domínio.** Tipos, portas e as regras puras de elegibilidade e de
      classificação viva/ociosa/encerrada. Sem I/O.
      **Requisito de D-024, vindo do review de S1-T0c:** o tipo de sessão descoberta é uma **união
      discriminada**, não um tipo único com `pid` opcional. Uma forma carrega `pid` garantido, a
      outra não tem PID nenhum. A política de encerramento (D-002) aceita só a primeira, e o
      compilador recusa a segunda.
      *Por que importa:* foi medido que `item.pid!` compila sem erro. Comentário avisando "não
      encerre sem PID" não impede ninguém; tipo impede.
      *Aceite:* existe um teste que **não compila** se alguém tentar passar a forma sem PID para a
      função de encerramento — ou, se um teste de compilação for caro demais, a função de
      encerramento aceita exclusivamente o tipo com `pid` garantido e isso está exercitado.
- [x] **S1-T0d — Migrar o código para inglês (D-028).** Vem **antes do S1-T2**, senão ele escreve
      código novo em português que teria de ser migrado logo depois.
      Escopo: identificadores, comentários de código, README, comandos e saída do CLI. `docs/`
      **não** muda — continua em português, e é por isso que o glossário existe.
      - use **exatamente** o glossário de `AGENTS.md` § Idioma. Termo que não estiver lá: **pare
        e pergunte**, não invente tradução. Deriva de termo é o único risco real desta migração.
      - renomear os diretórios de camada (`nucleo` → `core` etc.) tem raio de alcance grande:
        `.dependency-cruiser.cjs`, a matriz de 20 pares em
        `tests/integracao/guardas/_matriz-de-camadas.ts`, os testes de guarda, os limites de
        cobertura por diretório em `vitest.config.ts`, e os caminhos em `tests/`. Confira cada um.
      - `docs/ARQUITETURA.md` continua em português **mas cita os diretórios reais** — atualize só
        os nomes de caminho lá, não o texto.
      - o teste de sanidade da matriz compara os diretórios reais de `src/` com a lista declarada:
        ele **tem** que reprovar durante a migração e voltar a passar no fim. Se passar o tempo
        todo, alguma das duas pontas não foi migrada.
      *Aceite:* `npm run verificar` verde; `npx vitest run --project guards --file-parallelism`
      verde; nenhum identificador em português em `src/` e `tests/`; `docs/` intocado exceto os
      nomes de caminho.

- [x] **S1-T0e — Fechar o buraco do `passWithNoTests`.** Achado durante o S1-T0d, e é da pior
      classe: **falso verde**.
      `passWithNoTests: true` está ligado globalmente desde S0-T1, quando as faixas ainda estavam
      vazias. Consequência hoje: **qualquer projeto cujo glob deixe de casar passa verde, sem
      rodar teste nenhum.** Durante a migração, renomear o diretório antes de atualizar o config
      produziu `No test files found, exiting with code 0` — o portão teria aprovado uma migração
      pela metade.
      Não dá para simplesmente desligar: **duas** faixas estão legitimamente vazias hoje, não só
      uma como este item dizia antes de alguém contar de verdade. `integration` resolve para
      **zero**: os 4 arquivos que existem sob `tests/integration/` estão todos em
      `tests/integration/guards/`, que o projeto `integration` exclui por glob — as integrações
      de verdade (`discovery/`, `storage/`, `git/`, `process/`) só chegam nas tarefas seguintes.
      `tests/e2e/` também está vazio, até S1-T6.
      - guard que afirma que **cada projeto do vitest resolve para pelo menos um arquivo de
        teste**, dirigido por uma lista declarada — mesmo padrão da matriz de camadas
      - a lista declara explicitamente quais faixas podem estar vazias **e por quê** (hoje
        `integration`, até S1-T2, e `e2e`, até S1-T6)
      - **simétrico**: o teste falha também se uma faixa declarada como vazia deixar de estar.
        Sem isso, a exceção vira permanente sem ninguém notar quando o primeiro teste da faixa
        chegar.
      *Aceite:* renomear um diretório de teste sem atualizar o `vitest.config.ts` **reprova** o
      portão. Provado por execução, não por leitura.

- [x] **S1-T0f — O prettier não é aplicado em lugar nenhum.** Achado ao investigar um efeito
      colateral do S1-T0e. Medido, não suposto:
      - `core.autocrlf` está `true` nesta máquina e **não existe `.gitattributes`**, então a
        árvore de trabalho é CRLF
      - o prettier usa `endOfLine: "lf"` por padrão, então `format:check` acusa **todos** os
        arquivos
      - confirmado que a divergência é só fim de linha: a saída do prettier comparada com o
        arquivo, ignorando CR, é idêntica. Não há problema de formatação real
      - `format:check` **não está** no `verificar`, e o `lint-staged.config.js` roda
        `eslint --fix` e `tsc` — **não roda prettier**
      Ou seja: há `.prettierrc.json`, `.prettierignore`, dois scripts npm e uma seção de
      formatação no `AGENTS.md`, e **nada disso é verificado**. É padrão que existe no papel. Pior,
      o único comando que o checaria está permanentemente vermelho num checkout Windows, o que
      garante que ninguém passe a usá-lo: quem roda uma vez conclui que está quebrado.
      - fazer `format:check` passar num checkout Windows sem alterar conteúdo
      - **aplicar em algum lugar** — portão ou pre-commit. Decida qual e justifique; um padrão que
        ninguém verifica volta a divergir sozinho
      - se for preciso reformatar em massa, **commit separado** do commit que liga a verificação,
        senão o diff fica irrevisável
      *Aceite:* `npm run format:check` verde nesta máquina, e um `.ts` deliberadamente mal
      formatado em stage é barrado ou corrigido no commit. Provado por execução.

- [x] **S1-T0g — As docs internas não alcançaram o D-028.** Precisa entrar **antes do S1-T6**, que
      é onde os nomes de comando viram código.
      O escopo real é maior do que "nome de comando": a especificação inteira estava escrita com
      identificadores em português — chaves do `config.json`, chaves do handoff, layout de pastas
      em `~/.seeya/`, valores de enum e nomes de caso de uso.
      **Já feito pelo PO** (os dois documentos que o agente dev não altera): `ESPECIFICACAO.md` e
      `DECISOES.md` normalizados, 52 trocas, e o mapeamento inteiro fixado no glossário do
      `AGENTS.md` § Idioma, incluindo a tabela dos identificadores que vão para disco.
      **Falta**, e é o escopo desta tarefa:
      - `ARQUITETURA.md` — o bloco de `config.json` tem 11 chaves em português, e os casos de uso
        estão como `encerrarDia, iniciarDia, capturarSessao`
      - `PLANO-DE-ENTREGA.md`, `TESTES.md`, `FORA-DE-ESCOPO.md`, `QUESTOES.md` — nomes de comando
        e flags (`--sessao`, `--todas`, `--parar`)
      - `src/core/eligibility.ts:48` cita `~/.see-you-tomorrow/forks.json`, pasta que o D-027
        substituiu por `~/.seeya/`. É comentário apontando para caminho que não existe
      **O glossário manda.** Não invente nome: se faltar algum, pare e pergunte, para não haver
      dois nomes para a mesma coisa em dois arquivos.
      Duas coisas que **não** se traduzem: prosa em português (palavras como "fatos", "origem" e
      "caminho" também são texto corrido — trocar por busca cega destrói o documento; troque só
      dentro de crase, de chave JSON e de bloco de código), e registro histórico (o que está
      dentro de tarefa já `[x]` e os spikes descrevem o que era verdade na época).
      *Aceite:* nenhum identificador em português sobra fora de bloco histórico, a prosa continua
      em português, e `npm run verificar` verde.

- [x] **S1-T2 — `adapters/process`.** Liveness com desempate por `procStart`, nos 3 SOs.
      **Leia o `docs/spikes/F-procstart-por-so.md` antes de começar.** O formato do `procStart`
      é diferente nos três SOs e eles não se comparam entre si — no macOS nem é numérico. Aquele
      spike já rastreou os três, mas os achados **não foram verificados de forma independente**:
      confirme antes de construir em cima.
      Duas armadilhas registradas lá e aqui: no Windows o `SIGTERM` do Node chama
      `TerminateProcess`, que mata sem o processo salvar nada — usar isso viola D-002 parecendo
      cumpri-lo. E `EPERM` em `process.kill(pid, 0)` significa **vivo**, não morto.
      Quando o desempate não puder ser avaliado, `isAlive` **não** responde `false` (D-025).
- [x] **S1-T2b — Encerramento gracioso no Windows, por evento de console.** Nasce do Spike G,
      que **revoga** a conclusão do S1-T2 de que não havia caminho no Windows. Aquela conclusão
      foi tirada por raciocínio e não sobreviveu à primeira medição.
      **Leia `docs/spikes/G-ctrl-break-no-windows.md` antes de começar** — ele traz a técnica, os
      dois hospedeiros medidos e duas armadilhas de interpretação que já produziram leitura errada.
      - trocar o no-op do Windows em `src/adapters/process/termination.ts` por
        `CTRL_BREAK_EVENT` (nunca `CTRL_C_EVENT` — medido, é ignorado), via `AttachConsole` +
        `SetConsoleCtrlHandler(NULL, TRUE)` + `GenerateConsoleCtrlEvent`, por P/Invoke no
        PowerShell. **Sem dependência nova** — mesma técnica do adapter de notificação
      - `AttachConsole` falhando (sessão sem console, erro 6) devolve `false` honesto: é o caso
        que sobrou do aviso exigido por Q-007
      - depois de enviar, espera limitada e **reconfere a realidade**, como o caminho POSIX já faz
      - o comentário do módulo hoje **afirma que isso é impossível**. Ele não fica desatualizado:
        fica mentindo, e persuade quem ler a não tentar. Reescrever é parte da tarefa
      **Risco de desenho, receba pronto:** o evento vai para o **console**, não para o PID. Se o
      `seeya` estiver no mesmo console do alvo, ele se atinge. O helper se protege soltando o
      próprio console antes de anexar; o processo `seeya` pai **não**. Trate explicitamente.
      *Aceite:* teste que prova **graciosidade**, não morte — processo de controle com handler que
      grava marcador antes de sair; marcador escrito = teve chance de salvar. Mais o caso sem
      console devolvendo `false`. `verificar` e `verificar:linux` verdes (o caminho POSIX não muda).
- [x] **S1-T3 — `adapters/discovery`, estratégia por registro.** Lê
      `~/.claude/sessions/*.json`, tolerante a arquivo corrompido. Exclui forks de `forks.json`
      (D-012). Sessão sem transcript entra normalmente, com `hasTranscript: false` (D-013).
      Corrige Q-006 (`procStart` do macOS): o `regex` saiu do schema, virou `z.string().min(1)`.
      Entrada obsoleta (PID morto) entra na lista normalmente, com `processIsAlive: false` —
      não é excluída nem tratada como sinal de trabalho concluído (docs/spikes/E: o registro é
      apagado na saída graciosa, então uma entrada obsoleta só sobrevive a queda anormal, e é
      reportada como sessão encerrada, não descartada — já era o que `docs/ESPECIFICACAO.md` e o
      tipo de S1-T1 diziam). Formato de `~/.seeya/forks.json`: Q-008 fechada, opção B — objeto
      raiz com `schemaVersion` (`{ "schemaVersion": 1, "forks": [...] }`), `schemaVersion` ou
      `forks` ausentes/inválidos viram rejeição visível, cada item segue exigindo só `sessionId`.
- [x] **S1-T8 — Estratégia por varredura de transcripts (D-016).** Varre
      `~/.claude/projects/**/*.jsonl` por mtime dentro de `relevanceHours`, sem ler conteúdo
      antes de filtrar. Reconstrói o `cwd` a partir do transcript, já que o slug não é
      reversível com segurança.
      *Aceite:* sessão headless — que não aparece no registro — é descoberta. Um `~/.claude`
      falso com 500 transcripts é filtrado sem parse de conteúdo.
      **Implementado:** `src/adapters/discovery/transcript-scan.ts` (estratégia,
      `discoverSessionsFromTranscriptScan`) + `transcript-cwd.ts` (leitura mínima do `cwd`,
      linha a linha, para de ler assim que encontra). `stat` decide dentro/fora de
      `relevanceHours` antes de qualquer leitura de conteúdo; forks de `forks.json` são
      excluídos antes de abrir o arquivo (reaproveita `fork-registry.ts` da S1-T3, sem
      duplicar leitura). Prova por execução do item 2 do aceite: fixture com 500 transcripts
      obsoletos, cada um uma *pasta* com o nome `<uuid>.jsonl` (abrir como arquivo falharia,
      então sua ausência de `rejected` prova que nunca foram abertos) + um caso de controle
      idêntico *dentro* da janela, que precisa aparecer rejeitado — descarta a hipótese de que
      o filtro estivesse ignorando todo `.jsonl`-pasta por acidente, não por mtime. Linha
      truncada no fim tolerada (não derruba a sessão nem o lote); transcript >1 MB com `cwd` na
      primeira linha lido em poucos KB (`bytesRead` medido no teste). Transcript sem `cwd`
      legível em nenhuma linha é **rejeitado**, não descartado em silêncio nem inventado como
      sessão (D-025) — decisão registrada em Q-009 por ambiguidade quanto ao tipo de domínio.
      `npm run verificar` e `npm run verificar:linux` verdes.
- [x] **S1-T10 (REVOGADA por D-029) — Terceira estratégia: processo e `.key` sem `.json` (D-023).** Cobre o agente de
      **Entregue e depois revogada.** O D-029 tirou esta estratégia: a causa que o D-023
      atribuía não se confirmou em medição, e o custo era desproporcional. O código sai na
      S1-T11. Fica marcada como entregue porque foi — e como revogada porque não vale mais.
      execução autônomo, que as duas estratégias anteriores não veem: sem `.json` no registro e
      sem transcript.
      - listar `~/.claude/sessions/` e achar `<pid>.<hash>.key` **sem** `<pid>.json` — só o nome
        do arquivo. O `.key` é material sensível (modo 600): **nunca ler o conteúdo**
      - confirmar liveness e obter `cwd` + linha de comando enumerando processos: Linux por
        `/proc/<pid>/cwd`, macOS por `lsof`, Windows sem `cwd` (degrada, e lá essas sessões
        produzem `.json` de qualquer forma)
      - extrair da linha de comando o que serve de handoff: o comando e o item de trabalho
      - sessão vinda só desta origem entra com `sessionId: null` e nunca é candidata a
        encerramento de processo
      **A união de tipos vai precisar crescer, e isso é esperado.** O tipo de S1-T1 tem duas
      formas: com `pid` (e `sessionId`) e sem `pid` (e com `sessionId`). Esta origem é o inverso
      que ainda não existe: tem `pid` e **não tem `sessionId`** — o `.key` dá o PID, e o processo
      dá `cwd` e linha de comando, mas nenhum dos dois dá o id da sessão. Quem implementar decide
      a forma junto com o PO; o importante é não forçar um `sessionId` sintético só para caber no
      tipo atual, o que criaria um identificador falso que a deduplicação de S1-T9 usaria.
      *Aceite:* uma sessão lançada por script com prompt como argumento é descoberta, com `cwd` e
      linha de comando, num `~/.claude` falso + processo de teste. E um `.key` cujo PID **não**
      está vivo é ignorado, não reportado como sessão.

- [ ] **S1-T9 — Fusão das três estratégias.** União deduplicada: por `sessionId` quando existe,
      por **PID** quando a origem não fornece `sessionId` (D-023). Sessão vista só pela varredura
      de transcripts entra com `pid: null`; a vinda só do processo entra com `sessionId: null`.
      Nenhuma das duas é candidata a encerramento de processo.
      *Aceite:* sessão presente em duas ou três origens aparece **uma** vez, com os campos
      fundidos, e o teste cobre as três combinações de par.
      **Q-010:** para a origem de S1-T10 (`SessionWithoutSessionId`), **PID não é identidade
      estável**. Ela não tem `procStart`, então "mesmo PID em duas varreduras" não prova "mesma
      sessão" — ao contrário de `SessionWithPid`. A janela é estreita e aceita na v1; o que não se
      aceita é deduplicar por PID sem saber disso.
- [ ] **S1-T4 — `adapters/transcript`.** Parser streaming; últimos prompts, arquivos
      tocados, última atividade.
- [ ] **S1-T7 — Detecção precoce de sessão sem transcript.** Notificação uma vez por
      `sessionId`, disparada quando a sessão é vista, não no encerramento (D-013).
      *Aceite:* sessão registrada sem `.jsonl` gera exatamente uma notificação, e a segunda
      passagem da descoberta não repete.
      **D-029 estende esta tarefa:** além da sessão registrada sem transcript, avisar também
      sobre `.key` sem `.json` — sessões que o `seeya` vê existir e **não consegue inspecionar**.
      Só o **nome** do arquivo, nunca o conteúdo (modo 600). O aviso **não afirma** a causa: ela
      não está estabelecida (ver D-029). Diga o que se sabe e aponte o caminho conhecido.
      A listagem de `.key` sem `.json` foi removida pela S1-T11 em vez de ficar parada sem uso.
      Recupere de `src/adapters/discovery/process-key.ts` no commit `e45b348` — ela já era testada,
      e reescrever do zero seria desperdício.
- [ ] **S1-T11 — Reverter a terceira estratégia (D-029).** Remove o que a S1-T10 acrescentou,
      mantendo a detecção barata para a S1-T7.
      - sai: `adapters/discovery/process-key.ts`, `adapters/process/inspection.ts`, os métodos
        `readCwd`/`readCommandLine` de `ProcessControl`, e a terceira forma da união de tipos
      - **sai também a listagem de `.key` sem `.json`** (mudei de ideia depois de escrever esta
        tarefa): a S1-T7 ainda não existe, então mantê-la deixaria código de produção sem uso, e
        este projeto não guarda código especulativo. A lógica não se perde — está em
        `src/adapters/discovery/process-key.ts` no commit `e45b348`, de onde a S1-T7 recupera
      - `spawn-stdout.ts` é compartilhado com `proc-start.ts`: **não remova** sem conferir
      - a união volta a duas formas. Confira se o discriminante `hasSessionId` ainda paga o
        próprio custo com uma forma só — se não pagar, remova-o também
      - a regra de teste de tipo registrada em `docs/TESTES.md` (o `const` anotado pela união)
        **fica**: ela não depende desta estratégia e custou caro para ser achada
      *Aceite:* núcleo de volta a duas formas, `verificar` e `verificar:linux` verdes, e nenhuma
      leitura de linha de comando em lugar nenhum do código.
- [ ] **S1-T5 — `adapters/storage`.** Raiz injetável, escrita atômica, config com
      defaults, `schemaVersion`.
- [ ] **S1-T6 — `seeya sessions` e `seeya status`.**
      *Aceite do sprint:* `seeya sessions` lista corretamente as sessões reais desta máquina,
      incluindo as obsoletas, e o e2e nº1 passa.

---

## Sprint 2 — Encerrar o dia

- [ ] **S2-T1 — `adapters/git`.** Branch, status, commits do dia e **enumeração de
      worktrees** com o estado de cada um (D-013). Sem quebrar quando o `cwd` não é repo.
      *Aceite:* repo de teste com dois worktrees, um sujo e um limpo, produz o estado correto
      dos dois.
- [ ] **S2-T2 — `adapters/generation`.** Duas implementações, enxuta e profunda (D-011).
      Contexto por stdin ou arquivo, nunca por argumento (D-015). `--tools ""`,
      `--system-prompt` curto, `--json-schema`, timeout, orçamento, `spawn` sem shell, erro
      tipado. Registro do fork em `forks.json` no modo profundo.
      *Aceite:* teste com conteúdo contendo quebra de linha, aspas, acento e `%` chega íntegro
      ao processo filho; medição do piso de tokens antes e depois do `--tools ""` registrada.
      **Q-008:** o formato de `~/.seeya/forks.json` está fixado — `{ schemaVersion: 1,
      forks: [{ sessionId, createdAt }] }`. O `createdAt` é escrito desde já: S2-T6 precisa dele
      para `forkCleanupDays`, e acrescentá-lo depois vira migração de arquivo já existente.
- [ ] **S2-T3 — Caso de uso `endDay`.** Coleta multi-fonte com `sources[]` (D-013),
      concorrência limitada, isolamento de falha por sessão, fallback determinístico,
      anti-duplicidade, guarda de turno ativo. Handoff válido com qualquer fonte respondendo.
      **Q-007:** `terminateGracefully` devolvendo `false` com o processo ainda vivo não é erro e
      não aborta nada, mas **precisa aparecer no resultado do dia**, nomeando a sessão e o motivo.
      Silêncio aqui faz quem marcou `canTerminate: true` acreditar que a sessão fechou.
- [ ] **S2-T6 — Limpeza de forks.** Apaga forks próprios com mais de `forkCleanupDays`.
      *Aceite:* apaga apenas IDs presentes em `forks.json`; um teste prova que nenhum outro
      arquivo de `~/.claude/projects/` é tocado.
- [ ] **S2-T4 — Briefing.** Geração do `summary.md` a partir dos handoffs.
- [ ] **S2-T5 — `seeya end-day` com `--dry-run` e `--session`.**
      *Aceite do sprint:* e2e 2, 3 e 4 passam. Encerramento com o modelo indisponível ainda
      produz handoffs úteis.

---

## Sprint 3 — Começar o dia

- [ ] **S3-T1 — Leitura do briefing pendente** e montagem do prompt de retomada por sessão.
- [ ] **S3-T2 — Retomada.** `claude --resume` no `cwd` original, com fallback para sessão nova
      e aviso explícito ao usuário.
- [ ] **S3-T3 — `seeya start-day`** com seleção interativa e `--all`.
      *Aceite do sprint:* e2e 5 passa; retomada real de uma sessão de ontem funciona à mão.

---

## Sprint 4 — Automatizar

- [ ] **S4-T1 — `adapters/notification`** conforme o Spike B, com a cadeia de fallback e o
      contrato mínimo **sem ações**. Validação manual do `activationType="protocol"` com esquema
      `seeya://` no Windows; se não se provar, o produto segue sem ações clicáveis e nada quebra.
      **Q-007:** quando `canTerminate: true` estiver ligado e a terminação não acontecer (depois da
      S1-T2b: quando não há console para anexar), o aviso diz **qual sessão não foi encerrada e por
      captura — o handoff foi gravado; só a terminação não ocorreu.
- [ ] **S4-T2 — `core/schedule`.** Puro: dado config + estado + agora, o que deve acontecer.
      É aqui que moram os testes de horário de verão e de máquina suspensa.
- [ ] **S4-T3 — Daemon.** Loop, lockfile de instância única, recuperação de disparo atrasado.
      **Sobe desanexado do shell que o chamou** (D-005, emendado): `detached` + `stdio` ignorado
      + `unref()`. Não é comando em segundo plano — sobrevive a fechar a janela e a deslogar.
      No Windows isso significa **console nenhum**, e é o que torna o daemon inalcançável pelo
      Ctrl+Break que ele mesmo gera ao encerrar sessões (S1-T2b).
      *Aceite:* subir o daemon, **fechar o terminal**, e ele continua vivo e disparando.
- [ ] **S4-T4 — `seeya snooze`, `seeya skip-today`, `seeya config`.**
- [ ] **S4-T5 — `seeya daemon --stop/--status`.**
      *Aceite do sprint:* e2e 6, 7 e 8 passam. Um dia inteiro de uso real sem intervenção.

---

## Sprint 5 — Entregar

- [ ] **S5-T1 — Autostart do daemon** por SO (Task Scheduler, launchd, systemd user).
- [ ] **S5-T2 — `seeya init`**: config guiada na primeira execução.
- [ ] **S5-T3 — README** e empacotamento npm.
- [ ] **S5-T4 — Bateria manual nos 3 SOs** e correção do que aparecer.

---

## Definição de pronto (vale para toda tarefa)

1. Código implementa exatamente a spec; divergência virou questão, não improviso.
2. Testes da faixa correspondente escritos e passando.
3. `npm run verificar` verde (tipos + lint + dependency-cruiser + cobertura + testes).
4. Nenhum `TODO`, `any`, `@ts-ignore` ou `eslint-disable` novo sem justificativa em comentário.
5. Commits em português, pequenos, um assunto cada.
6. Review do agente revisor aprovado.

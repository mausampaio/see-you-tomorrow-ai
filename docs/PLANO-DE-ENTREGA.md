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

- [x] **S1-T12 — O piso de cobertura por diretório não existe.** Achado ao revisar a S1-T11, e é
      a **terceira** vez que este projeto encontra a mesma forma: uma garantia que existe só no
      texto (antes foram o `passWithNoTests` em S1-T0e e o prettier em S1-T0f).
      Medido, não suposto:
      - `docs/TESTES.md` afirma: "Cobertura mínima: `core/` 95%, demais diretórios de produção
        80%. **Configurado por diretório no vitest, e o CI falha abaixo disso.**"
      - o comentário do próprio `vitest.config.ts` repete "Per-directory coverage"
      - a realidade: a chave `'src/**'` aplica o limite ao **agregado**, não por diretório
      - prova: hoje `adapters/process` está em **78,19%** e o portão passa, porque o agregado
        está em 91,7%. Um diretório inteiro pode despencar sem ninguém saber
      O risco não é teórico: quanto mais código bem coberto entra, **mais folga o agregado dá**
      para um diretório mal coberto se esconder. A proteção afrouxa justamente conforme o projeto
      cresce, que é o oposto do que se quer.
      - fazer o limite valer por diretório de verdade, ou **corrigir os dois textos** para
        descreverem o que existe. As duas saídas são honestas; o que não é aceitável é a
        divergência atual
      - se escolher fazer valer: `adapters/process` vai **reprovar** hoje, e isso é o teste do
        conserto. Ou cobre, ou registra a exceção com motivo — não afrouxe o piso para caber
      *Aceite:* baixar a cobertura de um diretório abaixo do piso **reprova** o portão. Provado
      por execução, não por leitura.
- [x] **S1-T13 — O teste de terminação graciosa no Windows é intermitente.** Achado ao rodar o
      portão depois da S1-T12. **Não é regressão dela** — medido isolado, o arquivo passa em
      11,17s; o que mudava era a concorrência da suíte completa. Reproduzido de verdade uma vez
      (`npm run cobertura`, timeout em 15114ms) antes do conserto abaixo.
      **A causa original suspeitada — `Add-Type` recompilando C# a cada chamada — estava errada.**
      Medido isoladamente (script `-EncodedCommand` equivalente, 5 execuções): `Add-Type` custa
      200-350ms, muito longe de explicar um estouro de vários segundos. A causa real, encontrada
      instrumentando `sendCtrlBreak` com timestamps: depois que o helper do PowerShell transmite
      `CTRL_BREAK_EVENT` para o console em que ele mesmo está anexado, ele recebe o próprio evento
      — e o Windows leva **~5,5s medidos consistentemente (5,3s-5,6s em 3 execuções)** para
      encerrar de fato o processo do helper, mesmo com a resposta (`'sent'`) já escrita no stdout
      bem antes disso. `runPowerShellScript` esperava esse `close` antes de resolver a promise,
      então esse tempo morto entrava inteiro na duração do teste.
      **Conserto pela família B (custo, não tempo limite).** `console-signal.ts` ganhou
      `runSendScript`: resolve assim que a palavra de resultado aparece no stdout, sem esperar o
      processo fechar, e mata o helper (não é a sessão do usuário — D-002 não se aplica a esta
      plumbing interna). Isolado, o teste caiu de 7,29s para ~1,7s. Sob carga real
      (`npm run cobertura`, suíte completa, 3 execuções): 3891ms, 3149ms, 4115ms — o orçamento do
      teste desceu de 15s para **10s**, com margem real medida, não chutada (comentário ao lado do
      `it(...)` em `tests/integration/process/termination.test.ts`).
      **Não serializamos a faixa.** O `vitest.config.ts` já documenta por que isso escondeu uma
      corrida real no S0-T6 e custou seis rodadas no S1-T0 — aqui a resposta certa era reduzir o
      custo real da operação, e foi isso que resolveu o problema por completo, não só acomodá-lo.
      *Aceite:* `npm run verificar` rodou **5 vezes seguidas, 5 verdes** (ver relatório da tarefa).
      `npm run verificar:linux` verde. O teste continua verificando o marcador de shutdown do
      processo filho (`markerExists(marker)` ainda é `true`) — a garantia de graciosidade não foi
      enfraquecida, só o desperdício de tempo em volta dela.
- [x] **S1-T9 — Fusão das estratégias de descoberta.** Implementa a porta `SessionProvider`:
      `list()` devolve a união **já deduplicada**, nunca a concatenação crua. Quem chama não
      precisa saber quantas estratégias existem embaixo nem deduplicar por conta própria.
      **Reescrita em 2026-08-29 por causa do D-029.** O texto anterior falava em três
      estratégias e deduplicação por PID — os dois saíram com a revogação do D-023. Sobraram
      **duas** origens, e ambas fornecem `sessionId`:
      - **registro** (S1-T3): dá `pid`, `procStart`, liveness, `kind`, `name`
      - **varredura de transcript** (S1-T8): enxerga headless, dá `lastActivity` por mtime,
        entra com `pid: null` e nunca é candidata a encerramento de processo (D-002)
      - deduplicação **por `sessionId`**, só. Não há mais origem sem ele
      **A regra de fusão precisa ser decidida, não improvisada.** Quando a mesma sessão aparece
      nas duas origens, quem vence em cada campo? O registro é mais rico, mas o mtime do
      transcript pode ser **mais recente** que a última atividade que o registro conhece. Perder
      atividade recente é pior que perder um campo cosmético. Decida por campo, escreva o porquê,
      e registre em `docs/QUESTOES.md` se ficar ambíguo.
      **As rejeições também se somam.** As duas estratégias devolvem `{ sessions, rejected }`.
      A união preserva as duas listas — "3 sessões, 2 entradas ignoradas" continua verdadeiro
      depois da fusão, senão a visibilidade que S1-T3 e S1-T8 construíram morre aqui.
      *Aceite:* sessão presente nas duas origens aparece **uma** vez, com os campos fundidos
      segundo a regra escrita; sessão presente em uma só entra com a forma daquela origem; e as
      rejeições das duas aparecem somadas.
- [x] **S1-T4 — `adapters/transcript`.** Parser streaming; últimos prompts, arquivos
      tocados, última atividade.
      **Implementado:** porta `TranscriptReader`/tipo `SessionFacts` em `core/` (aditivo a
      `core/ports.ts`, sem reorganizar o arquivo — a S1-T5 mexe no mesmo arquivo em paralelo).
      `src/adapters/transcript/{schemas,facts,reader,index}.ts`: `reader.ts` lê o `.jsonl` linha a
      linha (`node:fs` `createReadStream`, reaproveitando o `splitLines` de
      `discovery/transcript-cwd.ts`), nunca carregando o arquivo inteiro em memória — provado por
      medição: `maxLineBufferBytes` (o pico do buffer de linha pendente) fica em torno de um chunk
      de stream (~65 KB) mesmo num fixture de >2 MB, e o teste compara os dois por execução, não
      por afirmação (`tests/integration/transcript/reader.test.ts`). Tipo de entrada desconhecido é
      contado (`unknownEntryTypeCount`) sem derrubar a leitura nem virar rejeição; linha truncada
      no fim vira rejeição individual (D-022) sem abortar as demais. Fixtures **sintéticas**
      (nenhum dado real) em `tests/fixtures/transcripts/`, moldadas pelas formas de
      `adapters/transcript/schemas.ts`. Cinco pontos não ancorados em texto registrados em Q-014.
      `npm run verificar` e `npm run verificar:linux` verdes.
- [x] **S1-T7 — Detecção precoce de sessão sem transcript.** Notificação uma vez por
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
      **Implementado.** Regra pura em `src/core/early-warnings.ts#detectEarlyWarnings`: dado o
      lote de `DiscoveredSession` já fundido (S1-T9), os nomes de `.key` sem `.json`
      (`src/adapters/discovery/uninspectable-keys.ts`, lógica recuperada do commit `e45b348`) e o
      estado "já avisado" anterior, devolve só os avisos **novos** e o próximo estado. Persistência
      aditiva na porta `Storage` (`core/ports.ts`): `readEarlyWarningState`/`saveEarlyWarningState`,
      implementadas em `StorageAdapter` contra `~/.seeya/early-warnings.json` (novo documento, com
      `schemaVersion` via o mecanismo de `schema-version.ts` já existente). Orquestração em
      `src/adapters/discovery/early-warnings.ts#discoverEarlyWarnings` — função nova e separada de
      `DiscoverySessionProvider` de propósito, para não mexer no construtor que a S1-T6 (em
      paralelo) já compõe; só grava o arquivo quando há aviso novo. O segundo gatilho dedupe pelo
      **nome completo do arquivo `.key`** (não o PID: o SO recicla PID, e um hash novo por sessão
      não colide mesmo com PID reciclado — raciocínio completo no topo de `early-warnings.ts`). O
      aviso do primeiro gatilho afirma causa e correção (D-018); o do segundo nomeia só o que se
      observa e um lead conhecido, sem afirmar causa (D-029). Nenhum código/teste lê conteúdo de
      `.key`. Três pontos registrados em Q-016 para confirmação (nomes de disco novos fora da
      tabela do `AGENTS.md`, a escolha da chave de dedup, e a função separada em vez de crescer
      `DiscoverySessionProvider`). `npm run verificar` e `npm run verificar:linux` verdes.
- [x] **S1-T11 — Reverter a terceira estratégia (D-029).** Remove o que a S1-T10 acrescentou.
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
- [x] **S1-T5 — `adapters/storage`.** Raiz injetável, escrita atômica, config com
      defaults, `schemaVersion`.
      **Implementado:** porta `Storage` em `src/core/ports.ts`, aditiva (só `readConfig` por
      enquanto — `saveHandoff`/`readBriefing`/`saveState` esperam `Day`/`Handoff`/`Briefing`/
      `DayState`, que ainda não existem). `StorageAdapter` (`src/adapters/storage/index.ts`) com
      raiz `seeyaHome` injetada no construtor, nunca `os.homedir()`.
      **Atomicidade provada por execução, não por confiar no padrão** (`atomic-write.ts` +
      `tests/integration/storage/atomic-write.test.ts`): um processo real
      (`tests/fixtures/storage/slow-atomic-write.mjs`) é morto com `SIGKILL` em vários pontos
      diferentes no meio da escrita, e o arquivo em disco é conferido depois — sempre íntegro,
      antigo ou novo, nunca pela metade. Medido também que `rename` sobre destino existente e
      **desocupado** se comporta igual em Windows e POSIX (Node/libuv já usa
      `MOVEFILE_REPLACE_EXISTING`), mas que Windows **recusa** o `rename` (`EPERM`) se outro
      processo tiver o destino aberto para leitura no instante exato — POSIX não recusa. Sem
      retry (exigiria `setTimeout`, proibido fora de `adapters/clock/` por D-019, e não há hoje
      um segundo escritor/leitor concorrente de `config.json`); documentado como limite conhecido
      no comentário do módulo.
      **Mecanismo de `schemaVersion`** (`schema-version.ts`): detecta a versão do documento e
      decide — já na versão esperada, migra pela tabela registrada, ou recusa (versão
      desconhecida/mais nova nunca é lida como compatível). Só existe a versão 1 hoje, então a
      tabela de migrações em produção fica vazia de propósito; o teste unitário do mecanismo
      injeta uma migração sintética só no teste, para não inventar uma migração falsa em
      produção.
      **Duas lacunas encontradas e registradas em Q-013** (não bloquearam a tarefa, solução
      mínima seguida): `endOfDayTime` não tem default afirmado em lugar nenhum — implementei
      `null` (só manual), não o `"19:30"` do exemplo de `docs/ARQUITETURA.md`, pelo espírito
      opt-in de D-002/D-011; e `forkCleanupDays` (D-012) não está na tabela de chaves do
      `AGENTS.md`, então não entrou no tipo `Config`.
      `npm run verificar` e `npm run verificar:linux` verdes.
- [x] **S1-T6 — `seeya sessions` e `seeya status`.**
      *Aceite do sprint:* `seeya sessions` lista corretamente as sessões reais desta máquina,
      incluindo as obsoletas, e o e2e nº1 passa.
      **Implementado:** `src/cli/composition.ts` é a raiz de composição (D-020) — o único módulo
      que nomeia `StorageAdapter`, `DiscoverySessionProvider`, `processControl` e `systemClock` e
      os injeta via `buildCliContext`. `seeya sessions` (`session-view.ts` + `format-sessions.ts`
      + `sessions-command.ts`) lista vivas/ociosas/encerradas/desconhecidas e **as rejeições**
      ("N sessions, M entries ignored") — D-022/Q-012 finalmente chegando a quem lê. Campo
      cosmético ausente (`name`) nunca esconde a sessão (D-021); `lastActivity: null` aparece como
      "unknown", nunca inventado (D-025). `seeya status` (`eligibility-view.ts` +
      `format-status.ts` + `status-command.ts`) saiu com escopo reduzido, registrado em Q-015:
      mostra `endOfDayTime` e a contagem de elegíveis/descobertas, mas não "quanto falta"
      (`core/schedule`, S4-T2), adiamentos/dia pulado (S4-T4) nem status do daemon (S4-T3) —
      nenhum desses existe ainda, e inventar o valor seria o erro que `AGENTS.md` proíbe.
      `adapters/clock/index.ts` ganhou sua primeira implementação real (`systemClock`), esperada
      desde S1-T1 e ainda vazia até aqui. `_test-projects.ts`: faixa `e2e` deixou de ser vazia de
      propósito (tests/e2e/sessions.test.ts). `_coverage-directories.ts`/`vitest.config.ts`:
      `cli/` passou de `excluded` para `covered` a 80% (só `index.ts` continua fora do
      `coverage.include`, por ser wiring fino do `commander` exercitado de verdade só pelo e2e).
      E2e nº1 roda `node dist/cli/index.js` (o artefato compilado, nunca `src/` via `tsx`/vitest)
      com `HOME`/`USERPROFILE` em `tmpdir` e um `claude` falso no PATH (`pretest:e2e` builda antes
      de cada `npm run test:e2e`), contra processos reais spawnados (vivo sem transcript, vivo com
      transcript antigo, morto) mais uma entrada de registro corrompida. `npm run verificar` e
      `npm run verificar:linux` verdes.

---

## Sprint 2 — Encerrar o dia

- [x] **S2-T1 — `adapters/git`.** Branch, status, commits do dia e **enumeração de
      worktrees** com o estado de cada um (D-013). Sem quebrar quando o `cwd` não é repo.
      *Aceite:* repo de teste com dois worktrees, um sujo e um limpo, produz o estado correto
      dos dois.
      **Implementado:** porta `GitReader`/tipo `GitReadResult` em `core/ports.ts` (aditiva, ao
      final do arquivo — outro agente mexe no mesmo arquivo em paralelo na S2-T2), tipos
      `GitFacts`/`GitCommit`/`WorktreeFacts` em `core/types.ts` (mesma disciplina aditiva).
      `src/adapters/git/{run-git,repo,branch,status,commits,local-day,worktree-list,
      git-adapter}.ts`: `spawn('git', args, { cwd, shell: false })` sem shell, nunca comando por
      string. `cwd` fora de repositório (`git rev-parse --is-inside-work-tree` falha) devolve
      `{ hasGit: false }` — ausência de dado, nunca `branch`/`dirty` inventados (D-025). "Commits
      do dia" filtrado em TypeScript contra `%cI` (data do committer) e os limites do dia local
      calculados a partir do `Clock` injetado (`local-day.ts#localDayBounds`, usa
      `getFullYear`/`getMonth`/`getDate` locais, não UTC) — `--since` do git só limita
      grosseiramente o histórico, nunca decide sozinho o que é "hoje" (D-019). Worktrees
      enumerados via `git worktree list --porcelain`, excluindo a entrada do próprio `cwd`; um
      worktree cujo diretório sumiu do disco (`git worktree list` ainda o lembra, mas nenhum
      comando roda nele) vira rejeição individual (`RejectedDiscoveryRecord`, D-022) sem derrubar
      os demais — provado com um repo de teste real (`tmpdir`, dois worktrees, um sujo e um
      limpo, mais um terceiro apagado do disco), commits datados de hoje e de ontem via
      `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, e um teste de snapshot (`HEAD`, reflog, status
      antes/depois) provando que nenhum comando escreve no repositório. Quatro escolhas sem
      resposta literal na spec registradas em Q-017 (nome da porta, assimetria de `commitsToday`
      entre o nível superior e `worktrees[]`, data de committer vs. autor, `branch: string | null`
      para HEAD destacada). `npm run verificar` e `npm run verificar:linux` verdes.
- [x] **S2-T2 — `adapters/generation`.** Duas implementações, enxuta e profunda (D-011).
      Contexto por stdin ou arquivo, nunca por argumento (D-015). `--tools ""`,
      `--system-prompt` curto, `--json-schema`, timeout, orçamento, `spawn` sem shell, erro
      tipado. Registro do fork em `forks.json` no modo profundo.
      *Aceite:* teste com conteúdo contendo quebra de linha, aspas, acento e `%` chega íntegro
      ao processo filho; medição do piso de tokens antes e depois do `--tools ""` registrada.
      **Q-008:** o formato de `~/.seeya/forks.json` está fixado — `{ schemaVersion: 1,
      forks: [{ sessionId, createdAt }] }`. O `createdAt` é escrito desde já: S2-T6 precisa dele
      para `forkCleanupDays`, e acrescentá-lo depois vira migração de arquivo já existente.
      Implementado em 2026-08-29: `LeanHandoffGenerator`/`DeepHandoffGenerator`
      (`src/adapters/generation/`), fork registrado via `registerFork` (reaproveita o leitor de
      `adapters/discovery/fork-registry.ts`, agora com `readForkRegistryEntries` preservando
      `createdAt`). Medição real registrada em `docs/QUESTOES.md` Q-020 (achado: `--json-schema`
      não reduz o piso, aumenta — ver a questão). `HandoffGenerator.generate()` precisou do
      `DiscoveredSession` inteiro, não só `SessionFacts` — ver Q-019. `npm run verificar` e
      `npm run verificar:linux` verdes.
- [x] **S2-T3 — Caso de uso `endDay`.** Coleta multi-fonte com `sources[]` (D-013),
      concorrência limitada, isolamento de falha por sessão, fallback determinístico,
      anti-duplicidade, guarda de turno ativo. Handoff válido com qualquer fonte respondendo.
      **Q-007:** `terminateGracefully` devolvendo `false` com o processo ainda vivo não é erro e
      não aborta nada, mas **precisa aparecer no resultado do dia**, nomeando a sessão e o motivo.
      Silêncio aqui faz quem marcou `canTerminate: true` acreditar que a sessão fechou.
      **Implementado em 2026-08-29:** `src/application/{end-day,capture-session,
      evidence-gathering,generation-policy,eligibility-assembly,concurrency,types}.ts`.
      `endDay` lê a config, descobre sessões, filtra por elegibilidade em dois estágios (barato,
      sem I/O, para quatro das cinco condições; completo, com evidência fresca, só para
      anti-duplicidade D-026) e captura cada sessão elegível sob `mapWithConcurrencyLimit`
      (`captureConcurrency`, default 3), isolando falha por sessão num `try`/`catch` por
      pipeline — uma sessão que lança nunca derruba as outras (provado em
      `tests/unit/application/end-day.test.ts`). `sources[]` reflete exatamente quem respondeu
      (`registry` ⟺ `hasPid`; `git` ⟺ `hasGit`; `transcript` ⟺ `hasTranscript` e a leitura não
      lançou), nunca "tentou". `source` descreve procedência da camada de entendimento, não a
      evidência de entrada (revisado no review, Q-021 item 1): `"model"` no sucesso da geração
      e `"deterministic"` na falha (D-003), **em qualquer um dos dois casos com ou sem
      transcript** — sessão sem transcript ainda roteia para o gerador enxuto (nunca o profundo,
      D-018), e um sucesso dessa chamada é `"model"` como qualquer outro; `sources[]` é quem
      registra a ausência de transcript, não `source`. `"noTranscript"` continua no enum para o
      estado em que o modelo **não é chamado** — não produzido por este código hoje.
      Anti-duplicidade (D-026) reconstrói a assinatura do `facts` já persistido em vez de
      inventar um campo novo em disco (Q-021 item 3, com o risco da reconstrução — mudança de
      forma dos fatos comparando em silêncio contra regras antigas — escrito em
      `core/evidence.ts#buildEvidenceSignature`); `Storage` ganhou `saveHandoff`/`readHandoff`,
      já incorporado ao esboço de `ARQUITETURA.md` pelo mantenedor (Q-021 item 4) — não
      conveniência, é o método que verifica o handoff em disco antes de terminar o processo.
      D-002: `saveHandoff` → `readHandoff` de verificação → só então `terminateGracefully`; falha
      no save ou verificação que volta `null` aborta a terminação sem exceção vazando (provado em
      `tests/unit/application/capture-session.test.ts`, incluindo a ordem exata das chamadas).
      Q-007: `terminateGracefully` devolvendo `false` com o processo vivo gera um
      `TerminationNotice` nomeado (`sessionId`/`cwd`/`name`/motivo) em
      `EndDayResult.terminationNotices`, nunca silencioso. `EndDayDeps` recebe `leanGenerator` E
      `deepGenerator` (não um só) porque a escolha por sessão depende de `hasTranscript`, só
      conhecido em runtime — Q-021 item 2. `knownForks` sempre vazio em `endDay`, com o risco de
      segunda ordem (se a exclusão rio acima falhar, o filtro para sem nada quebrar) escrito em
      `application/eligibility-assembly.ts#NO_KNOWN_FORKS` (Q-021 item 5). Q-021 fechada:
      confirmado nos itens 2 a 5, item 1 corrigido. `npm run verificar` e `npm run
      verificar:linux` verdes; `application/` em 100% linhas/statements, 98% branches.
- [x] **S2-T6 — Limpeza de forks.** Apaga forks próprios com mais de `forkCleanupDays`.
      *Aceite:* apaga apenas IDs presentes em `forks.json`; um teste prova que nenhum outro
      arquivo de `~/.claude/projects/` é tocado.
- [x] **S2-T4 — Briefing.** Geração do `summary.md` a partir dos handoffs.
      **Implementado em 2026-08-29:** `core/briefing.ts#generateBriefingMarkdown` é a regra pura
      (sem I/O, sem `Date.now()`, D-019) que renderiza o markdown a partir de `Handoff[]` e das
      rejeições de D-022; `application/briefing.ts#writeDailyBriefing` é a casca de I/O que lê
      `Storage#listHandoffs(day)` (nova, valida item a item — D-022 já citava "os handoffs lidos
      de `~/.seeya/`" como coleção externa) e grava com `Storage#saveBriefing` (nova, reaproveita
      `writeFileAtomic` da S1-T5). `endDay` chama isso como seu passo 3, relendo todos os handoffs
      do dia do disco — não só os desta execução — para que `seeya end-day --session <id>` (S2-T5)
      rodado mais de uma vez no mesmo dia continue produzindo um briefing consolidado. `source:
      "deterministic"` vira um blockquote de aviso explícito ("entendimento não disponível, a
      falha foi do modelo"); `capturedDuringActiveTurn: true` aparece colado à linha de estado;
      evidência parcial (`sources[]` incompleto) nomeia exatamente o que faltou; dia sem handoff
      nenhum produz "No sessions were captured today." em vez de silêncio ou invenção; handoff
      ilegível vira uma linha nomeada em "Unreadable entries", sem derrubar os demais. `Storage`
      cresceu como um segundo bloco `export interface Storage {}` mesclado pelo TypeScript (não
      editado no corpo original) — S2-T6 mexe no mesmo arquivo em paralelo, e o histórico dele já
      registrou merge quebrado por corte no meio de uma interface. Nome `saveBriefing` não estava
      na tabela de disco do `AGENTS.md` (só `readBriefing` estava, reservado para S3-T1); segui o
      par `save<Nome>`/`read<Nome>` já usado por `saveHandoff`/`saveEarlyWarningState`. Três
      escolhas registradas em Q-022 para confirmação. `npm run verificar` e `npm run
      verificar:linux` verdes; `core/` e `application/` em 100% de linhas e branches nos dois.
      **Implementado em 2026-08-29:** `forkCleanupDays` (D-012, default 7) faltava no `Config`
      desde a Q-013 (S1-T5 tinha registrado a lacuna sem inventar a chave) — acrescentado agora em
      `core/types.ts`/`adapters/storage/config-schema.ts`, primeira leitura real. Decisão pura em
      `core/fork-cleanup.ts#planForkCleanup`: idade comparada a partir do `Clock` injetado (D-019,
      nunca `Date.now()`), "mais de" é estritamente maior (fork com idade exata no limite é
      mantido), e uma entrada sem `createdAt` é sempre mantida — nunca tratada como "óbvia
      candidata" por falta de prova (D-025). Porta nova `ForkCleanup` em `core/ports.ts`
      (`ForkCleanupOutcome` como união discriminada, D-024: `reason` só existe no caso `failed`),
      aditiva ao final do arquivo por causa da S2-T4 em paralelo no mesmo arquivo.
      `adapters/discovery/fork-cleanup.ts#DiscoveryForkCleanup` é a única exceção do projeto que
      apaga arquivo fora de `~/.seeya/` (D-012) — reaproveita o leitor de `fork-registry.ts` (S1-T3)
      e o `locateTranscriptFile` de `transcript-lookup.ts` (S1-T4) em vez de duplicar a busca do
      `.jsonl`. Cada fork stale é resolvido independentemente (`Promise.all` com `try`/`catch` por
      item, D-022): uma falha real de exclusão (`failed`, com o erro bruto) nunca impede as outras,
      e um arquivo já ausente (`alreadyAbsent`) não é erro (D-025) — o usuário pode ter apagado à
      mão, e o objetivo da exceção já está satisfeito de qualquer forma. `forks.json` é reescrito
      atomicamente removendo só as entradas `deleted`/`alreadyAbsent` (`failed` fica para nova
      tentativa na próxima passagem); uma passagem sem nada para limpar nunca toca o arquivo.
      Contenção provada por instantâneo antes/depois de toda a árvore `~/.claude/projects/` (mesmo
      padrão do S2-T1 para git): conteúdo e `mtime` de um transcript real e de um fork ainda dentro
      do prazo ficam idênticos byte a byte; a única diferença é o arquivo do fork realmente stale
      desaparecendo (`tests/integration/discovery/fork-cleanup.test.ts`). Ainda sem raiz de
      composição em `cli/` — não existe hoje nenhum comando que precise disparar a limpeza (mesmo
      padrão já seguido por `adapters/generation` desde a S2-T2, sem wiring até existir chamador).
      Duas decisões sem resposta literal em D-012 registradas em Q-022 para confirmação do PO: o
      destino da entrada em `forks.json` após a exclusão, e o tratamento de arquivo já ausente.
      `npm run verificar` e `npm run verificar:linux` verdes.
- [x] **S2-T7 — O tempo limite do teste é igual ao do processo filho.** Diagnosticado pelo agente
      da S2-T6 ao investigar a intermitência recorrente do `eslint-restrictions.test.ts` — que já
      apareceu nas duas plataformas e foi atribuída a carga de máquina mais de uma vez.
      A causa é de desenho, e **mais funda do que este texto dizia originalmente**: eu escrevi que
      um mesmo valor servia de orçamento ao filho e de tempo limite ao teste. Não era isso — o
      `spawnSync` era chamado **sem opção `timeout` nenhuma**, então o filho não tinha orçamento
      próprio. Havia **um relógio só**, o do teste, matando o filho de fora.
      A consequência é pior que a lentidão: quando o filho demora, quem estoura primeiro é o
      **teste**, com "Test timed out" — em vez de o filho reportar o próprio estouro, que seria
      diagnosticável. A informação útil é sempre destruída pela corrida entre os dois.
      - o orçamento do teste tem que ficar **confortavelmente acima** do orçamento do filho, senão
        o interno nunca chega a disparar
      - a folga vem de medição, não de chute (mesma disciplina da S1-T13)
      *Aceite:* um filho que estoura o próprio orçamento produz falha **do filho**, com motivo
      legível, e não "Test timed out". Provado por execução.
      **Achado real (S2-T7): não existia orçamento nenhum no processo filho.** `run()` chamava
      `spawnSync` sem a opção `timeout` — o único relógio que já existia era o do `it(...)`, por
      fora. Por isso os dois "expiravam ao mesmo tempo": não eram dois relógios com o mesmo
      valor, era só **um** relógio (o do teste) fazendo o papel dos dois, e matando o filho antes
      que ele pudesse reportar por que estava lento.
      **Medido** (`npx vitest run --project guards` e `npm run cobertura`, 6 execuções nesta
      máquina): o filho legítimo mais lento — sempre um `eslint` real em
      `eslint-restrictions.test.ts`, cujo custo de parsing type-aware escala mal sob concorrência
      — terminou em 6246, 6676, 8808, 9834, 11618 e 11872ms. Uma dessas execuções, ainda sob o
      orçamento combinado antigo de 20000ms, reproduziu o bug de verdade: "Test timed out in
      20000ms" para um teste cujo próprio contador marcava 22239ms — o filho nunca tinha
      travado, só estava azarado sob carga, e o desenho antigo destruía essa distinção.
      `CHILD_PROCESS_BUDGET_MS = 30_000` (agora passado a `spawnSync({ timeout })`) fica ~2,5x
      acima do pior caso limpo (11872ms) e com folga real (>7,7s) sobre a execução contestada.
      `TEST_TIMEOUT_MS = CHILD_PROCESS_BUDGET_MS + 15_000 = 45_000` — a folga de 15s não é o
      tamanho do trabalho depois que o filho retorna (medido: matar via `timeout` do `spawnSync`
      volta ~10-25ms depois do valor configurado nesta máquina, sem o "ar morto" do console
      attach da S1-T13, que é um mecanismo diferente), é margem deliberada contra variação de
      agendamento sob carga real de CI.
      Teste de regressão novo: `tests/integration/guards/child-process-timeout.test.ts` força um
      comando falso (`node -e 'setTimeout(...)'`) a dormir além de um orçamento pequeno (300ms) e
      prova a mensagem legível: `"[guard child process exceeded its own 300ms budget
      (CHILD_PROCESS_BUDGET_MS) and was killed (SIGTERM) before finishing]"` — nunca "Test timed
      out". `npm run verificar` rodou **5 vezes seguidas, 5 verdes** (75 arquivos de teste, 671
      testes, 2 pulados por design). `npm run verificar:linux` verde (75 arquivos, 670 testes, 3
      pulados por design).
      **Não serializamos a faixa `guards`** — a causa aqui era o orçamento mal desenhado, não uma
      corrida real entre testes.
- [x] **S2-T5 — `seeya end-day` com `--dry-run` e `--session`.**
      *Aceite do sprint:* e2e 2, 3 e 4 passam. Encerramento com o modelo indisponível ainda
      produz handoffs úteis.
      **Implementado em 2026-08-30:** `src/cli/{end-day-command,format-end-day}.ts` +
      `composition.ts#buildEndDayContext` — a raiz de composição (D-020) finalmente nomeia os
      adapters de S2-T2 (`LeanHandoffGenerator`/`DeepHandoffGenerator`) e S2-T6
      (`DiscoveryForkCleanup`), prontos e desligados até aqui. `application/end-day.ts` ganhou
      `EndDayOptions` (`dryRun`/`sessionFilter`, ambos opcionais — nenhum call site anterior
      quebrou) em vez de um caminho paralelo: `--dry-run` percorre o mesmo pipeline real
      (descoberta, elegibilidade, evidência, geração) e só para exatamente no primeiro ponto de
      escrita (`capture-session.ts#persistAndMaybeTerminate`, a limpeza de forks e
      `application/briefing.ts#previewDailyBriefing`, que reaproveita `generateBriefingMarkdown`
      sem gravar). A única exceção deliberada: geração **profunda** nunca roda de verdade num
      dry-run — `--fork-session` escreveria um fork real em `~/.claude/projects/` por conta
      própria, fora do controle deste código, e isso violaria a regra inegociável de nunca
      escrever em `~/.claude/`; `generation-policy.ts#previewDeepCaptureOutcome` documenta o
      porquê e substitui só esse caso, sem tocar a geração enxuta (sem rodapé em disco, D-017).
      Prova de "escreve nada" por instantâneo da árvore inteira (conteúdo + mtime), mesmo
      instrumento do S2-T1/S2-T6 — `tests/e2e/end-day.test.ts`. `--session` (id ou `cwd`, string
      exata) filtra em `cli/`, não em `application/`: `endDay` recebe um predicado genérico
      (`sessionFilter`), nunca o conceito da flag. `EndDayResult` cresceu `dryRun`,
      `briefingPreview`, `sessionsInScope`, `forkCleanup`, `forkCleanupError` — todos aditivos.
      **Duas peças desligadas, uma ligada aqui:** limpeza de forks (D-012) entrou em
      `EndDayDeps.forkCleanup`, chamada como passo próprio de `endDay` (isolada como uma falha de
      captura, nunca aborta o resto); avisos precoces (D-018/S1-T7) foram decididos como
      pertencentes a `seeya sessions`, não a `end-day` — D-018 fala em "assim que a sessão é
      vista", que é a descoberta, não a rotina diária —, mas a fiação em si **não** foi feita
      nesta tarefa, para não alterar o contrato de um comando já aprovado (S1-T6) e sua suíte, fora
      do escopo orçado aqui. Argumento completo em `docs/QUESTOES.md` Q-024, junto com a segunda
      decisão (limpeza de forks nunca pré-visualizada em `--dry-run`, só pulada — `ForkCleanup` não
      tem hoje um modo somente-leitura). `tests/e2e/_harness.ts` passou a montar um `claude` falso
      de verdade no PATH (reaproveitando `tests/integration/generation/_fixtures.ts`, inclusive o
      shim `.exe` do Windows) — a versão anterior (S1-T6) nunca precisava disso, já que nenhum
      comando existente chamava `claude`. Achado no caminho: o diretório certo para o PATH é
      `path.dirname(fixture.binaryPath)`, não `fixture.dir` — no Windows os dois divergem (o `.exe`
      compilado vive num diretório de shim próprio, memoizado por processo), e usar o errado faz a
      resolução de PATH cair silenciosamente no `claude` real da máquina. `npm run verificar` e
      `npm run verificar:linux` verdes; `cli/` e `application/` em 100% de linhas nos dois.

---
- [x] **S2-T8 — Os orçamentos do Windows não têm folga para o CI.** O CI ficou **vermelho só no
      Windows** ao fechar o Sprint 2, com Ubuntu e macOS verdes. Duas causas distintas, as duas
      medidas nesta máquina e nunca no runner:
      - `tests/integration/process/termination.test.ts` usa `10_000` explícito, número que a
        S1-T13 mediu **aqui** quando a suíte tinha ~290 testes. Hoje são 714, e a contenção no
        runner é outra
      - `Hook timed out in 10000ms` no fixture de geração: é o **padrão do vitest para hooks**,
        estourado pelo `beforeAll` que compila o shim `.exe` com o `csc`. Num runner frio isso é
        caro, e o `Cannot convert undefined or null to object` que aparece junto é cascata do
        fixture ter ficado indefinido
      **A lição já está no repositório e eu não a apliquei:** a S1-T13 e a S2-T7 estabeleceram que
      número de orçamento vem de medição. O que faltou dizer é **onde** medir — medir na máquina do
      desenvolvedor e publicar é o mesmo erro de sempre, com outra roupa. O CI é o ambiente mais
      lento e mais contido dos três, e é ele que decide.
      - separe as duas causas: o tempo limite explícito do teste e o do hook
      - considere se o shim `.exe` precisa ser compilado **por worker** do vitest. Se cada arquivo
        de teste em um worker próprio recompila, o custo cresce com a suíte — e aí subir o tempo
        limite trata sintoma
      *Aceite:* CI verde nos **três** sistemas, conferido por execução (`gh run watch`), não só o
      portão local. E o número novo com a justificativa da folga escrita ao lado.


## Sprint 3 — Começar o dia

- [x] **S3-T1 — Leitura do briefing pendente** e montagem do prompt de retomada por sessão.
      **Implementado em 2026-08-30:** `Storage` ganhou `readBriefing(day)` (`core/ports.ts`,
      segundo bloco mesclado ao fim do arquivo — mesmo padrão de Q-022 item 2, porque a S3-T2
      mexe no mesmo arquivo em paralelo) e o tipo `Briefing` (`{ day, handoffs, rejected }`,
      reservado desde S1-T0g/Q-022): nenhum formato novo em disco, é `listHandoffs(day)` com
      `day` anexado — `null` só quando não há nada gravado para aquele dia (D-025).
      `application/find-pending-briefing.ts#findPendingBriefing` implementa o passo 1: caminha
      para trás um dia local por vez (`core/day.ts#subtractLocalDays`, novo, D-019) a partir do
      `Clock` injetado, parando no primeiro dia cujo `Briefing`
      `core/pending-briefing.ts#briefingStillPending` considera pendente. Devolve uma união
      discriminada (`{ found: true, briefing, daysAgo } | { found: false, daysSearched }`,
      D-024) — nenhum briefing pendente é caso normal, nunca exceção (aceite #5).
      **"Ainda tem pendências" definido por conteúdo, não por bookkeeping de retomada —
      Q-026, FECHADA pelo PO em 2026-08-30.** Nada persiste hoje "este dia já foi retomado" (isso
      é o passo 5, fora desta tarefa); um handoff `source !== "model"` conta sempre como pendente
      (D-025: ausência de veredito do modelo não é veredito de "concluído"), e só um
      `source: "model"` que relatou `pendingItems`/`tomorrowPlan` vazios conta como resolvido.
      Confirmado como regra **interina**: quando o passo 5 existir, "pendente" passa a ser "não
      retomado E com conteúdo", documentado em `core/pending-briefing.ts`.
      **Revisado no review: sem corte de produto por idade.** A primeira versão limitava a busca
      a 7 dias por analogia com `forkCleanupDays` — revogado: descartar um briefing pendente por
      idade não protege de nada, só esconde "onde eu parei" de quem voltou de férias. Agora a
      busca acha o briefing pendente mais recente **não importa a distância**, e devolve
      `daysAgo` (dias locais até hoje) para quem exibe. `MAX_BRIEFING_SCAN_DAYS = 30` continua
      existindo, mas só como limite de **E/S** (quanto disco esta chamada está disposta a tocar),
      não julgamento de produto — aumentar o número não muda o que conta como pendente.
      `core/resume-prompt.ts#buildResumePrompt`/`buildResumePrompts` monta o passo 4 (D-004,
      texto em inglês, D-028): honesto para `source: "deterministic"`/`"noTranscript"` (nunca
      finge entendimento que não existe, entrega só os fatos crus registrados) e sinaliza
      `capturedDuringActiveTurn: true` como aviso explícito de possível desatualização.
      `core/consolidated-plan.ts#renderConsolidatedPlan(briefing, daysAgo)` monta o passo 2
      ("mostra o plano consolidado"), texto plano por sessão (não o markdown completo de
      `seeya end-day`, que carrega git/recall/rejeitados demais para uma pré-visualização antes
      de escolher o que retomar); `renderRelativeAge` mostra a idade do briefing por extenso
      ("3 weeks ago") sempre que não for "ontem", em vez de deixar a pessoa presumir que o plano
      é fresco. `core/briefing.ts#renderGitBlock` passou a exportado para o gerador de prompt
      reaproveitar (evita duplicar a mesma renderização de `GitFacts`). Quem exibe (passo 2) e
      quem retoma de fato (passos 3-5) são S3-T3 e S3-T2 — esta tarefa não toca `cli/` (D-020).
      `npm run verificar` e `npm run verificar:linux` verdes; `core/` 100% linhas/branches nos
      dois.
- [x] **S3-T2 — Retomada.** `claude --resume` no `cwd` original, com fallback para sessão nova
      e aviso explícito ao usuário.
      **Duas incógnitas medidas antes de implementar (pedido do PO), resultado em
      `docs/spikes/H-retomada-interativa.md`:** (1) sem TTY real, "interativo" degrada sozinho
      para uma resposta única e sai — nunca abre sessão continuável — então o primeiro prompt só
      pode chegar por argumento posicional quando o processo herda o terminal do usuário; medido
      que `spawn` com array e `shell:false` (a disciplina que este projeto já usa) entrega esse
      argumento **byte a byte íntegro**, inclusive quebra de linha, aspas e acento — o que
      mutilava no Spike C era o shell, não o argumento. Isso corrigiu **D-015** (o texto da
      decisão registra a correção). (2) várias sessões interativas não cabem num terminal: a
      resposta é sequencial, um TTY herdado por vez — decisão do PO, registrada em D-015 junto
      com a primeira.
      **Implementado em 2026-08-30:** porta `SessionResumer`/tipos `ResumeOutcome`/
      `ResumeFallbackReason` (aditivo ao final de `core/ports.ts`/`core/types.ts` — S3-T1 mexe
      nos mesmos arquivos em paralelo). `adapters/resumption/` (`args.ts`, `env.ts`,
      `context-file.ts`, `spawn-interactive.ts`, `resumer.ts`): `ClaudeSessionResumer` spawna
      `claude --resume <sessionId> "<prompt>"` com `stdio: 'inherit'` quando o prompt cabe no
      teto medido (`RESUME_PROMPT_ARG_LIMIT_CHARS = 4096`, ~1/8 do limite de linha de comando do
      Windows); acima do teto, ou quando o `--resume` fecha rápido (`FAST_FAILURE_GRACE_MS =
      5000`) com código != 0, cai no **único** mecanismo de fallback (D-004): sessão nova no
      mesmo `cwd`, plano inteiro entregue via `--append-system-prompt-file` apontando para um
      arquivo escrito em `~/.seeya/tmp/` (nunca fora de `~/.seeya/`) e apagado depois de usado.
      D-017 saneado nos dois caminhos (`env.ts` reaproveita a lista de
      `adapters/generation/env.ts`, exportada para isso). Uma segunda falha rápida do próprio
      fallback lança exceção em vez de mentir dizendo que uma sessão nova abriu (D-025 aplicado a
      uma ação). Aviso ao usuário (`core/resume-notice.ts#formatResumeNotice`, puro) nomeia qual
      dos dois motivos disparou o fallback, nunca inventa qual causa exata explica um `--resume`
      que falhou (D-025 — `seeya` não lê o stderr real, que foi para a tela do usuário via
      `stdio: 'inherit'`). Seis escolhas sem resposta literal em D-004/D-015 registradas em
      Q-027 (renumerada no merge: a S3-T1 já tinha tomado o Q-026 em paralelo). `npm run verificar` e `npm run verificar:linux` verdes.
- [x] **S3-T3 — `seeya start-day`** com seleção interativa e `--all`.
      *Aceite do sprint:* e2e 5 passa; retomada real de uma sessão de ontem funciona à mão.
      **Implementado em 2026-08-30.** Os cinco passos: `application/find-pending-briefing.ts`
      (passo 1, já existia) → `core/consolidated-plan.ts#renderConsolidatedPlan` (passo 2, já
      existia) → `cli/start-day-selection.ts` decide o modo (`--session` vence `--all`; sem
      nenhuma flag e sem TTY, `noTtyNoFlag` — imprime o plano e as duas flags, sai 0, nunca trava
      esperando resposta) → `application/start-day.ts#resumeSessions` (passos 4-5, sequencial, um
      `SessionResumer.resume()` por vez, com progresso impresso entre uma sessão e outra) →
      marcação por sessão gravada **depois** de cada `resume()` completar, nunca antes ou em lote
      no fim (D-002 aplicado a bookkeeping em vez de terminação de processo). `resumeSessions`
      lançando (fallback também falhou rápido, Q-027 item 5) para o laço no meio, sem tentar as
      sessões seguintes; `cli/start-day-command.ts` relata quem foi retomado e quem não foi, e sai
      com código 1.
      **Storage ganhou `readResumedSessionIds`/`saveResumedSessionIds`** (`core/ports.ts`, dentro
      da interface já consolidada — ver a nota abaixo), persistidos em
      `~/.seeya/days/<day>/resumed.json` (`{ schemaVersion, sessionIds }`,
      `adapters/storage/resumed-sessions-schema.ts`) — por **sessão**, não por dia inteiro: um dia
      com três handoffs e um retomado continua "pendente" para as outras duas, nunca some da busca
      do passo 1. `core/pending-briefing.ts#handoffStillPending`/`briefingStillPending` passaram a
      receber esse conjunto e checá-lo primeiro; o docstring do módulo, que descrevia a regra como
      **interina** (Q-026), foi reescrito para descrever a regra real: "pendente" agora é "não
      retomado E com conteúdo". `unresumedHandoffs` (novo, mesmo arquivo) é o filtro **diferente**
      que os passos 3 usam para montar a lista de candidatos — todo handoff ainda não retomado,
      mesmo um que o modelo já confirmou limpo, porque é uma escolha real ainda não feita, não
      "pendência" no sentido de conteúdo.
      **Seleção interativa por `node:readline/promises`**, sem dependência nova
      (`cli/start-day-command.ts#askInteractively` + `cli/start-day-selection.ts#parseInteractiveSelection`):
      aceita números separados por vírgula, `all`, ou vazio para nada; resposta inválida reporta o
      problema e não retoma nada — sem laço de nova tentativa (escolha mínima, registrada abaixo).
      **`--session <id|cwd>`** casa contra **todos** os handoffs do briefing (não só os ainda não
      retomados) — intenção explícita tem precedência sobre o filtro de conveniência, mesmo
      convenção de `end-day --session`; sem match, mensagem e saída 0 (consistente com
      `end-day --session`, não um erro).
      **Consolidação de `Storage` em commit separado** (instrução do mantenedor): os dois blocos
      `export interface Storage {}` que existiam desde S2-T4/S3-T1 foram fundidos num só, sem
      mudança de comportamento, antes de qualquer código novo desta tarefa.
      **`core/consolidated-plan.ts` ganhou reconhecimento de retomada:** uma sessão já marcada
      resumida aparece como "already resumed today" em vez do seu `pendingItems`/`tomorrowPlan`
      (potencialmente obsoletos) — mesma disciplina de "não afirmar além do que se sabe" que o
      módulo já aplicava a handoff `source !== "model"`.
      Uma escolha sem resposta literal na spec registrada em `docs/QUESTOES.md` Q-028 (formato de
      `resumed.json`, ainda fora da tabela de identificadores em disco do `AGENTS.md`).
      **Aceite do sprint cumprido por e2e nº5** (`tests/e2e/start-day.test.ts`): handoff pendente
      escrito diretamente em disco (sem rodar `end-day`, já que `start-day` nunca redescobre
      sessões — D-004), `seeya start-day --all` invoca o `claude` falso com
      `['--resume', sessionId, prompt]`, e `resumed.json` reflete a sessão marcada. Um segundo
      e2e prova o caminho sem TTY (stdin `'ignore'` do harness já não é TTY, de graça): plano
      impresso, `--all`/`--session` sugeridos, `claude` nunca invocado, saída 0.
      *Retomada real à mão:* **verificada pelo mantenedor em 2026-08-30**, e é o que fecha o
      aceite do sprint. O agente corretamente NÃO alegou esta parte — não havia sessão Claude Code
      real para retomar dentro do ambiente dele —, então ela ficou pendente até a verificação
      humana. Percurso executado: sessão de teste aberta à mão com trabalho deliberadamente
      inacabado; `seeya end-day --session '<cwd>'` capturou em modo `lean` com `source: model`;
      `seeya start-day` num terminal separado achou o briefing do dia e retomou. Retomada e
      contexto injetado funcionaram.
      *Observado na captura, e vale registrar:* o "Understanding" gerado disse explicitamente que
      **não havia confirmação no contexto** de que o arquivo tinha sido criado ou as tarefas
      marcadas — em vez da narrativa óbvia a partir do pedido. É o D-025 aparecendo no texto do
      modelo, não só nos tipos, que é o que o prompt da S3-T1 foi desenhado para produzir.
      `npm run verificar` e `npm run verificar:linux` verdes; `core/` 100%, `application/` 100%,
      `cli/` 100% (linhas/statements) nos dois sistemas.

---

- [~] **S3-T4 — Teste de contrato para `--append-system-prompt-file`.** Aprovado pelo mantenedor
      em 2026-08-30 ao fechar a Q-027 item 3. O fallback da retomada (D-004) entrega o plano por
      `--append-system-prompt-file`, escolhido em vez de `--system-prompt-file` porque o primeiro
      **acrescenta** ao prompt de sistema e o segundo **substitui** o do Claude Code inteiro — o
      `seeya` não tem por que decidir remover comportamento que a pessoa espera de qualquer
      sessão. O problema: **nenhum dos dois aparece no `--help`**; foram achados varrendo strings
      do binário (Spike H). A semântica está medida na 2.1.235 e pode mudar numa versão sem
      aviso, e hoje nenhuma suíte cobre isso.
      *Escopo:* teste em `tests/contract/` (`npm run test:contrato`, a suíte que existe justamente
      para casar suposição nossa com binário real) que confirme "append, não replace" contra o
      `claude` instalado — isto é, que o prompt de sistema padrão **continua valendo** quando o
      flag é usado, não só que o texto extra chega. Se a distinção não for observável de fora,
      esse próprio achado é o resultado: registrar em QUESTOES o que dá e o que não dá para
      provar, sem inventar uma garantia que o teste não sustenta (D-025).
      **Implementado em 2026-08-30 (`tests/contract/append-system-prompt-file.test.ts`).** A
      distinção **é** observável de fora: uma chamada `claude -p --model haiku
      --append-system-prompt-file <arquivo>` pede, no mesmo turno, o nome do produto de CLI (só
      respondível a partir do prompt padrão) e um marcador sintético só presente no arquivo
      anexado — replace derrubaria o primeiro sem afetar o segundo.
      **Revisão do mantenedor pegou que a primeira entrega só tinha o braço positivo**: "os dois
      fatos chegam" é compatível com as duas semânticas até alguém medir o que o replace de fato
      faz — sem isso, o teste passaria de qualquer jeito, decorativo. **Braço negativo
      acrescentado:** uma terceira chamada com `--system-prompt-file <mesmo arquivo>` (o flag que
      de fato SUBSTITUI) fecha o argumento. Medido na 2.1.251, com `--model haiku`: controle e
      append respondem com o nome do produto ("Claude Code"), replace responde `UNKNOWN` — com o
      marcador do arquivo presente nos três casos. Essa é a prova que faltava.
      **Achado sério durante o fechamento do braço negativo: `--model sonnet` NÃO discrimina.**
      Tentado como forma de reduzir a instabilidade do haiku em responder a pergunta de
      autorrelato (abaixo); medido uma vez: (a) estourou o teto de US$0,10 por chamada (chegou a
      ~US$0,13) porque `--model sonnet` aqui passa por uma chamada interna de classificação em
      haiku antes do turno de sonnet, cada uma pagando criação de cache nova sob
      `--no-session-persistence`; (b) pior, a única chamada de sonnet que completou (a de replace)
      respondeu "Claude Code" mesmo com o prompt de sistema inteiramente substituído — autorrelato
      de identidade não depende do prompt de sistema nesse modelo, e o observável deixa de
      discriminar por completo. Revertido para `haiku`, a única configuração medida a funcionar.
      A primeira formulação da pergunta (booleano direto: "você sabe seu nome de produto?") tinha
      dado falso negativo mesmo no controle (recusa treinada a uma pergunta meta, não ausência do
      fato); a formulação corrigida (pedir o fato direto, com `UNKNOWN` como saída explícita) segue
      em uso. **Flakiness residual, medida e documentada, não escondida:** rodando o arquivo final
      (haiku, três chamadas) uma segunda vez, só a chamada de CONTROLE (sem flag) respondeu
      `UNKNOWN` de novo, sem motivo — append e replace nunca flakaram nas mesmas rodadas,
      sustentando a discriminação central. A mensagem de falha do teste de controle explica que uma
      falha isolada ali (com os outros três verdes) é ruído de amostragem até prova em contrário,
      não sinal de regressão. Nada disso foi escondido: comentário no arquivo preserva as três
      formulações tentadas (duas de pergunta, uma de modelo) e por que cada uma foi descartada.
      **Exatamente 3 chamadas reais por execução, nunca mais** (documentado em comentário no topo
      do arquivo): `--model haiku`, `--no-session-persistence`, `--max-budget-usd 0.10`, `cwd`
      descartável em `%TEMP%`, ambiente saneado reaproveitando
      `adapters/generation/env.ts#buildGenerationEnv(..., 'lean')` em vez de duplicar a lista
      D-017. **Total de chamadas reais gastas durante todo o desenvolvimento: 11** (4 na entrega
      original sem braço negativo; 1 sonda avulsa testando `--system-prompt-file`; 3 integrando o
      braço negativo com haiku; 3 tentando — e descartando — sonnet).
      **Achado extra, sem afetar a conclusão:** `claude --help` na 2.1.251 (mais nova que a 2.1.235
      do Spike H) já **menciona** as duas variantes `-file`, mas só de forma indireta, dentro da
      descrição do flag `--bare` — sem entrada própria nem descrição do que fazem. Continua sem
      ser "documentado" no sentido que importa para D-004.
      **Limitação registrada, não escondida (Q-029):** a medição usa `-p` (headless); o fallback
      real (`adapters/resumption/resumer.ts`) roda em modo interativo puro com `stdio: 'inherit'`,
      que estruturalmente não deixa o `seeya` ler o stdout do processo filho para verificar o
      mesmo fato nesse modo. Assumir que a construção do prompt de sistema é a mesma rotina nos
      dois modos é engenharia razoável, não medição direta — fica marcado como suposição, não
      como fato provado.
      Sem tocar `src/` (escopo da tarefa): só `tests/contract/`, `docs/TESTES.md`,
      `docs/QUESTOES.md` (Q-029) e este arquivo. `npm run verificar` e `npm run verificar:linux`
      verdes.
      *Fora de escopo:* trocar o flag, ou construir fallback para o caso de ele sumir — só
      quando e se a medição mostrar que sumiu.

- [~] **S3-T5 — Identificar a sessão na listagem e no `--session`.** Aprovada pelo mantenedor em
      2026-08-30, saída do primeiro teste real. **O problema:** ele lança o `claude` do diretório
      do usuário — hábito comum, e deliberado, porque trabalha em vários repositórios ao mesmo
      tempo e quer uma memória só para o projeto inteiro. Resultado: **dezenas de sessões com o
      mesmo `cwd`**, e nada na saída do `seeya sessions` que diga qual é qual. O `--session` aceita
      só `sessionId` ou `cwd` — e o `sessionId` **não é exibido em lugar nenhum**, então na prática
      sobra o `cwd`, que é ambíguo exatamente no caso dele.
      *O dado já existe:* `DiscoveredSession` carrega `sessionId`; a view é que o descarta.
      Verificado no registro real: `20632.json` traz `sessionId`, e `name` (`"code-6d"`,
      `nameSource: "derived"`) é gerado por sessão pelo próprio Claude Code — ou seja, vinte
      sessões no mesmo `cwd` já teriam nomes distintos.
      *Escopo:* exibir o `sessionId` (ou prefixo estável) no `seeya sessions`; `--session` passar a
      casar também por **prefixo de `sessionId`** e pelo **nome de exibição**, com erro claro
      quando o prefixo for ambíguo (nunca escolher uma por conta própria — D-025).
      *Junto, porque é a mesma dor:* normalizar caminho antes de comparar no `--session` e no
      `ignore` do `config.json` — hoje é igualdade exata de string, e o mantenedor tropeçou nisso
      com as contrabarras comidas pelo shell (`C:\Users\<usuario>` chegando como `C:Users<usuario>`).
      Mesma classe de erro da S2-T1, onde comparação de caminho por string passou no Linux e
      reprovou no macOS e no Windows. A mensagem de "não casou" deve mostrar o valor recebido
      quando ele diferir do digitado.

      **Implementado em 2026-08-30.** `core/cwd-normalization.ts#normalizeCwdForComparison`
      (nova, pura, sem `node:*`): unifica separador, remove barra final e só dobra maiúscula em
      `'win32'` — plataforma é **parâmetro**, nunca lida ali (mesma disciplina do `Clock`, D-019),
      justamente para o teste exercitar o ramo Windows rodando em qualquer SO (aceite: "não
      depende de rodar no Windows para valer"). `cli/session-reference.ts#resolveSessionReference`
      (nova, genérica sobre `{ sessionId, cwd, name }`) é o casador único usado por
      `end-day-command.ts` e `start-day-selection.ts`: `sessionId` exato é autoritativo e nunca
      ambíguo (D-021); senão, prefixo de `sessionId` + nome exato + `cwd` normalizado são avaliados
      juntos, e **dois ou mais candidatos casando é `ambiguous`**, nunca resolvido sozinho — nomeia
      todos os que casaram. `cli/session-id-display.ts#computeDisplaySessionIds` dá o prefixo
      exibido no `seeya sessions`: 8 caracteres (primeiro grupo do UUID) por padrão, escalando por
      fronteira de grupo (`8/13/18/23/36`) só para quem colidir no lote — matemática da colisão e
      justificativa do tamanho no docstring do módulo. `session-view.ts`/`format-sessions.ts`
      ganharam `sessionId`/`displaySessionId`/a linha `id: ...`; testado explicitamente com duas
      sessões de mesmo `cwd` e mesmo `name`, que é o caso que motivou a tarefa
      (`session-view.test.ts`, `format-sessions.test.ts`).

      **Mudança de comportamento em `end-day --session`, não só extensão.** Antes, `cwd` batendo em
      várias sessões descobertas processava todas em silêncio (igualdade exata nunca impedia isso).
      Agora `end-day-command.ts` resolve `--session` contra uma descoberta própria **antes** de
      chamar `application/endDay` (não dá para desfazer uma captura/encerramento depois de
      acontecer) e recusa com `ambiguous` — nunca captura nenhuma das candidatas. Custa uma segunda
      chamada de descoberta, com uma corrida pequena e rara coberta por mensagem própria
      (`formatVanishedMatchMessage`). A mensagem de "não casou"
      (`end-day-command.ts#formatNoMatchMessage`) sempre mostra o valor **cru** recebido, nunca uma
      forma normalizada silenciosa, e acrescenta a forma normalizada-como-`cwd` quando ela difere —
      é a peça do aceite 4, e só existe aqui (a de `start-day` é do S3-T6).
      **`start-day`:** `findHandoffBySessionReference` já devolve `ambiguous` com a lista completa,
      mas `start-day-command.ts` colapsa em `blocked` reaproveitando a `formatNoSessionMatch`
      **existente**, sem tocar `format-start-day.ts` nem `core/consolidated-plan.ts` — conforme
      instrução. **Falta**, fora do meu alcance: uma mensagem de ambiguidade própria para
      `start-day`, que nomeie as sessões, em vez de reaproveitar o "não encontrado" genérico.
      Cinco escolhas sem resposta literal na spec registradas em Q-030 para confirmação; um achado
      ortogonal (flutuação intermitente do `verificar:linux` na suíte `guards` sob contenção do
      container, não causada pelo código desta tarefa mas talvez agravada por ele) registrado em
      Q-030a.
      Normalização coberta nos três sistemas sem depender de rodar no SO real
      (`tests/unit/core/cwd-normalization.test.ts`, ambas as dicas de plataforma exercitadas
      explicitamente). `npm run verificar` verde; `npm run verificar:linux` verde (medido 4 de 6
      execuções verdes — ver Q-030a para as duas vermelhas, sem relação com a asserção da própria
      tarefa). `core/` 100%, `application/` 100% linhas (96,2% branches, agregado — ver Q-030 item
      1 sobre a leitura de `process.platform`), `cli/` 100% linhas (96,79% branches, agregado).

- [~] **S3-T6 — Formatação da saída do `start-day`.** Aprovada pelo mantenedor em 2026-08-30
      ("achei confuso demais"), com a saída real do primeiro uso como evidência. **Não é o
      PowerShell — é o nosso formatador**, em `core/consolidated-plan.ts`:
      (1) `pendingItems` e `tomorrowPlan` são **listas** e viram uma linha corrida só, coladas
      com `join('; ')` — cinco itens num parágrafo único, ilegível;
      (2) o cabeçalho envolve o `cwd` em **crase de markdown** numa saída que é texto
      puro de terminal, então a crase aparece literal na tela;
      (3) não há linha em branco separando o plano da pergunta do seletor.
      *Escopo:* item por linha, sem markdown em saída de terminal, e respiro antes da pergunta.
      *Fora de escopo:* a redundância entre `pending` e `plan` observada na mesma saída — ela vem
      do modelo, não do formatador, e tende a diminuir sozinha quando a D-011 for reavaliada sob
      a D-031 (captura profunda dá ao modelo a conversa inteira, em vez de dez prompts do
      usuário). Não vale remendar no formatador o que é escassez de evidência na captura.

      **Acréscimo do mantenedor, mesma tarefa, 2026-08-30:** resposta inválida no seletor
      interativo agora diz também que nada foi retomado e aponta `seeya start-day --help` para
      `--all`/`--session` — as duas informações que `parsed.reason`
      (`start-day-selection.ts`) deixava implícitas. Sem laço de nova tentativa (mantido de
      S3-T3); código de saída continua 0. Escolhas registradas em `docs/QUESTOES.md` Q-031.

- [~] **S3-T7 — Mensagem de falha do fallback com o argv, e build que limpa o destino.** Saída da
      Q-029, aprovada em 2026-08-30. **O problema, hoje:** se o
      `--append-system-prompt-file` sumir ou mudar de nome numa versão futura — e o mantenedor
      está certo de que isso é questão de tempo —, o `claude` recusa o argumento, sai rápido com
      código ≠ 0, e o `adapters/resumption/resumer.ts` lança com a mensagem *"Check that
      `claude` is on PATH and that `<cwd>` still exists"*. **Que estaria errada.** O binário está
      no PATH e o `cwd` existe; o que sumiu foi o flag. Mandar investigar o lugar errado é pior
      que não dizer nada.
      *Escopo:* a mensagem carrega o argv de fato tentado, para que a causa apareça sozinha. Vale
      olhar se o mesmo vale para o caminho do `--resume` primário.
      *Por que isto e não mais teste de contrato:* o teste da S3-T4 mede o modo `-p` e o fallback
      roda interativo — ele nunca vai cobrir o caminho real. A escolha registrada na Q-029 é
      seguir com `--append` até quebrar; esta tarefa é o que garante que, quando quebrar, dê para
      saber por quê em vez de caçar PATH.

      *Segunda parte, aprovada junto em 2026-08-30: o `build` precisa limpar o destino antes de
      compilar.* Hoje o script é só `tsc -p tsconfig.build.json`, e o `tsc` escreve por cima sem
      apagar o que sobrou. A tradução do projeto para inglês deixou `dist/adaptadores`,
      `dist/aplicacao`, `dist/nucleo` e `dist/agendador` convivendo com os diretórios atuais por
      duas semanas, na máquina do mantenedor, sem ninguém ver.
      **O que torna isto mais que arrumação:** o `package.json` declara `files: ["dist"]`, então
      um `npm publish` empacota **o que estiver ali** — código morto em português iria junto, num
      projeto que vai abrir o código. O mantenedor já limpou à mão; isto é o que impede a sobra
      de voltar na próxima renomeação.
      *Escopo:* apagar `dist/` antes de compilar, de forma que funcione nos três SOs — `rm -rf`
      não serve, e a preferência do projeto é não acrescentar dependência (produção tem só
      `commander` e `zod`; `node:fs`+`rmSync` resolve). Confirmar que `npm run verificar` e o CI
      seguem verdes, e que o e2e continua achando o binário compilado.

---

## Sprint 4 — Automatizar

- [~] **S4-T00 — Medir se a captura pega carona no cache.** Aprovada pelo mantenedor em
      2026-08-30 ao fechar a Q-032: "acho importante saber disso desde já". **Vem antes da
      S4-T0 e da S4-T1** porque é a resposta que decide a forma do daemon.
      *O que medir, e só isto por enquanto:* o custo de uma captura profunda **logo depois** de
      um turno da sessão, contra a mesma captura horas depois. Isola o efeito do relógio, que
      provavelmente decide antes da identidade de prefixo — cache com validade de minutos a uma
      hora torna irrelevante qualquer prefixo numa captura às 19h sobre sessão parada desde as
      10h.
      *Por que importa:* se a diferença for grande, o daemon deixa de ser "acorda no horário e
      captura tudo" e passa a ser "acompanha as sessões e captura cada uma quando esfria", com o
      fim do dia virando **consolidação** do que já foi capturado. Não são variações de
      implementação, são formas diferentes. O Spike I mostra que o próprio Claude Code resolve o
      mesmo problema assim: o away summary dispara por **ociosidade de 5 minutos**, não por
      horário.
      *Fora de escopo:* identidade de prefixo e validade efetiva (itens 2 e 3 da Q-032) — só
      valem a pena se o item 1 mostrar diferença.
      *Cuidado (D-001):* perseguir o cache reproduzindo o prefixo da sessão viva chega perto de
      "gerar por dentro". Qualquer desenho que saia daqui precisa mostrar que não gasta o
      contexto da sessão viva nem interrompe o turno dela.

- [~] **S4-T00b — Qual dos três flags quebra a identidade de prefixo?** Aprovada pelo mantenedor
      em 2026-08-31, saída do Spike J. **Pode dissolver a Q-034 em vez de forçar a escolha.**
      *O que o Spike J não isolou:* ele comparou **os três flags juntos** (`--tools ""`,
      `--system-prompt` próprio, `--json-schema`) contra **nenhum deles**. A Q-034 só é um dilema
      se os três forem igualmente culpados — e há evidência de que não são: o **Achado 4** mediu
      a configuração atual lendo **70.260 tokens de cache** quando a hipótese era zero. Reuso
      grande acontece mesmo com os três presentes, e isso não bate com "os três quebram".
      *A hipótese a testar:* o culpado é o `--system-prompt` sozinho, por ficar no começo absoluto
      do prefixo. Se for, dá para **manter a saída estruturada** e ainda assim acertar o cache —
      movendo a instrução de extração para o prompt do usuário em vez do prompt de sistema.
      *Escopo:* largar um flag por vez a partir da configuração atual, medindo `cache_read` e
      `cache_creation` (em `usage`, snake_case — ver Achado 1 do Spike J). Reaproveitar
      `scripts/spike-j-measure.mjs` em vez de escrever outro. Explicar, ou pelo menos delimitar,
      o Achado 4 — hoje é o único número do spike sem explicação, e é o que impede qualquer
      redesenho de saber de onde a captura parte.
      *Custo:* 3 a 4 chamadas. O Spike J inteiro custou US$ 0,048 com cinco.
      *Entrega:* atualizar o **Spike J** com uma seção nova, não criar um spike K — é a mesma
      pergunta, medida com mais resolução. E dizer, na Q-034, se a troca sobrevive ou não.
      **Medido em 2026-08-31 (`docs/spikes/J-cache-na-captura.md`, seção "S4-T00b", 6 chamadas
      reais, US$ 0,2245).** Hipótese **refutada**: largar só o `--system-prompt` leu **zero**
      cache contra a sessão viva — o mesmo resultado que largar só `--tools ""` ou só
      `--json-schema` também produziu. Um braço de controle (os três largados) confirmou que o
      mecanismo de cache estava funcionando normalmente na mesma janela — os zeros são sinal
      real. O Achado 4 foi parcialmente delimitado: o bloco grande de tokens não é gatilhado pelo
      `--json-schema` (removê-lo muda o total por ~150 tokens, do tamanho do próprio schema); o
      peso está em `--system-prompt`/`--tools ""` e numa interação não-aditiva entre os dois
      (Q-035, nova, aberta). **A Q-034 sobrevive** como escolha real entre barato e estruturado —
      não é um dilema falso.

- [~] **S4-T00c — O modo enxuto para de jogar fora o texto do assistente.** Saída da reavaliação
      da **D-011** sob a **D-031**, em 2026-08-31. **É o conserto do defeito que o primeiro teste
      real expôs.**
      *O defeito:* `buildLeanPrompt` manda ao modelo projeto, `cwd`, última atividade, **os dez
      últimos prompts do usuário** e arquivos tocados. O `processAssistantEntry`
      (`adapters/transcript/reader.ts`) extrai das entradas do assistente **só** timestamp e
      caminhos de arquivo — o **texto** do assistente é descartado e nunca chega a existir em
      `SessionFacts`. Foi por isso que a captura perdeu o "4 concluídas, 6 pendentes": a frase
      estava lá, dita pelo modelo, num turno de assistente. O modelo da captura não falhou —
      foi honesto sobre evidência que não tinha (D-025).
      *Escopo:* o texto do assistente passa a ser extraído e a chegar ao prompt do enxuto.
      *A parte que não pode ser chutada:* **quanto**. Mensagem de assistente é longa, e escolher
      "os últimos N" por analogia repetiria exatamente o erro que esta decisão já cometeu — a
      primeira D-011 estimou US$ 0,15 e a medição da S2-T2 achou US$ 0,08–0,09 e um
      `--json-schema` que **quintuplica** o piso, o oposto do suposto. **Meça o custo com e sem,**
      e escolha o volume com número na mão. O `scripts/spike-j-measure.mjs` já sabe ler
      `usage.cache_read_input_tokens`/`cache_creation_input_tokens` e custo por chamada.
      *Cuidado de privacidade:* texto de assistente é conteúdo de trabalho real. Ele já vai para
      o handoff em `~/.seeya/`, então não é fronteira nova — mas nada disso pode vazar para o
      repositório em fixture ou teste (o portão de termos locais existe para isso).
      *Aceite:* uma sessão onde o assistente diz o que fez e o usuário nunca repete produz
      handoff que registra o que foi feito — o caso exato que falhou no teste real.

- [~] **S4-T00d — A falha de geração precisa dizer o que o `claude` respondeu.** Achada pelo
      mantenedor em 2026-08-31, testando à mão a captura nova da S4-T00c. **Faça antes do daemon:**
      ele vai chamar a captura em laço, e uma falha cega repetida N vezes é pior que uma.

      **O que aconteceu.** A captura falhou e o handoff caiu para determinístico — a D-003
      funcionando, o dia não abortou. Mas o que ficou gravado foi:

      ```
      generationError: claude exited with code 1, expected 0. stderr: (empty)
      ```

      **A causa está no ordenamento, não numa mensagem mal escrita.** O `spawn-claude.ts` coleta
      `stdout` **e** `stderr`. Mas o ramo `nonZeroExit` de `errors.ts` monta a mensagem só com o
      `stderr` — e a chamada usa `--output-format json`, onde o `claude` reporta erro **no stdout**,
      como envelope com `is_error`/`subtype`/`result`. Saída ≠ 0 faz o código pegar o ramo cego e
      **descartar o envelope antes de olhar para ele**.

      **O conserto usa maquinaria que já existe.** `GenerationFailureReason` já tem a variante
      `modelReportedError` (`subtype` + `result`), que é muito mais informativa. Em saída ≠ 0,
      **tente ler o stdout como envelope primeiro**; se ele trouxer `is_error`, reporte
      `modelReportedError`. Só quando o stdout não for envelope válido caia no `nonZeroExit` — e aí
      **incluindo o stdout bruto**, como o ramo `invalidJson` já faz com o dele.

      *Cuidado de tamanho:* `result` pode carregar saída do modelo. Limite o que entra na mensagem —
      ela vai para `generationError`, que **é gravado no handoff em disco**.
      *Cuidado de privacidade:* essa mesma superfície já existe (o handoff guarda conteúdo de
      trabalho), então não é fronteira nova — mas nada de stdout real em fixture do repositório.

      *Aceite:* falha com saída ≠ 0 **e** envelope no stdout produz mensagem que nomeia o
      `subtype` e o `result`, não "(empty)". Teste com os dois casos: envelope presente e stdout
      ilegível.

      *Fora de escopo:* descobrir **por que** aquela chamada específica falhou. A hipótese é
      orçamento — `captureModel` tem default `sonnet` e `budgetPerSessionUsd` default US$ 0,25, e
      a S3-T4 mediu que `--model sonnet` dispara um classificador haiku interno antes do turno
      real, cobrando os dois. **Mas é hipótese**, e é exatamente o que esta tarefa existe para
      tornar visível na próxima vez. Se os defaults precisarem mudar, isso é decisão de produto
      com a evidência na mão, não palpite agora.

      **Implementado em 2026-08-31.** `run-generation.ts#runGeneration`, em saída ≠ 0, tenta ler o
      `stdout` como o envelope `--output-format json` (`tryParseClaudeOutput`, que não lança) antes
      de desistir; se ele trouxer `is_error`, a rejeição vira `modelReportedError` (mesma função
      `modelReportedError` usada pelo caminho de saída limpa, agora carregando também o `exitCode`
      real observado). Só quando o `stdout` não é o envelope válido cai para `nonZeroExit`, que
      ganhou um campo `stdout` com o texto bruto — mesmo tratamento que `invalidJson#raw` já dava
      ao dele. O corte de tamanho do `result` (500 caracteres) mora em `errors.ts#describe()`, não
      na construção do `reason`: `error.reason.result` continua íntegro para quem faz
      pattern-matching programático, só a mensagem renderizada (a que vai para `generationError`
      no handoff em disco) fica limitada. `tests/fixtures/generation/fake-claude.mjs` ganhou a
      capacidade de escrever `FAKE_CLAUDE_STDOUT` também no modo `nonzero` (reaproveitado, não
      duplicado), o que permite reproduzir as duas formas de falha em
      `tests/integration/generation/lean-generator.test.ts`: saída ≠ 0 com envelope `is_error`
      válido → `modelReportedError`; saída ≠ 0 com `stdout` ilegível → `nonZeroExit` com o `stdout`
      bruto anexado. Três escolhas sem resposta literal na tarefa, e um achado à parte não
      consertado (o `timeout` de `spawn-claude.ts` descarta o mesmo tipo de evidência, só que no
      caminho de timeout) registrados na Q-039.

- [~] **S4-T00e — Captura que falhou não pode bloquear a retentativa do dia.** Achada pelo
      mantenedor em 2026-08-31, testando à mão. **Antes do daemon**, que vai chamar a captura em
      laço e multiplicar o efeito.

      **O que aconteceu.** A primeira captura falhou (orçamento) e caiu para determinístico —
      D-003 funcionando, o dia não abortou. Na segunda tentativa, com o problema já corrigido, a
      sessão veio **inelegível por `duplicateToday`** e o comando gravou **0 handoffs**. Para
      testar de novo foi preciso **apagar `~/.seeya/days/<dia>/` na mão**.

      **A causa.** `application/eligibility-assembly.ts` lê o handoff anterior do dia
      (`Storage.readHandoff`) e compara assinaturas de evidência (D-026) **sem olhar o campo**
      `source`. Um handoff `deterministic` — onde o modelo **não rodou** — conta como "já
      capturado hoje".

      **É o mesmo raciocínio da Q-026, uma camada acima.** Lá, `pendingItems` vazio num handoff
      determinístico não podia contar como "nada pendente", porque ausência de análise não é
      veredito. Aqui, um handoff determinístico não pode contar como "já capturado", **pela mesma
      razão**: ele é o registro de que a análise **não aconteceu**. Tratá-lo como conclusão
      transforma ausência em estado concluído — D-025 aplicado à elegibilidade.

      **E o custo real é maior que o incômodo do teste.** Em produção, uma falha passageira —
      orçamento, rede, modelo indisponível — consome em silêncio a única captura daquela sessão no
      dia. O fallback da D-003 existe para o dia não se perder; do jeito que está, a **camada de
      entendimento** se perde de qualquer forma, até amanhã.

      *Escopo:* só handoff com `source: "model"` bloqueia por duplicidade. `deterministic` e
      `noTranscript` deixam a sessão elegível de novo — a retentativa só pode melhorar o que está
      lá. A comparação de assinatura (D-026) continua igual; o que muda é **quais handoffs
      anteriores contam**.

      *Cuidado que não pode ser ignorado:* o daemon chama isto **em laço**. Se o modelo estiver
      falhando de forma persistente, "determinístico não bloqueia" vira retentativa a cada ciclo,
      gastando dinheiro sem melhorar nada. **Esta tarefa não resolve isso** — o limite de
      retentativas por sessão por dia é do daemon (S4-T3), e precisa estar escrito lá antes de o
      laço existir. Registre a dependência nas duas pontas.

      *Aceite:* sessão com handoff determinístico do mesmo dia e evidência inalterada volta a ser
      elegível; com handoff `model` e evidência inalterada, continua `duplicateToday`.

      **Implementado em 2026-08-31.** `core/eligibility.ts#PreviousCaptureToday` ganhou um campo
      `source: HandoffSource`; a condição 5 (`duplicateToday`) só dispara quando
      `previousCaptureToday.source === 'model'`. `application/eligibility-assembly.ts` só repassa
      o `source` do handoff lido, sem decidir nada — a regra de quais handoffs contam como
      "já capturado" mora inteira no núcleo, junto das outras quatro condições. `noTranscript`
      recebeu o mesmo tratamento de `deterministic` (não uma regra distinta): os dois significam
      "o modelo não analisou", por motivos diferentes, mas nenhum é veredito (D-025). A comparação
      de assinatura (D-026) não mudou. Onde o limite de retentativas do daemon (S4-T3) deveria
      encaixar, registrado sem implementar, em Q-040.

- [~] **S4-T0b — Implementar a D-031: capturar o que está vivo, listar o que foi fechado.**
      A **D-031** foi decidida em 2026-08-30 e **nunca implementada** — o código continua
      capturando sessão fechada, que é exatamente o que ela tira de escopo. **Antes do daemon
      (S4-T3)**, para ele nascer laçando o escopo certo em vez de ser corrigido depois.

      **As três populações, e o sinal que as separa** (medido no Spike E: o registro é apagado na
      saída graciosa; entrada obsoleta sobrevive só a terminação anormal):

      | situação | significado | escopo |
      |---|---|---|
      | registro + PID vivo (`alive`/`idle`) | sessão viva | **captura** |
      | registro + PID morto (`ended`) | morreu **sem** sair graciosamente | **captura** |
      | só transcript, sem registro (`unknown`) | saiu graciosamente: a pessoa fechou | **lista** |

      A segunda linha não é concessão: terminal fechado no braço, máquina que suspendeu, `claude`
      que caiu — a pessoa **perdeu** aquilo sem escolher, que é quando um handoff mais serve.

      **A listagem só se justifica se identificar a sessão para um humano.** "code-6d, fechada
      17h" não diz nada. Use **`aiTitle` + último prompt**, medidos no Spike I: `ai-title` e
      `last-prompt` são entradas do transcript que o Claude Code já grava, **já estão em
      `KNOWN_ENTRY_TYPES`** e hoje não são lidas. **Custo zero de modelo.** E moram no transcript,
      não no registro — sobrevivem justamente na população que esta listagem descreve.

      *Ressalva:* `ai-title` é entrada interna não documentada. Ausente vira **listagem sem
      título**, nunca título inventado (D-025). Se valer teste de contrato, abra questão.

      **O que isto custa, e está na D-031:** o varrimento de transcript também encontra sessões
      **vivas que não se registraram** (D-018), e sem registro elas não têm PID — caem no mesmo
      `unknown`. Não há como separar das fechadas com carinho. A captura sai para as duas; o
      **aviso** da D-018 continua.

      *Onde o corte mora, e é preferência com motivo:* a **S4-T00e roda em paralelo e é dona de**
      **`core/eligibility.ts` e `application/eligibility-assembly.ts`**. Ponha o corte de escopo
      **antes** da elegibilidade — as cinco condições dela falam de uma sessão que **já está** em
      escopo. Se não couber assim, **pare e reporte** em vez de invadir.

      *Aceite:* sessão só-transcript não é capturada e **aparece na listagem** com título e último
      prompt; sessão com registro e PID morto **é** capturada; briefing do dia mostra as duas
      coisas sem confundi-las.

      **Implementado em 2026-08-31:** `core/capture-scope.ts#isCaptureCandidate` — o corte é
      exatamente `session.hasPid`, sem campo novo: `SessionWithPid` (viva ou `ended`) sempre foi o
      único formato com registro; `SessionWithoutPid` sempre foi só-transcript (Q-041 item 1).
      Aplicado em `application/end-day.ts` antes de `evaluateCheapEligibility`, sem tocar
      `core/eligibility.ts`/`application/eligibility-assembly.ts` (S4-T00e). Sessão fora de escopo
      vira `core/types.ts#SessionListing` (`sessionId`, `cwd`, `name`, `aiTitle`, `lastPrompt`),
      montada por `application/session-listing.ts` a partir de `TranscriptReader.readListingInfo`
      (porta nova, `core/ports.ts`) — leitura dedicada de `ai-title`/`last-prompt`
      (`adapters/transcript/listing.ts`, `adapters/transcript/schemas.ts`), mantendo o último valor
      visto (ambos são regravados conforme a sessão evolui, Spike I). A listagem aparece em seção
      própria, nunca misturada com handoffs, tanto em `core/briefing.ts#generateBriefingMarkdown`
      (`summary.md`) quanto em `cli/format-end-day.ts` (relatório do terminal) — **não persistida**:
      recalculada a cada `end-day`, ao contrário dos handoffs (Q-041 item 4). O aviso da D-018
      (`core/early-warnings.ts`) não foi tocado e continua funcionando — ele opera sobre a
      descoberta completa, de fora do corte de escopo. Sete escolhas registradas em **Q-041**.

- [~] **S4-T0c — O artefato do dia precisa dizer quando foi um recorte.** Saída da Q-041,
      levantada pelo mantenedor em 2026-09-01 a partir do teste à mão. **Antes do daemon.**

      **O defeito.** `core/briefing.ts` não tem noção de ter sido uma execução filtrada. Um
      `seeya end-day --session X` produz um `summary.md` **indistinguível** de um dia completo que
      por acaso tinha uma sessão só.

      **Por que isso é D-025 no nível do dia.** Quem abrir aquele arquivo amanhã vê um handoff e
      conclui que o dia teve uma sessão relevante — quando cinco sessões vivas podem nunca ter
      sido olhadas. Ausência de handoff passa a ler como "aquela sessão não tinha nada", e o
      correto é **"ninguém olhou"**. O mesmo erro que a Q-026 corrigiu dentro de um handoff,
      agora um nível acima.

      **Como a pergunta apareceu, porque o caminho importa.** O mantenedor perguntou se a
      listagem de sessões fechadas deveria ser estreitada por `--session`. Estreitar daria quase
      sempre **vazio** — o valor casa com a sessão selecionada, que por estar em escopo de captura
      nunca aparece na listagem. Nenhuma das duas opções óbvias servia, e foi investigando isso
      que o defeito de verdade apareceu: a listagem é a **única parte do documento que se comporta
      como visão do dia inteiro**, dentro de um documento que é recorte e não se declara recorte.

      *Escopo 1:* o `summary.md` (e a saída do `end-day`) registram quando a execução foi
      recortada, e por qual valor de `--session`. A **listagem continua completa** — com o recorte
      declarado ela vira contexto do dia claramente rotulado, em vez de contradição.

      *Escopo 2, mesma tarefa porque é o mesmo raciocínio:* hoje "`(no title)`" na listagem
      significa **duas coisas diferentes** — não havia `ai-title`, ou a **leitura falhou**. Achatar
      as duas é o que o D-025 proíbe, e só a segunda pede ação de alguém. Separe (mesmo espírito
      da D-022: rejeição visível e contável).

      *Fora de escopo:* estreitar a listagem por `--session` (decidido: não), persistir a listagem
      por dia (decidido: não, D-027 — e sumir da listagem quando a sessão volta a ser capturável é
      o comportamento certo), e teste de contrato para `ai-title` (decidido: não agora — se sumir,
      degrada para sem título e nada quebra).

      *Aceite:* rodar `end-day --session X` e um `end-day` completo no mesmo dia produz dois
      `summary.md` **distinguíveis por leitura**, sem precisar comparar contagens. E falha de
      leitura da listagem aparece diferente de ausência de título.

      **Implementado em 2026-09-01:** `core/types.ts#EndDayScope` (união discriminada, `fullDay` |
      `singleSession` com o valor CRU de `--session`, nunca o `sessionId` resolvido) viaja opcional
      em `EndDayOptions.scope`, resolvido dentro de `endDay()` (`options.scope ?? { kind:
      'fullDay' }`) e devolvido, sempre presente, em `EndDayResult.scope`. `core/briefing.ts#
      generateBriefingMarkdown` recebeu um sexto parâmetro `scope` (default `fullDay`, mesmo
      padrão de `listedSessions`) e imprime `renderScopeNote` logo após o timestamp, afirmando os
      dois casos por igual — um dia completo agora diz "full day" explicitamente, nunca por
      omissão. `cli/format-end-day.ts#formatScopeLine` repete a mesma informação no relatório do
      terminal. Nada disso é persistido: recalculado a cada execução, igual à listagem (Q-041 item
      4) — uma execução completa mais tarde no mesmo dia sobrescreve a nota de escopo da anterior.
      Separadamente, `core/types.ts#SessionListing.aiTitle`/`lastPrompt` viraram
      `SessionListingInfo` (união discriminada: `{ kind: 'read', aiTitle, lastPrompt }` ou `{ kind:
      'unreadable', reason }`, embutida em `SessionListing.info`), fechando a lacuna em que uma
      falha real de leitura (`application/session-listing.ts`) degradava para o mesmo `{ aiTitle:
      null, lastPrompt: null }` de um `ai-title` simplesmente ausente. `core/briefing.ts#
      formatSessionListingLine`/`countUnreadableListings` (exportados, reaproveitados por `cli/
      format-end-day.ts`) tornam a falha visível linha a linha ("title unavailable — could not
      read the transcript (motivo)") e contável (nota agregada na seção "Not captured" quando
      houver ao menos uma), sem alarmar sessões ordinariamente sem título. Seis escolhas
      registradas em **Q-042**.

- [~] **S4-T0d — A nota de recorte precisa trazer o número que já está em mãos.** Emenda pequena
      à S4-T0c, apontada pelo mantenedor em 2026-09-01. **Erro meu, não do agente que a
      implementou** — ele obedeceu uma premissa que eu escrevi errada na Q-041.

      **A premissa errada.** Eu afirmei que o comando "não sabe quais sessões deixaram de ser
      capturadas por causa do filtro, só que houve filtro". Verificado no código:
      `application/end-day.ts#applyCaptureScope` calcula `captureCandidates` e `sessionsInScope`
      **na mesma função, lado a lado**. As duas listas estão em mãos no instante do filtro — o
      total, quantas sobraram, e por diferença **quantas** e **quais** foram descartadas.

      **O que saiu disso.** A nota diz *"Other sessions discovered today **may not** have been
      looked at"*. "May not" onde existe número disponível é vago sem necessidade, e soa como
      incerteza técnica quando é só a nota não contar o que já foi contado. **É o inverso do erro
      que este projeto persegue:** em vez de afirmar o que a evidência não sustenta, deixar de
      afirmar o que ela sustenta.

      *Escopo:* a nota de recorte no `summary.md` e na saída do `end-day` traz o número. Forma
      sugerida, não obrigatória: "1 de 4 candidatas foi considerada; 3 descartadas pelo filtro".

      **A aritmética é a parte fácil de errar.** O denominador é **candidatas a captura**
      (`isCaptureCandidate`, D-031), **não** "sessões descobertas". Descobertas inclui as fechadas,
      que vão para a listagem e **não** foram descartadas pelo filtro — eram outra população desde
      o começo. Usar o número errado faria a nota mentir na direção oposta. **Teste um caso com
      as três populações ao mesmo tempo** (viva capturada, viva descartada pelo filtro, fechada
      listada), que é onde a conta errada apareceria.

      *Fora de escopo:* **listar quais** sessões o filtro descartou. Pode virar ruído, e
      `--session` costuma ser deliberado. Se você achar que vale, **abra questão**, não implemente.

      *Aceite:* execução recortada informa quantas candidatas havia e quantas foram descartadas;
      dia completo continua dizendo que foi completo, sem número inventado onde não há descarte.

      **Implementado em 2026-09-01:** `core/types.ts#ResolvedEndDayScope` — tipo NOVO, irmão de
      `EndDayScope`, não o mesmo tipo esticado. `EndDayScope` (entrada de `EndDayOptions.scope`,
      inalterado) continua só `kind` + `sessionValue`, porque `cli/end-day-command.ts` monta esse
      valor **antes** de `endDay` rodar sua própria descoberta — as contagens não existem ainda
      nesse instante, e dar ao tipo de entrada um campo `captureCandidateCount` obrigatório
      forçaria um placeholder (`0`? `undefined`?) que pareceria dado real sem ser (o mesmo erro do
      D-025, aplicado à forma do próprio escopo). `ResolvedEndDayScope.singleSession` carrega
      `captureCandidateCount` (D-031, antes de `--session`) e `consideredCount` (depois,
      `sessionsInScope.length`) — só `EndDayResult.scope` e quem o renderiza
      (`core/briefing.ts#renderScopeNote`, `cli/format-end-day.ts#formatScopeLine`) veem esse
      tipo. `application/end-day.ts#applyCaptureScope` passou a devolver também
      `captureCandidateCount` (o `captureCandidates.length` que já calculava, só nunca tinha
      saído da função); uma função nova, `resolveScope`, faz a costura `EndDayScope` →
      `ResolvedEndDayScope` dentro de `endDay()`, chamada depois de `applyCaptureScope` (antes,
      era antes — a ordem inverteu porque agora o escopo resolvido depende do resultado do corte).
      O texto virou "N of M capture candidates considered; K discarded by the filter." nas duas
      superfícies (`summary.md` e terminal), substituindo o "may not have been looked at" da
      S4-T0c. Dia completo não ganhou nenhum número novo: `renderScopeNote`/`formatScopeLine`
      continuam com um `if (scope.kind === 'fullDay')` que retorna a mesma frase de sempre, sem
      tocar `captureCandidateCount`/`consideredCount` — o tipo nem permite ler esses campos nesse
      ramo (união discriminada). Teste das três populações ao mesmo tempo (viva considerada, viva
      descartada pelo filtro, fechada listada) em `tests/unit/application/end-day.test.ts`
      ("endDay — scope note reports the discard count (S4-T0d)") e a mesma prova na função pura em
      `tests/unit/core/briefing.test.ts`: `discoveredCount` fica 3, `captureCandidateCount` fica
      2 — a diferença é exatamente a sessão fechada, que nunca foi candidata. Escolhas registradas
      em **Q-043**.

- [~] **S4-T0e — O prompt de captura precisa proibir identificador inventado.** Achado pelo
      mantenedor em 2026-09-02, num `end-day` real sobre a própria sessão de trabalho. **Trataria
      como mais urgente que o daemon:** este defeito corrompe o artefato **em silêncio**.

      **O que aconteceu.** A captura saiu boa — `source: model`, entendimento de 2043 caracteres
      que acerta o trabalho do dia. Mas o terceiro `pendingItem` nomeia **cinco worktrees por ID**:
      `agent-a3a7d78489e5801f0`, `agent-a55122566d4a0061c`, `agent-ab7a6b01cb4e42ea3`,
      `agent-a1b18309afddc9a9e`, `agent-acf95a5b3de591220`. **Nenhuma das cinco existe.** Há 25
      worktrees em disco e nenhuma bate com nenhum desses identificadores.

      **A forma do erro é a pior possível.** A afirmação é **verdadeira** — há worktrees mescladas
      precisando de limpeza — e **cada identificador é inventado**. Frase certa decorada com
      especificidade falsa, que é justamente o que a faz parecer verificada. Quem ler amanhã vai
      procurar diretório que nunca existiu.

      **É o D-025 acontecendo pelo modelo, não pelo código** — primeira vez que pegamos isso neste
      projeto. Todo o resto que a gente consertou (mensagem cega, ramo errado, ausência virando
      afirmação) deixava rastro. Este **não deixa**: produz texto plausível.

      **A lacuna, no `adapters/generation/system-prompt.ts`.** O prompt diz *"if the context has
      nothing substantive, say so plainly instead of inventing activity"* — proíbe **inventar
      atividade** e não diz nada sobre **inventar identificadores dentro de uma atividade real**.
      O modelo viu caminhos sob `.claude/worktrees/` nos 47 `touchedFiles`, deduziu a categoria,
      e preencheu os nomes.

      *Escopo:* instrução específica para a forma observada, não um "não alucine" genérico —
      **quando só dá para ver que uma categoria de coisas existe, mas não quais, diga isso em vez
      de enumerar**. "Várias worktrees mescladas" é honesto; nomear as que não recebeu, não.

      *Honestidade sobre o aceite:* é mudança de prompt, e o efeito **não é verificável por teste
      de unidade** — depende do modelo. Não finja que é. O que dá para fazer: cobrir o texto do
      prompt por teste (a instrução está lá) e registrar na questão que a validação real é
      observar capturas reais. **Não invente um teste que aparenta provar o que não prova.**

      *Candidato registrado, NÃO para agora:* verificação mecânica — conferir se identificadores
      na saída aparecem na entrada. É tentador e arriscado (paráfrase legítima viraria falso
      positivo, e reprovar handoff bom é pior que o defeito). Se o problema reaparecer depois
      desta emenda, aí sim vale medir. Registre a ideia; não construa.

      **EMENDA (2026-09-02): duas falhas, dois modelos, mesma raiz — a instrução precisa cobrir
      as duas.** O mantenedor repetiu a mesma captura trocando sonnet por haiku. O haiku **não
      inventou identificador nenhum** — e produziu outra coisa, pior de detectar:

      > *"Background search confirmed the IDs the user suspected as hallucination were **actually
      > introduced by the user's own documentation, not found in the codebase before**."*

      **Conclusão invertida.** A busca achou os IDs no `PLANO-DE-ENTREGA.md` porque **eu os
      escrevi lá**, citando-os como invenções. O modelo leu o resultado e concluiu o oposto: que
      não eram alucinação. Quem ler esse handoff amanhã recebe o achado de cabeça para baixo.

      **E é pior que a invenção do sonnet, por assimetria de verificação:** um identificador
      inventado é **conferível** — um `ls` resolveu em cinco linhas. Uma conclusão invertida se
      apresenta como resultado de investigação e destrói o achado real em silêncio, sem nada para
      conferir contra.

      *Escopo ampliado:* a instrução cobre **as duas formas** — não enumerar itens de uma
      categoria que só se sabe existir, **e** não afirmar conclusão sobre algo visto pela metade.
      Quando a evidência estiver incompleta, **dizer que está** é a resposta certa (D-025), e vale
      tanto para identificador quanto para veredito.

      *Observação que muda a leitura:* a previsão de que o modelo mais barato falharia no caso
      difícil **estava errada**. No caso fácil (checklist) o haiku perdeu o item de julgamento; no
      caso difícil (sessão discursiva) ele **pegou** o item de julgamento e não inventou nada.
      Não há aqui uma ordenação simples de "modelo melhor" — há formas de erro diferentes, e a
      instrução tem que fechar as duas portas.

      *Ver também:* **Q-044**, sobre o truncamento em 500 caracteres ter cortado justamente a
      conclusão da mensagem que originou a inversão.

      **Implementado em 2026-09-03:** `GENERATION_SYSTEM_PROMPT`
      (`src/adapters/generation/system-prompt.ts`) ganhou duas frases, uma por forma medida —
      "name the category, not invented items" para a forma do sonnet (item nomeado a partir de
      categoria só deduzida), "say it is partial instead of stating what it proves" para a forma
      do haiku (conclusão sobre busca/mensagem cortada). Nenhuma cita os IDs reais nem o incidente
      — texto de produção, não registro (AGENTS.md § Comentários). Prompt cresceu de 463 para 701
      caracteres (+51%); D-011 pede atenção a cada caractere aqui, então o comentário acima da
      constante e um teste-tripwire (`length < 1000`) ficam como aviso para quem adicionar mais.
      Teste novo, `tests/unit/adapters/generation/system-prompt.test.ts`, cobre que as duas frases
      existem na constante e que é exatamente essa string que `args.ts` manda em `--system-prompt`
      — **não** que o modelo obedece, o que nenhum teste de unidade prova. Candidato mecânico
      (conferir identificador da saída contra a entrada) registrado e **não** construído — risco
      de falso positivo em paráfrase legítima. Validação real (observar capturas de verdade) ainda
      **não aconteceu** — registrado em **Q-045**, em aberto para o mantenedor decidir quando.

- [~] **S4-T0 — A evidência não pode ficar presa ao `cwd` de lançamento.** Aprovada pelo
      mantenedor em 2026-08-30. **O problema, observado no primeiro teste real:** a sessão subiu
      de `C:\Users\<usuario>` e o trabalho aconteceu numa pasta criada durante a conversa. O
      `GitReader` olhou para o diretório pessoal — que não é repositório — e não achou nada, então
      o handoff não soube dizer se havia diretório associado nem se havia git. **O modo profundo
      não conserta isso:** a evidência de git é atrelada ao `cwd` independentemente do modo.
      *A raiz é mais ampla:* o `cwd` faz **três trabalhos ao mesmo tempo** — identidade da sessão
      (`--session`, `projectPolicy`), local do trabalho (evidência de git) e agrupamento na
      exibição. Para quem lança do diretório pessoal, ele erra nos três.
      *Escopo sugerido:* derivar diretórios candidatos a partir de `touchedFiles` (que já traz
      caminhos reais, extraídos dos blocos de tool-use) e rodar o `GitReader` também contra eles,
      reportando por diretório em vez de um só. Manter D-025: diretório que não é repositório é
      ausência de evidência, nunca "sem mudanças".
      *Por que aqui e não na S3:* depende da reavaliação da **D-011** sob a **D-031**. Com captura
      profunda o modelo lê a conversa, que **nomeia** o diretório de trabalho — isso não entrega
      fatos de git, mas muda o que esta tarefa precisa consertar. Especificar antes disso seria
      desenhar contra um alvo que está se movendo.

      **EVIDÊNCIA REAL (2026-09-02), que substitui o caso sintético.** Um `end-day` sobre a própria
      sessão de trabalho do mantenedor devolveu:

      ```
      sources: ["transcript","registry"]     facts.git: null
      ```

      A sessão foi lançada de `C:code`, que **não é repositório**. O trabalho todo aconteceu em
      `C:codesee-you-tomorrow-ai` — 8 commits só no dia anterior, e dezenas na semana. O handoff
      tem **zero** fatos de git.

      Isto é melhor evidência que o caso do `seeya-todo-test`, que nem repositório era: aqui o
      repositório **existe**, tem histórico denso, e a evidência não chega porque o `cwd` de
      lançamento é o **pai** dele. Vale reavaliar o escopo desta tarefa com este caso na mão.

      **ESCOPO FECHADO (2026-09-02) pela D-032.** A tarefa deixa de ser "derivar diretórios
      candidatos e ver no que dá" e passa a ter forma decidida:

      1. **A evidência de git segue os `touchedFiles`, não o `cwd` de lançamento.** Sobe de cada
         arquivo até achar um `.git`, desduplica pela raiz.
      2. **`HandoffFacts.git` vira lista**, com os fatos completos de cada repositório.
      3. **Migração obrigatória, e é a parte que não pode ser esquecida.** Handoff versão 1, com
         `git` singular, é lido como lista de um elemento. Sem isso, subir o `HANDOFF_SCHEMA_VERSION`
         torna **ilegível todo handoff já gravado** — o `resolveSchemaVersion` **lança**, não
         degrada — e o `seeya start-day` lê exatamente isso.
      4. **Normalizar a raiz antes de desduplicar**, reusando `core/cwd-normalization.ts` (S3-T5).
         Sem isso os mesmos caminhos com maiúscula diferente viram dois repositórios — aconteceu
         na medição que originou a D-032.
      5. **Arquivos fora de qualquer repositório são contados e declarados** (12 de 47 na sessão
         medida). Sumir com eles esconde atividade.
      6. **O `cwd` de lançamento continua valendo quando for repositório.**
      7. **Limite de quantos repositórios visitar, rotulado no código como E/S e não julgamento de
         produto**, com o excedente declarado — mesma distinção da Q-025.

      *Aceite:* uma sessão lançada de fora de qualquer repositório, que tocou arquivos em **dois**
      repositórios diferentes, produz handoff com os dois — e um handoff **versão 1 já em disco**
      continua sendo lido sem erro. **Os dois casos com teste**; o segundo é o que protege o
      histórico de quem já usa.

      *Fora de escopo:* mudar o que o `--session`/`ignore` fazem com caminho (já resolvido na
      S3-T5 — **reuse**, não reescreva), e qualquer tentativa de adivinhar um repositório
      "principal" para voltar ao singular.

      **Implementado em 2026-09-03.** `core/types.ts#RepositoryGitFacts` (`GitFacts` + `root`)
      substitui `GitFacts | null` em `HandoffFacts.git`, que vira `readonly
      RepositoryGitFacts[]`; `filesOutsideRepository`/`reposNotVisited` entram como `number | null`
      no mesmo tipo, `null` reservado para handoff migrado de schemaVersion 1 (D-025: uma versão
      antiga nunca mediu nenhum dos dois, e `0` alegaria uma medição que não existiu).
      `core/ports.ts#GitReader` ganha `readEvidenceAcrossRepos(cwd, touchedFiles)`, devolvendo
      `GitEvidenceAcrossRepos`. A descoberta de raiz é I/O puro em
      `adapters/git/repo-roots.ts#findRepoRoot` (`fs.stat` de `.git`, subindo diretório por
      diretório — nunca `git rev-parse --show-toplevel` por arquivo, mais caro à toa) e a
      orquestração — desduplicar por `core/cwd-normalization.ts` (S3-T5, reusado sem alteração),
      manter a raiz do `cwd` sempre em primeiro no corte do limite (item 6), e aplicar
      `MAX_GIT_ROOTS_TO_VISIT` (8, exportado e com parâmetro de override pelo mesmo motivo de
      `findPendingBriefing#maxScanDays`: teste não precisa criar 9 repositórios reais em disco) —
      vive em `adapters/git/git-adapter.ts#GitAdapter.readEvidenceAcrossRepos`.
      `application/evidence-gathering.ts#gatherEvidence` deixou de rodar transcript e git em
      paralelo: git agora depende de `touchedFiles`, que só existe depois que o transcript (ou seu
      padrão vazio) resolve — sequencial por necessidade, não por descuido, comentado no código.
      `git` continua em `sources[]` sempre que **ao menos um** repositório respondeu (item 7 do
      escopo/D-013).
      **Migração:** `adapters/storage/handoff-schema.ts` sobe `HANDOFF_SCHEMA_VERSION` de 1 para 2
      e registra `HANDOFF_SCHEMA_MIGRATIONS` (mecanismo de `schema-version.ts`, até agora vazio em
      produção — esta é a primeira migração real do projeto). A migração mora no schema, não em
      `resolveSchemaVersion` nem numa função de leitura separada: `resolveSchemaVersion` já existia
      genérico exatamente para receber uma tabela por documento, e `adapters/storage/index.ts`
      passa `HANDOFF_SCHEMA_MIGRATIONS` só nos dois pontos que leem handoff
      (`readHandoff`/`listHandoffs`), sem tocar `readConfig`/`readEarlyWarningState`/
      `readResumedSessionIds`. A migração **nunca reescreve o arquivo em disco** — só traduz em
      memória a cada leitura — porque `resolveSchemaVersion` é puro (recebe o documento parseado,
      devolve outro objeto) e `StorageAdapter` nunca chama uma escrita depois de uma leitura; isso
      cai de graça a favor do `--dry-run` (que já não grava nada) e de quem lê o mesmo handoff duas
      vezes no mesmo dia (`listHandoffs`, chamado de novo a cada `seeya end-day --session`
      subsequente): a segunda leitura migra de novo, do mesmo arquivo v1 inalterado, para o mesmo
      resultado — testado explicitamente (`tests/integration/storage/handoff.test.ts`, "reading the
      same v1 file twice produces the identical result... no write-on-read"). O `root` do
      repositório único de um documento v1 é preenchido a partir do `cwd` de topo do próprio
      documento (era exatamente essa a leitura implícita antes de existir `root`).
      **Testado:** os dois casos do aceite têm teste de integração dedicado — dois repositórios
      git reais em `tmpdir`, com um `cwd` fora dos dois, em
      `tests/integration/git/git-adapter.test.ts` (mais o caso do item 6: raiz do `cwd` mantida
      mesmo sem `touchedFiles` nela; o caso do item 5: arquivo fora de qualquer repo contado; e o
      caso do item 7: excedente do limite declarado, via o parâmetro de override); e um documento
      v1 **bruto** (JSON escrito à mão, nunca via `serializeHandoff`, que só escreve a versão atual)
      em `tests/integration/storage/handoff.test.ts`, describe "D-032 migration from schemaVersion
      1" — cobre `readHandoff`, `listHandoffs`, `git: null` migrando para `[]`, e a idempotência da
      leitura. Toda fixture/duplo que construía `HandoffFacts`/`Handoff` literalmente foi atualizada
      para a forma nova (lista + dois campos novos) nos testes já existentes.
      **Verificado, não só assumido:** `npm run verificar` e `npm run verificar:linux` verdes,
      `core/` e `application/` em 100% (o piso de S1-T12 continua valendo por diretório, não só no
      agregado).
      **Questão registrada:** `docs/QUESTOES.md` **Q-046** — nomes novos que ainda não estão no
      glossário do `AGENTS.md` (`RepositoryGitFacts`, `readEvidenceAcrossRepos`,
      `GitEvidenceAcrossRepos`, `filesOutsideRepository`, `reposNotVisited`) e o valor de
      `MAX_GIT_ROOTS_TO_VISIT`, para confirmação do mantenedor.

- [~] **S4-T0f — Teste de unidade que spawna processo real está na faixa errada.** Achado em
      2026-09-04, investigando um vermelho no CI de Windows.

      **O que falhou.** `tests/unit/adapters/process/proc-start.test.ts`, caso
      *"win32: recheck says the PID is gone"*, com `Test timed out in 5000ms` — **primeira vez em
      oito execuções**. Rerun do mesmo commit passou, então é contenção, não defeito
      determinístico.

      **Mas a fragilidade é estrutural, não azar.** Esse teste chama a plataforma `win32` de
      verdade: ele **spawna `powershell.exe`**. Medido nesta máquina, quente: 500–880ms por
      chamada, duas por arquivo. E o `docs/TESTES.md` define a faixa assim:

      > *"unidade — core/ e transcript/ — **sem I/O, sem relógio real**"*

      **Um teste que spawna processo está na faixa que proíbe I/O.** Ele usa o default de 5000ms
      do vitest porque **ninguém lhe deu orçamento** — e ninguém deu porque a faixa promete que
      não precisa. Ele é frágil **por construção**.

      **A pista do conserto está no próprio docstring dele:** o PID é impossível de propósito,
      para a busca falhar em qualquer plataforma, e o que se afirma é **só a rotulagem**
      (`processGone` × `unavailable`), decidida pelo `recheck` **injetado**. O spawn real é
      **incidental** — o teste não precisa do powershell para responder, precisa que a captura
      falhe.

      *Escopo:* tornar o teste genuinamente puro, injetando a falha de captura em vez de
      provocá-la com processo real. O projeto já injeta `platform` e `recheck` exatamente para
      isso — a costura existe, falta usá-la aqui.

      *Alternativas descartadas, e por quê:* **subir o timeout** trata o sintoma e deixa I/O numa
      faixa que promete não ter; **mover para `tests/integration/process/`** é honesto mas mantém
      processo real para testar lógica pura — e a cobertura real daquela função contra processo
      de verdade **já existe** em `tests/integration/process/liveness.test.ts`, com orçamento.

      *Enquanto estiver aí:* varra `tests/unit/` atrás de **outros** testes que fazem I/O. Se
      houver mais, **liste na Q-047** em vez de consertar todos — quero decidir o alcance.

      *Aceite:* o caso `win32` não spawna processo nenhum, e a asserção sobre a rotulagem
      continua valendo.

- [~] **S4-T0g — O CI de Windows *pareceu* quadruplicar com a S4-T0 — e não foi isso.** Achado na mesma

      > **CORREÇÃO (2026-09-05, medido — a premissa desta tarefa era minha e estava errada).**
      > Eu li a **duração total do job** e atribuí ao código. Medindo **por passo**, em 7
      > execuções do `windows-latest`, o passo de teste/build ficou entre **95 e 135s em todas
      > elas**, antes e depois da S4-T0 — crescimento de 15% a 40%, coerente com os 1,4x de
      > testes, **não** com 4,3x.
      >
      > Os 582s vieram **73% de um `npm ci` que travou por ~7 minutos**, com cache quente, sem
      > erro registrado e com o `package-lock.json` inalterado naquele commit — ruído de
      > infraestrutura, sem relação com código deste repositório.
      >
      > **A hipótese do `createGitFixture` caiu.** Por arquivo, no CI real:
      > `tests/integration/git/` = **~6,6%** do tempo agregado (~10,6s). O peso está em
      > `tests/integration/guards/` = **~81%** (~130s de 161s), que roda `eslint` e
      > `dependency-cruiser` como processos reais — custo **pré-existente desde o Sprint 0**, já
      > documentado na Q-025/Q-030a, e **não** regressão da S4-T0.
      >
      > **Nenhum código foi mudado, e essa é a entrega certa.** Otimizar o `createGitFixture`
      > trocaria cobertura real de git por ~10s num job que já estava na ordem de grandeza
      > esperada em 6 de 7 execuções medidas. O agente mediu antes de mexer, como a tarefa
      > exigia, e a medição disse para não mexer.
      >
      > **Fica registrado como o erro que foi:** medir tempo de parede e chamar de regressão de
      > código é a mesma classe de engano que a S2-T8 e a Q-030a já tinham nomeado — atribuir
      > causa antes de isolar variável. Ver **Q-048** para as tabelas.
      investigação, e é o achado maior.

      **Medido**, duração do job `windows-latest` nas últimas oito execuções verdes:

      ```
      582s  merge: S4-T0          <- 
      144s  merge: S4-T0e
      121s  docs: D-032
      130s  docs: amend S4-T0e
      157s  docs: plan S4-T0e
      137s  merge: S4-T0d
      138s  docs: correct Q-041
      134s  merge: S4-T0c
      ```

      De ~2min15 para **9min42**. Os testes cresceram **1,4x** (de ~800 para 1124); o tempo
      cresceu **4,3x**. A desproporção é o ponto — não é "mais testes", é outra coisa.

      **Suspeita principal, a confirmar medindo:** as suítes novas criam **repositórios git reais**
      em `tmpdir` (`createGitFixture`), e operação de git no Windows é cara. **Meça por arquivo
      antes de mexer** — a S2-T8 já ensinou que a causa provável pode não ser a causa.

      **Por que isto importa mais que o número:** este é o portão que se espera antes de publicar.
      Quadruplicar a espera muda como se trabalha, e o efeito **piora sozinho** conforme a suíte
      cresce. Foi também o que encheu o runner o bastante para a S4-T0f aparecer.

      *Direções possíveis, nenhuma decidida:* reusar um repositório por **arquivo** em vez de por
      teste; pagar a criação uma vez em `globalSetup`, como já se fez com o shim do `csc.exe`
      (S2-T8); ou reduzir o que precisa de repositório real. **Escolha com a medição na mão.**

      *Aceite:* o job de Windows volta para a ordem de grandeza anterior **sem** perder cobertura
      real de git — e o relatório diz onde estava o tempo, não só que melhorou.

- [ ] **S4-T0h — A saída do `end-day` mostra a prosa e esconde a lista.** Achado pelo mantenedor
      em 2026-09-05, com captura de tela de uma execução real. **É a S3-T6 outra vez, no outro
      comando** — aquele conserto nunca atravessou para cá.

      **O que a tela mostra.** Por sessão capturada, o `cli/format-end-day.ts` imprime
      `mode/source/terminated` e depois o **`Understanding` inteiro, sem quebra**. Numa execução
      com sonnet isso deu **1682 caracteres** correndo até a largura do terminal — parede única.

      **E o que ele NÃO imprime:** `pendingItems` e `tomorrowPlan`. Quem acabou de encerrar o dia
      recebe a **narrativa** e não recebe **a lista do que ficou pendente** — que é a parte curta,
      acionável, e a razão de rodar o comando. **Isso não é formatação ruim, é a informação
      errada.** A prosa faz sentido no `summary.md`, que existe para ser lido com calma; o
      terminal é o lugar da lista.

      *Escopo 1:* a lista pendente aparece no terminal, item por linha. O `core/consolidated-plan.ts`
      já tem `renderItemList` fazendo exatamente isso para o `start-day` (S3-T6) — **avalie
      reusar em vez de escrever outro**, com o cuidado de não arrastar `core/` para uma
      responsabilidade de `cli/`.

      *Escopo 2:* a prosa para de ser parede. Quebra em coluna legível — e **considere se ela
      deve aparecer inteira**, dado que já está no `summary.md`. Um resumo curto, ou nada, pode
      ser melhor que 1682 caracteres. **Decida e explique**; não é obrigatório mantê-la.

      *Cuidado:* o `end-day` também imprime seções que **não** podem sumir — inelegíveis com
      motivo, falhas, avisos de terminação (Q-007), limpeza de forks, e a nota de escopo
      (S4-T0c/S4-T0d). Legibilidade não pode virar omissão: a D-022 e a D-025 valem aqui, e
      **nenhum balde pode ser silenciosamente descartado**.

      *Fora de escopo:* o idioma. Ver o item próprio abaixo.

      *Aceite:* uma execução com duas sessões capturadas cabe na tela sem rolagem infinita, e
      **a lista de pendências é visível sem abrir arquivo nenhum**.

- [ ] **S4-T0i — Tornar deliberado o idioma do conteúdo gerado (D-033).**
      Observado na mesma captura de tela: a sessão do projeto saiu **em português** e a
      `seeya-todo-test` **em inglês**, no mesmo relatório.

      **Não é defeito de código — é decisão de produto que ninguém tomou.** O modelo espelha o
      idioma da sessão capturada, e num dia com sessões mistas o `summary.md` e o terminal ficam
      bilíngues. A **D-028** fixa inglês para o que é **público** (CLI, docs), e o conteúdo
      gerado a partir da conversa do usuário nunca foi classificado.

      *As opções, e nenhuma é obviamente certa:* espelhar o idioma da sessão (o que já acontece,
      por acidente); fixar um idioma no prompt de captura; ou tornar isso configurável.
      Espelhar tem argumento real — o handoff é lido por quem escreveu a sessão. Fixar tem outro
      — um briefing consolidado com quatro sessões em três idiomas é pior que qualquer escolha
      única.

      **Não implemente antes de decidir.** Abra a questão com as opções e o custo de cada uma; a
      escolha é do mantenedor.

      **Medido (Q-048): a hipótese do `createGitFixture` caiu, e a "desproporção" some quando o
      job é separado por etapa.** Isolando `Instala as dependências` (`npm ci`) de `Roda o portão`
      (tsc+lint+depcruise+build+cobertura) em 7 execuções reais do `windows-latest`
      (`gh run view --log`), o passo que roda teste de verdade ficou entre **95s e 135s em todas
      elas**, antes e depois da S4-T0 — um crescimento de +15% a +40%, proporcional ao 1,4x de
      testes, não 4,3x. Os 582s inteiros vieram **73% de um único `npm ci`** que travou por 7
      minutos com cache já restaurado e nenhum erro no log — infraestrutura do runner, não código
      deste projeto (`package-lock.json` não mudou nesse commit). No log verboso da execução
      seguinte (já com os 1124 testes), `tests/integration/guards/` (spawns reais de
      `eslint`/`dependency-cruiser`, existente desde o Sprint 0, já custoso — Q-025, Q-030a) é
      **~81%** do tempo agregado de teste no Windows; `tests/integration/git/` (o suspeito) é
      **~6,6%**. **Nenhum código foi alterado** (nem `_fixtures.ts`, nem `vitest.config.ts`): a
      medição não sustenta um problema ali para consertar, e mexer seria trocar cobertura real de
      git por uma economia de ~10s num job já na ordem de grandeza esperada em 6 das 7 execuções.
      Detalhe completo, tabelas e as três medições (local, por etapa de CI, por arquivo no runner
      real) em `docs/QUESTOES.md` Q-048.

- [~] **S4-T1 — `adapters/notification`** conforme o Spike B, com a cadeia de fallback e o
      contrato mínimo **sem ações**. Validação manual do `activationType="protocol"` com esquema
      `seeya://` no Windows; se não se provar, o produto segue sem ações clicáveis e nada quebra.
      **Q-007:** quando `canTerminate: true` estiver ligado e a terminação não acontecer (depois da
      S1-T2b: quando não há console para anexar), o aviso diz **qual sessão não foi encerrada e por
      captura — o handoff foi gravado; só a terminação não ocorreu.
- [~] **S4-T2 — `core/schedule`.** Puro: dado config + estado + agora, o que deve acontecer.
      É aqui que moram os testes de horário de verão e de máquina suspensa.
      **Implementado em 2026-08-31:** `src/core/schedule.ts` — `resolveEndOfDayInstant` (a
      conversão `"HH:MM"` + dia + fuso, D-019, delegando DST inteiramente à plataforma: hora
      inexistente na entrada do horário de verão normaliza para depois do buraco, hora ambígua na
      saída resolve para a ocorrência mais cedo — os dois medidos com `TZ=America/New_York`,
      2026-03-08/2026-11-01, ambos documentados no comentário da função e na Q-037 item 1/2, nunca
      uma tabela de transições própria), `computeEffectiveEndOfDay` (soma o adiamento acumulado,
      `null` quando `endOfDayTime` é `null`), `emptyDayState`/`applySnooze`/`applySkipToday` (D-006,
      cumulativos, resetando por `core/day.ts#localDayString` na virada de dia) e `decideSchedule`
      — a união discriminada `ScheduleDecision` (D-024) com seis casos (`disabled`, `skipped`,
      `alreadyEnded`, `waiting`, `leadTimeWarning` com qual antecedência, `endOfDay` com `delayMs`
      bruto em vez de um `late: boolean` que apagaria a distinção que a spec pede, Q-037 item 3) e
      `nextState` (mesmo padrão de `core/early-warnings.ts`: a marca de "já notificado"/"já
      encerrado" volta junto da decisão, e só o caller persiste depois de agir de verdade). `DayState`
      (`core/types.ts`) é só o tipo de domínio — nenhum método novo em `Storage`/`core/ports.ts`,
      por pedido explícito da tarefa (a persistência real é S4-T3/S4-T4). Seis escolhas sem resposta
      literal na spec registradas em `docs/QUESTOES.md` Q-037 (resolução das duas transições de
      horário de verão, `delayMs` em vez de booleano, ordem de prioridade quando duas antecedências
      vencem juntas após suspensão, `alreadyEnded` permanente mesmo com adiamento pedido depois, e o
      reset de virada de dia vivendo no `core/` em vez de esperar a chave de disco de S4-T3/S4-T4).
      29 testes em `tests/unit/core/schedule.test.ts`, incluindo os dois dias de virada de horário
      de verão com `TZ` forçado e restaurado. `npm run verificar` e `npm run verificar:linux` verdes.
- [ ] **S4-T3 — Daemon.** Loop, lockfile de instância única, recuperação de disparo atrasado.
      **Sobe desanexado do shell que o chamou** (D-005, emendado): `detached` + `stdio` ignorado
      + `unref()`. Não é comando em segundo plano — sobrevive a fechar a janela e a deslogar.
      No Windows isso significa **console nenhum**, e é o que torna o daemon inalcançável pelo
      Ctrl+Break que ele mesmo gera ao encerrar sessões (S1-T2b).
      *Aceite:* subir o daemon, **fechar o terminal**, e ele continua vivo e disparando.
      **Q-024: os avisos precoces (S1-T7) são ligados aqui.** Estão prontos e desligados desde o
      Sprint 1. Não pertencem ao `end-day` (aviso que chega à noite sobre um problema da manhã é
      autópsia, não aviso) nem ao `seeya sessions` (sob demanda: quem nunca roda nunca é avisado,
      e a especificação diz que aquele comando não escreve nada). O daemon é a única coisa que vê
      sessões **continuamente**, que é o que o D-018 quer dizer com "assim que a sessão é vista".
      Ver `src/adapters/discovery/early-warnings.ts`.

      **ATUALIZAÇÃO (2026-09-05): esta entrada é do Sprint 0, e cinco coisas mudaram desde
      então. Leia isto antes do texto acima.**

      **1. A decisão de agenda já existe e é pura.** A S4-T2 entregou `core/schedule.ts`, que
      devolve **união discriminada de seis variantes** (`disabled`, `skipped`, `alreadyEnded`,
      `waiting`, `leadTimeWarning`, `endOfDay`) mais um `nextState`. O daemon **consome**, não
      redecide. E o `nextState` só deve ser persistido **depois** de a ação ter sucesso — a
      função pura nunca assume que o efeito aconteceu.

      **2. O `DayState` ainda NÃO é persistido, e persistir é desta tarefa.** A S4-T2 entregou o
      tipo de domínio de propósito sem disco, deixando a forma para quem fosse gravar. O
      `AGENTS.md` § Idioma **já reserva** `estado.json` e `Storage.saveState` — use esses nomes.
      **D-027: chave que vai para disco é barata agora e cara depois.**

      **3. O limite de retentativa mora aí, e a Q-040 já disse por quê.** A S4-T00e fez handoff
      determinístico **deixar de bloquear** nova captura no mesmo dia — correto para uso à mão, e
      em laço vira retentativa a cada ciclo se o modelo estiver falhando de verdade, gastando
      dinheiro sem melhorar nada. A contagem **não** pode ser reconstruída dos handoffs
      (`saveHandoff` **sobrescreve**, não acumula), então ela mora no `DayState`.

      **4. A cadência foi resolvida por medição, e o resultado é o mais simples.** O Spike J
      mediu que o cache de prompt vive na faixa de **uma hora** (quente aos 18 minutos, tier de
      1h em toda escrita). Isso **derrubou** o argumento — vindo do Spike I, por analogia com o
      away summary — de que o daemon precisaria de detecção fina de ociosidade de 5 minutos.
      **O desenho segue o da especificação:** laço de 30s decidindo por relógio de parede,
      captura no horário efetivo. Não construa captura contínua.

      **5. Notificação e escopo já existem.** A S4-T1 entregou a porta `Notifier` e a cadeia de
      fallback (primeiro disponível vence; nenhum disponível cai para stderr **sem lançar**). A
      D-031 já está implementada no `endDay`, então o daemon herda o escopo certo — captura o
      que está vivo e o que morreu por acidente, lista o que foi fechado.

      **Um cuidado que só aparece em laço:** o `end-day` à mão é uma execução por dia; o daemon
      chama a captura **repetidamente**. Tudo que é aceitável uma vez — falha de geração, sessão
      inelegível, notificação que não sobe — passa a acontecer N vezes. **Nada disso pode virar
      enxurrada de aviso nem de gasto.** Pense em quem deixa a máquina ligada no fim de semana.
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

- [ ] **S5-T5 — Atualizar as ações do CI, que rodam num runtime obsoleto.** Não é a nossa versão
      do Node: o `ci.yml` pede `node-version: 22` para o projeto e isso está certo (D-008). O que
      está velho é o **runtime das ações**: `actions/checkout@v4` e `actions/setup-node@v4` são
      construídas para Node 20, e o GitHub já as força a rodar em Node 24, avisando em toda
      execução.
      Isso é **relógio correndo, não preferência**: hoje é aviso, e vira falha quando o GitHub
      parar de forçar. A troca é de duas linhas; o custo de deixar passar é o CI quebrar num dia
      em que ninguém mexeu em nada — e aí alguém vai procurar a causa no código.
      *Aceite:* CI verde nos três sistemas **sem o aviso de runtime obsoleto** na saída.
- [ ] **S5-T6 — Portão de segurança antes de publicar: dependências e SAST.** Pedido do mantenedor
      em 2026-08-30, com a ressalva de que não é para agora — entra antes da publicação, não
      durante a construção.
      O motivo de existir: este projeto vai para npm como código aberto, **executa processos**,
      **lê arquivos do usuário** e tem uma exceção documentada para **apagar** dentro do
      `~/.claude/`. É superfície suficiente para merecer análise automática antes de alguém
      instalar isto na própria máquina.
      - **dependências:** `npm audit` no portão. A árvore é pequena hoje, então é barato — e o
        momento de estabelecer o hábito é enquanto é barato
      - **SAST:** o CodeQL é o encaixe natural (nativo do GitHub, gratuito em repositório
        público, entende TypeScript). Vale apontá-lo em especial para o que o projeto faz de
        arriscado: montagem de argumento de `spawn`, caminho de arquivo vindo de fora, e a
        exclusão do D-012
      - **segredo:** já existe o `scripts/verificar-termos-locais.mjs` no pre-commit, mas ele só
        protege quem commita **nesta** máquina. Varredura no CI cobre quem clonar e contribuir
      **Uma decisão a tomar quando chegar:** o portão de segurança **reprova** o CI ou só reporta?
      Reprovar por vulnerabilidade transitiva que não tem correção disponível trava o projeto por
      algo fora do alcance dele. Reportar e ninguém olhar é o mesmo que não ter. Não decida isso
      agora — decida com o primeiro achado real na mão.

- [ ] **S5-T7 — Avaliar um `--sessions` que aceite lista.** Ideia do mantenedor em 2026-08-30,
      ao fechar a Q-030, **com a ressalva dele de que não é para agora** — registrada aqui para
      não se perder, não como tarefa aceita.
      *Contexto:* a S3-T5 fez `--session` **recusar** valor ambíguo em vez de resolver várias
      sessões de uma vez. Isso não removeu capacidade nenhuma: capturar todas as sessões de um
      `cwd` nunca foi objetivo, era efeito colateral de comparar caminho por igualdade de string
      numa flag cuja ajuda diz "limit to a single session".
      *Se um dia entrar:* uma flag **separada e explícita** para várias, nunca reinterpretando a
      singular. O `--session` recusando ambiguidade é o que impede escolha errada no comando que
      também pode encerrar processo (D-002); relaxar aquilo para acomodar o caso plural traria o
      problema de volta pela porta dos fundos.
      *Critério para existir:* necessidade real de uso, não simetria de API. Se ninguém sentir
      falta, esta entrada some sem custo — que é o melhor destino possível para ela.
## Definição de pronto (vale para toda tarefa)

1. Código implementa exatamente a spec; divergência virou questão, não improviso.
2. Testes da faixa correspondente escritos e passando.
3. `npm run verificar` verde (tipos + lint + dependency-cruiser + cobertura + testes).
4. Nenhum `TODO`, `any`, `@ts-ignore` ou `eslint-disable` novo sem justificativa em comentário.
5. Commits em português, pequenos, um assunto cada.
6. Review do agente revisor aprovado.

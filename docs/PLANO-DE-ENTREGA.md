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

**Estado do sprint, corrigido em 2026-09-10.** Todas as tarefas abaixo marcadas `[x]` foram
revisadas, mescladas e publicadas pelo PO à medida que voltaram — mas o plano ficou com `[~]` em
27 delas, porque a revisão mesclava e esquecia de marcar. Ninguém lendo este arquivo saberia
que o sprint estava fechado no código. É o risco que a `docs/V2-RUMO.md` descreve (documento
desatualizado afirma o falso com confiança), observado aqui antes de ser teoria. **Exceção:**
a S4-T0i (idioma do conteúdo gerado, D-033) não foi feita. **Sprint aceito pelo mantenedor em
2026-09-10**, com base no daemon rodando de verdade em 06 e 07/09 (captura agendada disparando
sozinha, avisos prévios, nenhuma janela) e na retomada com `start-day` em 08/09. A S4-T0i fica
como tarefa aberta, já decidida, fora do aceite.

- [x] **S4-T00 — Medir se a captura pega carona no cache.** Aprovada pelo mantenedor em
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

- [x] **S4-T00b — Qual dos três flags quebra a identidade de prefixo?** Aprovada pelo mantenedor
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

- [x] **S4-T00c — O modo enxuto para de jogar fora o texto do assistente.** Saída da reavaliação
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

- [x] **S4-T00d — A falha de geração precisa dizer o que o `claude` respondeu.** Achada pelo
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

- [x] **S4-T00e — Captura que falhou não pode bloquear a retentativa do dia.** Achada pelo
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

- [x] **S4-T0b — Implementar a D-031: capturar o que está vivo, listar o que foi fechado.**
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

- [x] **S4-T0c — O artefato do dia precisa dizer quando foi um recorte.** Saída da Q-041,
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

- [x] **S4-T0d — A nota de recorte precisa trazer o número que já está em mãos.** Emenda pequena
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

- [x] **S4-T0e — O prompt de captura precisa proibir identificador inventado.** Achado pelo
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

- [x] **S4-T0 — A evidência não pode ficar presa ao `cwd` de lançamento.** Aprovada pelo
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

- [x] **S4-T0f — Teste de unidade que spawna processo real está na faixa errada.** Achado em
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

- [x] **S4-T0g — O CI de Windows *pareceu* quadruplicar com a S4-T0 — e não foi isso.** Achado na mesma

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

- [x] **S4-T0h — A saída do `end-day` mostra a prosa e esconde a lista.** Achado pelo mantenedor
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

      **Implementado em 2026-09-05.** `core/consolidated-plan.ts#renderItemList` virou export
      (só isso — mesma assinatura, mesmo comportamento) e `cli/format-end-day.ts` passou a
      chamá-lo para `pendingItems`/`tomorrowPlan` na seção `Captured:`, mesmo formato item-por-
      linha que o `start-day` já usa (S3-T6): rótulo com 4 espaços, item com 6. Gate em
      `source === 'model'` para a lista aparecer — um handoff `deterministic`/`noTranscript`
      nunca teve o modelo confirmando "nada pendente" (D-003), e imprimir uma lista vazia (ou o
      aviso "nothing pending recorded") ali misturaria "falhou" com "checou e não achou nada",
      mesma disciplina que `renderSessionPlanLine` já aplica ao `start-day`. `Understanding`
      passou a ser um resumo de até 200 caracteres (`excerptUnderstanding`, corta em fim de frase
      quando cabe no orçamento, senão no último espaço, nunca no meio de palavra), com
      `(…, full text in summary.md)` quando corta — decisão explicada na Q-050: quebra de linha
      pura não resolve "N sessões encher a tela", só transforma uma parede de 1682 caracteres em
      várias linhas; um resumo curto com aviso explícito resolve e não descarta nada em silêncio
      (D-025), porque o texto inteiro continua intacto no `summary.md`
      (`core/briefing.ts#renderTextBlock`, não tocado por esta tarefa). Nenhuma seção existente
      foi removida ou reordenada — inelegíveis, falhas, avisos de terminação, limpeza de forks e
      a nota de escopo continuam todas presentes, testado explicitamente. Teste com o caso real
      pedido pelo aceite: duas sessões capturadas, uma com `understanding` de exatamente 1682
      caracteres (o tamanho medido do achado original) e várias pendências, a outra uma sessão
      curta comum — nenhuma linha do relatório resultante passa de 300 caracteres, e a lista de
      pendências aparece item por linha sem abrir o `summary.md`
      (`tests/unit/cli/format-end-day.test.ts`). Três escolhas registradas em Q-050 para
      confirmação do PO (reuso do `renderItemList`, o corte em 200 caracteres em vez de quebra de
      linha, e o gate por `source`). `npm run verificar` e `npm run verificar:linux` verdes;
      `core/` 100% linhas, `cli/` 100% linhas.

- [x] **S4-T0i — Tornar deliberado o idioma do conteúdo gerado (D-033).** Revisada e mesclada em 2026-09-11; validação real fica para o próximo `end-day` com sessões de idioma misto.
      Observado na mesma captura de tela: a sessão do projeto saiu **em português** e a
      `seeya-todo-test` **em inglês**, no mesmo relatório.

      **Decidida desde 05/09: a D-033 fixa que a moldura é inglesa e o conteúdo gerado espelha o
      idioma da sessão. Falta só implementar** — uma frase no `GENERATION_SYSTEM_PROMPT`, dentro do
      teto de 1000 caracteres que um teste já vigia. O texto abaixo é de antes da decisão e ficou
      desatualizado; a sessão limpa do spike K foi induzida a erro por ele (2026-09-10).

      *Texto original:* **Não é defeito de código — é decisão de produto que ninguém tomou.** O modelo espelha o
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

      **Feito (2026-09-11).** Uma frase acrescentada ao `GENERATION_SYSTEM_PROMPT`
      (`src/adapters/generation/system-prompt.ts`), entre a instrução de responder só com o JSON
      pedido e as instruções de não inventar (D-025) já existentes desde a S4-T0e:

      > `Mirror the session's predominant language in the field values, not just its latest
      > message.`

      **Medido: 701 caracteres antes, 793 depois** — dentro do teto de 1000 do teste-tripwire, com
      folga de 207. "Field values" restringe a instrução ao conteúdo dos campos do JSON
      (`understanding`, `pendingItems`, `tomorrowPlan`); não menciona `key` nem formato, então não
      dá margem para o modelo ler "responda no idioma da sessão" como cobrindo a moldura (chaves,
      texto do CLI, títulos do `summary.md`), que continua em inglês por D-028 e não foi tocada. O
      comentário do módulo cita D-033 e S4-T0i para o porquê; o comentário do teste novo faz o
      mesmo.

      Teste novo em `tests/unit/adapters/generation/system-prompt.test.ts`: asserção de conteúdo
      (a frase existe, verbatim, na string exportada) mais o tripwire de 1000 caracteres já
      existente, agora provando 793 < 1000. **Inferido, não medido: que o modelo de fato espelha
      o idioma predominante em vez do idioma da última mensagem** — nenhum teste de unidade prova
      isso (é prosa gerada), e não escrevi teste que aparente provar mais do que "a instrução
      existe no prompt enviado". **O que o mantenedor precisa ver à mão:** o próximo `end-day` real
      com sessão de idioma misto — confirmar que os campos gerados seguem o idioma predominante da
      sessão e não o da última mensagem digitada.

      `npm run verificar` verde: 133 arquivos de teste, 1441 testes passando (3 skipped),
      cobertura 97,05% statements / 92,65% branches / 98,2% funcs / 97,29% lines — acima dos
      mínimos de `AGENTS.md`. `npm run verificar:linux` verde.

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

- [x] **S4-T1 — `adapters/notification`** conforme o Spike B, com a cadeia de fallback e o
      contrato mínimo **sem ações**. Validação manual do `activationType="protocol"` com esquema
      `seeya://` no Windows; se não se provar, o produto segue sem ações clicáveis e nada quebra.
      **Q-007:** quando `canTerminate: true` estiver ligado e a terminação não acontecer (depois da
      S1-T2b: quando não há console para anexar), o aviso diz **qual sessão não foi encerrada e por
      captura — o handoff foi gravado; só a terminação não ocorreu.
- [x] **S4-T2 — `core/schedule`.** Puro: dado config + estado + agora, o que deve acontecer.
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
- [x] **S4-T3 — Daemon.** Loop, lockfile de instância única, recuperação de disparo atrasado.
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

      **Implementado em 2026-09-05.** `src/scheduler/` (novo): `poll.ts#pollOnce` — um ciclo,
      chamado a cada 30s por `loop.ts#runDaemon` via `Clock.sleep` (D-019: porta ganhou `sleep`,
      nenhum `setTimeout` fora de `adapters/relogio`). Avisos precoces (Q-024) rodam em **todo**
      ciclo, antes da decisão de agenda — `discoverEarlyWarnings` já deduplica sozinho, então
      "sem repetir para a mesma sessão" vem de graça. `decideSchedule` é consumida, nunca
      redecidida; `nextState` só é persistido depois da ação ter sucesso.

      **Retentativa de turno ativo (5 min) sai do MESMO laço de 30s, sem laço novo.** Enquanto uma
      sessão capturada vier com `capturedDuringActiveTurn: true`, o poll grava tudo MENOS
      `endOfDayFired` — o próximo ciclo pergunta a mesma coisa de novo, e `endDay` naturalmente só
      recaptura quem ainda está em turno (D-026 já barra o resto). Finaliza quando ninguém mais
      está em turno ativo OU o orçamento de 5 min estoura (mesmo `delayMs` que decide "atrasado").

      **`DayState.captureAttemptsToday`** (campo novo, `core/types.ts`) é o limite de retentativa
      da Q-040 item 3: `core/capture-retry.ts` conta, por `sessionId`, toda captura que **não**
      terminou com `source: "model"` (falha total ou `deterministic`/`noTranscript`) e exclui
      quem chega a **3 tentativas** (`MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY`, justificado no
      comentário: conservador, sem base numérica na spec, e ainda assim engatilha antes do teto
      natural de ~10 polls da janela de 5 min). `scheduler/capture-filter.ts` vira isso num
      `EndDayOptions.sessionFilter` — a peça que a S4-T00e já tinha apontado como o encaixe.

      **Persistência.** `Storage` ganhou `readState`/`saveState` (`~/.seeya/estado.json`, D-006,
      arquivo único na raiz — não um por dia, porque `DayState.day` já se autodetecta como
      obsoleto, ver Q-037 item 6) e `readDaemonLock`/`writeDaemonLock`/`clearDaemonLock`
      (`~/.seeya/daemon.lock`, D-005). Ambos seguem o padrão versionado já usado por
      `config.json`/`early-warnings.json` (`adapters/storage/state-schema.ts`,
      `daemon-lock-schema.ts`).

      **Instância única (D-005).** `core/daemon-lock.ts#decideLockAcquisition` é pura: lock
      ausente ou com PID morto → adquire; PID vivo → recusa, nomeando quem segura. **Sem
      desempate por `procStart`** — risco aceito e documentado no próprio arquivo (PID reciclado
      recusaria por engano um daemon legítimo; consequência pequena e reversível, ao contrário do
      registro de sessões do Claude Code). Checado duas vezes: o lançador confere antes de
      spawnar (feedback imediato, sem gastar um processo à toa); o worker confere de novo com o
      próprio PID, e essa é a checagem que vale de verdade.

      **Subida desanexada (D-005).** `adapters/process/daemon-launch.ts#spawnDetachedDaemon`:
      `detached: true` + `stdio: 'ignore'` + `.unref()`. `seeya daemon` sem a variável de ambiente
      `SEEYA_DAEMON_CHILD` é o **lançador** (verifica o lock, spawna o worker com essa variável
      setada, imprime o PID e sai); com ela, é o **worker** (o laço de verdade, sem console — daí
      não haver flag `--run` escondida no `--help`: uma variável de ambiente já carrega o mesmo
      sinal "isto não é para um humano digitar" que o D-017 usa na outra direção).

      **Como o desanexamento foi testado.** `tests/integration/process/daemon-launch.test.ts` e
      `tests/integration/cli/daemon-command.test.ts` spawnam um processo real (reaproveitando o
      fixture `graceful-child.mjs` do S1-T2) e confirmam que ele fica vivo, é alcançável e
      responde a sinal — prova que a chamada produz um processo real, não uma simulação. Nenhum
      teste AUTOMATIZADO prova sobrevivência ao fechamento do terminal (exigiria o processo de
      teste morrer e algo de fora checar depois), mas a verificação manual foi feita, e mediu o
      que o aceite pede: `npm run build` seguido de `node dist/cli/index.js daemon` numa invocação
      do Bash tool (com `USERPROFILE` apontado para uma pasta descartável — `HOME` é bloqueado
      neste ambiente por motivo de isolamento de git, `USERPROFILE` não), e o PID relatado
      (437448) checado vivo por `tasklist` **numa segunda invocação do Bash tool** — cada chamada
      é um processo de shell novo, que nasce e morre sozinho, então se o daemon estivesse preso
      àquele shell já teria morrido junto. `daemon.lock` confirmado em disco com o mesmo PID; uma
      terceira invocação tentando `seeya daemon` de novo recusou com "already running (pid
      437448)" — o guarda de instância única também medido contra o binário real, não só contra
      fakes. Processo encerrado e pasta descartável removida ao final. Isto é uma janela de shell
      terminando, não uma janela de terminal interativa sendo fechada por um humano — mas o
      mecanismo que garante os dois (processo pai morre, filho `detached`/`unref` continua) é o
      mesmo, e é isso que estava em teste.

      **Cobertura:** `core/` 100% (`capture-retry.ts`, `daemon-lock.ts` novos, 100% cada);
      `scheduler/` 98.85%/97.82%/95%/100%. `npm run verificar` e `npm run verificar:linux` verdes
      (medido nesta máquina via Docker Desktop, container Linux real, não emulado).

      **Não implementado nesta tarefa, por estar fora do escopo que o plano já separa:**
      `seeya daemon --stop/--status` é a S4-T5; `seeya snooze`/`skip-today`/`config` são a S4-T4
      (o daemon já lê `estado.json`/`config.json` a cada ciclo, então uma dessas escritas
      concorrentes já é visível no próximo poll, sem mudança nenhuma aqui). Registro de
      diagnóstico (o daemon roda com `stdio: 'ignore'` — uma falha de poll é engolida, sem log em
      lugar nenhum) e a legibilidade de `captureModel`/`budgetPerSessionUsd` ficarem presos ao
      valor do início do daemon (ao contrário de `relevanceHours`, que é relido a cada ciclo)
      estão registrados na Q-049 para o mantenedor decidir, não decididos aqui.
- [x] **S4-T3e — O `fake-claude.mjs` vaza processo, e isso envenena toda medição de tempo.**
      Achado em 2026-09-05, investigando um vermelho do portão que não era do código.

      **O sintoma.** Havia **365 processos node** vivos na máquina do mantenedor, acumulados por
      semanas. Depois de matar os 334 antigos, o portão passou de primeira, 1218 testes, **sem
      tocar em código**. Os 31 restantes eram **todos** do nosso próprio fixture:

      ```
      14  tests/fixtures/generation/fake-claude.mjs -p --...   (checkout principal)
       7  .claude/worktrees/agent-.../tests/fixtures/...
       5  ...                                                  (e outras worktrees)
      ```

      **O mecanismo, e ele explica por que ninguém percebeu.** O fixture lê stdin com
      `readFileSync(0, 'utf8')` — leitura **síncrona e bloqueante**. Ela só retorna quando o
      stdin fecha. Se quem spawnou some sem fechar o cano — e o `spawnClaude` aborta por
      `AbortSignal.timeout`, além de haver testes que spawnam direto —, **o filho fica preso para
      sempre**. Não é processo lento; é processo que nunca mais recebe EOF.

      **E um cão de guarda não salvaria:** `readFileSync` trava o event loop, então nenhum
      `setTimeout` dispara. O fixture **não tem como se autodestruir** enquanto ler assim.

      *Escopo:* as duas pontas, provavelmente. **(a)** o fixture lê stdin de forma que permita um
      limite próprio de vida; **(b)** quem spawna garante fechar o stdin do filho, inclusive no
      caminho de abort. A (a) é local e defensiva; a (b) ataca a origem e depende de acertar
      todos os pontos de chamada. **Meça qual caminho vaza antes de consertar os dois.**

      *Aceite:* rodar a suíte inteira duas vezes seguidas e **a contagem de processos node não
      cresce**. Esse é o teste — não uma asserção de unidade, mas a verificação que prova o
      conserto. Diga a contagem antes e depois no relatório.

      **Por que vale mesmo não sendo urgente para o produto:** processo acumulado **envenena toda
      medição de tempo**. Já custou duas investigações — a Q-030a tratou como contenção e seguiu,
      e a S4-T0g gastou uma tarefa inteira procurando regressão no CI que não existia, porque o
      runner do GitHub nasce limpo e o problema era só local. Ver `docs/TESTES.md` § "Suíte lenta
      ou instável".

      **Medido em 2026-09-05, e o mecanismo real não era o hipotetizado acima (Q-052 tem os
      números completos).** `spawn-claude.ts` já fecha o stdin do filho de forma incondicional e
      síncrona logo após o `spawn()`, em todo caminho — inclusive abort — então o `readFileSync(0)`
      do fixture já recebia EOF quase de imediato mesmo no modo `'hang'`; o travamento eterno vinha
      de **depois** disso, do `setInterval` que o próprio modo `'hang'` arma de propósito. Contando
      `node.exe` desta worktree por `CommandLine` (`Get-CimInstance Win32_Process`, não
      `Get-Process`, que não expõe o comando): baseline 0; só o teste `-t "hangs"` deixa **1**
      processo; a suíte `tests/integration/generation` inteira (24 testes) deixa **exatamente 2** —
      o mesmo número das duas únicas ocorrências de `FAKE_CLAUDE_MODE = 'hang'` em todo o
      repositório. Nenhum teste spawna o fixture diretamente (grep confirmou); a frase "há testes
      que spawnam direto" não se sustentou aqui. A causa real: no Windows,
      `tests/integration/generation/_fixtures.ts` compila um `.exe` em C# como *launcher* (workaround
      do EINVAL de `.cmd`/`.bat`, CVE-2024-27980) — dois saltos de processo
      (`spawnClaude` → shim → `node fake-claude.mjs`). O `AbortSignal.timeout` mata só o PID
      imediato (o shim); no Windows isso não afeta o neto, que fica órfão sem sinal nenhum. No
      POSIX o launcher usa `exec`, que troca a imagem do processo mantendo o PID — aí matar o
      imediato mata o real, sem órfão. **Só (a) foi implementado.** `spawn-claude.ts` não tem bug
      de stdin para corrigir (medido), e a causa do órfão é específica do shim de teste do Windows,
      não da produção — atacar (b) (ensinar o arnês a matar a árvore inteira) seria escopo maior
      que o problema medido pede. `tests/fixtures/generation/fake-claude.mjs`: `readFileSync(0)`
      síncrono virou leitura assíncrona por `process.stdin`, preservando o `captureFile` idêntico
      (D-015/D-017 continuam provados pelo mesmo instrumento); um cão de guarda (`setTimeout` de
      5000ms, 17x o menor timeout real usado com `'hang'`, 300ms) mata o processo sozinho se nada
      mais o fizer. Contagem depois da correção: a suíte inteira de `generation` ainda deixa 2
      processos no instante em que o `vitest` retorna (o cão de guarda ainda não disparou), e cai
      para **0** dentro dos 6 segundos seguintes, medido por polling a cada 750ms — nunca mais
      cresce. Detalhes completos, incluindo os números passo a passo, em Q-052.

- [x] **S4-T3b — O daemon precisa deixar rastro quando falha, e o lock precisa desempatar PID.**
      Saída da **Q-049**, respondida em 2026-09-05. **Antes da S4-T5**, que vai querer ler as duas
      coisas.

      **Parte 1 — erro de ciclo vira estado, não fluxo.** Hoje o `scheduler/loop.ts` tem um
      `catch {}` deliberado: o daemon engole erro de ciclo. Um processo de fundo que falha sem
      rastro **fica vivo, parece saudável e não faz nada** — a pessoa descobre no dia seguinte,
      quando o briefing não existe, e não há o que investigar.

      **Logger está descartado:** o daemon sobe desanexado com `stdio` ignorado (D-005) — não tem
      para onde escrever —, e arquivo de log traz rotação, tamanho, retenção: várias chaves em
      disco (D-027) para um problema com solução menor.

      *Escopo:* gravar no `estado.json` **que já existe** o último erro e a **contagem de ciclos
      consecutivos que falharam**. O que a pessoa precisa não é "o que deu errado às 14h32", é
      **"faz três horas que não consigo trabalhar"**.

      *E uma notificação, uma só:* se o daemon falhar em **todos** os ciclos por um período longo,
      isso é acionável e merece **um** aviso — não um por erro. Mesmo padrão que o **D-018** já usa
      nos avisos precoces. **Notificar por ciclo é a enxurrada que o brief da S4-T3 proibiu.**
      Escolha o período e **justifique**; se não houver base, escolha o mais conservador e diga.

      **Parte 2 — o lock desempata por `procStart`.** Hoje ele guarda só o PID. **PID reciclado faz
      um lock morto parecer vivo** → o segundo daemon recusa subir → **nenhum daemon roda**, e a
      pessoa acha que está ligado. O erro oposto (dois daemons) é ruim mas **barulhento**; este é
      silencioso, e o D-025 existe contra ausência parecendo presença.

      *A maquinaria já existe:* a S1-T13 fez `ProcessControl.isAlive(pid, procStart)` exatamente
      para isso, e o `adapters/process/proc-start.ts` já captura o valor. O lock grava o
      `procStart` na escrita e compara na leitura. **Não construa maquinaria nova.**

      *Cuidado do D-025, que o `resolveIsAlive` já tem:* `procStart` que não pode ser capturado ou
      comparado (`unavailable`) **não** significa "morto" — cai para a checagem básica e o lock
      **continua respeitado**. Ausência de evidência não vira licença para subir um segundo daemon.

      *Aceite:* daemon que falha em vários ciclos deixa rastro legível no estado do dia e avisa
      **uma** vez; lock apontando para PID reciclado é reconhecido como morto; lock cujo
      `procStart` é indisponível **continua sendo respeitado**. **Os três com teste** — o terceiro
      é o que impede o conserto de virar o defeito oposto.

      **Implementado em 2026-09-05.** `core/daemon-health.ts` (novo) é a decisão pura: dado o
      `DaemonHealth` atual (`{ lastCycleError: { message, at } | null, consecutiveCycleFailures
      }`, campo novo em `DayState`), a mensagem de erro e o instante, devolve o próximo estado e se
      esta é a ÚNICA passagem que deve notificar — `consecutiveCycleFailures ===
      NOTIFY_AFTER_CONSECUTIVE_CYCLE_FAILURES` (120 ciclos = 1h a 30s/poll, reaproveitando a ordem
      de grandeza que o Spike J já tinha fixado, em vez de um terceiro número solto — justificado
      no comentário e na Q-053 item 2). `scheduler/health.ts` (novo) é a casca de I/O chamada do
      `catch` de `scheduler/loop.ts#runDaemon` — lê `estado.json`, grava o resultado, notifica só
      quando `shouldNotify`; um sucesso limpa a sequência só quando havia algo para limpar (sem
      escrita em `estado.json` no caminho saudável comum). `scheduler/notices.ts` ganhou
      `buildDaemonUnhealthyNotice`, reportando minutos estimados pela contagem de ciclos (sem
      `Clock` dentro de `core/`, D-019) e o último erro.

      **`daemonHealth` é o único campo de `DayState` que sobrevive à virada de meia-noite** —
      `core/schedule.ts#resetIfNewDay` ganhou uma exceção explícita e comentada: sem isso, um
      daemon quebrado desde antes da meia-noite pareceria "saudável" no dia seguinte, exatamente o
      oposto do que esta tarefa existe para resolver (Q-053 item 1, com teste dedicado provando os
      dois lados: campos por dia resetam, `daemonHealth` não).

      **Lock:** `core/daemon-lock.ts#DaemonLockInfo` ganhou `procStart: string | undefined`; o
      comentário de topo do arquivo (que afirmava a limitação como aceita) foi reescrito, não
      deixado desatualizado. `scheduler/lock.ts#checkDaemonLock` passa `existing.procStart` para
      `ProcessControl.isAlive`, reaproveitando o desempate que a S1-T13 já construiu — nenhuma
      lógica de comparação nova. `acquireDaemonLock` ganhou parâmetro `procStart`, gravado junto
      com o lock. **A premissa da Q-049 item 6 (de que a autodescrição do próprio `procStart` não
      era possível) não se sustentou ao encostar no código** — `captureObservedProcStart` não se
      importa de quem é o `pid`, então `cli/index.ts` chama a mesma função já existente sobre o
      próprio `process.pid` do worker, logo após ele subir, e passa o valor adiante como dado
      pronto (nunca I/O dentro de `scheduler/`) — ver Q-053 para o relato completo.

      **PID reciclado, testado com processo real** (`tests/integration/scheduler/lock.test.ts`,
      novo): reaproveita a técnica de `tests/integration/process/liveness.test.ts` — um filho real
      genuinamente vivo, lock gravado com `procStart` deliberadamente errado, produz exatamente a
      mesma evidência que uma reciclagem de PID produziria; `checkDaemonLock` devolve `'acquire'`
      mesmo com o PID vivo. Caso irmão com o `procStart` real confirma `'refuse'`. `procStart`
      ausente no lock (formato antigo) também testado de ponta a ponta: `'refuse'`, nunca tratado
      como morto (D-025).

      **Migração:** os dois documentos (`estado.json`, `daemon.lock`) ganharam campos `.optional()`
      dentro da MESMA versão de schema, sem bump — mesmo precedente que `captureAttemptsToday` já
      tinha aberto em `state-schema.ts`. Testado escrevendo documentos à mão (nunca via
      `serializeState`/`serializeDaemonLock`) sem as chaves novas e confirmando que a leitura
      devolve os defaults (`EMPTY_DAEMON_HEALTH`/`procStart: undefined`) em vez de rejeitar o
      arquivo (`tests/integration/storage/state.test.ts` e `daemon-lock.test.ts`).

      **Sete escolhas sem resposta literal no despacho da tarefa, registradas em Q-053** (onde
      `daemonHealth` mora, o limite de 120 ciclos, a estimativa de minutos por contagem em vez de
      tempo real, a constante `POLL_INTERVAL_MS` repetida em vez de importada — evita ciclo de
      import dentro de `scheduler/` —, ausência de bump de `schemaVersion`, onde o `procStart`
      próprio é capturado, e o alcance do teste de "procStart indisponível"). `docs/TESTES.md`
      ainda descreve o lock sem desempate — não editado por mim (não é documento que o dev altera),
      sinalizado na Q-053 para o PO atualizar.

      Cobertura: `core/` 100% (`daemon-health.ts`/`daemon-lock.ts` inclusos); `scheduler/` 98,14%
      statements/98,27% branches/92,59% funções/100% linhas. `npm run verificar` e `npm run
      verificar:linux` verdes (medido nesta máquina, o segundo via Docker Desktop, container Linux
      real).

- [x] **S4-T3c — Persistir o `assistantMessages` no handoff.** Decisão do mantenedor ao fechar a
      **Q-036**, em 2026-09-05.

      **Por que muda.** O `understanding` é **derivado** do texto do assistente. Sem ele em disco,
      o handoff **não é auditável** — não dá para saber, relendo, se o modelo leu ou inventou. E
      este projeto já pegou as duas coisas: identificador fabricado (sonnet, 02/09) e conclusão
      invertida (haiku, 02/09). **Guardar a evidência é o que permite conferir em vez de confiar.**

      **O argumento que sustentava não persistir caiu, e a medição é simples:**

      ```
      assistantMessages : 10 mensagens × 500 caracteres  → teto ~5 KB
      lastPrompts       : 10 prompts   × SEM LIMITE      → sem teto
      ```

      O campo que não era gravado é **o único dos dois com teto**. "Volume muito maior que os
      prompts" era o meu argumento, e é o inverso da verdade.

      *Escopo:* `assistantMessages` entra no `handoffFactsSchema` e no `serializeHandoff`; o
      `parseHandoffFacts` **deixa de devolver `[]` fixo** e passa a ler do disco.

      **Migração obrigatória — `schemaVersion` 2 → 3.** Documento v2 volta a ser lido com
      `assistantMessages: []`, porque um handoff v2 **nunca mediu isso** e `[]` é o valor honesto
      (D-025). Mesma disciplina da D-032, que já provou valer: os quatro dias reais do mantenedor
      foram lidos com o código novo **antes** de a mudança ser aceita. **Faça o mesmo** — e diga
      no relatório que fez.

      *Cuidado de privacidade, e ele não é bloqueante:* isto aumenta o conteúdo de trabalho real
      em `~/.seeya/`. Nada disso pode aparecer em fixture do repositório — o portão de termos
      locais existe para isso e **já recusou um commit** nesta sessão.

      *Fora de escopo:* dar teto ao `lastPrompts` (**Q-051**). Truncar prompt do usuário pode
      piorar a captura e é decisão de outra natureza; juntar faria uma tarefa carregar dois riscos.

      *Aceite:* handoff novo grava e relê o texto do assistente; **handoff v2 já em disco
      continua legível**, com `[]`. Os dois com teste.

      **Implementado em 2026-09-06:** `HANDOFF_SCHEMA_VERSION` 2 → 3
      (`src/adapters/storage/handoff-schema.ts`). `assistantMessages` entrou no
      `handoffFactsSchema` (`z.array(z.string())`), `serializeHandoff` passou a escrevê-lo, e
      `parseHandoffFacts` deixou de devolver `[]` fixo — lê `raw.assistantMessages` do documento já
      migrado. `migrateHandoffV2ToV3` acrescenta `assistantMessages: []` a um documento v2
      (que nunca escreveu essa chave), registrada em `HANDOFF_SCHEMA_MIGRATIONS[2]` — mesmo
      mecanismo de `resolveSchemaVersion` que a D-032 já validou, encadeando 1→2→3 automaticamente
      para um documento v1. `core/types.ts#SessionFacts.assistantMessages` teve o docstring
      atualizado: a frase que dizia "deliberately NOT added to `handoffFactsSchema`" (verdadeira
      até esta tarefa) foi substituída pela descrição do novo comportamento. Limites
      (`MAX_ASSISTANT_MESSAGES`/`MAX_ASSISTANT_MESSAGE_CHARS`) e o teto do `lastPrompts`
      **não foram tocados** (Q-051 segue fechada como estava).

      **Diferença de padrão em relação à D-032, registrada e justificada (Q-055):** os campos de
      D-032 (`filesOutsideRepository`/`reposNotVisited`) migram para `null`, para distinguir "não
      medido" de "medido, deu zero" — são contagens. `assistantMessages` migra para `[]`, não
      `null`, porque o **tipo** já era `readonly string[]` antes desta tarefa: "nenhuma mensagem
      encontrada" sempre foi `[]`, medido ou não, e dar `null` ao campo exigiria mudar o tipo de
      `SessionFacts` para acomodar uma distinção que ele nunca precisou fazer. Segui a letra da
      tarefa (`[] é o valor honesto`) em vez do precedente de D-032 — os dois casos parecem iguais
      e não são.

      **Migração testada em dois níveis, como o aceite pede:**
      1. `tests/integration/storage/handoff.test.ts`, novo describe "S4-T3c migration from
         schemaVersion 2" — documento v2 **bruto** (JSON escrito à mão, nunca via
         `serializeHandoff`) sem a chave `assistantMessages` é lido sem erro, como `[]`;
         `filesOutsideRepository`/`reposNotVisited` já migrados de D-032 continuam corretos depois
         do passo v2→v3; `listHandoffs` migra transparentemente; ler duas vezes não reescreve o
         arquivo. Mais um teste no describe de D-032 provando que um documento v1 encadeia as duas
         migrações (1→2→3) e chega em `assistantMessages: []`. E o teste antigo que provava a
         **exclusão** de Q-036 foi invertido: agora prova que um handoff com texto real do
         assistente é **persistido** e volta idêntico (round-trip).
      2. **Verificação manual contra os handoffs reais do mantenedor**, pedida explicitamente no
         despacho (mesma disciplina da D-032): script só-leitura com o `StorageAdapter` do build
         novo contra `~/.seeya/days/` desta máquina. **Medido:** 8 diretórios de dia (incluindo
         três backups de `2026-09-02` e um de `2026-09-05`), 12 handoffs, mistura real de
         `schemaVersion` 1 (8 arquivos) e 2 (4 arquivos). Todos os 12 leram sem erro, zero
         rejeitados, todos com `assistantMessages: []` (nenhum foi capturado com o código novo,
         então nenhum tinha o campo — `[]` é o valor certo para os 12). Os campos de D-032
         continuaram corretos (inclusive um `filesOutsideRepository: 14` real). Conferido por
         `grep` depois que os 12 arquivos em disco **não mudaram** de `schemaVersion` — a leitura
         não reescreve nada. Detalhe completo e a diferença de padrão registrados na Q-055.

      `npm run verificar` e `npm run verificar:linux` verdes (medidos nesta máquina, o segundo via
      Docker Desktop). Cobertura: `core/` 100%, `adapters/storage` 97,92% statements/90,29%
      branches/98,03% funções/98,42% linhas — acima do piso de 80% do diretório.

- [x] **S4-T3d — Quatro números para a config (D-035) e o agendamento vencido (D-036).**
      Saída da varredura de questões com o mantenedor, em 2026-09-05.

      **Parte 1 — D-035.** Quatro números viram chave de `config.json`, **com o valor atual como
      default**, então nada muda de comportamento:

      | de | default | por quê é preferência, não fato técnico |
      |---|---|---|
      | `MAX_GIT_ROOTS_TO_VISIT` | 8 | depende do arranjo de pastas da pessoa |
      | limite de retentativa de captura | 3 | depende do quanto ela topa gastar |
      | `MAX_BRIEFING_SCAN_DAYS` | 30 | quem volta de um mês fora quer mais |
      | limiar de disparo obsoleto | 5 min | quanta obsolescência ela tolera (D-036) |

      **Leia a D-035 antes de escolher os nomes** — ela tem o critério, e a lista do que
      **continua constante** e por quê. Não mova nada além destes quatro.

      **Parte 2 — D-036, e é mudança de comportamento.** Emenda a `docs/ESPECIFICACAO.md`, que
      mandava o encerramento acontecer ao acordar "com aviso de que houve atraso". Passa a ser:

      1. **Dia local diferente → não dispara, nunca.** Notifica que o encerramento daquele dia
         não aconteceu e precisa ser feito à mão.
      2. **Mesmo dia, atrasado além do limiar → captura, mas NÃO encerra.** Aviso diz que rodou
         atrasado e que a terminação foi pulada.
      3. **Mesmo dia, dentro do limiar → normal.**

      **Por que a assimetria:** capturar tarde é quase inofensivo — a captura fotografa as sessões
      como estão. **Encerrar tarde pode destruir trabalho:** com `canTerminate: true`, uma máquina
      que acorda às 8h faria um agendamento de ontem **matar as sessões abertas hoje**.

      *O `core/schedule.ts` não muda:* ele continua devolvendo `delayMs` cru e **não** escolhe
      limiar (Q-037 item 3). Quem decide é o daemon, agora lendo a config.

      *Aceite:* dia virado **não** dispara e notifica; mesmo dia atrasado captura e **não**
      encerra, mesmo com `canTerminate: true`; dentro do limiar tudo normal. **Os três com
      teste** — o segundo é o que protege trabalho de quem deixa a máquina suspender.

      *Cuidado:* `docs/ESPECIFICACAO.md` é documento de autoridade. **Atualize o texto dela**
      apontando para a D-036, em vez de deixar a spec contradizendo o código.

      **Implementado em 2026-09-06.** Os quatro números viraram campos de `Config`
      (`core/types.ts`), opcionais em `configFileSchema` e com o valor atual como default em
      `CONFIG_DEFAULTS` (`adapters/storage/config-schema.ts`): `maxGitRootsToVisit` (8),
      `maxCaptureAttemptsPerSessionPerDay` (3), `maxBriefingScanDays` (30) e
      `overdueFireThresholdMinutes` (5). As constantes antigas (`MAX_GIT_ROOTS_TO_VISIT`,
      `MAX_CAPTURE_ATTEMPTS_PER_SESSION_PER_DAY`, `MAX_BRIEFING_SCAN_DAYS`) continuam existindo,
      agora documentadas como "o default que a config espelha" — `core/` não pode importar
      `adapters/storage/config-schema.ts` (matriz de camadas), então cada uma pina o mesmo literal
      de novo, o mesmo padrão que `POLL_INTERVAL_MS` já usava em `scheduler/`.

      **Threading até o uso real.** `GitReader.readEvidenceAcrossRepos` (`core/ports.ts`) ganhou
      `maxRootsToVisit?: number`; `application/evidence-gathering.ts#gatherEvidence` repassa
      `config.maxGitRootsToVisit`, chamado por `application/capture-session.ts` (usado tanto por
      `seeya end-day` quanto pelo daemon). `scheduler/capture-filter.ts#buildRetryFilter` e
      `core/capture-retry.ts#sessionsExhaustedToday` ganharam `maxAttempts` opcional, alimentado
      por `config.maxCaptureAttemptsPerSessionPerDay` em `scheduler/poll.ts`.
      `application/find-pending-briefing.ts#findPendingBriefing` já aceitava `maxScanDays` desde a
      S3-T3 — só precisou de um chamador real: `cli/composition.ts#buildStartDayContext` **passou
      a ler `config.json`**, coisa que evitava de propósito antes (comentário antigo removido,
      motivo em Q-054 item 3).

      **D-036, as três regras, em `scheduler/poll.ts`.** Caso 1 (dia virado):
      `pollOnce` compara `estado.json` (`stored.day`) com o dia local de `now` **antes** de chamar
      `decideSchedule` — `core/schedule.ts#resetIfNewDay` foi **exportado** (não alterado de
      contrato) para o daemon reaproveitar a mesma comparação em vez de duplicá-la. Se o dia virou
      e o fechamento de ontem nunca disparou (`!endOfDayFired`) nem foi pulado (`!skipped`) com
      `endOfDayTime` ligado, notifica **uma vez** (`scheduler/notices.ts#buildMissedEndOfDayNotice`)
      e grava o estado resetado imediatamente — é essa gravação que move `stored.day` para hoje e
      impede o mesmo aviso de repetir a cada poll de 30s enquanto a pessoa não interage (o mesmo
      padrão "avisa uma vez" que `core/daemon-health.ts`/S4-T3b já tinha estabelecido, reaproveitado
      como o brief pediu). Casos 2/3 (mesmo dia): `runEndOfDay` compara o `delayMs` cru que
      `core/schedule.ts` já devolvia (Q-037 item 3, contrato **não** alterado) contra
      `config.overdueFireThresholdMinutes`; se vencido, chama `endDay` com o novo
      `EndDayOptions.skipTermination: true` (`application/types.ts`), que
      `application/capture-session.ts#captureSession` transforma em
      `policy.canTerminate && !skipTermination` — o handoff é gravado e verificado normalmente
      (D-002 continua valendo), só a terminação é pulada. Dentro do limiar, `skipTermination` é
      `false` e o comportamento é idêntico ao de antes desta tarefa.

      **O teste que protege trabalho real** (`tests/unit/scheduler/poll.test.ts`, describe "D-036
      case 2/3"): uma sessão com `canTerminate: true` e um `ProcessControl.terminateGracefully` que
      **lança exceção se for chamado** (prova mais forte que um contador — se a terminação fosse
      tentada, `pollOnce` teria rejeitado e o teste teria falhado); poll 15 minutos depois do
      `endOfDayTime` configurado, sessão capturada com sucesso (handoff existe em disco), aviso
      diz "delayed"/"no session was terminated", e a promessa `pollOnce(...)` resolve sem lançar —
      prova que `terminateGracefully` nunca foi invocado. Um segundo teste espelha o mesmo cenário
      **dentro** do limiar (5s de atraso) com um `ProcessControl` real que registra a chamada, e
      confirma que a terminação ACONTECE normalmente — sem o par positivo, o primeiro teste só
      provaria "meu guarda reprova", não "meu guarda reprova o caso certo" (AGENTS.md: "teste o
      caso permitido, não só o proibido").

      **O caso 1 também tem os dois lados testados:** dia virado com fechamento nunca disparado
      notifica uma vez e não repete num segundo poll no mesmo dia; dia virado com fechamento **já
      disparado**, ou explicitamente **pulado** (`skip-today`), ou com `endOfDayTime: null`
      (agendamento desligado) — nenhum desses notifica, provando que o aviso não é automático só
      porque o dia mudou.

      **Seis escolhas sem resposta literal no despacho da tarefa, registradas em Q-054** — os
      quatro nomes (em especial `overdueFireThresholdMinutes`, escolhido para nomear o FATO, não a
      consequência), o acoplamento (deliberado, sob o default) entre este limiar e a janela de
      retentativa de turno ativo (as duas usam 5 minutos por construção, não coincidência — mesma
      lógica que a Q-049 item 5 já tinha adotado para a versão só-texto deste número), a leitura
      nova de `config.json` em `seeya start-day`, o uso da config ATUAL (não a de ontem) para
      decidir se um dia perdido merece aviso, a redação do aviso do dia perdido (não promete refazer
      o fechamento — não existe `--day` no `seeya end-day`), e `docs/ARQUITETURA.md` § "Config" não
      atualizado com os quatro campos (mesmo gap já existente para `forkCleanupDays`).

      **Migração testada:** `tests/integration/storage/read-config.test.ts` escreve um
      `config.json` no formato EXATO de antes desta tarefa (sem as quatro chaves novas) e confirma
      que a leitura devolve os quatro defaults em vez de rejeitar o arquivo; um segundo teste
      confirma que um `config.json` com as quatro chaves presentes honra cada uma.

      Cobertura, `npm run cobertura` (Windows, esta máquina): geral 97,87%/93,50%/98,51%/98,04%
      (statements/branches/functions/lines); dentro do container Linux
      (`npm run verificar:linux`, `node:22-bookworm`): 97,92%/93,67%/98,64%/98,04% — as duas acima
      dos mínimos do `AGENTS.md`. `core/` 100% em statements/functions/lines nas duas máquinas,
      99,06% branches (`briefing.ts`, não tocado por esta tarefa, é a única linha de branch
      faltante ali). `scheduler/` 98,29%/100%/93,1%/100%
      (`poll.ts`/`capture-filter.ts`/`notices.ts` 100% nas quatro métricas; o único gap de funções
      em `scheduler/` é `loop.ts`, não tocado por esta tarefa). `npm run verificar` e
      `npm run verificar:linux` verdes, códigos de saída lidos separadamente do comando, nunca
      encadeados com commit.

- [x] **S4-T4 — `seeya snooze`, `seeya skip-today`, `seeya config`.**
      `docs/ESPECIFICACAO.md` § "seeya snooze..."/"seeya config" (D-006, D-027, D-035).

      **`snooze`/`skip-today` construíram zero regra nova** — tudo já existia em `core/schedule.ts`
      desde a S4-T2 (`applySnooze`/`applySkipToday`/`resetIfNewDay`). `src/cli/snooze-command.ts`
      só resolve `today` pelo `Clock` injetado (D-019), lê/grava `Storage.readState`/`saveState`, e
      renderiza a confirmação re-chamando `decideSchedule` **só de leitura** (o `nextState` dessa
      segunda chamada nunca é persistido) — a mensagem nunca inventa uma segunda interpretação do
      estado, ela pergunta à mesma função que o daemon vai perguntar no próximo poll.
      `+15m`/`+30m`/`+1h` é o único enum aceito, igual ao texto que
      `scheduler/notices.ts#buildLeadTimeNotice` já sugeria.

      **`seeya config`** tem três sub-ações: `get [key]` / `set <key> <value>` (toda chave escalar
      de `Config` — horário, antecedências, modelo, todos os limites incluindo os quatro da D-035)
      e `policy <cwd> [--can-terminate <bool>] [--deep-capture <bool>]` (a única categoria indexada
      por `cwd`, não escalar). A spec nomeia categorias, não subcomandos literais — desenho
      registrado em `docs/QUESTOES.md` Q-056. Validação em `adapters/storage/config-schema.ts`
      reaproveita o `configFileSchema` já existente campo a campo
      (`configFileSchema.shape[key].safeParse(...)`), nunca uma cópia da regra: mudar o regex de
      `endOfDayTime` num lugar já muda o outro. `Storage` ganhou `saveConfig` (D-027: `config.json`
      era só-leitura em produção desde a S1-T5 — esta é a primeira escrita real).

      **A chave e o valor são validados ANTES de escrever (D-027).** Chave inexistente ou valor que
      o schema recusaria nunca chega a `writeFileAtomic` — provado por teste: um `set` inválido
      nunca cria `config.json` do zero nem sobrescreve um já existente.

      **Adiar acumula, pular depois de adiar mantém o adiamento gravado, e a virada de meia-noite
      zera tudo menos `daemonHealth`** — os cinco casos obrigatórios de `docs/TESTES.md`, cada um
      com teste próprio em `tests/unit/cli/snooze-command.test.ts`, mais o espelho em
      `tests/integration/cli/snooze-command.test.ts` contra um `StorageAdapter` real: uma escrita
      por uma instância e uma leitura por uma instância **completamente nova**, sem estado
      compartilhado nenhum — a prova de "funciona com ou sem o daemon rodando" que a spec pede.

      **A corrida de escrita concorrente foi medida, não suposta.** `adapters/storage/atomic-write.ts`
      já registrava que não havia, até esta tarefa, um segundo escritor/leitor concorrente de
      `config.json` para justificar medir — e que `estado.json` ganharia o mesmo problema quando
      `seeya snooze` chegasse. Dois testes de integração
      (`tests/integration/storage/state-concurrent-write.test.ts`,
      `config-concurrent-write.test.ts`) martelam 300 iterações de leitura/escrita concorrentes via
      `StorageAdapter` real. **Medido nesta máquina (Windows): ~18-20% das escritas colidem com
      `EPERM`** (o risco que `atomic-write.ts` já documentava, nunca um modo de falha novo);
      **0/300 leituras, em seis execuções, viram documento corrompido** — a garantia "nunca
      parcial" do `writeFileAtomic` se sustentou sob carga real. Não implementei retry nem lock —
      o despacho da tarefa pediu explicitamente para não inventar travamento; a escolha e as
      opções ficam registradas em Q-056 para o mantenedor decidir.

      **Não tocado, fora do escopo dos três comandos:** `seeya status` continua sem mostrar
      `skipped`/`snoozeMinutesTotal`/daemon rodando (a Q-015 já esperava isso até S4-T3/S4-T4
      existirem — ambas prontas agora, mas mexer em `status-command.ts` não foi pedido por esta
      tarefa; registrado em Q-056 para o mantenedor abrir como tarefa própria se quiser).

      **Cobertura, medida nesta máquina:** agregado 97,53%/93,13%/98,58%/97,67%
      (statements/branches/functions/lines) — acima dos mínimos do `AGENTS.md`. `core/` 100%
      statements/functions/lines, 99,06% branches (não tocado por esta tarefa).
      `adapters/storage/` 94,93%/88,55%/98,38%/95,31%; `cli/` 97,39%/96,03%/97,43%/97,33% — os dois
      arquivos novos (`snooze-command.ts`, `config-command.ts`) e o `config-schema.ts` estendido
      todos acima de 80%. `npm run verificar` e `npm run verificar:linux` verdes, códigos de saída
      lidos separadamente do comando, nunca encadeados com commit.
- [x] **S4-T4b — Escrita concorrente não pode virar stack trace no `snooze`.** Saída da medição
      da S4-T4, em 2026-09-06.

      **Medido**, 300 iterações concorrentes de leitura/escrita, 3 execuções cada:

      ```
      ~18-20%  das ESCRITAS rejeitadas com EPERM no rename (Windows)
        0/300  das LEITURAS viram documento corrompido — em nenhuma das 6 execuções
      ```

      **A garantia do rename atômico segura inteira** — nenhum leitor vê arquivo partido, e o
      `atomic-write.ts` já documentava esse risco desde a S1-T5, sem ninguém poder medir porque
      não havia escritor. Quem perde é a **promessa do escritor**.

      **O problema:** ninguém captura essa rejeição. Um `seeya snooze` no instante infeliz falha
      com **stack trace e código 1** — embora o arquivo em disco permaneça válido.

      **E o motivo de não esperar relato de usuário, que os números escondem: a colisão não é
      uniformemente distribuída.** O daemon escreve a cada 30 segundos, e o `snooze` é justamente
      o comando que se roda **no momento do encerramento** — o instante em que o daemon está mais
      ativo. O relato seria *"o snooze quebrou às 19h30, quando eu precisava dele"*.

      *Escopo:* retentativa **limitada** dentro do `atomic-write.ts`, que conserta os dois
      escritores de uma vez (o comando e o daemon), **mais** mensagem legível quando a
      retentativa esgota — nunca stack trace para o usuário (AGENTS.md § "Mensagens de erro").

      *Cuidados:*
      **(a)** retentativa **limitada**, não infinita — problema real de permissão (antivírus
      segurando o arquivo, por exemplo) precisa continuar aparecendo, não virar travamento;
      **(b)** `atomic-write.ts` é adapter, então dormir ali é permitido — o **D-019 proíbe ler o
      relógio**, não esperar. Mas se você precisar de `Clock`, diga em vez de improvisar;
      **(c)** a medição existente (`state-concurrent-write.test.ts`,
      `config-concurrent-write.test.ts`) é o seu instrumento — **rode antes e depois** e mostre os
      dois números.

      *Aceite:* a taxa de escrita rejeitada **cai de forma medida**, e o que restar sai como
      mensagem, não como stack trace. **A garantia de leitura não pode regredir**: 0 documento
      corrompido continua sendo 0.

      **Implementado:** retentativa limitada dentro de `writeFileAtomic`
      (`adapters/storage/atomic-write.ts`), só no passo de `rename` e só para `EPERM` (o único
      código já observado nas duas medições). Entre tentativas, um turno do event loop
      (`setImmediate`) — não `Clock`/`setTimeout` — porque a corrida é de ordenação do event loop
      (o leitor concorrente precisa terminar `open`+`read`+`close`), não de tempo relógio; ver
      Q-058 para a análise completa de por que `Clock` injetado teria custo desproporcional aqui
      (~100 call sites de `StorageAdapter` em teste). `MAX_RENAME_ATTEMPTS = 8`, escolhido testando
      1/5/8/10 tentativas com o mesmo instrumento até o ponto de retorno decrescente. Ao esgotar as
      tentativas, a mensagem nomeia o arquivo e diz que ele continua travado, com o erro original
      em `.cause` — nunca mais o texto cru do Node. Como o fix mora dentro de `writeFileAtomic`,
      conserta os dois escritores (`seeya snooze`/`config` e o daemon) sem tocar
      `snooze-command.ts`, `config-command.ts` nem `scheduler/`.

      **Medido nesta máquina (Windows), 300 iterações/3 execuções, mesmo instrumento antes e
      depois:**

      ```
      estado.json  antes: 60/300, 64/300, 56/300 (~19-21%)   depois: 3/300, 5/300, 1/300 (~0.3-1.7%)
      config.json  antes: 63/300, 63/300, 55/300 (~18-21%)   depois: 7/300, 1/300, 1/300 (~0.3-2.3%)
      leituras     antes: 0/300 corrompidas (todas as execuções)   depois: 0/300 (todas as execuções)
      ```

      A garantia de leitura não regrediu (0 continua 0), e a taxa de escrita rejeitada caiu cerca
      de 10-60× dependendo da execução — sem eliminá-la por completo, o que é esperado: um leitor
      ainda pode, em tese, vencer as 8 tentativas seguidas.

      **Cobertura, medida nesta máquina:** agregado 97,5%/93,02%/98,58%/97,64%
      (statements/branches/functions/lines). `core/` 100% statements/functions/lines, 99,06%
      branches (não tocado por esta tarefa). `adapters/storage/` 94,86%/88,06%/98,48%/95,2%,
      `atomic-write.ts` 92,59%/83,33%/80%/96% — acima do mínimo de 80% do `AGENTS.md` para fora de
      `core/`. `npm run verificar` e `npm run verificar:linux` verdes, códigos de saída lidos
      separadamente, nunca encadeados com commit.

      Q-058 registra a tensão entre o despacho ("dormir ali é permitido... se precisar de `Clock`,
      diga") e o guard de lint (`no-restricted-globals` bane `setTimeout`/`setInterval` em todo
      `src/**` fora de `adapters/clock/`, sem exceção por intenção), e por que a solução escolhida
      foi `setImmediate` sem `Clock` em vez de expandir a assinatura de `StorageAdapter`.

- [x] **S4-T5 — `seeya daemon --stop/--status`.** Fecha o Sprint 4.
      *Aceite do sprint:* e2e 6, 7 e 8 passam. Um dia inteiro de uso real sem intervenção.

      **Implementado em 2026-09-06.** `src/cli/daemon-command.ts` ganhou `runDaemonStatus` e
      `runDaemonStop`, ambos sobre um único `checkLiveLock` que lê `daemon.lock` e desempata
      liveness com o `procStart` que a S4-T3b já construiu (`ProcessControl.isAlive(pid,
      procStart)`) — os dois comandos nunca podem discordar sobre qual dos quatro estados (D-024)
      estão vendo, porque leem exatamente a mesma decisão.

      **Os quatro estados, nunca achatados.** `LiveLockCheck` é uma união discriminada:
      `noLock` (nunca subiu, ou já saiu limpo), `dead` (lock existe, PID confirmado morto pelo
      desempate — "não rodando", mas com texto diferente de `noLock` para um crash não parecer algo
      "atualmente errado"), `alive` (lock existe, PID confirmado vivo), e `unknown` (a própria
      checagem de liveness **lançou** — `adapters/process/liveness.ts#interpretExistenceCheckError`
      se recusa a adivinhar um código de erro desconhecido, e nem `--status` nem `--stop` fingem
      saber "rodando" ou "não rodando" nesse caso, D-025). `--status` mostra, junto: `DayState.
      daemonHealth` (o ponto inteiro da S4-T3b — reaproveita `buildDaemonUnhealthyNotice` para o
      texto/estimativa de minutos, nunca recalculando a aritmética uma segunda vez, e destensa a
      frase — presente quando o daemon está vivo, passado quando não está, "status atual
      desconhecido" no caso `unknown` — para nunca afirmar "ainda falhando" sobre um processo que já
      não existe), e o estado de agenda de hoje via `decideSchedule` (nunca uma releitura própria de
      `skipped`/`endOfDayFired`, mesma disciplina que `cli/snooze-command.ts#renderSnoozeConfirmation`
      já usa — o texto não pode discordar do que o próximo poll real faria). `--status` é read-only:
      nunca escreve `daemon.lock` nem `estado.json`, nem quando encontra lock obsoleto.

      **A premissa do brief ("SIGTERM entre processos no Windows não roda o handler JS") já estava
      medida, não precisou de medição nova.** `tests/integration/process/daemon-launch.test.ts`
      (S4-T3) já documentava isso no próprio comentário, ao explicar por que
      `termination-windows.ts` existe. Conferido de novo aqui só para ter certeza de que a leitura
      não mudou.

      **Por que o Windows é necessariamente abrupto, e o texto do `--stop` diz isso em vez de
      fingir simetria.** Duas medições, nenhuma nova: (1) o Spike G mediu que `AttachConsole` falha
      com erro 6 contra um processo sem console — e o daemon sobe exatamente assim, de propósito
      (D-005, `DETACHED_PROCESS`), então `CTRL_BREAK_EVENT` nunca alcança o worker. (2) a S4-T3b
      mediu que `process.kill(pid, 'SIGTERM')` entre processos no Windows chama `TerminateProcess`
      na hora, sem rodar handler nenhum. As duas medições juntas fecham a pergunta: não existe
      **nenhum** caminho gracioso para o daemon no Windows, nem o que já existia
      (`terminateGracefully`) nem um `SIGTERM` cru. `runDaemonStop` no Windows pula direto para o
      abrupto e diz por quê na própria mensagem, em vez de tentar `terminateGracefully` primeiro só
      para observar o "no-console" de sempre.

      **Novo primitivo, deliberadamente fora de `ProcessControl`:**
      `adapters/process/termination.ts#terminateAbruptly(pid)` — `SIGKILL`/`TerminateProcess`
      incondicional, tolerando `ESRCH` (já morto), relançando qualquer outro erro. **Nunca** usado
      em sessão descoberta (D-002 seguiria proibindo kill forçado ali); existe só para o `seeya`
      encerrar o próprio daemon. Não entrou na porta `ProcessControl` porque nenhum chamador em
      `scheduler/`/`application/` precisa dele — só `cli/daemon-command.ts`, que já importa função
      de adapter diretamente noutros pontos (`spawnDetachedDaemon`, `captureObservedProcStart`),
      então isto segue o mesmo precedente em vez de inchar um contrato cruzado por uma única chamada.

      **Quem limpa o lock — respondendo à pergunta do brief.** `runDaemonStop` **sempre** confirma a
      morte primeiro e **sempre** limpa o lock depois, em qualquer caminho (grácil, abrupto, ou lock
      já obsoleto) — nunca confia só no próprio `clearDaemonLock()` do daemon ao sair
      (`scheduler/loop.ts`), porque essa confiança já provou ser furada no Windows (não há saída
      graciosa) e não é garantida nem no POSIX (o processo pode cair entre o sinal e a própria
      escrita de limpeza). O `clearDaemonLock()` do daemon continua existindo como segunda linha de
      defesa para um `--stop` que ele **não** disparou (um `kill -TERM` de fora, por exemplo) — as
      duas coisas convivem, mas `--stop` nunca depende da segunda. A limpeza só acontece com
      **evidência positiva** de morte (D-025): se o `SIGKILL` não pôde nem ser enviado (erro de
      permissão) ou o PID ainda aparece vivo depois de reconferido, o lock fica como está e a
      mensagem manda checar à mão — soltar um lock cujo PID pode continuar vivo arrisca dois daemons
      simultâneos, o defeito que o resto do D-005 existe para evitar.

      **Achado ao construir, corrigido no mesmo commit: `scheduler/loop.ts` só notava um `--stop`
      depois de até 30s dormindo.** `runDaemon`'s laço só checava `shouldStop` antes/depois de cada
      poll e de UM sleep de `POLL_INTERVAL_MS` inteiro — um `SIGTERM` real chegando logo no início
      da soneca ficava sem efeito prático por quase 30s. `sleepUntilNextPollOrStop` (novo,
      `scheduler/loop.ts`) fatia a mesma espera em pedaços de 1s, checando `shouldStop` entre eles —
      o tempo total dormido não muda (ainda `POLL_INTERVAL_MS` quando ninguém pede parada), só a
      **reação** a um pedido de parada, que cai de "até 30s" para "cerca de 1s". Medido pelo próprio
      e2e novo (item 8, abaixo): a jornada inteira — dois daemons reais, `--status`, `--stop`,
      terceiro daemon — roda em ~2-3s, não nos 30s+ que o `GRACEFUL_STOP_DEADLINE_MS` sozinho
      pediria sem essa mudança. Sem essa correção, `--stop` continuaria correto, só lento; com ela,
      fica rápido no caso comum e ainda correto no raro.

      **Números escolhidos sem base na spec, registrados em Q-057:**
      `GRACEFUL_STOP_DEADLINE_MS` (15s) e `ABRUPT_STOP_CONFIRM_MS` (2s).

      **Testes.** Unidade (`tests/unit/cli/daemon-command.test.ts`): os quatro estados de
      `--status` (incluindo a checagem que lança), a diferença de tempo verbal saudável/vivo vs.
      obsoleto/desconhecido na saúde, a nota de agenda (desabilitado, pulado, com adiamento
      acumulado), e os ramos de `--stop` que não tocam processo real (sem lock, lock obsoleto —
      limpo —, checagem que lança — lock intocado). Integração
      (`tests/integration/process/termination.test.ts`): `terminateAbruptly` contra um processo
      real — mata sem rodar o handler grácil (a prova de que é abrupto), e tolera PID já morto;
      medido que a confirmação de morte **precisa** de uma espera curta (o Linux do CI mostrou
      `isAlive` ainda `true` no instante seguinte ao `SIGKILL`, sob carga — corrigido com o mesmo
      padrão de espera-e-reconfere que `waitForExit`/`waitForExitWindows` já usam). Integração
      (`tests/integration/cli/daemon-command.test.ts`): `runDaemonStop`/`runDaemonStatus` contra
      processo real e `ProcessControl` real — parada graciosa POSIX de verdade (marcador escrito,
      handler rodou), parada abrupta com plataforma forçada para `'win32'` **em qualquer host**
      (prova a seleção do ramo — nunca tenta gracioso no Windows — de forma portátil; a chamada de
      SO por baixo, `SIGKILL` vs. `TerminateProcess`, difere por host, mas a alegação sob teste —
      "abrupto, handler nunca roda, morte confirmada, lock limpo" — vale para as duas, e é isso que
      o teste prova), lock obsoleto limpo. E2e novo (`tests/e2e/daemon.test.ts`, item 8): segunda
      instância recusa; `--status` vê o mesmo lock real, vivo e depois morto; `--stop` sem forçar
      plataforma (o único teste do repositório que exercita o despacho real, não forçado); terceira
      instância sobe limpa — a prova direta do aceite "o lock não fica para trás".

      **Itens 6 e 7 do e2e continuam sem teste, e não é descuido — o motivo já registrado pela
      S4-T3/S4-T4 não mudou.** Item 6 precisa de um ponto de injeção de relógio no binário
      compilado, que não existe (`cli/index.ts` sempre monta `systemClock` real) — construir isso
      agora seria escopo além desta tarefa, e sem ele o teste exigiria minutos de relógio real por
      execução. Item 7 foi deixado agrupado com 6 e 8 de propósito pela S4-T3/S4-T4, para nascerem
      juntos como uma jornada "dia inteiro" coerente quando o 6 deixasse de estar bloqueado — isso
      não mudou aqui. Entregue o que ficou novo e possível: o item 8, agora provado ponta a ponta
      **com** `--stop`/`--status`, não uma peça isolada.

      **Cobertura:** medida via `npm run cobertura` (Windows) e dentro do container Linux
      (`npm run verificar:linux`) — `core/` 100% nas duas máquinas; `scheduler/` 98,4%
      statements/100% branches/93,33% funções/100% linhas (o único gap de função é `loop.ts`'s
      `sleepUntilNextPollOrStop` sendo uma função só, contada uma vez, sem nada a mais para cobrir);
      `adapters/process/` 91,61%/81,33%/93,02%/92,56% no Windows e 89,71%/81,35%/92,85%/90,38% no
      Linux — as duas acima do piso de 80% do `AGENTS.md` (precisou de um teste novo,
      `tests/unit/adapters/process/termination.test.ts`, mockando `process.kill` para exercitar o
      ramo de erro não-`ESRCH` de `terminateAbruptly`, que nenhum teste com processo real cobre por
      construção); `cli/` 95,25%/93,93%/95,45%/95,68% no Windows e 95,43%/94,27%/95,45%/95,87% no
      Linux. `npm run verificar` e `npm run verificar:linux` verdes, códigos de saída lidos
      separadamente do comando, nunca encadeados com commit — o segundo confirmado explicitamente
      por `; echo "EXITCODE=$?"` numa chamada própria, porque o texto final de resumo do `vitest`
      não sobreviveu à captura de saída do Docker neste ambiente (achado registrado, não um
      vermelho: a contagem de testes e a tabela de cobertura por diretório chegaram inteiras, só o
      bloco de resumo final some — o código de saída é a fonte de verdade de qualquer forma).

      Sete escolhas sem resposta literal no despacho da tarefa registradas em **Q-057**.

---

- [x] **S4-T6 — O daemon abre janelas de terminal na cara do usuário.** Saída do **primeiro
      ensaio real** (2026-09-06): daemon no ar, encerramento agendado para 14:30, sessões vivas de
      verdade. Disparou na hora, capturou as duas sessões e escreveu o `summary.md` — e revelou
      três defeitos que nenhum teste tinha como pegar.

      **Parte 1 — as janelas (o defeito grave).** O daemon roda **sem console** (D-005), e no
      Windows um programa de console lançado por quem não tem console **ganha uma janela nova**.
      Medido pelo mantenedor em uso real: a cada ciclo de 30s, uma janela **por sessão viva**
      (`adapters/process/proc-start.ts` chama `powershell.exe` via
      `adapters/process/spawn-stdout.ts` para cada `isAlive` com `procStart`), e **uma rajada no
      instante do encerramento** — um `claude` por sessão (`adapters/generation/spawn-claude.ts`) e
      um `git` por repositório (`adapters/git/run-git.ts`). A janela do modelo **fica visível pelo
      tempo inteiro da resposta** (~1 min no ensaio). Cada uma **rouba o foco do teclado e corta o
      que a pessoa está digitando**.

      Nunca apareceu em teste porque, rodando pelo terminal, o filho herda o console existente e
      não abre janela nenhuma. **Só o daemon sofre** — e o daemon é o modo normal de uso.

      `adapters/process/console-signal.ts` **já passa `windowsHide: true`** nos seus dois `spawn`;
      os outros quatro não. Nenhum dos quatro usa `detached`, então a opção se aplica limpa.

      *Aceite:* nenhuma janela aparece durante um ciclo de laço **nem durante um encerramento
      completo**, verificado com o daemon de verdade no Windows — não só com teste. O que os
      `spawn` devolvem (stdout, código de saída) não pode mudar.

      **Parte 2 — o aviso mente o tempo que falta.** `scheduler/notices.ts#buildLeadTimeNotice`
      escreve `closing in ${leadTimeMinutes} min`, que é o **nome da regra**, não o tempo restante.
      Medido: às 14:08, com encerramento às 14:30, o toast disse "closing in 30 min" — faltavam 22.
      Em operação normal os dois batem (o laço dispara dentro de 30s da marca); descola quando o
      daemon **sobe atrasado**, que é justamente quando a pessoa mais precisa do número certo. É a
      D-025 aplicada ao texto: dizer o que se sabe, não o rótulo mais próximo.

      *Aceite:* o texto informa o tempo real que falta, derivado de `effectiveEndOfDay` e do
      `Clock` (D-019), e a marca que disparou continua sendo registrada como disparada.

      **Parte 3 — `schemaVersion` não é chave desconhecida.** `seeya config get schemaVersion`
      responde `unknown config key "schemaVersion"`. Ela existe, é obrigatória, e é conferida em
      toda leitura — só não é editável. Chamar de desconhecida o que o próprio programa exige é
      afirmar o contrário do que se sabe.

      *Aceite:* a resposta distingue **chave inexistente** de **chave não editável**, e a segunda
      diz onde ela é usada. Vale para `get` e para `set`.

      **Implementado em 2026-09-06.** As três partes, separadas.

      **Parte 1 — `windowsHide: true` nos quatro `spawn` que faltavam.**
      `adapters/generation/spawn-claude.ts#spawnClaude`, `adapters/git/run-git.ts#runGit`,
      `adapters/process/spawn-stdout.ts#runForStdout` e
      `adapters/notification/backend.ts#spawnCommand` — exatamente os quatro que o texto desta
      entrada já apontava ("captura, evidência de git e notificação"). Não mexi nos outros três
      `spawn` sem a opção: `daemon-launch.ts#spawnDetachedDaemon` já usa `detached`+`stdio:'ignore'`
      (o próprio mecanismo do D-005 — não tem janela para esconder, o processo já nasce sem
      console); `termination-posix.ts` é POSIX-only por construção (S1-T12), `windowsHide` seria
      no-op sempre; `resumption/spawn-interactive.ts#runInteractive` usa `stdio: 'inherit'` de
      propósito (Spike H) — é o comando manual `seeya start-day`, com o console do usuário já
      presente, e esconder a janela ali esconderia a própria sessão interativa que o comando existe
      para abrir. Detalhe completo dos nove `spawn` e por que cada um ficou de um lado, em Q-059.

      **Não escrevi teste que aparenta provar esta parte — e essa ausência é a entrega, não uma
      lacuna (cuidado (a) do despacho).** O defeito só existe quando o processo pai não tem console
      (D-005); `vitest` sempre roda com console próprio, herdado pelo processo filho, então a MESMA
      suíte que teoricamente provaria "sem janela" não tem como reproduzir "com janela" para
      começo de conversa. Um `vi.mock('node:child_process')` provaria só que a chave está no objeto
      de opções, não que a janela some — e o projeto não usa `vi.mock` em lugar nenhum da suíte
      hoje (AGENTS.md: duplo é classe/objeto nomeado implementando a porta, não stub de módulo).
      Os testes de integração existentes contra processo real continuam verdes com a opção
      presente — provam que `stdout`/`stderr`/código de saída/erro não mudaram (cuidado (b)), não
      que a janela sumiu. Detalhe em `docs/TESTES.md`, entrada S4-T6.

      **MEDIDO PELO AGENTE: nenhuma regressão de contrato nos quatro `spawn`** — os testes de
      integração que já exercitavam processo real
      (`tests/integration/notification/spawn-command.test.ts`, `tests/integration/git/`,
      `tests/integration/generation/lean-generator.test.ts`,
      `tests/unit/adapters/process/proc-start.test.ts`) continuam verdes.
      **NÃO MEDIDO PELO AGENTE, e é o aceite real desta parte: nenhuma janela aparecendo com o
      daemon de verdade no Windows, durante um ciclo de laço e durante um encerramento completo.**
      Isto exige o mantenedor rodando o binário fora do terminal do agente — peço que ele confirme
      à mão antes de considerar esta parte fechada.

      **Parte 2 — o aviso agora reporta o tempo real, via `Clock`.**
      `core/schedule.ts#minutesRemaining(target, now)` — pura, dois `Date`, sem I/O — substitui o
      antigo "printa de volta o nome da regra configurada". `scheduler/poll.ts` calcula
      `minutesRemaining(decision.effectiveEndOfDay, now)` (o mesmo `now` já lido do `Clock`
      injetado, D-019) e passa o resultado para `buildLeadTimeNotice`, cuja assinatura mudou de
      `(leadTimeMinutes, day)` para `(minutesRemaining, day)`. **O que NÃO mudou (cuidado (e)):**
      `decideSchedule` continua decidindo QUANDO o aviso dispara e QUAL regra configurada disparou
      exatamente como antes; `firedLeadTimesInMinutes` continua gravando o valor configurado
      (`30`/`15`), nunca o tempo real. Só a frase mudou.

      Achado ao construir, registrado em Q-059 item 4 em vez de decidido: num atraso grande o
      bastante, a regra "de 30 min" pode disparar com menos tempo real do que a regra "de 15 min"
      teria dado se checada a tempo — a pessoa recebe o número certo agora, mas ainda associado ao
      nome da regra que dispara primeiro em ordem decrescente, não à mais próxima da realidade.
      Mudar essa ordem seria mudar o gatilho, o que o despacho pediu para eu não decidir sozinho.

      **Testes:** `tests/unit/core/schedule.test.ts` (`minutesRemaining`, incluindo o caso exato
      medido no ensaio real — 30 min configurados às 14:08, fim às 14:30, 22 min reais);
      `tests/unit/scheduler/notices.test.ts` (`buildLeadTimeNotice` renderiza o número recebido,
      singular/plural); `tests/unit/scheduler/poll.test.ts` — o teste que prova a composição e que
      **falha sem o conserto em `poll.ts`**: um poll às 19:10 com fim às 19:30 e
      `leadTimesInMinutes: [30, 15]` dispara a regra de 30 (é a próxima não disparada, em ordem
      decrescente) mas a notificação diz "20 min", nunca "30 min" — e `firedLeadTimesInMinutes`
      continua `[30]`.

      **Parte 3 — `schemaVersion` deixa de ser chamada de desconhecida.**
      `adapters/storage/config-schema.ts` ganhou `schemaVersionNotEditableMessage()`, função
      própria (não generalizei `unknownConfigKeyMessage` — `projectPolicy` continua no caminho
      antigo, fora do escopo desta tarefa). `cli/config-command.ts#runConfigGetCommand` responde
      `schemaVersion: 1` (o `CONFIG_SCHEMA_VERSION` do código, já que `schemaVersion` não é campo
      de `Config` — é removido antes de `configFileSchema` rodar, `resolveSchemaVersion`);
      `runConfigSetCommand` responde a mensagem nova, que nomeia a chave, diz que ela existe e é
      validada em toda leitura de `config.json` e de todo handoff, e nunca contém o texto que
      `unknownConfigKeyMessage` usa. Não a tornei editável (cuidado (f)). Testes:
      `tests/unit/adapters/storage/config-schema.test.ts`,
      `tests/unit/cli/config-command.test.ts` — nos dois sentidos (`get`/`set`), provando ausência
      do texto de "chave desconhecida".

      **Cobertura, medida separadamente nas duas máquinas** (`npm run cobertura` no Windows,
      `npm run verificar:linux` no container): 132 arquivos de teste, 1402 passaram + 3 pulados, as
      duas vezes. `core/` 100% nas duas; `scheduler/` 98,42% statements/100% branches/93,33%
      funções/100% linhas nas duas (idêntico — `loop.ts#sleepUntilNextPollOrStop`, função só,
      contada uma vez, é o único gap de função, já registrado na S4-T5); `adapters/storage/`
      94,88/88,06/98,5/95,21 no Windows e 93,7/86,93/95,52/94,02 no Linux; `cli/`
      95,28/94,01/95,45/95,71 no Windows e 95,47/94,35/95,45/95,9 no Linux — as duas acima do piso
      de 80%. `npm run verificar` e `npm run verificar:linux` verdes, códigos de saída lidos
      separadamente do comando (o container precisou de `; echo "EXITCODE=$?"` numa chamada à
      parte, mesma disciplina da S4-T5 — o processo rodou em segundo plano por passar de 120s, e o
      código de saída real foi conferido no arquivo de saída dedicado da própria ferramenta, não
      inferido do encadeamento).

      Cinco escolhas registradas em **Q-059**, nenhuma bloqueando o portão.

      **Verificado à mão pelo mantenedor em 2026-09-07, no Windows, com o daemon de verdade —
      a única prova que existe para a parte 1.** Ciclo de laço rodando desde ~09:06 e encerramento
      completo às 09:30 (~1 min de captura, `summary.md` escrito às 09:31): **nenhuma janela
      apareceu**, nem a piscada por sessão a cada 30s, nem a janela do modelo que antes ficava
      visível pelo tempo inteiro da resposta. A parte 2 tem evidência própria, também de uso real:
      às 09:06, com encerramento às 09:30, o toast disse `closing in 23 min` — no dia anterior, na
      mesma situação, teria dito `30 min`.

- [x] **S4-T7 — Notificação não pode virar ruído: histerese por tipo, e alertas precoces num
      aviso só.** Saída da **Q-059 item 4**, refinada pelo mantenedor em 2026-09-07.

      **Parte 1 — histerese por tipo de notificação.** Medido no uso real: o aviso prévio dispara
      **uma regra por volta do laço**, e as regras vencem por ordem, não por distância real ao fim
      do dia. Daemon subindo às 14:20 com encerramento às 14:30 e regras `[30, 15]` manda dois
      avisos com **30 segundos** de intervalo ("10 min" e depois "9 min").

      **A primeira proposta do PO — colapsar as regras vencidas — não cobria o caso, e o
      mantenedor achou o furo:** subindo às 14:14, a regra de 30 vence e dispara ("16 min"), e um
      minuto depois a regra de 15 dispara **legitimamente**, sem atraso nenhum. Colapsar vencidas
      não impede esse par. O que resolve os dois casos é medir **a distância entre avisos**, não o
      atraso da regra.

      **A regra:** um aviso não sai se **outro do mesmo tipo** saiu há menos de N minutos. O
      "mesmo tipo" é do mantenedor e é o que impede o efeito colateral grave: o resultado do
      encerramento ("2 sessions captured"), o aviso de encerramento perdido e os alertas precoces
      **nunca** podem ser calados por um aviso prévio recente — são classes diferentes, e o
      resultado é justamente o que não se pode perder.

      **Três definições, já decididas:** (a) o aviso engolido **não volta depois** — ele conta como
      dado e é marcado como disparado; entregar mais tarde só empurra o amontoado para frente, e o
      anterior já disse "vai encerrar logo" com o tempo real (S4-T6); (b) guardar **um carimbo de
      hora por tipo** no estado do dia, que já vai para o disco e já reseta na virada — **não** uma
      fila de entregas pendentes; (c) o número é **config com padrão de 3 minutos** (D-035:
      depende de quanto ruído a pessoa tolera, não de fato técnico).

      **Não mude quando as regras vencem.** `core/schedule.ts#decideSchedule` e
      `firedLeadTimesInMinutes` ficam como estão — isto decide se o aviso **sai**, não quando a
      regra vence.

      *Aceite:* daemon subindo atrasado manda **um** aviso, não dois; o primeiro aviso do dia nunca
      é engolido; e um encerramento que termina logo depois de um aviso prévio **continua
      notificando**.

      **Parte 2 — alertas precoces viram um aviso só.** `scheduler/poll.ts` hoje faz
      `for (const warning of warnings) notify(...)`: um toast por achado, em sequência, no mesmo
      ciclo. Histerese não serve aqui — calar alerta é **perder informação**. O certo é **juntar
      num aviso só**, dizendo quantos são e o suficiente para a pessoa agir, sem inventar o que não
      se sabe (D-025) e sem estourar o que o toast mostra.

      *Aceite:* N alertas no mesmo ciclo produzem **uma** notificação que declara os N; nenhum
      achado desaparece do texto sem estar contado.

      **Acréscimo à tarefa, aprovado pelo mantenedor em 2026-09-07, mesma área — Parte 3: prazo
      novo devolve os avisos daquele prazo.** `core/schedule.ts#findDueLeadTime` pula regras em
      `DayState.firedLeadTimesInMinutes`, que guardava só o número da regra, nunca o prazo a que
      ela se referia — um `snooze` ou uma mudança de `endOfDayTime` que move o prazo efetivo
      deixava a regra antiga marcada disparada para sempre, e a captura seguinte acontecia sem
      aviso nenhum. **A regra: "o aviso não é sobre a regra, é sobre o prazo. Prazo novo, aviso
      novo."** *Aceite:* depois de um `snooze` (ou de uma mudança de `endOfDayTime`), as regras
      voltam a poder disparar para o **novo** prazo; um prazo que não mudou não redispara nada.

      **Relatório (dev).**

      **Medido, contra o commit final (depois de dois refactors de tamanho de função — ver
      abaixo):** 133 arquivos de teste, 1424 testes passaram + 3 pulados (1427), `npm run
      verificar` verde (`format:check`, `tsc --noEmit`, `lint`, `dependencias` — 149 módulos/450
      dependências sem violação —, `build`, `cobertura`), medido nas duas máquinas separadamente
      (`npm run cobertura` no Windows, `npm run verificar:linux` no container
      `node:22-bookworm`), as duas rodando em segundo plano por passar de 120s, código de saída
      lido do arquivo de saída dedicado, nunca do encadeamento (mesma disciplina da S4-T5/S4-T6).
      Cobertura, Windows: geral 97,04%/92,77%/98,19%/97,28% (statements/branches/funcs/lines);
      `core/` 100/99,08/100/100 (piso 95%); `scheduler/` 98,54/100/93,93/100 (piso 80% — o único
      gap de função é `loop.ts#sleepUntilNextPollOrStop`, já registrado desde a S4-T5, não tocado
      aqui); `adapters/storage/` 94,53/88,23/98,52/94,86 (piso 80%; `config-schema.ts` sozinho
      fica em 85,48% — o switch de `applyConfigFieldUpdate` tem 13 ramos quase idênticos e só um
      é exercitado por teste desde antes desta tarefa, `leadTimeHysteresisMinutes` só herdou o
      mesmo padrão, não é regressão nova); `cli/` 95,28/94,01/95,45/95,71 (piso 80%). Cobertura,
      Linux (mesmo commit, `npm run verificar:linux`): geral 96,98%/92,83%/97,99%/97,19%; `core/`
      100/99,08/100/100 (idêntico ao Windows); `scheduler/` 98,54/100/93,93/100 (idêntico);
      `adapters/storage/` 93,35/87,16/95,58/93,67 (piso 80%, alguns pontos abaixo do Windows — a
      mesma faixa de diferença que a S4-T6 já registrou entre as duas máquinas, nunca diferença de
      comportamento); `cli/` 95,47/94,35/95,45/95,9 (piso 80%). As duas rodadas: 133 arquivos de
      teste, 1424 testes passaram + 3 pulados (1427), idêntico nas duas máquinas.

      **Dois refactors de limpeza, sem mudança de comportamento (cobertos pela suíte já
      existente):** `core/schedule.ts#decideAgainstDeadline` e `scheduler/poll.ts#pollOnce`
      passaram do piso de ~20 linhas (AGENTS.md § "Estilo de código") ao ganhar a parte 3/parte 1
      respectivamente — `decideLeadTimeOrWait` e `handleLeadTimeWarning` foram extraídas do mesmo
      jeito que `decideAgainstDeadline`/`runEndOfDay` já tinham sido extraídas antes, mesma razão.

      As três partes, mais o achado de reuso, medidos com testes que reproduzem os casos reais
      citados no despacho: o `daemon subindo atrasado às 14:20 com [30,15]` da parte 1
      (`tests/unit/scheduler/poll.test.ts`, "one notice, not two"); o `snooze de 14:30 para 18:00`
      da parte 3 (`tests/unit/core/schedule.test.ts`, "the measured bug: a snooze that moves the
      deadline..."); e a interação das duas, pedida explicitamente no cuidado (b) da parte 3
      (`tests/unit/scheduler/poll.test.ts`, "S4-T7 Part 1 + Part 3 interaction") — um `snooze`
      dado 15 segundos depois do primeiro aviso reabre a regra para o novo prazo mas NÃO gera um
      segundo aviso imediato, porque as duas partes vivem em campos independentes de `DayState` e
      a histerese (parte 1) nunca lê o carimbo de prazo (parte 3).

      **Inferido:** que o comportamento acima é exatamente o que o mantenedor vai observar rodando
      o daemon de verdade amanhã — não posso confirmar isso a partir daqui, só a lógica isolada.
      Também inferido: que `MAX_EARLY_WARNINGS_LISTED = 5` (parte 2, escolhido não medido, mesmo
      espírito do precedente de `UNDERSTANDING_EXCERPT_CHARS`) é um tamanho razoável para o corpo
      de um toast — não tenho como medir altura real de toast a partir daqui.

      **O que o mantenedor precisa ver à mão:** rodando o daemon de verdade, confirmar que **não
      aparecem mais dois avisos prévios em sequência rápida** (o "amontoado" original) e que um
      `seeya snooze` dado perto do fim ainda entrega o aviso seguinte, sem rajada — os dois só se
      provam com o relógio real e o SO real, do jeito que a S4-T6 já registrou para a supressão de
      janela de console.

      **Decisões registradas em Q-060:** a representação do "tipo" (campo dedicado
      `lastLeadTimeWarningNoticeAt` em `DayState`, não um campo genérico em `Notice` nem uma
      chave solta — cuidado (a)); onde mora a decisão pura (`core/lead-time-hysteresis.ts`, novo
      módulo, para não misturar com `decideSchedule`/`findDueLeadTime`, que ficam intocados —
      cuidado (b) e (d) das duas partes); os dois campos novos em `DayState`/`estado.json` sem
      migração, ausência lida como "nunca disparou"/"sem evidência de mudança de prazo" (D-025 —
      cuidado (d)/(e)); o desenho de `resolveFiredLeadTimes` e a alternativa descartada (forçar
      reset quando o carimbo de prazo é desconhecido, rejeitada por poder redisparar avisos já
      corretos contra o `estado.json` real do mantenedor); e os três nomes novos no glossário de
      `AGENTS.md` (`leadTimeHysteresisMinutes`, `lastLeadTimeWarningNoticeAt`,
      `firedLeadTimesEffectiveEndOfDay`).

- [x] **S4-T8 — A leva pequena: três mensagens que falam do mecanismo em vez de falar com a
      pessoa.** Todas saíram de uso real nos dias 06 e 07/09/2026, nenhuma de teste. Nenhuma muda
      comportamento — só o que o programa diz. A S4-T7 já aterrissou, então
      `config-schema.ts` está livre; roda em paralelo com a **S4-T9**, que não toca nenhum arquivo
      desta (conferido: uma mexe em mensagens de `cli/`+`config-schema.ts`, a outra nos `spawn` de
      `adapters/`).

      **1 — Zero à esquerda na hora.** `seeya config set endOfDayTime 9:30` é recusado pelo regex
      de `adapters/storage/config-schema.ts`. O mantenedor: *"eu não errei digitando uma letra ou
      algo inválido de verdade, 09 e 9 é basicamente a mesma coisa"*. Aceitar hora de um dígito e
      **normalizar na gravação** (`9:30` → `09:30` no arquivo), mantendo o minuto com dois dígitos
      — `9:5` ninguém escreve, e ali a ambiguidade seria real. O que fica no disco continua num
      formato só. E a mensagem de valor inválido de verdade deve trazer **exemplo**, sem o `✖` que
      hoje vaza a formatação da biblioteca de validação para a tela.

      **2 — `seeya daemon --stop` explica o mecanismo em vez de responder a pergunta.** Hoje
      devolve um parágrafo sobre por que o Windows não permite parada graciosa. Quem digitou
      `--stop` quer saber **"parou mesmo, e eu perdi alguma coisa?"** — e a resposta é "sim, parou"
      e "não perdeu nada", porque o daemon grava o estado a cada volta do laço. A explicação
      técnica fica no código, onde já mora.

      **3 — `projectPolicy` também é chamada de chave desconhecida.** Mesmo defeito que a S4-T6
      corrigiu para `schemaVersion`, e sobrou: a mensagem diz `unknown config key "projectPolicy"`
      e, na mesma frase, ensina a usar `seeya config policy <cwd>`. Dizer que não conhece e
      explicar como usar, no mesmo texto, é o programa se contradizendo.

      *Aceite:* as três falam com quem digitou. Nenhum comportamento muda; o valor gravado por (1)
      é sempre o canônico.

      **Implementado em 2026-09-07.**

      **Item 1.** `adapters/storage/config-schema.ts#configFileSchema.endOfDayTime` — regex
      `^([01]?\d|2[0-3]):[0-5]\d$` (hora de um ou dois dígitos; minuto sempre dois, sem afrouxar:
      `25:00`, `9:75`, `9:5`, `abc`, vazio continuam recusados) seguido de `.transform(normalizeEndOfDayTime)`.
      A normalização mora no SCHEMA, não no comando — `parseConfigFieldUpdate` (`seeya config set`)
      já reusa `configFileSchema.shape.endOfDayTime` diretamente, então colocá-la ali faz leitura de
      disco e escrita via CLI convergirem para o mesmo canônico num lugar só (justificativa completa
      em Q-061 item 1). Mensagem nova, com exemplo:
      `expected 24h local time "HH:MM" (e.g. "09:30" or "9:30")`. O `✖` saiu de
      `parseConfigFieldUpdate` inteiro (todo campo, não só a hora — Q-061 item 2), trocando
      `z.prettifyError` por `result.error.issues.map(i => i.message).join('; ')`.

      **Antes:** `seeya config set endOfDayTime 9:30` → `seeya config set: invalid value "9:30" for
      "endOfDayTime": ✖ expected 24h local time "HH:MM"`.
      **Depois:** `seeya config set endOfDayTime 9:30` → `endOfDayTime set to 09:30.` (grava
      `"09:30"` em `config.json`). Um valor de verdade inválido agora diz, por exemplo:
      `seeya config set: invalid value "9:75" for "endOfDayTime": expected 24h local time "HH:MM"
      (e.g. "09:30" or "9:30")` — sem `✖`.

      **Item 2.** `cli/daemon-command.ts#runDaemonStop`. Conferido em `scheduler/loop.ts#runDaemon`
      e `scheduler/poll.ts#pollOnce` (não só repetido do despacho, Q-061 item 3): cada poll lê
      `Config`/`DayState` do zero e persiste qualquer decisão antes de retornar — nada fica só em
      memória entre duas voltas do laço. Uma parada que caia NO MEIO de um poll em andamento (fim de
      dia em curso, `GRACEFUL_STOP_DEADLINE_MS` de 15s estourado ou o caminho sempre-abrupto do
      Windows) não corrompe nada, mas aquela tentativa específica não é contada e é retentada do
      zero pelo próximo daemon — registrado honestamente no comentário do código, não escondido.
      `WINDOWS_ABRUPT_REASON` (a explicação de por que o Windows não tem parada graciosa) deixou de
      ser impressa na tela; o texto inteiro continua como comentário, agora colado ao branch
      `platform === 'win32'` de `runDaemonStop` (cuidado (d): a informação mudou de lugar, não
      sumiu).

      **Antes (Windows/forçado):** `Stopped the daemon (pid 4242) — stopped abruptly: Windows has
      no way to ask a console-less, detached process (D-005) to shut down on its own, and a
      cross-process signal there terminates immediately without running its own shutdown code.`
      **Depois (Windows/forçado):** `Stopped the daemon (pid 4242) forcibly. Nothing was lost: it
      saves its state after every poll cycle, so the next "seeya daemon" picks up exactly where
      this one left off.`
      **Antes (POSIX gracioso):** `Stopped the daemon (pid 4242) gracefully.`
      **Depois (POSIX gracioso):** `Stopped the daemon (pid 4242) gracefully. Nothing was lost: it
      saves its state after every poll cycle, so the next "seeya daemon" picks up exactly where
      this one left off.`

      **Item 3.** `projectPolicyNotEditableMessage()` nova em `adapters/storage/config-schema.ts`,
      mesmo padrão de `schemaVersionNotEditableMessage` (S4-T6/Q-059 item 5) — função dedicada, não
      generalização de `unknownConfigKeyMessage`. Interceptada em
      `cli/config-command.ts#runConfigSetCommand`, antes de `parseConfigFieldUpdate`, no mesmo lugar
      e ordem da checagem de `schemaVersion`. `seeya config get projectPolicy` já funcionava antes
      desta tarefa; o defeito era só em `set` (Q-061 item 5). `projectPolicy` **não** virou editável
      por `config set` — continua fora de `EDITABLE_CONFIG_KEYS`, só com comando próprio.

      **Antes:** `seeya config set projectPolicy '{}'` → `seeya config set: unknown config key
      "projectPolicy". Expected one of: ... (for "projectPolicy", use "seeya config policy <cwd>"
      instead).`
      **Depois:** `seeya config set projectPolicy '{}'` → `seeya config set: "projectPolicy"
      exists, but "seeya config set" cannot write it — it is keyed by project (cwd), not a single
      scalar value, so it has its own sub-action: "seeya config policy <cwd>" to set it, or "seeya
      config get projectPolicy" to read it.`

      **Cuidado (f):** nenhuma asserção existente foi apagada para a suíte passar. O único teste
      que mudou de SENTIDO (não só de texto) foi o caso `endOfDayTime` de um dígito no `it.each` de
      valores inválidos de `config-schema.test.ts` — deixou de ser inválido por definição da própria
      tarefa, então foi trocado por dois casos que continuam genuinamente inválidos (minuto de um
      dígito, hora fora do intervalo). Os textos de `runDaemonStop` que os testes fixavam foram
      atualizados com asserções adicionais provando a ausência do mecanismo na tela
      (`not.toContain('Windows')`/`not.toContain('console')`), não só a presença do texto novo.
      Um teste de unidade planejado para o caminho de parada forçada foi descartado a tempo (Q-061
      item 7): `finishAbruptStop` chama `terminateAbruptly` direto, fora de `DaemonControlDeps`, e
      um PID inventado mandaria um sinal real de morte de processo na máquina do teste — o caminho
      já é coberto com segurança em `tests/integration/cli/daemon-command.test.ts`, contra um
      processo fixture real.

      **Cobertura e portão:** `npm run verificar` (Windows) — 133 arquivos de teste, 1434 passaram
      (3 skipped), `core/` 100%, `adapters/storage` 94,98% linhas / 87,43% branches, `cli` 95,73%
      linhas / 94,05% branches (piso de 80% por diretório respeitado, números batem os do S4-T7).
      `npm run verificar:linux` — mesmos 133 arquivos, 1434 passaram (3 skipped), `adapters/storage`
      94,98% linhas / 87,43% branches, `cli` 95,91% linhas / 94,38% branches (pequena variação de
      cobertura entre plataformas, já vista em tarefas anteriores, sem cair abaixo do piso nos
      dois). Os dois códigos de saída lidos separadamente do `tail`, nunca encadeados com o commit.
      Detalhes completos, incluindo os cuidados (a)-(f) um a um, em `docs/QUESTOES.md` **Q-061**.

- [x] **S4-T9 — Um `spawn` só, invisível por padrão, com a exceção declarada (D-038).** Fecha a
      **Q-059 item 3**, decidida pelo mantenedor em 2026-09-07. Roda em paralelo com a **S4-T8** — a
      sequência que este plano afirmava antes estava errada: conferido arquivo a arquivo, as duas
      não se cruzam.

      Refatoração, **não conserto**: o comportamento de hoje já está certo desde a S4-T6 (verificada
      à mão, nenhuma janela apareceu). O que falta é impedir que volte a estar errado.

      Um `spawn` interno do projeto que **sempre** passa `windowsHide: true`, aceitando as opções
      que variam entre os call sites (`stdio` completo, `ignore` parcial, `AbortSignal.timeout`,
      herança de `env`). Os seis `spawn` que hoje escondem passam por ele. Os três que não escondem
      **declaram por quê no próprio call site**: `daemon-launch.ts` (`detached`, console nenhum —
      mecanismo diferente, mesmo resultado), `termination-posix.ts` (POSIX, a opção é no-op) e
      `resumption/spawn-interactive.ts` (**a exceção da D-038**: a janela é o produto).

      **A guarda é a entrega, não o embrulho.** Importar `spawn` de `node:child_process` direto vira
      erro de lint fora do embrulho e das exceções declaradas — mesma técnica que já banisce
      `new Date()` fora de `adapters/clock/` (D-019). Sem isso, a próxima pessoa esquece de novo, que
      é exatamente o que já aconteceu uma vez.

      *Aceite:* nenhum comportamento muda (os testes de integração contra processo real continuam
      verdes, sem alteração de stdout, código de saída ou erro); um `spawn` novo escrito fora do
      embrulho **falha no portão**; e o `start-day` interativo continua abrindo a janela de verdade
      — verificado à mão, porque é o único jeito.

      **Implementado em 2026-09-07.** `src/adapters/process/spawn.ts#spawnHidden`: passa-adiante
      fino para `node:child_process.spawn`, forçando `windowsHide: true` por cima de qualquer opção
      recebida (spread de `options` primeiro, override depois — nenhum call site consegue
      reativar a visibilidade por acidente). A assinatura replica os overloads que o próprio
      `spawn(command, args, options)` do Node declara (`stdio` em tripla, sem `stdio`, e o geral),
      em vez de um `SpawnOptions` genérico — decisão registrada em Q-062 item 2: um tipo genérico
      teria forçado quatro dos seis call sites a ganhar checagem de nulo em `child.stdout`/
      `child.stderr` que não tinham antes, exatamente o "forçar assinatura pobre" que o cuidado (d)
      do despacho pediu para evitar.

      Os seis `spawn` que já escondiam a janela passam a importar `spawnHidden` de
      `adapters/process/spawn.ts`: `adapters/generation/spawn-claude.ts`, `adapters/git/run-git.ts`,
      `adapters/process/spawn-stdout.ts`, as duas chamadas de `adapters/process/console-signal.ts`
      e `adapters/notification/backend.ts`. Nenhuma lógica de leitura de stream mudou — só a linha
      de import e a chamada `spawn(...)` → `spawnHidden(...)`, com o comentário de medição da S4-T6
      preservado (AGENTS.md § "Comentários") e reescrito só na frase final ("esta opção esconde a
      janela" → "o embrulho força esta opção agora"). As três exceções mantêm o import direto de
      `node:child_process`, cada uma com um comentário novo no próprio `import`, não só no
      comentário de módulo já existente, citando D-038 e o motivo: `daemon-launch.ts` (`detached`+
      `stdio:'ignore'` já é console nenhum, nada para o wrapper esconder), `termination-posix.ts`
      (POSIX-only, `windowsHide` seria no-op) e `resumption/spawn-interactive.ts` (a própria exceção
      da D-038 — `stdio: 'inherit'`, a janela é o produto).

      **A guarda.** `eslint.config.js` ganhou um bloco `no-restricted-imports` (`paths`,
      `importNames: ['spawn']`) escopado a `src/**/*.ts`, com `ignores` listando os quatro arquivos
      pelo caminho exato (o embrulho + as três exceções) e, **também**, `src/core/**/*.ts` — essa
      última exclusão não é sobra, é necessária: `core/` já não pode importar NENHUM `node:*` (bloco
      já existente), e como o flat config do ESLint resolve regras por "o último config que casa o
      arquivo vence" (sem merge), um bloco novo cujo `files` é superset de `src/core/**/*.ts` e que
      declarasse a MESMA chave de regra (`no-restricted-imports`) SEM excluir `core/` teria
      silenciosamente SUBSTITUÍDO a proibição ampla por uma que só bane `spawn` — testado na prática
      (Q-062 item 1): sem a exclusão, o teste de guarda já existente "rejects node:* imported in
      src/core/" fica vermelho. Com a exclusão, os dois blocos coexistem sem conflito, e confirmei
      manualmente rodando eslint contra um fixture `node:fs` em `src/core/` (continua rejeitado) e
      contra um `spawn` em `src/adapters/generation/` (rejeitado, mensagem cita `spawnHidden`/D-038).

      **Onde o embrulho mora, conferido contra a matriz antes de escrever (cuidado (e)).**
      `adapters/process/` — os três chamadores que precisam dele (`adapters/generation`,
      `adapters/git`, `adapters/notification`) são adapters diferentes importando de outro adapter.
      A tabela de `docs/ARQUITETURA.md` marca a diagonal `adapters` → `adapters` como "—" (fora dos
      20 pares ordenados, não um dos proibidos) e `.dependency-cruiser.cjs` não tem regra
      `adapters-does-not-import-adapters` — só `adapters-does-not-import-application-cli-or-scheduler`.
      Confirmado contra o portão real, não só a leitura da tabela: `depcruise src` aprovou os seis
      imports novos sem violação (151 módulos/452 dependências). Detalhe completo em Q-062 item 1.

      **Testes.** `tests/integration/guards/eslint-restrictions.test.ts` ganhou um describe novo
      com seis casos (rejeita `spawn` comum e com alias — `importNames` casa o nome original
      exportado, não o alias local; aprova `spawnHidden` importado em outro lugar; aprova os quatro
      arquivos reais da exceção, apontando eslint para o CAMINHO REAL de cada um, porque a exclusão
      é por arquivo exato, não por diretório — uma fixture em `_guard-eslint/` nunca poderia provar
      a isenção). Nenhum teste de comportamento novo nos seis call sites: continuam cobertos pelos
      MESMOS testes de integração contra processo real de antes (Q-059 item 1), rodados antes e
      depois da troca sem alteração de asserção. Detalhe em `docs/TESTES.md`, entrada S4-T9.

      **MEDIDO PELO AGENTE.** `npm run verificar` verde (`format:check`, `tsc --noEmit`, `lint`,
      `dependencias` — 151 módulos/452 dependências sem violação —, `build`, `cobertura`): 133
      arquivos de teste, 1429 passaram + 3 pulados (1432). Cobertura geral 97,04/92,77/98,19/97,28
      (statements/branches/funcs/lines); `core/` 100/99,08/100/100 (piso 95%); `scheduler/`
      98,54/100/93,93/100 (piso 80%, mesmo gap de função já registrado desde a S4-T5,
      `loop.ts#sleepUntilNextPollOrStop`, não tocado aqui); `adapters/process/` 91,66/81,57/93,18/
      92,61 (piso 80% — os seis call sites tocados ficam dentro do rollup do diretório; nenhum
      arquivo individual precisa bater 80% sozinho, só o diretório); `adapters/generation/`
      96,12/93,33/100/96,06; `adapters/git/` 98,02/83,6/100/97,97; `adapters/notification/`
      100/93,47/100/100; `adapters/storage/` 94,53/88,23/98,52/94,86; `adapters/resumption/`
      98,36/91,3/100/98,36; `cli/` 95,28/94,01/95,45/95,71 — todos acima do piso de 80%.
      `npm run dependencias`: 151 módulos, 452 dependências, zero violações (os seis imports
      adapter-para-adapter novos incluídos). Guarda de lint provada na prática, três vezes: (1)
      fixture com `spawn` de `node:child_process` em `src/adapters/generation/` → eslint reprova
      com a mensagem citando `spawnHidden`/D-038 (exit 1); (2) fixture equivalente em
      `src/core/` com `node:fs` → continua reprovando com a mensagem original de `core/` (exit 1,
      prova que a nova regra não substituiu a antiga); (3) suíte de guarda automatizada
      (`eslint-restrictions.test.ts`), 14 testes no arquivo (8 pré-existentes + 6 novos), todos
      verdes.

      **NÃO MEDIDO PELO AGENTE, e é o único ponto que o mantenedor precisa conferir à mão: que o
      `seeya start-day` interativo continua abrindo a janela de verdade.** Nada mudou em
      `resumption/spawn-interactive.ts` além de um comentário — continua importando `spawn`
      diretamente de `node:child_process` com `stdio: 'inherit'`, exatamente como antes desta
      tarefa — e os testes de integração/unidade desse arquivo continuam verdes sem alteração. Mas
      "a janela ainda abre" é, pela própria natureza do defeito que a S4-T6 documentou, algo que
      nenhuma suíte automatizada consegue provar (o processo de teste sempre tem console próprio).
      A S4-T6 já teve esse ponto confirmado à mão pelo mantenedor uma vez; esta tarefa não muda
      código nesse call site além do comentário, então o risco de regressão é baixo, mas o pedido
      do despacho foi explícito nesse ponto e eu não tenho como verificar sozinho.

      **Cobertura e portão, medidos separadamente nas duas máquinas** (`npm run verificar` no
      Windows, `npm run verificar:linux` no container `node:22-bookworm`, ambos em segundo plano
      por passarem de 120s, código de saída lido do arquivo de saída dedicado — mesma disciplina
      da S4-T5/S4-T6/S4-T7). Linux (mesmo commit `5a5381d`): `npm run verificar:linux` verde de
      ponta a ponta (exit 0) — `format:check`, `tsc --noEmit`, `lint`, `dependencias`, `build`,
      `cobertura`, dentro do container. 133 arquivos de teste, 1429 passaram + 3 pulados (1432) —
      idêntico ao Windows. Cobertura geral 96,99/92,84/98/97,19 (statements/branches/funcs/lines,
      levemente diferente do Windows por linha específica, mesma faixa de diferença que a S4-T6/
      S4-T7 já registraram entre as duas máquinas); `core/` 100/99,08/100/100 (piso 95%,
      idêntico); `scheduler/` 98,54/100/93,93/100 (piso 80%, idêntico); `adapters/process/`
      89,81/81,66/93,1/90,47 (piso 80%; `spawn.ts`, o embrulho novo, 100/100/100/100 sozinho);
      `adapters/git/` 98,02/83,6/100/97,97; `adapters/notification/` 100/93,47/100/100;
      `adapters/storage/` 93,35/87,16/95,58/93,67; `adapters/resumption/` 98,36/91,3/100/98,36;
      `cli/` 95,47/94,35/95,45/95,9 — todos acima do piso de 80%. `dependencias`: mesmo resultado
      do Windows, zero violações. Suíte de guarda (`eslint-restrictions.test.ts`, incluindo os
      seis testes novos de D-038) verde no container.

- [x] **S4-T10 — O portão fica vermelho sem defeito nenhum: prazo fixo contra operação de custo
      variável.** Bloqueia a publicação da **S4-T9**, que está mesclada e **não publicada** por
      causa disto.

      **Medido em 2026-09-08, quatro rodadas.** `npm run verificar` falha com 2 a 3 testes
      estourando tempo — **sempre** os que lançam processo de verdade (`powershell.exe`, anexar
      console), e **o conjunto muda a cada rodada**. `terminateGracefully (Windows:
      CTRL_BREAK_EVENT via console attach)` falhou em todas.

      **Não é a S4-T9, e isto foi isolado, não suposto:** o portão foi rodado **no commit anterior
      a ela** (`8a6d71e`) e falhou igual, com três testes. Esse mesmo commit passou **verde ontem,
      nesta máquina**, duas vezes. **Não é carga do conjunto inteiro:** rodando só os dois arquivos
      que falharam, passam; rodando **só o projeto `integration`**, falham três — a contenção está
      dentro dele.

      **A causa provável, e ela está escrita como afirmação no `vitest.config.ts`.** O projeto
      `integration` declara que "não disputa nenhum recurso, então mantém o paralelismo padrão".
      Isso é falso para os testes de processo: eles disputam a capacidade do sistema de **lançar
      processos**, cujo custo o próprio projeto mediu como variável (500-880ms por `powershell.exe`,
      **quente** — `adapters/process/proc-start.ts`). Os prazos são fixos (5s e 8s). Ontem coube;
      hoje, com a máquina reiniciada, não cabe.

      *Aceite:* **o portão passa cinco vezes seguidas** nesta máquina. A correção não pode ser
      apenas aumentar prazo — prazo generoso demais deixa de pegar travamento de verdade, que é
      exatamente o que esses testes existem para pegar. Medir antes e depois, e dizer o custo em
      tempo total do conjunto.

      **Implementado em 2026-09-08.** Reproduzido antes de mexer em qualquer arquivo: contagem de
      processos node primeiro (`docs/TESTES.md` § "Suíte lenta ou instável"), **1** processo vivo
      nesta máquina — não é o caso das centenas acumuladas que aquela seção cobre, então a causa
      tinha que ser outra, e era a que a entrada da tarefa já apontava. Rodei `npm run verificar`
      uma vez no estado herdado (commit `da2ebfc`, antes de qualquer edição minha) para ter um
      "antes" medido, não só citado: **vermelho**, 128s de parede (`date` antes/depois), 3 arquivos
      falharam por timeout — `cli/composition.test.ts`, `cli/daemon-command.test.ts` (2 casos) e
      `process/termination.test.ts`. **`composition.test.ts` não estava na lista de "testes
      envolvidos" do despacho** (que citava só `termination`, `liveness`, `daemon-command`, `lock`),
      mas grepar por `captureObservedProcStart(` em `tests/` mostra que ele chama a mesma função
      real (`buildCliContext`'s teste "the real ProcessControl reports this test process itself as
      alive") — e foi exatamente esse o que estourou no meu "antes". Cinco arquivos, não quatro;
      registrado em **Q-063** e incluído na correção, porque a evidência (o próprio log de falha)
      é mais forte que a lista original.

      **A correção: separar os cinco num projeto vitest novo, serializado só entre eles.** Novo
      projeto `integration-process` (`vitest.config.ts`) com `include` explícito dos cinco arquivos
      e `fileParallelism: false` — só dentro dele, não no resto de `integration`. Os outros 36
      arquivos de `integration/` (isolados por tmpdir, nunca lançam processo real) continuam com o
      paralelismo padrão de sempre. O comentário falso no `integration` ("não disputa nenhum
      recurso") foi reescrito para dizer a verdade parcial que era: verdade para 37 de 42 arquivos,
      falsa para estes cinco.

      **Por que não foi só alargar o prazo (cuidado a do despacho).** Os prazos de
      `terminateGracefully` (5s Windows-console, 2s sem console) já carregam o orçamento interno da
      operação **mais** 3s de folga (comentário original de `termination.test.ts`, preservado) — se
      o processo alvo nunca reagir ao `CTRL_BREAK_EVENT` (travamento real, não custo de lançar
      `powershell.exe`), o teste ainda estoura essa folga e falha, porque a folga continua fixa e
      pequena. Alargar esses 5s/8s para "caber" a contenção também alargaria a folga sobre
      travamento real — exatamente a perda que o despacho pediu para evitar. A correção não tocou
      nenhum desses números.

      **Por que serializar só estes cinco, e não `integration` inteiro (cuidado c).** A
      `S1-T0` já registrou, no próprio `vitest.config.ts`, por que `fileParallelism: false` foi
      recusado em `guards/`: lá a serialização teria **escondido** uma corrida real em estado
      mutável compartilhado — o bug era a corrida, e paralelismo é o que a expõe. Aqui a disputa é
      por um recurso real e medido (capacidade do SO de lançar processo, 500-880ms por
      `powershell.exe` **quente**, `adapters/process/proc-start.ts`), não um artefato de fixture
      compartilhada — serializar estes cinco **remove** a disputa em vez de escondê-la. Medido, não
      só argumentado: rodando só os cinco isolados do resto da suíte, em paralelo entre si (sem
      `fileParallelism: false`, via `--fileParallelism` explícito), os cinco passam em 11,0s — a
      disputa entre eles sozinhos, sem o resto da suíte rodando junto, não é suficiente para
      estourar o prazo. É a carga do conjunto inteiro (os outros ~128 arquivos de teste competindo
      pelas 8 CPUs desta máquina ao mesmo tempo) que empurra o lançamento do `powershell.exe` para
      fora do orçamento — serializar estes cinco tira o pior caso (dois ou três lançamentos
      pesados simultâneos) sem impor custo algum aos 36 arquivos irmãos, que nunca tocam
      `powershell.exe`.

      **Custo medido da serialização:** os cinco arquivos, sozinhos, em série
      (`fileParallelism: false`, como ficou): 25,5s. Os mesmos cinco, sozinhos, em paralelo entre
      si: 11,0s. A diferença (~14,5s de trabalho que passou a ser sequencial) fica **dentro** da
      janela em que os outros 128 arquivos de `unit`/`integration`/`guards` já estão rodando em
      paralelismo pleno — não é um acréscimo que se soma ao tempo total da suíte, é trabalho que se
      sobrepõe a um tempo que já ia ser gasto de qualquer forma. Confirmado pelo número que importa,
      o tempo de parede da suíte inteira: **antes** (vermelho, uma medição) 128s; **depois** (verde,
      cinco medições) 126s/140s/129s/130s/131s, média 131s — mesma ordem de grandeza, sem regressão
      perceptível.

      **Aceite, medido cinco vezes seguidas nesta máquina, `npm run verificar`:**

      ```
      rodada 1: EXITCODE:0, 07:29:02–07:31:08 (126s), 133 arquivos, 1440 passaram, 3 pulados
      rodada 2: EXITCODE:0, 07:31:18–07:33:38 (140s), 133 arquivos, 1440 passaram, 3 pulados
      rodada 3: EXITCODE:0, 07:33:42–07:35:51 (129s), 133 arquivos, 1440 passaram, 3 pulados
      rodada 4: EXITCODE:0, 07:35:55–07:38:05 (130s), 133 arquivos, 1440 passaram, 3 pulados
      rodada 5: EXITCODE:0, 07:38:09–07:40:20 (131s), 133 arquivos, 1440 passaram, 3 pulados
      ```

      Cobertura (rodada 1, representativa — as cinco não divergem de forma relevante): geral
      97,05/92,65/98,2/97,29 (statements/branches/funcs/lines); `core/` 100%; `adapters/process/`
      dentro do piso de 80% (os cinco arquivos movidos continuam contando para o mesmo diretório,
      só mudou o projeto vitest que os roda, não o `include` de cobertura). `npm run verificar:linux`
      verde (container `node:22-bookworm`) — nesta plataforma os cinco arquivos não lançam
      `powershell.exe` (é Windows-only), então a disputa que motivou esta tarefa nunca existiu ali;
      a separação de projeto é inofensiva lá, só reduz paralelismo de 5 arquivos que já eram
      baratos nesse SO.

      **`docs/TESTES.md`** ganhou uma entrada nova documentando o método (contar node primeiro,
      depois checar se quem falhou lança processo real, depois checar se está sob paralelismo
      padrão do mesmo projeto vitest) — para o próximo vermelho sem defeito achar isto sem repetir
      a investigação. **Q-063** registra a divergência da lista de arquivos (o quinto arquivo) e o
      raciocínio completo dos cuidados (a)-(d).

- [ ] **S4-T11 — A CI do Windows fica vermelha em push só de documentação: os testes de `git/` e
      `storage/` ficaram fora da S4-T10.** Proposta do PO em 2026-09-11, ainda **não despachada**.

      **Medido em dois pushes de oito desde 10/09, ambos só de documentação** (`4146faa` e
      `e9286a5`): o job `windows-latest` falha com 14 testes estourando `5000ms`, sempre nos
      mesmos arquivos — `tests/integration/git/git-adapter.test.ts` (12 dos 14 casos),
      `git/primitives.test.ts`, `storage/atomic-write.test.ts`, os dois
      `storage/*-concurrent-write.test.ts` e, uma vez, `discovery/transcript-scan.test.ts` em
      30 s. Junto, **`EBUSY: resource busy or locked, rmdir '...\seeya-git-...\main'`** na
      limpeza do diretório temporário do git. Ubuntu e macOS passam nas mesmas execuções. O
      portão local está verde (cinco rodadas seguidas depois da S4-T10).

      **Medido depois:** a reexecução do mesmo job (`gh run rerun --failed`), sem nenhuma mudança,
      **passou**. É variabilidade do runner; o defeito é os testes serem sensíveis a ela. Não
      procure defeito de código.

      **Hipótese, não medição:** é a mesma classe de problema da S4-T10 — prazo fixo contra
      lançamento de processo de custo variável — só que nos testes que lançam **`git`** (cada
      `createGitFixture` faz vários `git init`/`commit`/`worktree add` por caso) e nos que matam
      processo de verdade (`atomic-write`), todos ainda em paralelismo padrão porque a S4-T10
      serializou só os cinco arquivos que lançam `powershell.exe`. O `EBUSY` pode ser um `git`
      ainda vivo quando o `afterEach` apaga a pasta — o que seria defeito de higiene do teste, e
      não só de prazo.

      *O que fazer:* medir antes de mexer (tempo por arquivo e quantidade de processos lançados
      por caso), estender o método da S4-T10 ao que a medição apontar, e explicar o `EBUSY` em vez
      de contorná-lo. **Sem aumentar prazo sem medição** (mesma regra da S4-T10). Nada em `src/`.

      *Aceite:* explicação do `EBUSY`; os arquivos apontados com tempo por caso registrado; o
      portão local continua verde cinco vezes seguidas; e a CI do Windows verde nos **três pushes
      seguintes** à mesclagem — a única prova possível, porque o runner é o que não se reproduz
      aqui.

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
- [ ] **S5-T8 (candidato, NÃO agendado) — Briefing agrupado por projeto.** Direção aprovada pelo
      mantenedor em 2026-09-07 (**D-039**), sem tarefa disparada e sem prazo. O `summary.md` hoje é
      lista plana de sessões; a D-032 já descobre os repositórios de cada sessão pelos arquivos
      tocados, então o agrupamento sai de evidência que já existe. Ataca a metade **de leitura** do
      "estou perdido entre vinte sessões" — a metade de **decidir** o que fazer com cada uma é a
      tela do v2. Interessa agora porque é a base que essa tela vai consumir.

## Definição de pronto (vale para toda tarefa)

1. Código implementa exatamente a spec; divergência virou questão, não improviso.
2. Testes da faixa correspondente escritos e passando.
3. `npm run verificar` verde (tipos + lint + dependency-cruiser + cobertura + testes).
4. Nenhum `TODO`, `any`, `@ts-ignore` ou `eslint-disable` novo sem justificativa em comentário.
5. Commits em português, pequenos, um assunto cada.
6. Review do agente revisor aprovado.

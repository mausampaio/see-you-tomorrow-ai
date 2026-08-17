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
      *Aceite cumprido:* `npx vitest run --project guardas --file-parallelism` passa em Linux e
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

- [ ] **S1-T0c — Corrigir os schemas contra dado real de outra máquina.** Os schemas do S0-T5
      foram escritos contra o `~/.claude` de **uma** máquina (Windows, uso pessoal). Testados
      contra a saída real de uma máquina Linux, **rejeitam**:
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

- [ ] **S1-T1 — `nucleo/` de domínio.** Tipos, portas e as regras puras de elegibilidade e de
      classificação viva/ociosa/encerrada. Sem I/O.
- [ ] **S1-T2 — `adaptadores/processo`.** Liveness com desempate por `procStart`, nos 3 SOs.
- [ ] **S1-T3 — `adaptadores/descoberta`, estratégia por registro.** Lê
      `~/.claude/sessions/*.json`, tolerante a arquivo corrompido. Exclui forks de `forks.json`
      (D-012). Sessão sem transcript entra normalmente, com `temTranscript: false` (D-013).
- [ ] **S1-T8 — Estratégia por varredura de transcripts (D-016).** Varre
      `~/.claude/projects/**/*.jsonl` por mtime dentro de `horasDeRelevancia`, sem ler conteúdo
      antes de filtrar. Reconstrói o `cwd` a partir do transcript, já que o slug não é
      reversível com segurança.
      *Aceite:* sessão headless — que não aparece no registro — é descoberta. Um `~/.claude`
      falso com 500 transcripts é filtrado sem parse de conteúdo.
- [ ] **S1-T9 — Fusão das duas estratégias.** União deduplicada por `sessionId`; sessão vista só
      pela varredura entra com `pid: null` e estado `desconhecido`, e nunca é candidata a
      encerramento de processo.
      *Aceite:* sessão presente nas duas origens aparece **uma** vez, com os campos fundidos.
- [ ] **S1-T4 — `adaptadores/transcricao`.** Parser streaming; últimos prompts, arquivos
      tocados, última atividade.
- [ ] **S1-T7 — Detecção precoce de sessão sem transcript.** Notificação uma vez por
      `sessionId`, disparada quando a sessão é vista, não no encerramento (D-013).
      *Aceite:* sessão registrada sem `.jsonl` gera exatamente uma notificação, e a segunda
      passagem da descoberta não repete.
- [ ] **S1-T5 — `adaptadores/armazenamento`.** Raiz injetável, escrita atômica, config com
      defaults, `versaoDoEsquema`.
- [ ] **S1-T6 — `seeya sessoes` e `seeya status`.**
      *Aceite do sprint:* `seeya sessoes` lista corretamente as sessões reais desta máquina,
      incluindo as obsoletas, e o e2e nº1 passa.

---

## Sprint 2 — Encerrar o dia

- [ ] **S2-T1 — `adaptadores/git`.** Branch, status, commits do dia e **enumeração de
      worktrees** com o estado de cada um (D-013). Sem quebrar quando o `cwd` não é repo.
      *Aceite:* repo de teste com dois worktrees, um sujo e um limpo, produz o estado correto
      dos dois.
- [ ] **S2-T2 — `adaptadores/geracao`.** Duas implementações, enxuta e profunda (D-011).
      Contexto por stdin ou arquivo, nunca por argumento (D-015). `--tools ""`,
      `--system-prompt` curto, `--json-schema`, timeout, orçamento, `spawn` sem shell, erro
      tipado. Registro do fork em `forks.json` no modo profundo.
      *Aceite:* teste com conteúdo contendo quebra de linha, aspas, acento e `%` chega íntegro
      ao processo filho; medição do piso de tokens antes e depois do `--tools ""` registrada.
- [ ] **S2-T3 — Caso de uso `encerrarDia`.** Coleta multi-fonte com `fontes[]` (D-013),
      concorrência limitada, isolamento de falha por sessão, fallback determinístico,
      anti-duplicidade, guarda de turno ativo. Handoff válido com qualquer fonte respondendo.
- [ ] **S2-T6 — Limpeza de forks.** Apaga forks próprios com mais de `diasParaLimparForks`.
      *Aceite:* apaga apenas IDs presentes em `forks.json`; um teste prova que nenhum outro
      arquivo de `~/.claude/projects/` é tocado.
- [ ] **S2-T4 — Briefing.** Geração do `resumo.md` a partir dos handoffs.
- [ ] **S2-T5 — `seeya encerrar-dia` com `--dry-run` e `--sessao`.**
      *Aceite do sprint:* e2e 2, 3 e 4 passam. Encerramento com o modelo indisponível ainda
      produz handoffs úteis.

---

## Sprint 3 — Começar o dia

- [ ] **S3-T1 — Leitura do briefing pendente** e montagem do prompt de retomada por sessão.
- [ ] **S3-T2 — Retomada.** `claude --resume` no `cwd` original, com fallback para sessão nova
      e aviso explícito ao usuário.
- [ ] **S3-T3 — `seeya iniciar-dia`** com seleção interativa e `--todas`.
      *Aceite do sprint:* e2e 5 passa; retomada real de uma sessão de ontem funciona à mão.

---

## Sprint 4 — Automatizar

- [ ] **S4-T1 — `adaptadores/notificacao`** conforme o Spike B, com a cadeia de fallback e o
      contrato mínimo **sem ações**. Validação manual do `activationType="protocol"` com esquema
      `seeya://` no Windows; se não se provar, o produto segue sem ações clicáveis e nada quebra.
- [ ] **S4-T2 — `nucleo/agenda`.** Puro: dado config + estado + agora, o que deve acontecer.
      É aqui que moram os testes de horário de verão e de máquina suspensa.
- [ ] **S4-T3 — Daemon.** Loop, lockfile de instância única, recuperação de disparo atrasado.
- [ ] **S4-T4 — `seeya adiar`, `seeya pular-hoje`, `seeya config`.**
- [ ] **S4-T5 — `seeya daemon --parar/--status`.**
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

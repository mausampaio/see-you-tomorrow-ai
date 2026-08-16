# Plano de entrega

Uma tarefa por vez, na ordem. Cada tarefa é um branch (`tarefa/S1-T3-descoberta`) e termina
com os testes da sua faixa passando e os guards verdes.

O agente dev **não pula tarefa**, **não agrupa tarefas** e **não começa a próxima** antes do
review aprovar a anterior.

Legenda: `[ ]` a fazer · `[~]` em andamento · `[x]` aprovado no review

---

## Sprint 0 — Fundação e riscos

O objetivo aqui não é entregar produto, é **derrubar as incertezas antes que elas custem caro**.

- [~] **S0-T1 — Scaffold.** Node 22, TS estrito ESM, vitest, eslint, prettier, commander, zod.
      `package.json` com `bin: { seeya }`. Estrutura de pastas de `docs/ARQUITETURA.md` criada
      vazia com um `index.ts` por camada.
      *Aceite:* `npm run build`, `npm test`, `npm run lint` passam num repo sem código de negócio.

- [ ] **S0-T2 — Guards executáveis.** `dependency-cruiser` com as regras de camada;
      `no-restricted-imports` proibindo `node:*` em `nucleo/` e proibindo `Date`/`setTimeout`
      fora de `adaptadores/relogio`; limites de cobertura por diretório; husky + lint-staged;
      workflow de CI rodando lint + tipos + unidade + integração nos 3 SOs.
      *Aceite:* commits propositalmente violadores são **rejeitados**, com o teste que prova isso.

- [x] **S0-T3 — SPIKE A.** Feito pelo PO em 2026-08-16. Veredito em
      `docs/spikes/A-resume-headless.md`: funciona com a sessão viva, transcript original
      preservado. Gerou D-011, D-012 e D-015.
      *Complemento feito:* `docs/spikes/C-alternativa-barata-e-transcript-desativado.md`.

- [x] **S0-T4 — SPIKE B.** Feito pelo PO em 2026-08-16. Veredito em `docs/spikes/B-notificacoes.md`.
      Windows exibe toast sem dependência nenhuma (WinRT via PowerShell). Ações clicáveis são
      inconsistentes entre SOs: a spec passou a **não depender delas**. macOS e Linux
      documentados, não executados — S5-T4 continua obrigatório.

- [ ] **S0-T5 — Schemas e contrato.** Schemas zod de tudo que vem do Claude Code, mais a suíte
      `contrato` de `docs/TESTES.md`.
      *Aceite:* contrato roda verde contra o `~/.claude` real da máquina.

---

## Sprint 1 — Enxergar as sessões

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

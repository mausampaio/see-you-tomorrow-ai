# Plano de entrega

Uma tarefa por vez, na ordem. Cada tarefa é um branch (`tarefa/S1-T3-descoberta`) e termina
com os testes da sua faixa passando e os guards verdes.

O agente dev **não pula tarefa**, **não agrupa tarefas** e **não começa a próxima** antes do
review aprovar a anterior.

Legenda: `[ ]` a fazer · `[~]` em andamento · `[x]` aprovado no review

---

## Sprint 0 — Fundação e riscos

O objetivo aqui não é entregar produto, é **derrubar as incertezas antes que elas custem caro**.

- [ ] **S0-T1 — Scaffold.** Node 22, TS estrito ESM, vitest, eslint, prettier, commander, zod.
      `package.json` com `bin: { seeya }`. Estrutura de pastas de `docs/ARQUITETURA.md` criada
      vazia com um `index.ts` por camada.
      *Aceite:* `npm run build`, `npm test`, `npm run lint` passam num repo sem código de negócio.

- [ ] **S0-T2 — Guards executáveis.** `dependency-cruiser` com as regras de camada;
      `no-restricted-imports` proibindo `node:*` em `nucleo/` e proibindo `Date`/`setTimeout`
      fora de `adaptadores/relogio`; limites de cobertura por diretório; husky + lint-staged;
      workflow de CI rodando lint + tipos + unidade + integração nos 3 SOs.
      *Aceite:* commits propositalmente violadores são **rejeitados**, com o teste que prova isso.

- [ ] **S0-T3 — SPIKE A (risco maior do projeto).** Descobrir empiricamente o comportamento de
      `claude -p --resume <id> --fork-session --output-format json`:
      funciona com a sessão **viva**? o transcript original é preservado? qual a latência e o
      custo típicos? o que acontece se o `cwd` mudou?
      *Aceite:* `docs/spikes/A-resume-headless.md` com os comandos executados, a saída bruta e
      um veredito claro. Se não funcionar em sessão viva, o caminho alternativo do
      `docs/ARQUITETURA.md` vira o padrão — **e isso é decisão do PO, não do dev**.

- [ ] **S0-T4 — SPIKE B.** Notificação nativa nos 3 SOs: escolher biblioteca ou chamada direta,
      testar ações clicáveis, medir dependências externas necessárias.
      *Aceite:* `docs/spikes/B-notificacoes.md` com o que funciona em cada SO e o fallback.

- [ ] **S0-T5 — Schemas e contrato.** Schemas zod de tudo que vem do Claude Code, mais a suíte
      `contrato` de `docs/TESTES.md`.
      *Aceite:* contrato roda verde contra o `~/.claude` real da máquina.

---

## Sprint 1 — Enxergar as sessões

- [ ] **S1-T1 — `nucleo/` de domínio.** Tipos, portas e as regras puras de elegibilidade e de
      classificação viva/ociosa/encerrada. Sem I/O.
- [ ] **S1-T2 — `adaptadores/processo`.** Liveness com desempate por `procStart`, nos 3 SOs.
- [ ] **S1-T3 — `adaptadores/descoberta`.** Registro + resolução do transcript, tolerante a
      arquivo corrompido.
- [ ] **S1-T4 — `adaptadores/transcricao`.** Parser streaming; últimos prompts, arquivos
      tocados, última atividade.
- [ ] **S1-T5 — `adaptadores/armazenamento`.** Raiz injetável, escrita atômica, config com
      defaults, `versaoDoEsquema`.
- [ ] **S1-T6 — `seeya sessoes` e `seeya status`.**
      *Aceite do sprint:* `seeya sessoes` lista corretamente as sessões reais desta máquina,
      incluindo as obsoletas, e o e2e nº1 passa.

---

## Sprint 2 — Encerrar o dia

- [ ] **S2-T1 — `adaptadores/git`.** Branch e status do `cwd`, sem quebrar quando não é repo.
- [ ] **S2-T2 — `adaptadores/geracao`.** Invocação headless conforme o veredito do Spike A;
      timeout, orçamento, `spawn` sem shell, erro tipado.
- [ ] **S2-T3 — Caso de uso `encerrarDia`.** Concorrência limitada, isolamento de falha por
      sessão, fallback determinístico, anti-duplicidade, guarda de turno ativo.
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

- [ ] **S4-T1 — `adaptadores/notificacao`** conforme o Spike B, com a cadeia de fallback.
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

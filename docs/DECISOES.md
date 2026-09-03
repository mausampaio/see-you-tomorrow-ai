# Decisões

Registro imutável das decisões de produto e arquitetura. **O agente dev não altera este
arquivo.** Se uma tarefa parecer exigir a violação de uma decisão, pare e abra uma questão
em `docs/QUESTOES.md` em vez de decidir sozinho.

Toda decisão nova entra como uma entrada numerada nova. Decisão revogada é marcada como
`REVOGADA por D-0XX`, nunca apagada.

---

## D-001 — O handoff é gerado por fora da sessão, nunca por dentro

**Contexto.** A ideia original era "enviar um comando para a sessão interromper e guardar
tudo". Escrever no TTY de outro processo não é viável nos três SOs.

> **CORREÇÃO (2026-08-30, observado).** Este parágrafo afirmava também que "não há IPC, não há
> socket de controle". **Isso não é mais verdade.** O registro de uma sessão viva traz
> `messagingSocketPath` (no Windows, um named pipe `\.pipecc-msg-<hex>`),
> `bridgeSessionId` e `peerProtocol`; o ambiente dos processos filhos traz
> `CLAUDE_CODE_MESSAGING_SOCKET` e `CLAUDE_CODE_MESSAGING_TOKEN`. Observado no registro real,
> **não sondado** — mandar mensagem malformada para o pipe de uma sessão viva é risco sem
> retorno.
>
> Pelo que dá para ler, é a **malha interna de mensagens entre agentes** do Claude Code, não um
> canal de controle geral, e é protegida por um token que vive no ambiente herdado — exatamente
> a categoria de variável que a **D-017** existe para remover. Usá-lo seria o `seeya` se passar
> por processo filho de uma sessão, contra uma decisão que já tomamos.
>
> **A decisão continua valendo, pelos motivos que sobrevivem à correção**, e eles são de
> produto, não de impossibilidade: gerar por dentro gastaria o contexto da própria sessão —
> justamente a mais escassa no fim do dia, que é quando o handoff importa — e interromperia o
> turno dela. Ver **D-031**, que redefine o escopo e mantém "por fora" como o único mecanismo.

**Decisão.** O `see-you-tomorrow` nunca fala com a sessão viva. Ele lê o transcript da sessão
em disco e gera o handoff em um **processo headless separado**
(`claude -p --resume <sessionId> --fork-session`), que enxerga a conversa inteira.

**Consequências.**
- Funciona mesmo para sessões que já morreram.
- Não consome o contexto nem interrompe o turno da sessão viva.
- `--fork-session` é obrigatório: garante que a captura não escreva no transcript original.
- O verbo "encerrar" no produto significa **capturar e avisar**, não **matar**, exceto onde
  D-002 permitir.

---

## D-002 — Encerrar a sessão viva é opt-in, por sessão

**Decisão.** O comportamento padrão do encerramento é: gerar o handoff, notificar o usuário e
**deixar a sessão viva intacta**. O usuário pode marcar sessões específicas como
`canTerminate: true` na config; só essas têm o processo finalizado após o handoff ser gravado
com sucesso.

**Consequências.**
- A política vive em `config.json`, chaveada por `cwd` (não por `sessionId`, que muda a cada
  sessão nova).
- Encerrar exige, nesta ordem: handoff gravado e verificado em disco → só então terminar o
  processo. Falha na captura aborta o encerramento daquela sessão.
- Terminação é graciosa primeiro (SIGTERM / equivalente Windows), com prazo, e o app **não**
  faz kill forçado na v1.

---

## D-003 — Geração híbrida: fatos determinísticos + entendimento pelo modelo

**Decisão.** Todo handoff tem duas camadas:

1. **Fatos** — extraídos localmente, sem custo e sem rede: últimos prompts do usuário,
   arquivos tocados, branch e sujeira do git no `cwd`, timestamp da última atividade.
2. **Entendimento** — o que estava sendo feito, o que falta e o plano de amanhã, escrito pelo
   Claude headless a partir dos fatos + transcript.

**Decisão de falha.** Se a camada 2 falhar (rede, cota, timeout, binário ausente), o handoff é
gravado **mesmo assim**, só com os fatos, e marcado `source: "deterministic"`. O encerramento
do dia nunca falha inteiro por causa do modelo.

**Consequências.** A camada 1 é testável sem rede e é o que os testes cobrem com rigor. A
camada 2 é sempre mockada nos testes.

---

## D-004 — "Iniciar o dia" retoma a sessão original

**Decisão.** `seeya start-day` executa `claude --resume <sessionId>` no `cwd` original de cada
sessão pendente, injetando o plano do dia anterior como primeiro prompt.

**Consequências.**
- O `sessionId` do dia anterior precisa ser persistido no handoff.
- Se o `--resume` falhar (sessão expirada, projeto movido), o fallback é abrir sessão nova com
  o handoff como contexto — e avisar o usuário que houve fallback.
- Retomar N sessões significa N processos. A v1 pergunta quais retomar em vez de disparar
  todas de uma vez.

---

## D-005 — Daemon próprio para o agendamento

**Decisão.** `seeya daemon` é um processo de longa duração que cuida do relógio, das notificações
prévias, do adiamento e do disparo. Não usamos Task Scheduler / cron / launchd para a lógica.

**Consequências.**
- Instância única obrigatória: lockfile em `~/.seeya/daemon.lock` com PID e
  verificação de liveness.
- O daemon precisa sobreviver a suspensão da máquina: o disparo é decidido comparando relógio
  de parede, nunca contando `setTimeout` longo.
- Instalar o daemon no autostart do SO é tarefa do Sprint 5, não da lógica.
- **O daemon se desliga do shell que o iniciou.** Não é processo filho preso ao terminal: sobe
  desanexado, sem console, e sobrevive a fechar a janela, encerrar o shell ou deslogar. Um daemon
  que morre junto com quem o chamou não é um daemon — é um comando em segundo plano.

  Acrescentado em 2026-08-18, a partir de uma observação do mantenedor. A ausência disto no texto
  original era buraco, não omissão deliberada: o `seeya daemon &` num shell parecia suficiente e
  não é.

  Em Node, `detached: true` + `stdio: 'ignore'` + `unref()` cobre os dois mundos: no POSIX faz
  `setsid`, e no Windows usa `DETACHED_PROCESS`, que dá **console nenhum**. Medido no Spike G, de
  lado: um processo assim recusa `AttachConsole` com erro 6.

  **Consequência de segunda ordem, e é o motivo de isto ter aparecido agora:** sem console, o
  daemon fica **inalcançável por evento de console**. O risco de o `seeya` se matar com o
  Ctrl+Break que ele mesmo gera (S1-T2b) desaparece por construção, em vez de depender de uma
  proteção que alguém precisa lembrar de manter.

  **Custo assumido:** desanexado, o daemon não escreve no terminal de quem o subiu. Diagnóstico
  passa a ser arquivo de log e `seeya daemon --status`, não saída ao vivo. É o comportamento
  normal de daemon, mas é uma troca real e fica registrada aqui para não ser redescoberta como
  defeito.

---

## D-006 — Adiar por incrementos, ou pular o dia

**Decisão.** Quando a notificação de encerramento dispara, o usuário pode:
- **adiar** por um incremento (+15min, +30min, +1h);
- **pular hoje**, o que desliga o encerramento automático até o próximo dia;
- deixar passar, e o encerramento acontece.

**Consequências.** O estado de adiamento é persistido em `estado.json` e é por dia. Reiniciar o
daemon não zera adiamentos já feitos. Não há limite de adiamentos — "pular hoje" é a válvula
de escape explícita, então forçar um teto seria redundante.

---

## D-007 — Estado global em `~/.seeya/`

**Decisão.** Config, estado, handoffs e histórico ficam em `~/.seeya/`. O app
**nunca** escreve dentro dos repositórios das sessões capturadas.

**Consequências.** O `start-day` lê tudo de uma fonte só. Nenhum `.gitignore` de terceiro
precisa ser tocado. O caminho raiz é injetável para que os testes rodem em `tmpdir`.

---

## D-008 — Node 22 + TypeScript, tudo em português

> **A parte de idioma desta decisão foi revogada por D-028.** O texto abaixo fica como estava
> porque decisão revogada é registro, não erro — mas **não** siga a regra de idioma daqui. Hoje:
> identificador, comentário, texto do CLI e mensagem de commit em **inglês**; documentação em
> `docs/` em português. O resto de D-008 (Node 22 LTS, TypeScript estrito, ESM) continua valendo.

**Decisão.** Node 22 LTS, TypeScript estrito, ESM. Identificadores, comentários, mensagens de
commit, documentação e texto do CLI em português.

**Consequências.** Nomes de módulo e de função em PT (`descoberta`, `capturarSessao`). Nomes que
vêm de fora — campos de JSON do Claude Code, APIs de bibliotecas — mantêm a grafia original.

---

## D-009 — Só Claude na v1, mas atrás de uma interface

**Decisão.** A v1 suporta exclusivamente o Claude Code, porém a descoberta e a captura ficam
atrás das interfaces `ProvedorDeSessoes` e `GeradorDeHandoff`. Nenhum outro harness é
implementado agora.

**Consequências.** Nada específico do Claude pode vazar para `core/`. Adicionar Cursor ou
Codex depois deve ser escrever um adapter novo, não editar o núcleo.

---

## D-010 — O binário se chama `seeya`

**Decisão.** O pacote é `see-you-tomorrow`; o comando digitado no terminal é `seeya`.

**Consequências.** `bin: { "seeya": "./dist/cli/index.js" }` no `package.json`. Nenhum outro
alias é publicado na v1. Toda documentação e todo texto de ajuda usam `seeya`.

---

## D-011 — Captura enxuta por padrão, profunda por opção

**Contexto.** Medido no Spike A e no Spike C: `--resume` completo custa ~US$ 0,50 por sessão
(82 k tokens de contexto reescritos no cache); sessão nova com contexto enxuto custa ~US$ 0,15
(dos quais ~12 k tokens são piso fixo do próprio Claude Code, não o nosso texto).

**Decisão.** O padrão é **enxuto**: o `seeya` lê o transcript, extrai o que importa e manda para
uma sessão nova. Projetos marcados com `deepCapture: true` na config usam `--resume`
completo.

**Consequências.**
- `GeradorDeHandoff` tem duas implementações atrás da mesma porta; a escolha é config, não `if`
  espalhado.
- A geração usa `--tools ""`, `--system-prompt` curto e `--json-schema`, para derrubar o piso de
  tokens e domar a saída (Spike C, segundo achado).

  > **CORREÇÃO (2026-08-29, medido na S2-T2).** Os três flags **não compõem**, ao contrário do
  > que esta linha sugeria. Medido com o mesmo contexto, modelo haiku, claude 2.1.235:
  >
  > | flags | tokens de entrada | custo |
  > |---|---|---|
  > | nenhuma | 23.607 | US$ 0,0488 |
  > | `--tools ""` | 7.136 | US$ 0,0159 |
  > | `--tools ""` + `--json-schema` | **40.076** | US$ 0,0831 |
  >
  > O `--tools ""` cumpre a promessa (~70% de redução). O `--json-schema` **mais que quintuplica**
  > o piso em relação a ele, ficando acima até da chamada sem otimização nenhuma. O motivo foi
  > identificado, não só observado: com ele o `stop_reason` vira `tool_use` e o `num_turns` vira 2
  > — a saída estruturada é uma chamada de ferramenta forçada internamente, que o `--tools ""`
  > não desliga.
  >
  > **Os três continuam em uso**: extração confiável pesa mais que o custo marginal, e um
  > handoff que falha ao parsear cai para determinístico, perdendo a camada de entendimento que
  > é o único motivo de chamar o modelo. Mas o piso real do modo enxuto com saída estruturada
  > está perto de **US$ 0,08–0,09** (haiku), não dos US$ 0,15 estimados no Spike C. Ver Q-020.
- O custo estimado do encerramento é mostrado no `--dry-run`.

> **REAVALIAÇÃO (2026-08-31, sob a D-031).** O padrão **continua enxuto**, mas por um motivo
> diferente do original, e com uma obrigação nova.
>
> **O motivo original enfraqueceu.** O enxuto foi escolhido porque ~US$ 0,50 por sessão no modo
> profundo é proibitivo **vezes 40**. A D-031 tirou do escopo as sessões fechadas
> deliberadamente, e o conjunto candidato passou a ser um punhado de sessões vivas. Vezes
> quatro ou cinco, US$ 0,50 deixa de ser proibitivo.
>
> **Mas o profundo não é a resposta, e a razão é o que ele compra.** Ele entrega ao modelo a
> conversa **inteira**, incluindo saída de ferramenta — logs, diffs, listagens. O próprio Claude
> Code, no prompt do away summary (Spike I), manda **pular** exatamente isso: *"Skip root-cause
> narrative, fix internals, secondary to-dos"*. Pagar 5x por contexto que o próprio fornecedor
> instrui a descartar é comprar ruído a preço de sinal.
>
> **O defeito medido é outro, e é barato de consertar.** O modo enxuto monta `buildLeanPrompt`
> com cinco coisas: projeto, `cwd`, última atividade, **os dez últimos prompts do usuário** e
> arquivos tocados. O `processAssistantEntry` (`adapters/transcript/reader.ts`) extrai das
> entradas do assistente **apenas** timestamp e caminhos de arquivo. **O texto do assistente é
> descartado estruturalmente — nunca chega a existir em `SessionFacts`.**
>
> Foi assim que o primeiro teste real perdeu o "4 concluídas, 6 pendentes": a frase existia, dita
> pelo modelo, num turno de assistente. O modelo da captura não falhou — respondeu com honestidade
> sobre evidência que não tinha (D-025). **Não é problema de prompt; é ausência de dado.**
>
> **A decisão: o enxuto para de jogar fora o texto do assistente.** Isso ataca a falha observada
> pelo preço do enxuto, é reversível, e deixa o profundo como o que ele sempre foi — opção por
> projeto, para quem quiser pagar pela conversa inteira.
>
> **Com uma condição, porque senão isto vira o erro que esta própria decisão já cometeu uma vez:**
> **quanto** de texto do assistente entra tem que ser **medido**, não escolhido por analogia. A
> primeira versão desta decisão estimou US$ 0,15 para o enxuto e a medição da S2-T2 achou
> US$ 0,08–0,09 e um `--json-schema` que **quintuplica** o piso — o oposto do que se supunha.
> Mensagem de assistente é longa; escolher "os últimos N" sem medir repetiria a mesma classe de
> erro.
>
> **O que NÃO muda:** o profundo continua opt-in por projeto (`deepCapture`), a saída continua
> estruturada (Q-034 fechada: o caminho barato do cache exige abrir mão dela, e a D-031 tirou a
> pressão de custo que justificaria a troca), e o handoff que falha ao parsear continua caindo
> para determinístico (D-003).


---

## D-012 — Os forks são responsabilidade do `seeya`

**Contexto.** `--fork-session` copia o transcript inteiro para um arquivo novo em
`~/.claude/projects/`. Sem tratamento, o `seeya` descobriria os próprios forks como sessões e
tentaria capturá-los, gerando novos forks — laço de realimentação.

**Decisão.** Todo `sessionId` de fork criado pelo `seeya` é registrado em
`~/.seeya/forks.json`. A descoberta **exclui** esses IDs. Forks com mais de
`forkCleanupDays` (default 7) são apagados.

**Consequências.** Apagar arquivo dentro de `~/.claude/projects/` é a **única** exceção à regra
"nunca escreva em `~/.claude/`", e vale exclusivamente para forks que o próprio `seeya` criou e
registrou. Qualquer outro arquivo ali é intocável.

---

## D-013 — Transcript é uma fonte de evidência, não a fonte

**Contexto.** Existem sessões sem transcript utilizável, e a causa é **conhecida** desde o Spike
D: o Claude Code 2.1.233 suprime a persistência em três situações — marcador de sessão filha
herdado, `CLAUDE_CODE_SKIP_PROMPT_HISTORY` definido, e falha de escrita do transcript. Nos dois
primeiros casos o próprio produto avisa que **`--resume` não encontrará a sessão**. No terceiro,
o transcript existe mas está incompleto, sem sinal externo que o distinga de uma sessão curta.

Caso real: as sessões do agente `agente-interno` caem no primeiro caso. O estado real delas vive numa
issue e num **worktree** criado no projeto.

A decisão abaixo não depende da causa: mesmo com a supressão corrigida via
`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`, transcript ausente, incompleto ou ilegível continua
sendo caso a tratar — e o worktree continua sendo a fonte mais informativa desse tipo de sessão.

**Decisão.** A captura coleta evidências de **várias fontes independentes**, e o transcript é
apenas uma delas. As fontes da v1, por ordem de confiabilidade:

1. **Git** — branch, commits do dia, diff não commitado, e **worktrees** do repositório, com o
   estado de cada um.
2. **Transcript**, quando existe.
3. **Registro de processos** — `cwd`, nome, horário de início.

Um handoff é útil se **qualquer** fonte responder. Sessão sem transcript mas com worktree ativo
gera handoff bom.

**Além disso:** o `seeya` detecta a ausência de transcript **assim que vê a sessão**, não no fim
do dia, e notifica na hora — quando ainda dá para reagir.

**Consequências.**
- `adapters/git` cresce: precisa enumerar worktrees (`git worktree list`), não só o `cwd`.
- O handoff ganha `fontes: []` declarando de onde cada informação veio.
- `source: "noTranscript"` é um estado normal, não um erro.

---

## D-014 — O wrapper PTY é v2, e é aditivo

**Decisão.** O `seeya claude` — subir o Claude dentro de um PTY controlado pelo `seeya`, para
poder pedir o handoff à própria sessão — fica para a v2. Quando chegar, **coexiste** com a
descoberta: será o modo recomendado de abrir sessão, mas a descoberta continua funcionando para
tudo que for aberto sem ele. Nada passa despercebido por não ter usado o wrapper.

**Consequências.**
- A descoberta é o piso permanente da arquitetura, nunca substituída pelo wrapper.
- `ProvedorDeSessoes` precisa suportar duas origens simultâneas sem duplicar sessão: uma sessão
  aberta via wrapper aparece **uma vez**, não duas.
- É o caminho para harnesses sem transcript legível (codex e afins), conforme D-009.
- Riscos conhecidos, a tratar quando for a hora: `node-pty` é dependência nativa; o passthrough
  precisa ser impecável (resize, raw mode, alt screen, Ctrl+C); injetar texto com um diálogo de
  permissão aberto responde o diálogo. O wrapper pede o handoff **em arquivo**, nunca lê a tela.

---

## D-015 — Contexto vai por stdin ou arquivo, nunca por argumento

**Contexto.** No Spike C o contexto multilinha foi passado como argumento de linha de comando e
chegou mutilado ao modelo — o PowerShell quebrou a string e o modelo recebeu uma palavra solta.

**Decisão.** Todo texto de tamanho variável enviado ao `claude` vai por **stdin** ou por arquivo
temporário. Argumento de linha de comando só para flags e valores curtos e conhecidos.

**Consequências.** Vale junto com a regra já existente de `spawn` com array e `shell: false`.

> **CORREÇÃO (2026-08-30, medida na S3-T2).** Esta decisão generalizou de uma causa específica
> para uma proibição ampla, e a generalização não se sustenta. **O que mutilou o texto no Spike C
> foi o shell, não o argumento.** Medido com o `claude` real (2.1.235): passando por
> `spawn(bin, [...args, texto], { shell: false })`, um prompt com quebra de linha, aspas dos dois
> tipos, `%` e acento volta **byte a byte idêntico**. Cerca de 19 KB no argumento também passam.
>
> A regra continua valendo, e agora com o limite certo: **texto de tamanho variável não vai por
> argumento quando a invocação puder alcançar um shell, e não vai quando puder ser grande** — o
> Windows corta a linha de comando perto de 32.767 caracteres, e estourar isso falha de forma
> feia. Onde o projeto já usa stdin ou arquivo, continua usando: é mais seguro e não custa nada.
>
> **O caso que forçou a revisão** é a retomada interativa (D-004). Medido: sem TTY real, o
> `claude --resume` **não abre sessão interativa** — detecta a ausência de terminal, responde uma
> vez em texto puro e sai. Para haver sessão interativa de verdade, o processo precisa herdar um
> TTY real; e a partir do momento em que o stdin **é** o terminal do usuário, ele é o teclado, e
> não há como o `seeya` escrever nele por fora. O argumento posicional é o único canal que resta.
>
> Não é exceção à regra: é a regra dita com precisão. Ver Spike H.
Tem teste de integração dedicado, com conteúdo contendo quebra de linha, aspas, acento e `%`.

---

## D-016 — Descoberta por duas estratégias, não uma

**Contexto.** O Spike D mostrou que **sessão headless (`claude -p`) deixa transcript mas não se
registra** em `~/.claude/sessions/`. Uma descoberta baseada só no registro é cega para todo
agente de execução, que é justamente o caso que mais precisa de handoff.

**Decisão.** `ProvedorDeSessoes` combina duas estratégias e devolve a **união deduplicada por
`sessionId`**:

1. **Registro** — `~/.claude/sessions/*.json`. Dá `pid`, liveness, `kind`, `name`. Só enxerga
   interativas.
2. **Varredura de transcripts** — `~/.claude/projects/<slug>/*.jsonl` — **um nível, não recursivo**;
   sub-agentes escrevem um nível abaixo e não são sessões (ver o comentário de
   `adapters/discovery/transcript-scan.ts`) — filtrado por mtime dentro de
   `relevanceHours`. Enxerga headless também. Não dá `pid` nem liveness.

Sessão vista pelas duas tem os dados fundidos; sessão vista só pela varredura entra com
`pid: null` e estado `unknown` — nunca é candidata a encerramento de processo (D-002).

**Consequências.**
- A varredura precisa ser barata: `stat` por arquivo, sem ler conteúdo, antes de qualquer parse.
- Ela vê os forks do próprio `seeya`, então a exclusão de D-012 passa a ser **crítica**, não
  higiênica.
- O `cwd` de uma sessão vinda só da varredura tem de ser reconstruído do conteúdo do transcript,
  já que o slug do diretório é irreversível com segurança.
- Esta decisão substitui a suposição, agora sabidamente errada, de que o registro seria
  suficiente.

---

## D-017 — O `seeya` declara o ambiente que dá ao `claude`, nunca herda

**Contexto.** O Spike D mostrou que `CLAUDE_CODE_CHILD_SESSION` é herdado por todo processo
filho e suprime o transcript na 2.1.233. O `seeya` spawna `claude` para gerar handoffs, e o
daemon muito provavelmente será iniciado de dentro de uma sessão Claude — o projeto é
desenvolvido assim. Sem tratamento, o `seeya` contamina as próprias invocações com estado
ambiental que ele não escolheu.

**Decisão.** Ao spawnar `claude`, o `seeya` monta o ambiente **explicitamente**, partindo do
ambiente do sistema e **removendo** as variáveis de sessão herdadas: `CLAUDE_CODE_CHILD_SESSION`,
`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_PID`, `CLAUDECODE`,
`CLAUDE_AGENT_SDK_VERSION`. Depois define o que precisa, por modo:

| Modo | Persistência desejada | Como |
|---|---|---|
| Enxuto (padrão) | **nenhuma** — a sessão é descartável | `--no-session-persistence` |
| Profundo | **sim** — o fork precisa existir | `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` |

**Consequências.**
- **Simplifica D-012**: no modo enxuto, que é o padrão, nenhum fork ou transcript é criado.
  O registro e a limpeza de forks passam a valer só para o modo profundo.
- Sem isso, o modo profundo falharia silenciosamente quando o daemon fosse iniciado de dentro
  de uma sessão Claude — o fork não seria criado e `--resume` não acharia nada.
- Teste de integração dedicado: verificar o `env` entregue ao processo filho em cada modo.

---

## D-018 — Detectar a supressão e dizer como resolver

**Decisão.** Quando o `seeya` encontra uma sessão registrada sem transcript, ele não se limita a
degradar o handoff (D-013): informa **a causa provável e a correção**, uma vez por `sessionId`.

```
Sessão "agente-interno-ui-03" (c:\work\projeto) está sem transcript.
Causa provável: marcador de sessão filha herdado (sessão aberta de dentro de outra sessão).
Correção: definir CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 no ambiente de quem abre a sessão.
O handoff desta sessão usará git e worktree como fonte.
```

**Consequências.**
- O `seeya` registra a versão do Claude Code observada em cada handoff — o comportamento varia
  entre versões na mesma máquina (2.1.201 e 2.1.233 coexistindo foi o caso real).
- A captura profunda (D-011) detecta sessão suprimida e **cai para enxuto** em vez de tentar um
  `--resume` que o produto já declara que vai falhar.

---

## D-021 — Campo de exibição nunca torna uma sessão invisível

**Contexto.** O schema do registro de sessões nasceu exigindo `name`, `entrypoint` e `kind`. O
review mediu a consequência: um registro sem qualquer um dos três é rejeitado inteiro, e a
sessão desaparece da descoberta por registro. D-016 dá uma segunda chance pela varredura de
transcripts, mas as duas falhas se cruzam — registro rejeitado **e** transcript suprimido
(D-013) — e a sessão fica totalmente invisível. É estreito, e é exatamente a classe de bug que
este projeto existe para evitar.

**Decisão.** Os campos do registro se dividem em dois grupos, com tratamento diferente:

| Grupo | Campos | No schema |
|---|---|---|
| **Identidade e liveness** | `sessionId`, `cwd`, `pid`, `procStart`, `startedAt` | obrigatórios |
| **Classificação e exibição** | `kind`, `entrypoint`, `name` | `.optional()`, com padrão no adapter |

Padrões do adapter: `name` ausente vira o nome derivado do `cwd`; `kind` e `entrypoint`
ausentes viram `"desconhecido"`.

**Consequências.**
- Nenhum campo cosmético pode reprovar um registro. Se dá para identificar e localizar a
  sessão, ela entra.
- Vale como princípio geral, não só para este schema: ao validar dado externo, campo que só
  serve para exibir é sempre opcional.
- Teste obrigatório em S1-T3: registro sem `name` é descoberto, com o nome derivado do `cwd`.

---

## D-022 — Lista de fonte externa valida item por item, nunca em bloco

**Contexto.** `agentsJsonOutputSchema` era `z.array(item)`. Testado contra a saída real de uma
segunda máquina, Linux, **rejeitou o array inteiro** por causa de uma única entrada: uma
sessão `kind: "background"` que não tem `pid` (tem `id`) e usa `state` em vez de `status`. Uma
sessão de background e o `seeya` perderia a fonte de descoberta completa.

Isso contradizia o próprio `CLAUDE.md`: "arquivo externo corrompido ou com campo desconhecido:
registre e siga em frente. Nunca derrube o comando inteiro por causa de uma entrada ruim". A
regra existia; o schema não a cumpria, porque `z.array` é tudo-ou-nada.

**Decisão.** Toda coleção que vem de fonte externa é validada **por item**. Itens válidos entram,
itens inválidos são registrados e descartados individualmente, e a operação segue. Vale para:

- a saída de `claude agents --json`
- os arquivos de `~/.claude/sessions/*.json`
- as entradas do `.jsonl` de transcript
- os handoffs lidos de `~/.seeya/`

**Consequências.**
- O tipo de retorno declara os dois lados: os itens aceitos **e** os rejeitados com o motivo, para
  que o `seeya sessions` possa dizer "3 sessões, 1 entrada ignorada" em vez de mentir por omissão.
- `agentsJsonItemSchema` ganha `pid` opcional e aceita a variante de background (`id`,
  `state`). Item sem `pid` nunca é candidato a encerramento de processo, igual à sessão vinda só
  da varredura (D-016).
- Teste obrigatório: um array com uma entrada boa e uma inválida devolve a boa e reporta a outra.
  Sem esse teste, alguém "simplifica" de volta para `z.array` e o furo volta.

---

## D-023 — Terceira estratégia de descoberta: o processo, e o `.key` sem `.json`

> **REVOGADA por D-029 em 2026-08-19.** O fenômeno observado é real, mas a causa que este texto
> atribui — "lançada com prompt como argumento" — **não se confirma**, e o custo da resposta era
> desproporcional ao caso. O texto fica como registro; **não implemente a partir daqui.**
>
> Este documento tem um defeito que vale nomear: ele **não registra a versão** do Claude Code sob
> a qual a medição foi feita, num projeto onde todo spike registra. Foi exatamente essa lacuna
> que quase produziu o erro oposto — ver D-029.

**Contexto.** Um agente de execução autônomo, lançado por um script com o prompt como argumento
(`claude --dangerously-skip-permissions "/<comando> --item <N>"`), **não aparece** em
`claude agents --json` nem produz `<pid>.json` em `~/.claude/sessions/` — mesmo estando vivo e
trabalhando. As duas estratégias de D-016 são cegas para ele: sem `.json` para ler, e sem
transcript para varrer (D-013).

Medido cruzando a lista de processos do SO com o conteúdo do diretório de sessões:

| Sessão | `<pid>.json` | `<pid>.<hash>.key` |
|---|---|---|
| interativa comum | sim | às vezes |
| **lançada com prompt como argumento** | **não** | **sim** |

O arquivo `.key` estava lá o tempo todo. Foi descartado antes como "resíduo órfão de limpeza
incompleta" — errado: os `.key` sem `.json` correspondiam, PID a PID, às sessões autônomas ativas.

**Decisão.** `ProvedorDeSessoes` ganha uma terceira estratégia, e ela tem **duas fontes que se
confirmam**:

1. **`.key` sem `.json` no diretório de sessões.** Dá o PID pelo nome do arquivo. Barato: uma
   listagem de diretório, sem ler conteúdo. O `.key` é material sensível (modo 600) — o `seeya`
   **lê apenas o nome do arquivo, nunca o conteúdo**.
2. **EnumeraÇão de processos do SO.** Confirma que o PID está vivo e entrega o que o registro não
   tem: a **linha de comando** e o `cwd`.

**A linha de comando é fonte de handoff, não só de identificação.** `/<comando> --item 2990` diz o
que a sessão está fazendo e em qual item de trabalho — informação de primeira ordem para uma
sessão que não tem transcript nenhum.

**Consequências.**
- Capacidade por plataforma, medida: Linux dá `cwd` por `/proc/<pid>/cwd`; macOS por `lsof`;
  **Windows não dá** `cwd` sem código nativo. Aceitável — no Windows essas sessões produzem
  `.json` normalmente, então a estratégia não é necessária lá.
- Deduplicação (D-016) por **PID** para sessão viva, já que esta origem não fornece `sessionId`.
- Sessão vinda só desta origem entra com `sessionId: null` e nunca é candidata a encerramento de
  processo (D-002).
- O `.key` sem `.json` **não** é sinal de sessão morta: é sinal de sessão que se registra de outra
  forma. Não trate como entrada obsoleta.

---

## D-024 — Schema valida com fidelidade; o domínio torna o estado inválido irrepresentável

**Contexto.** O review de S1-T0c provou que `pid` opcional protege apenas por comentário:
`item.pid!` compila sem erro. Nada no tipo impede alguém escrever `terminarProcesso(item.pid!)`.
A sugestão foi transformar o item numa união discriminada dentro do schema.

**Decisão.** As duas responsabilidades ficam em camadas diferentes, e é isso que resolve:

| | Responsabilidade | Consequência |
|---|---|---|
| **Schema** (`adapters/`) | reproduzir a realidade com **fidelidade** | se existe variante sem `pid`, ele aceita. Apertar aqui seria mentir sobre o mundo. |
| **Tipo de domínio** (`core/`) | tornar estado inválido **irrepresentável** | `pid` não é campo opcional de um tipo só; são **duas formas distintas** de sessão. |

O tipo de domínio de sessão descoberta é uma **união discriminada**: uma forma que carrega `pid`
garantido e outra que não tem PID nenhum. A política de encerramento (D-002) só aceita a primeira,
e o compilador recusa a segunda — sem `!`, sem `as`, sem depender de ninguém ler comentário.

**Consequências.**
- Vira requisito de **S1-T1**, que define os tipos de `core/`. Não é correção de schema.
- O adapter de descoberta converte da forma do schema para a forma de domínio, e é ali que a
  decisão "tem PID ou não" acontece **uma vez**, em vez de em cada chamador.
- Regra geral: `!` e `as` em código de produção são sinal de que o tipo está errado, não de que o
  autor sabe mais que o compilador.

**Um achado que foi recusado, para não ser "corrigido" depois:** o review notou que um item com
`sessionId` + `cwd` + `startedAt`, mas **sem `pid` e sem `id`**, é aceito. Isso é correto e
deliberado. Por D-021, identidade é `sessionId` e `cwd`; `pid` é liveness. Um item assim é uma
sessão **identificável e capturável**, só não encerrável — exatamente o caso que D-021 existe para
não perder. Exigir `pid` ou `id` reintroduziria o bug que D-021 corrigiu.

---

## D-025 — Ausência de dado não vira afirmação sobre o mundo

**Contexto.** Ao classificar o estado de uma sessão viva cuja última escrita no transcript é
`null` — porque não há transcript —, a implementação de S1-T1 retornou **`idle`**, com o
argumento de que é a leitura literal de "sessão viva sem escrita no transcript há mais de
`idleMinutes`" no caso degenerado.

**Decisão. Está errado, e a resposta correta é `alive`.** O próprio glossário resolve:

- **`alive`** = "sessão cujo processo está em execução agora". É exatamente o que se sabe quando o
  PID está vivo.
- **`idle`** = "sessão **viva** sem escrita no transcript há mais de `idleMinutes`". É um
  **refinamento** de `alive`, e depende de evidência de não-escrita.

Com `null` não há transcript, logo não há como estabelecer "sem escrita há mais de X minutos" —
não há como estabelecer nada sobre escrita. `idle` é uma **afirmação**; `null` é **ausência de
dado**. Converter uma na outra é o erro.

**Por que isso importa mais do que parece.** `null` é precisamente o caso de D-013: transcript
suprimido, que é o agente de execução autônomo. Marcá-lo como `idle` diria "não está fazendo
nada" justamente sobre a sessão com maior probabilidade de estar trabalhando a todo vapor e
invisível. O `seeya sessions` mentiria com confiança, e sobre o caso que mais importa.

**Consequências.**
- `classifyState` devolve `alive` quando o processo está vivo e `lastTranscriptWrite` é
  `null`. Só devolve `idle` com um timestamp real que já passou do limite.
- Vale como princípio geral do domínio: **nenhuma regra converte "não sei" em afirmação
  positiva.** Quando faltar dado, o resultado é o estado menos específico que a evidência
  sustenta, nunca o mais específico que ela permitiria imaginar.
- Teste obrigatório: sessão viva com `null` é `alive`; sessão viva com timestamp antigo é `idle`.
  Os dois casos, sempre — sem o primeiro, alguém "otimiza" de volta.

---

## D-026 — Anti-duplicidade compara evidência, não transcript

**Contexto.** A condição de anti-duplicidade dizia "não tem handoff do dia corrente com
**transcript** inalterado desde então". O review de S1-T1 mediu a consequência: com transcript
ausente nas duas capturas, `null == null` conta como inalterado, e a sessão fica presa como
duplicada pelo resto do dia — **mesmo que a árvore git tenha mudado**.

O caso atingido é exatamente o do agente de execução autônomo (D-013): sem transcript, com o
trabalho todo em commits e worktree. A condição foi escrita antes de D-013 tornar a evidência
multi-fonte, e nunca foi revista. A implementação de S1-T1 é leitura fiel do texto — o texto é
que estava errado.

**Decisão.** A anti-duplicidade compara a **assinatura da evidência**, não o transcript. Se
qualquer fonte de D-013 mudou desde a última captura do dia, a sessão **não** é duplicada.

**Consequências.**
- A assinatura cobre as fontes de D-013: última atividade do transcript **quando existe**, e o
  estado do git — HEAD, sujeira, commits do dia, worktrees.
- `null` em uma fonte não é "inalterado": é ausência daquela fonte, e o julgamento passa às
  demais (mesmo princípio de D-025 — ausência de dado não vira afirmação).
- O handoff persiste a assinatura para a comparação seguinte. O formato exato é de S2-T3, quando
  houver handoff de verdade; o que S1-T1 precisa é a regra receber a assinatura pronta, não
  calculá-la.
- Teste obrigatório: duas capturas sem transcript, **com git alterado** entre elas, **não** são
  duplicadas. É o caso que motivou a decisão e o que mais dói se voltar.

---

## D-027 — O diretório de dados é `~/.seeya/`, igual ao comando

**Contexto.** O projeto tinha três nomes em circulação: o produto **See You Tomorrow AI**, o
pacote `see-you-tomorrow-ai`, o comando `seeya` — e um diretório de dados `~/.see-you-tomorrow/`
que não batia com nenhum deles. Era resíduo do nome anterior ao `-ai`.

**Decisão.** `~/.seeya/`, igual ao comando que a pessoa digita.

O argumento decisivo é de descoberta: quem se pergunta "onde o `seeya` guarda as coisas?" chuta
o nome do comando. É o precedente do próprio Claude Code — comando `claude`, diretório
`~/.claude/`. Nome de pacote é coisa de quem instala; nome de comando é coisa de quem usa.

**Consequências.**
- Trocado enquanto custava uma substituição em documento: **zero linha de código** usava o
  caminho, porque `adapters/armazenamento` (S1-T5) ainda era stub. Depois do S1-T5 e de uma
  semana de uso, custaria código de migração, detecção de diretório antigo e o risco de handoff
  órfão numa pasta que ninguém olha mais.
- A raiz continua **injetável**: nenhum teste toca o diretório real, e o nome não fica espalhado
  pelo código.
- **Não adotamos XDG** (`~/.config/seeya`, `~/.local/share/seeya`) na v1. É a convenção correta
  no Linux e triplicaria a resolução de caminho por plataforma; fica anotado para a v2, quando
  houver usuário Linux de verdade reclamando — não antes.

**Regra que vale além deste caso:** nome de diretório, arquivo de estado ou chave persistida é
decisão **barata antes do primeiro byte gravado e cara depois**. Quando perceber divergência de
nomenclatura, corrija enquanto não há dado de ninguém dentro.

---

## D-028 — Inglês no que é público, português no que é interno

**Revoga a parte de idioma de D-008**, que mandava tudo em português.

**Contexto.** O projeto é de código aberto por intenção. Identificador em português é o sinal mais
visível de "isto não é para você" que um leitor de fora encontra — antes de qualquer documento.
Mas a documentação interna é o ativo mais incomum daqui, e ela é rica **porque escrever é barato
para o mantenedor**. Traduzi-la cobraria duas vezes: as ~22 mil palavras agora, e cada decisão
futura escrita mais devagar, para sempre, num projeto que não é o trabalho principal de ninguém.

Medido antes de decidir: `src/` tem **923 linhas**, `tests/` 2.892, documentação 2.816 linhas.
O código é barato de migrar hoje e caro depois do Sprint 2.

**Decisão.**

| | Idioma |
|---|---|
| Identificadores e comentários de código | **inglês** |
| README | **inglês** |
| Comandos e saída do CLI | **inglês** |
| Mensagens de commit, daqui em diante | **inglês** |
| `docs/` — decisões, spec, arquitetura, plano, spikes, questões | **português** |
| Conversa entre PO e agentes | **português** |

As 114 mensagens de commit anteriores **ficam em português**. São registro histórico; a emenda
marca quando a decisão foi tomada, e reescrever seria churn sem retorno.

**O risco desta divisão é deriva de termo** — `elegibilidade` no documento, `eligibility` no
código, e daqui a três meses alguém inventa `eligible` num terceiro lugar. A mitigação é o
**glossário de domínio em `AGENTS.md` § Idioma**, que fixa a tradução de cada termo. Termo novo
entra no glossário **antes** de entrar no código.

**Consequência para o CLI, e uma dívida assumida.** O CLI nasce em inglês, e isso deixa o
mantenedor digitando comandos num idioma que não é o dele. A saída é configuração de idioma,
registrada como trabalho futuro em `docs/FORA-DE-ESCOPO.md`. Para que ela seja **extração e não
arqueologia**, vale desde já: **texto voltado ao usuário fica concentrado, nunca espalhado em
`console.log` pelo meio da lógica.** Essa é a única parte da i18n que custa caro se for deixada
para depois.

---

## D-019 — O que é proibido é ler o relógio, não construir uma data

**Contexto.** O guard de S0-T2 baniu o identificador `Date` inteiro fora de
`adapters/relogio/`. O review apontou, com razão, que isso vai além do que `CLAUDE.md` pedia e
gera atrito real: `new Date(stringIso)` para parsear um timestamp de transcript, de `procStart`
ou de data de commit é **transformação determinística de dado**, não leitura do "agora". Sem
isso, S1-T2, S1-T4 e S2-T1 precisariam de `eslint-disable` em cascata — e guard que todo mundo
desliga deixa de ser guard.

**Decisão.** O que é proibido fora de `adapters/relogio/` é a **fonte não-determinística de
tempo**, não o tipo `Date`:

| Construção | Fora de `clock/` |
|---|---|
| `new Date()` sem argumento | **proibido** — use a porta `Relogio` |
| `Date.now()` | **proibido** — use a porta `Relogio` |
| `setTimeout` / `setInterval` | **proibido** |
| `new Date(valor)` com argumento | **permitido** |
| `Date.parse(valor)`, métodos de instância | **permitido** |

**Consequências.**
- `no-restricted-globals` não distingue aridade; a regra passa a ser `no-restricted-syntax` com
  os seletores `NewExpression[callee.name='Date'][arguments.length=0]` e
  `CallExpression[callee.object.name='Date'][callee.property.name='now']`.

**Limitação conhecida e aceita.** O review mediu: o seletor casa forma sintática, não fluxo de
dados, então quatro construções escapam — `const D = Date; D.now()`, `Date['now']()`,
`globalThis.Date.now()` e `new Date(...[])`. Nenhuma delas é escrita por acidente, e as formas
literais `new Date()` e `Date.now()`, que são o risco real, são pegas. O guard cobre o
descuido, não o contorno deliberado — e isso é suficiente, porque contorno deliberado também
passa por review. Não chame estes seletores de "à prova de bala" na documentação.
- A porta `Relogio` **não** ganha método de parsing. Ela existe para responder "que horas são",
  e essa continua sendo a única pergunta não-determinística.
- Testes de guarda obrigatórios para os dois lados: `new Date()` reprovado, `new Date(iso)`
  aprovado, ambos fora de `clock/`. Sem o teste do caso permitido, a regra pode voltar a ser
  estrita demais sem ninguém notar.

---

## D-020 — `cli/` é a única raiz de composição

**Contexto.** `docs/ARQUITETURA.md` diz que todo acesso ao mundo passa por uma porta de
`nucleo/portas.ts`, mas as regras de camada não impediam `application/` de importar
`adapters/` direto. Verificado na prática: `application` importando `adapters/git` passa sem
reclamação. Isso deixaria um caso de uso instanciar adapter concreto e furar as portas — e
levaria junto a garantia de que teste unitário não toca disco.

**Decisão.** Só `cli/` pode nomear adapter concreto. É ele que constrói as implementações e as
injeta em `application/` e em `scheduler/`.

| De → Para | |
|---|---|
| `application` → `adapters` | **proibido** — dependa da porta em `core/` |
| `scheduler` → `adapters` | **proibido** — recebe injetado do `cli` |
| `cli` → `adapters` | permitido — é a raiz de composição |
| `cli` → `scheduler`, `cli` → `application` | permitido |
| `scheduler` → `application` | permitido |

**Consequências.**
- Todo caso de uso recebe suas dependências por parâmetro ou construtor. Nenhum faz `import`
  de implementação.
- É isto que torna executável a regra de `docs/TESTES.md` de que nenhum teste unitário toca
  disco: sem acesso ao adapter, não há como tocar.
- `docs/ARQUITETURA.md` ganha esta tabela; a regra de dependência lá deixa de ser só o diagrama
  de setas.

---

## D-029 — Revoga a terceira estratégia: avisar, em vez de contornar

**Revoga D-023.** Proposta do mantenedor, em 2026-08-19.

**Contexto.** O D-023 criou uma terceira estratégia de descoberta para enxergar sessões que não
se registram e não deixam transcript. Ela custou: uma terceira forma na união de tipos do
núcleo, enumeração de processos por sistema operacional (Linux por `/proc`, macOS por `lsof`,
Windows sem suporte), captura de linha de comando com a questão de privacidade que ela abre, e
um identificador — o PID — que não é estável entre varreduras.

**O argumento que decide, e ele já estava no repositório.** O **D-018** enfrenta a mesma causa
raiz — sessão aberta de dentro de outra sessão — e escolhe resposta oposta: **informar a causa
provável e a correção**, uma vez por sessão, deixando o usuário resolver. O projeto estava
dando duas respostas incoerentes para o mesmo problema: explicar num caso, construir maquinaria
no outro.

E a perda é pequena: a sessão-filha invisível foi lançada por uma **sessão pai que é visível e
tem transcript próprio**. O trabalho não desaparece do alcance do `seeya`; muda de sujeito.

**Medição feita antes de revogar (2026-08-19, Windows 11).** O D-023 afirma que uma sessão
"lançada com prompt como argumento" não produz `<pid>.json` e produz `<pid>.<hash>.key`.
Testado com amostragem contínua — necessária porque a entrada do registro é apagada na saída
graciosa (Spike E), e uma primeira tentativa que conferiu só ao final viu "nada" por isso:

| binário | aninhado? | `.json` | `.key` | transcript |
|---|---|---|---|---|
| 2.1.235 | sim (`CLAUDE_CODE_CHILD_SESSION=1`) | **sim** | não | sim |
| 2.1.233 | sim (idem) | **sim** | não | sim |

A 2.1.233 é a versão que os documentos apontam como portadora do supressor. Nas duas, a sessão
se registrou normalmente. **A hipótese de versão está descartada** — e essa checagem não foi
zelo: o projeto já concluiu errado uma vez por testar numa versão diferente da observada
(Spike D), e o D-023 não registra sob qual versão mediu.

**O que continua não testado**, e por isso a decisão não se apoia nisso: o caminho real, com
script intermediário, aninhamento mais profundo e sessões de vida longa. As sessões de teste
viveram de 4 a 6 segundos. O fenômeno observado pelo mantenedor é real; o que caiu foi a **causa
atribuída**, não a observação.

**Decisão.** A descoberta volta a ter **duas** estratégias (D-016). No lugar da terceira:

1. **A detecção barata fica.** Listar `~/.claude/sessions/` e ver `.key` sem `.json` custa uma
   listagem de diretório. Isso continua, e alimenta o aviso.
2. **O aviso substitui o contorno**, como extensão do D-018 e da S1-T7: o `seeya` diz quantas
   sessões existem que ele **não consegue inspecionar**, e aponta o caminho conhecido (sessão
   aberta de dentro de outra). Não afirma a causa como certa — ela não está estabelecida.
3. **Sai tudo o que vinha depois:** enumeração de processos, leitura de `cwd`, captura de linha
   de comando, e a terceira forma da união de tipos.

**Consequências.**
- O `.key` continua sendo lido **apenas pelo nome**. Nunca o conteúdo (modo 600).
- **Q-011 deixa de existir**: sem captura de linha de comando, não há segredo indo para disco.
- **Q-010 deixa de existir**: sem essa origem, nada é deduplicado por PID.
- A união de tipos volta a **duas** formas, e o núcleo simplifica.
- O buraco do Windows (sem `cwd` sem código nativo) para de importar.
- Se o gatilho verdadeiro for identificado um dia, isto reabre — mas aí com causa conhecida, e a
  resposta provavelmente continua sendo avisar, não contornar.

## D-030 — Independência de harness: a costura é a porta, não o nome da classe

**Proposta do mantenedor, em 2026-08-30**, ao revisar a Q-027 item 1: o `seeya` hoje só funciona
com o Claude Code, mas há intenção de suportar outros harnesses, e ele pediu **ambiente agnóstico
desde já** — sem propor o suporte agora.

**A decisão.** A independência de harness mora em `core/ports.ts`. Cada porta é declarada em
vocabulário neutro (`SessionProvider`, `TranscriptReader`, `HandoffGenerator`, `SessionResumer`,
`ProcessControl`, `Storage`) e cada adaptador é nomeado pelo que **de fato** amarra
(`ClaudeSessionResumer`). Isso não é acidente de nomenclatura: é onde a troca acontece.

**Três consequências, que é o que esta decisão existe para não deixar decair:**

1. **Adaptador não vira genérico no nome.** Renomear `ClaudeSessionResumer` para
   `HarnessSessionResumer` tornaria o nome **menos** exato — a classe spawna `claude --resume` e
   depende de flags específicos dele. Nome de adaptador descreve a amarração, não a aspiração.

2. **Segundo harness é adaptador novo, não hierarquia.** Nada de classe-base `HarnessResumer`
   com uma subclasse. O que varia entre harnesses não é um algoritmo comum com ganchos: é se
   `--resume` existe, como sessão é identificada, se dá para reatar sessão. Dois adaptadores
   compartilhariam a assinatura da porta — que já ganham implementando-a — e quase nada além.
   A escolha de qual usar é do `cli/`, a única raiz de composição (D-020).

3. **O núcleo pode citar um harness em texto para humano; nunca em tipo, ramo de decisão ou
   caminho de arquivo.** Auditado em 2026-08-30: os únicos pontos de `src/core/` que nomeiam
   o Claude Code são `early-warnings.ts` (conselho que cita `CLAUDE_CODE_*`) e `resume-notice.ts`
   ("claude exited with code N"). Os dois são mensagem impressa, e ficam. Um `if` sobre qual
   harness é, um campo de tipo com nome de harness ou um caminho como `~/.claude` dentro de
   `core/` seriam violações — esses pertencem a `adapters/`.

**Por que escrever agora, sem suporte a segundo harness no horizonte.** Porque o custo de perder
a costura é assimétrico: mantê-la é de graça (já está assim), e recuperá-la depois de alguém
"generalizar" o nome do adaptador ou enfiar um ramo de harness no núcleo é caro. Esta decisão não
pede trabalho nenhum hoje — ela impede trabalho errado amanhã.

## D-031 — O `seeya` captura o que está vivo, e o que morreu por acidente

**Proposta do mantenedor, em 2026-08-30**, depois do primeiro teste ponta a ponta real.

**Contexto.** O produto existe para fazer um **corte do trabalho em andamento** e devolver a
pessoa a ele no dia seguinte. Sessão fechada não é trabalho em andamento — e, pior, **não diz
nada sobre por que foi fechada**: pode ter sido concluída, abandonada, ou fechada para continuar
depois. Nada no rastro distingue os três.

A analogia do mantenedor, que é o argumento inteiro em uma frase: seria o equivalente a, em vez
de olhar os documentos **abertos** no fim do dia, varrer o computador inteiro atrás de todos os
arquivos alterados naquele dia. E a escala não é hipotética — ele abre e fecha **mais de 40
sessões** num dia de trabalho normal.

**O sinal que separa os casos já estava medido.** O Spike E mediu que a entrada do registro
existe apenas enquanto o processo vive e **é apagada na saída graciosa**; entrada obsoleta
sobrevive só a terminação anormal — kill, crash, queda de energia. Nas palavras do próprio
spike: *"entrada obsoleta é acidente, nunca registro confiável de trabalho concluído"*. Isso dá
três populações, não duas:

| situação | significado | escopo |
|---|---|---|
| registro + PID vivo (`alive`/`idle`) | sessão viva | **captura** |
| registro + PID morto (`ended`) | morreu **sem** sair graciosamente | **captura** |
| só transcript, sem registro (`unknown`) | saiu graciosamente: a pessoa fechou | **fora** |

**Decisão.** A captura do fim do dia cobre a sessão viva e a que morreu por acidente. A sessão
fechada deliberadamente **sai do escopo da captura**.

A segunda linha não é concessão: terminal fechado no braço, máquina que suspendeu e não voltou,
`claude` que caiu — a pessoa **perdeu** aquilo sem escolher, que é exatamente quando um handoff
mais serve. Só a saída graciosa é decisão dela.

**A sessão fechada aparece no briefing como listagem, nunca como captura.** E a listagem só se
justifica se identificar a sessão **para um humano**: "code-6d, fechada 17h" não diz nada a
ninguém.

**Medido em 2026-08-30, depois de o mantenedor perguntar de onde vem o "recap" que ele usa para
reconhecer as próprias sessões.** O recap longo que ele mostrou **não está em disco**: varredura
de todo o `~/.claude` atrás das frases dele achou só a mensagem em que ele próprio o citou
(`history.jsonl` e o transcript da sessão). É gerado para exibição, não persistido.

**Mas duas entradas do transcript servem, e saem de graça:**

| entrada | forma | nesta sessão |
|---|---|---|
| `ai-title` | `{ type, aiTitle, sessionId }` | 388 ocorrências — regravada conforme a sessão evolui |
| `last-prompt` | `{ type, lastPrompt, leafUuid, sessionId }` | 387 ocorrências |

O `aiTitle` desta sessão, no momento da medição: *"Planejar desenvolvimento do app
see-you-tomorrow"*. Não é o recap rico — é bem mais curto. Mas as 388 ocorrências mostram que ele
**acompanha o assunto ao longo do dia** em vez de congelar no começo. E o `last-prompt` mostra que
o Claude Code **já persiste o último prompt sozinho**, sem precisarmos derivá-lo de
`SessionFacts.lastPrompts`.

**A linha da listagem passa a ser título + último prompt**: o título diz do que a sessão trata, o
prompt diz onde ela parou. Nenhum dos dois custa chamada de modelo — o Claude Code já pagou por
eles. Isso resolve o "qual das 40 era aquela" sem pagar captura por nenhuma.

**E encaixa exatamente na população certa:** o `aiTitle` mora no **transcript**, não no registro.
O registro some na saída graciosa (Spike E); o transcript não. Ou seja, ele sobrevive justamente
nas sessões para as quais esta listagem existe.

**Ressalva, mesma classe de risco do `--append-system-prompt-file`:** `ai-title` é entrada
interna não documentada. Ela já está catalogada em `KNOWN_ENTRY_TYPES`
(`adapters/transcript/schemas.ts`) — o projeto sabe que ela existe e hoje **não a lê**, porque só
`user` e `assistant` têm schema estrutural. Se a listagem depender dela, ela merece teste de
contrato como o do flag. E o D-025 se aplica: entrada ausente vira **listagem sem título**, nunca
título inventado.

**O que isto custa, dito na cara.** O varrimento de transcript (segunda estratégia da D-016) não
enxerga só as fechadas com carinho: é também o que encontra **sessões vivas que não se
registraram** (D-018). Sem registro elas não têm PID, então caem todas no mesmo estado
`unknown` — **não há como separar "viva e não registrada" de "fechada graciosamente"**. Esta
decisão tira a captura das duas juntas. A perda é parcialmente antiga: a D-029 já tinha recusado
construir maquinaria para essa população e escolhido **avisar** em vez de contornar. O aviso
continua; a captura é que sai.

**Três decisões que isto revisa, e nenhuma delas é pequena:**

1. **D-001.** A consequência "funciona mesmo para sessões que já morreram" deixa de ser
   **objetivo** e passa a ser efeito colateral a conter. A decisão de gerar por fora continua
   valendo inteira — pelos motivos que sobrevivem (não gastar o contexto da sessão viva, não
   interromper o turno, um mecanismo só), e não pela impossibilidade técnica que o texto dela
   ainda alega. Ver a correção separada sobre o canal de mensagens.
2. **D-016.** O papel da segunda estratégia muda: ela continua descobrindo, para listar e para
   avisar, mas deixa de alimentar a captura.
3. **D-011.** É a revisão mais interessante, e vem de graça. O padrão enxuto foi escolhido
   porque ~US$ 0,50 por sessão no modo profundo é proibitivo — **vezes 40**. Vezes três ou
   cinco, é plausível. Se o conjunto candidato encolhe para as sessões vivas, o argumento que
   sustentava o enxuto por padrão enfraquece, e o profundo entrega ao modelo a conversa inteira.

**Por que isso importa mais do que parece.** O primeiro teste real mostrou o modelo dizendo,
corretamente, que não havia confirmação no contexto sobre o que tinha sido feito — enquanto a
conversa dizia, em texto do assistente, "4 concluídas, 6 pendentes". O modo enxuto nunca vê o
texto do assistente: `processAssistantEntry` extrai dele apenas timestamp e caminhos de arquivo.
Reavaliar a D-011 com a conta nova pode resolver isso **por escopo** — o modelo passando a ler o
que o Claude escreveu — em vez de por remendo no prompt.

## D-032 — A evidência de git segue os arquivos tocados, e são vários repositórios

**Proposta do mantenedor, em 2026-09-02**, depois de uma captura real da própria sessão de
trabalho dele voltar com `facts.git: null`.

**Contexto, medido.** A sessão foi lançada de `C:\code`, que **não é repositório**. Todo o trabalho
aconteceu em `C:\code\see-you-tomorrow-ai` — dezenas de commits na semana. O handoff registrou
`sources: ["transcript","registry"]` e **zero** fatos de git.

Não é caso de canto: é o fluxo declarado dele. Ele lança o `claude` do diretório do usuário
**de propósito**, porque trabalha em vários repositórios ao mesmo tempo e quer uma memória só para
o projeto inteiro. O `cwd` de lançamento, nesse fluxo, não é onde o trabalho está.

**A derivação, verificada nos dados reais.** Agrupando os 47 `touchedFiles` daquela sessão por raiz
de repositório (subindo de cada arquivo até achar um `.git`):

```
 35  c:\code\see-you-tomorrow-ai
 12  (fora de repositório)
```

A evidência estava a um passo. O `touchedFiles` já é extraído dos blocos de tool-use (D-013) e já
carrega caminhos reais.

**Decisão.** A evidência de git deixa de ser atrelada ao `cwd` de lançamento e passa a ser derivada
dos **arquivos efetivamente tocados**, reportando **cada repositório encontrado**, não um só.

`HandoffFacts.git` deixa de ser `GitFacts | null` e passa a ser uma **lista**.

**Por que plural, e por que a medição não decidiu isto.** Medi três sessões reais e nenhuma tocou
mais de um repositório — mas **as três eram sessões construindo este próprio projeto**,
estruturalmente de um repositório só. Aquela amostra não poderia responder a pergunta nem se a
resposta fosse "plural": frontend e backend na mesma sessão, que é o caso comum que o mantenedor
descreve, nunca apareceria ali. **Amostra enviesada é outro jeito de afirmar além da evidência**, e
o registro fica aqui para ninguém citar aquele "0 de 3" como se fosse resposta.

O que decide é o fluxo declarado por quem usa: uma sessão que mexe em frontend e backend tem dois
repositórios com histórico próprio, e reportar um só seria escolher em silêncio.

**Consequências, e a primeira é obrigatória:**

- **Migração de esquema não é opcional.** `HANDOFF_SCHEMA_VERSION` é **1**, e `resolveSchemaVersion`
  **lança** quando a versão não bate — não adivinha, não degrada. Subir para 2 sem migração torna
  **ilegível todo handoff já gravado**, e o `seeya start-day` lê exatamente isso: o briefing de
  ontem. Handoff versão 1, com `git` singular, tem que ser lido como lista de um elemento. São
  poucas linhas, e é a diferença entre a mudança ser invisível e a mudança comer o histórico de
  quem já usa.
- **Normalizar a raiz antes de desduplicar**, reusando `core/cwd-normalization.ts` (S3-T5). Sem
  isso, `c:\code\x` e `C:\code\x` viram dois repositórios — aconteceu na medição que originou esta
  decisão.
- **Arquivos fora de qualquer repositório são contados e declarados.** Foram 12 de 47 na sessão
  medida. Sumir com eles esconderia atividade; declarar a contagem é o D-025 aplicado.
- **O `cwd` de lançamento continua valendo quando for repositório.** Quem abre dentro do projeto não
  pode perder nada.
- **Limite de quantos repositórios visitar, rotulado como E/S e não julgamento de produto** — cada
  um custa comandos de git. Mesma distinção que a Q-025 fixou para `MAX_BRIEFING_SCAN_DAYS`, com o
  excedente **declarado** em vez de omitido.
- **`sources` continua listando `git` quando ao menos um repositório respondeu** (D-013): evidência
  parcial é evidência, e a ausência de um repositório específico aparece na lista, não no silêncio.

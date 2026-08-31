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
- **`storage/`**: `tmpdir` real. Testar atomicidade — matar no meio da escrita não pode
  deixar arquivo pela metade; ler documento de `schemaVersion` antiga aciona migração.
  `resumed.json` (S3-T3, por `day`): arquivo ausente é conjunto vazio (D-025), JSON inválido e
  `schemaVersion` desconhecida rejeitam de forma visível, e uma segunda escrita substitui o
  conjunto inteiro (não incrementa) — mesmo padrão de `early-warnings.json`.
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
- **`process/`**: iniciar um processo filho trivial, verificar liveness, terminar com graça,
  verificar que morreu. Por plataforma.
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

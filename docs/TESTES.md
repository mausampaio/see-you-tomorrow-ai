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
        │   unidade     │  nucleo/ e transcricao/ — sem I/O, sem relógio real
        │    (~200)     │
        └───────────────┘
             + contrato (~5)  ← faixa lateral, roda contra o ~/.claude real
```

## Unidade — a base

Cobre `nucleo/` e a lógica pura de `transcricao/`. Sem disco, sem rede, sem processo, sem
`new Date()`. Todas as portas substituídas por duplos em memória.

O que precisa estar coberto com rigor, porque é onde os bugs vão doer:

- **Cálculo do instante de encerramento** a partir de `"19:30"` + data + fuso. Casos
  obrigatórios: dia normal; dia de entrada de horário de verão; dia de saída; horário já
  passado no momento da checagem; `horarioDeEncerramento: null`.
- **Adiamento e pular-hoje**: adiar antes do horário; adiar depois do horário; adiar duas vezes;
  pular depois de já ter adiado; virada de meia-noite zerando o estado do dia.
- **Elegibilidade da sessão**: cada uma das **cinco** condições da spec isolada, e as combinações
  de borda (sessão relevante mas ignorada; sessão com handoff do dia mas transcript alterado).
- **Liveness com PID reciclado**: PID vivo + `procStart` divergente = obsoleta.
- **Cadeia de fallback do notificador**: primeiro disponível vence; nenhum disponível cai para
  stderr sem lançar.
- **Decisão de fallback da geração**: erro do modelo produz handoff `deterministico`, nunca
  exceção que aborte o encerramento.
- **Coleta multi-fonte (D-013)**: handoff continua válido com só git respondendo; com só
  transcript; com só registro; com nenhuma fonte, a sessão é reportada como não capturável, sem
  exceção. O campo `fontes[]` reflete exatamente quem respondeu.
- **Exclusão de forks (D-012)**: sessão cujo `sessionId` está em `forks.json` nunca é elegível.
  Este teste é o que impede o laço de realimentação — não pode ser removido.
- **Detecção precoce sem transcript**: notifica na primeira vez que vê o `sessionId`, e não
  notifica de novo nas passagens seguintes. A mensagem inclui a correção (D-018).
- **Sessão suprimida não tenta captura profunda**: sessão registrada sem transcript, com
  `capturaProfunda: true`, cai para enxuto sem tentar `--resume` (D-018).
- **Sanitização de ambiente (D-017)**: o `env` entregue ao processo filho não contém
  `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID` nem `CLAUDECODE`, mesmo
  quando o processo do `seeya` os tem. Modo enxuto passa `--no-session-persistence`; modo
  profundo define `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`. Este teste é o que impede o modo
  profundo de falhar em silêncio quando o daemon sobe de dentro de uma sessão Claude.

Cobertura mínima: **`nucleo/` 95%**, demais diretórios de produção **80%**. Configurado por
diretório no vitest, e o CI falha abaixo disso.

## Integração — os adapters

Cada adapter contra o mundo real, mas num mundo de mentira controlado.

- **`descoberta/`**: um `~/.claude` falso montado em `tmpdir`, com registros válidos,
  registros obsoletos, JSON corrompido e campo faltando. Verificar que corrompido é ignorado
  com log, não crash.
- **`transcricao/`**: fixtures de `.jsonl` reais **anonimizados**, commitados em
  `tests/fixtures/transcricoes/`. Incluir obrigatoriamente: transcript grande (>1 MB), com
  tipos de entrada desconhecidos, com linha truncada no fim (o Claude Code pode estar
  escrevendo enquanto lemos).
- **`armazenamento/`**: `tmpdir` real. Testar atomicidade — matar no meio da escrita não pode
  deixar arquivo pela metade; ler documento de `versaoDoEsquema` antiga aciona migração.
- **`geracao/`**: um script falso de `claude` colocado no PATH do teste, que devolve JSON
  canned, JSON inválido, código de saída != 0, e um que trava (para testar o timeout).
  **Nenhum teste da suíte chama a API de verdade.** Obrigatório: um teste que passa contexto com
  quebra de linha, aspas duplas e simples, acento e `%`, e verifica que o processo filho recebeu
  o texto **íntegro** (D-015 — foi exatamente isso que quebrou no Spike C).
- **`git/`**: repositório de teste construído em `tmpdir` com dois worktrees, um sujo e um
  limpo, commits datados de hoje e de ontem. Verificar enumeração, estado por worktree e o
  recorte de "commits do dia". Mais um caso com `cwd` que não é repositório.
- **`processo/`**: iniciar um processo filho trivial, verificar liveness, terminar com graça,
  verificar que morreu. Por plataforma.
- **`notificacao/`**: cada backend com o binário externo falsificado; verificar os argumentos
  montados, não o toast aparecendo.

## E2E — poucos e caros

Rodam o binário `seeya` compilado, com `HOME`/`USERPROFILE` apontando para `tmpdir` e um
`claude` falso no PATH. Um teste por jornada:

1. `seeya sessoes` lista corretamente vivas, ociosas e encerradas.
2. `seeya encerrar-dia --dry-run` não escreve nada e descreve o que faria.
3. `seeya encerrar-dia` gera handoffs + briefing com o conteúdo esperado.
4. `seeya encerrar-dia` com o `claude` falso falhando gera handoffs determinísticos e sai com
   sucesso.
5. `seeya iniciar-dia --todas` invoca `claude --resume` com os argumentos certos.
6. Daemon, com relógio injetado, dispara aviso prévio e depois o encerramento.
7. `seeya adiar +30m` empurra o disparo; `seeya pular-hoje` cancela.
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

**Registrar sempre a versão contra a qual o contrato rodou.** O Spike D mostrou que o
comportamento muda entre versões (2.1.201 × 2.1.233) e que **duas versões coexistem na mesma
máquina** — CLI no PATH e a empacotada na extensão do VS Code. Um contrato verde sem a versão
anotada não prova nada.

Rodar antes de cada release e quando o Claude Code atualizar. Falha aqui = issue, não hotfix
às cegas.

## Regras que valem para toda a suíte

- Nenhum teste depende de rede.
- Nenhum teste depende do relógio real: `Relogio` é sempre injetado.
- Nenhum teste escreve fora do seu `tmpdir`. Um teste que escreva no `~/.claude` ou no
  `~/.see-you-tomorrow` reais é um bug grave.
- Testes de plataforma usam `describe.skipIf` explícito, nunca ficam silenciosamente verdes.
- Fixtures anonimizadas: nenhum caminho, token, nome de cliente ou trecho de código privado
  vai para o repositório.

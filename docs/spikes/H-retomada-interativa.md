# Spike H — Retomada interativa: TTY, argumento posicional e o sinal de falha do `--resume`

**Data:** 2026-08-30 · **Versão do Claude Code:** 2.1.235 · **Plataforma:** Windows 11 ·
**Tarefa:** S3-T2 · **Decisões afetadas:** D-004, D-015 (corrigida por este spike)

## Por que este spike existe

O Spike A mediu `--resume` no modo **headless** (`claude -p --resume ... --fork-session`), que é a
captura (D-001). O S3-T2 é outro caso: **retomar uma sessão de verdade, interativa**, injetando o
plano do dia anterior como primeiro prompt (D-004). O Spike A não cobre isso, e a spec era omissa
sobre dois pontos técnicos que só medição resolve:

1. Existe forma de retomar interativamente já com um primeiro prompt, sem violar D-015?
2. Como saber, de fora, que o `--resume` falhou (para disparar o fallback que D-004 exige)?

**Ambiente saneado antes de cada medição** (D-017): as seis variáveis de sessão herdadas
(`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_PID`,
`CLAUDECODE`, `CLAUDE_AGENT_SDK_VERSION`) removidas via `spawn` com `env` montado explicitamente,
nunca herdado — a máquina de teste tinha as seis definidas, herança de rodar de dentro de uma
sessão Claude. `spawn` sempre com array de argumentos e `shell: false`. Todas as sessões usadas são
descartáveis, criadas em `cwd`s de `%TEMP%`; nenhum `~/.claude` de projeto real foi tocado.

## Achado central (medido): sem TTY, "interativo" não é interativo

**Método.** `claude --resume <sessionId>` (sem `-p`) chamado via `child_process.spawn` com
`stdio: ['pipe','pipe','pipe']` — o mesmo que `seeya` teria se tentasse rodar isso como processo
filho comum. Testado de duas formas: prompt escrito no stdin (e fechado), e prompt como argumento
posicional. Sessão de teste criada previamente com `claude -p` (persistência padrão, sem
`--no-session-persistence`), depois retomada.

**Resultado, nos dois casos:** o processo não abre nenhuma UI interativa. Ele detecta a ausência de
TTY, responde à mensagem **uma única vez**, em texto puro, no stdout, e sai com código 0 — em
**menos de 6 segundos** (o processo já tinha fechado no primeiro `poll` de 2s nas três repetições).
Não há diferença de comportamento entre "prompt por stdin" e "prompt por argumento" nesse ponto:
**nenhum dos dois produz sessão interativa** sem TTY real.

```
$ node probe.mjs --resume <id>          # stdin recebe "Reply with exactly: STDIN_PROMPT_WORKED"
CLOSED code=0 signal=null               # fechou antes do primeiro poll de 2s
stdout: "STDIN_PROMPT_WORKED\n"         # resposta do modelo, não eco do stdin

$ node probe.mjs --resume <id> "Reply with exactly: INTERACTIVE_PROMPT_WORKED"
CLOSED code=0 signal=null
stdout: "INTERACTIVE_PROMPT_WORKED\n"   # idem, via argumento
```

**Consequência de desenho, e é a que decide tudo:** para existir sessão interativa de verdade
(TUI, usuário continua digitando depois), o processo **precisa herdar um TTY real** —
`stdio: 'inherit'` a partir do processo que já está no terminal do usuário. A partir do momento em
que o stdin **é** o terminal herdado, ele é o teclado: não há como `seeya` escrever nele por fora.
**O argumento posicional passa a ser o único canal que resta** para semear o primeiro prompt — não
por preferência, por eliminação.

## O teste de integridade do argumento posicional (o que corrigiu D-015)

**Método.** Mesma disciplina de `spawn` do resto do projeto (array, `shell: false`, nunca string de
shell no meio). Testado com `claude -p` (mais barato e determinístico para round-trip; a mecânica de
passagem de argv é a mesma independente de `-p`) passando o conteúdo hostil como **último elemento
do array de argumentos**, nunca via stdin.

| Conteúdo testado | Canal | Resultado |
|---|---|---|
| Quebra de linha, aspas duplas e simples, `%`, acento (`ação`, `não`, `café`), backtick, barra invertida final | argumento posicional | **idêntico byte a byte** (`MATCH? true`) |
| ~19.295 caracteres de texto de enchimento | argumento posicional | aceito e processado sem erro; sem truncamento perceptível |

**Interpretação.** O Spike C atribuiu a mutilação ao argumento em si. Não era isso: o Spike C
invocou via PowerShell, que reinterpretou a string antes de o processo a receber. Com `spawn` e
array — a única forma como este projeto já invoca `claude` — **não há shell no meio**, e o
argumento chega intacto. D-015 foi corrigida para refletir isso: proíbe argumento quando a
invocação **pode alcançar um shell** e quando o texto **pode ser grande**, não argumento como
categoria.

**Teto adotado, e de onde veio.** O Windows corta a linha de comando perto de **32.767** unidades
UTF-16 (`CreateProcess`), somando o caminho do binário e todos os argumentos. `RESUME_PROMPT_ARG_LIMIT_CHARS
= 4096` (`src/adapters/resumption/args.ts`) fica em ~1/8 desse teto: margem para `--resume
<uuid-36-chars>`, para caracteres que precisem de par substituto (raro no texto simples destes
planos, mas não impossível) e para o que o próprio SO acrescenta ao fazer o quoting do argv. Acima
do teto, `seeya` nem tenta o argumento — vai direto para o fallback (ver abaixo).

## Pista falsa: `CLAUDE_CODE_RESUME_PROMPT`

**Método.** Sem resposta na superfície (`claude --help` não lista nada parecido), o binário
(`claude.exe`, 2.1.235, ~312 MB) foi vasculhado por strings ASCII imprimíveis — mesma técnica dos
Spikes D e F (procurar marcador no binário quando a pergunta não tem resposta documentada). A busca
por `env.claude_code` achou, entre centenas de variáveis, `CLAUDE_CODE_RESUME_PROMPT` e
`CLAUDE_CODE_RESUME_FROM_SESSION` — nomes que pareciam candidatos óbvios a "prompt de retomada por
variável de ambiente".

**Testado:** `claude -p --resume <id> --fork-session` com `CLAUDE_CODE_RESUME_PROMPT` definida,
**sem** prompt nenhum via stdin ou argumento.

```
Error: No deferred tool marker found in the resumed session. Either the session was not
deferred, the marker is stale (tool already ran), or it exceeds the tail-scan window.
Provide a prompt to continue the conversation.
```

**Veredito: pista falsa.** É mecanismo interno de retomada de uma *tool* diferida (provavelmente
ligado a agendamento/`ScheduleWakeup`, achado na mesma varredura), não um canal geral de prompt. A
mensagem confirma, de quebra, que `--resume` exige um prompt vindo de algum lugar — não há como
pular essa exigência por variável de ambiente. Registrado aqui para ninguém redescobrir isto e
perder tempo.

## O sinal de falha do `--resume`

**Método.** `claude --resume <uuid-sintético-inexistente>` (nunca criado por nenhuma sessão real).

**Resultado, reproduzido de forma estável:**

```
exit code: 1
stderr: "No conversation found with session ID: 00000000-0000-4000-8000-000000000000\n"
```

Falhou **antes do primeiro poll de 2 segundos** nas medições — sem chamada de modelo, é uma
checagem local (o registro/transcript não existe para aquele id). `adapters/resumption` usa isso
como o sinal "tentativa rápida e mal-sucedida" (`FAST_FAILURE_GRACE_MS = 5000` — bem acima do que
foi medido, bem abaixo de qualquer uso real). **Importante:** com `stdio: 'inherit'` (o modo de
produção), `seeya` nunca lê esse texto de stderr — ele vai direto para a tela do usuário. A
implementação decide o fallback só pelo **código de saída** e por **ter fechado rápido**, nunca por
casar a mensagem (a mensagem muda entre versões; o código de saída e o tempo, não deveriam).

## O que não foi testado

- **`cwd` que sumiu (projeto movido, D-004).** Não foi criado um caso real de diretório apagado
  entre a captura e a retomada. `adapters/resumption` trata isso pelo mesmo caminho de
  `resumeFailed` (um `cwd` inexistente faz o `spawn` emitir `error`/`ENOENT`, tratado como falha
  rápida) — é inferência a partir do comportamento documentado do Node, não medição direta contra
  o `claude` real nesse cenário específico.
- **O limite exato da linha de comando do Windows.** Testado até ~19.295 caracteres com sucesso;
  não foi buscado o ponto exato de falha perto de 32.767. O teto de 4096 adotado tem margem
  suficiente para não precisar saber o limite exato.
- **O mesmo teste de integridade do argumento em macOS/Linux.** Só esta máquina (Windows) foi
  usada. `spawn` com array e `shell:false` deveria se comportar de forma equivalente nos três SOs
  (é a mesma API do Node, sem shell envolvido em nenhum), mas isso é a mesma classe de suposição
  que o Spike F alertou a não fazer sem medir — fica como risco conhecido, não como fato
  estabelecido.

## Consequências para o projeto

- D-015 corrigida (ver o texto da decisão): o alcance da proibição de argumento passa a ser
  explícito ("quando a invocação puder alcançar um shell, e quando puder ser grande"), em vez de
  uma proibição geral que a causa real (Spike C) nunca sustentou.
- S3-T2 implementado com `stdio: 'inherit'` como a única forma viável de sessão interativa de
  verdade; argumento posicional abaixo de 4096 caracteres para o caso comum; fallback único
  (D-004) — sessão nova via `--append-system-prompt-file` apontando para um arquivo em
  `~/.seeya/tmp/` — reaproveitado tanto para `--resume` que falhou rápido quanto para prompt acima
  do teto, nunca dois mecanismos.
- S3-T3 (retomada de várias sessões) herda a restrição de TTY: como "interativo" só existe com
  terminal herdado, e um processo só tem um terminal, retomar `--all` é necessariamente
  **sequencial**, uma sessão de cada vez — não uma limitação de implementação, é o que a medição
  acima estabelece como possível.

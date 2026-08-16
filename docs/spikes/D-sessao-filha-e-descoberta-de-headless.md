# Spike D — Supressão de transcript e descoberta de sessão headless

**Data:** 2026-08-16 · **Plataforma:** Windows 11 · **Perguntas:** Q-002, Q-003

> **Correção.** A primeira versão deste documento concluiu que a hipótese da sessão filha estava
> *falsificada*. Estava errado: o teste rodou o CLI 2.1.201, que **não tem o mecanismo**. A
> conclusão correta está abaixo. O erro fica registrado porque a lição vale: um experimento que
> não reproduz um comportamento relatado testa também a própria montagem.

## Hipótese testada

Ao chamar `agente-interno:ui` de dentro de uma sessão, o Claude entende a sessão nova como **filha** e
desabilita o transcript.

O ambiente de uma sessão Claude carrega o sinal, herdado por todo processo filho:

```
CLAUDE_CODE_CHILD_SESSION = 1
CLAUDE_CODE_SESSION_ID    = 11111111-…
CLAUDE_PID                = 40001
CLAUDECODE                = 1
```

## Primeira tentativa, inconclusiva

`claude -p` executado duas vezes de dentro de uma sessão viva, com e sem
`CLAUDE_CODE_CHILD_SESSION=1`. **Ambas criaram transcript.** Isso pareceu falsificar a hipótese.

Não falsificou: o `claude` do PATH é **2.1.201**, e a sessão da UI que exibe o aviso é
**2.1.233** (empacotada na extensão do VS Code). Duas versões diferentes na mesma máquina.

## Confirmação por inspeção dos binários

Busca pelos marcadores nos dois binários:

| Marcador | 2.1.201 (CLI do PATH) | 2.1.233 (extensão VS Code) |
|---|---|---|
| `nested_marker` | ausente | **presente** |
| `tengu_persistence_suppressed` | ausente | **presente** |
| `persistence-suppressed` | ausente | **presente** |
| `transcript-writer-degraded` | ausente | **presente** |
| `CLAUDE_CODE_SKIP_PROMPT_HISTORY` | presente | presente |

**Veredito: hipótese confirmada.** A supressão por marcador de sessão filha é funcionalidade
introduzida entre 2.1.201 e 2.1.233. O teste anterior rodou uma versão que não a possui.

## O mecanismo, extraído do binário 2.1.233

Existem **três** estados degradados distintos, não um:

### 1. `nested_marker` — marcador de sessão filha herdado
> Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker
> · restart with `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` to keep future transcripts

### 2. `skip_prompt_history` — variável explícita
> Transcript saving is off — CLAUDE_CODE_SKIP_PROMPT_HISTORY is set
> · **--resume will not find this session**; if unintended, unset it and restart

### 3. `transcript-writer-degraded` — escrita falhando
> Transcript writes are failing (`<código>`)
> · recent messages may not be saved for resume

O terceiro é o mais perigoso para o `seeya` e eu não sabia que existia: **o transcript existe,
mas está incompleto.** Não há como distinguir "sessão curta" de "sessão longa com escrita
falhando" olhando só o arquivo.

## Consequências para o projeto

1. **A captura profunda é impossível em sessão suprimida.** O próprio produto declara que
   `--resume` não encontra a sessão. Não é degradação, é indisponibilidade — o modo profundo
   (D-011) tem de detectar e cair para o enxuto.
2. **O `seeya` contamina o que ele mesmo executa.** Se o daemon subir de dentro de uma sessão
   Claude — o que é provável, já que o projeto é desenvolvido assim — todo `claude` que ele
   spawnar herda `CLAUDE_CODE_CHILD_SESSION`. Ver D-017.
3. **Esse cenário tem solução imediata**, independente do `seeya`: definir
   `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` no ambiente do script do `agente-interno:ui`.
4. **Transcript incompleto vira caso de teste**, junto com transcript ausente.
5. **A versão do Claude Code importa** e varia na mesma máquina. O `seeya` registra em cada
   handoff a versão observada, e os testes de contrato passam a registrar contra qual versão
   rodaram.

## Achado independente: sessão headless não se registra

**Nenhuma das duas invocações `claude -p` criou entrada em `~/.claude/sessions/`**, apesar de
ambas terem criado transcript. Depois de duas execuções completas, o registro continha apenas a
sessão interativa.

Isso responde a parte central de Q-002 e vale para as duas versões:

> Sessão headless deixa transcript, mas **não** se registra como processo.

Descoberta baseada só no registro é cega para todo agente de execução. Resolvido por D-016
(registro + varredura de transcripts).

## Achado secundário: derivação do slug

O `cwd` do teste virou `C--Users-<usuario>-AppData-Local-Temp-…-scratchpad-spikeD`: separadores e
`:` viram `-`. Continua valendo procurar o arquivo por `sessionId` em todos os slugs em vez de
confiar na derivação.

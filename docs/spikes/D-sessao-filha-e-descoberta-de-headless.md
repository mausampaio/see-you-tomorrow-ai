# Spike D — Sessão filha desabilita transcript? E sessão headless é descoberta?

**Data:** 2026-08-16 · **Plataforma:** Windows 11 · **Perguntas:** Q-002, Q-003

## Hipótese testada

Relato do usuário: ao chamar `agente-interno:ui` de dentro de uma sessão, o script que sobe o Claude
gera uma sessão que o Claude Code entende como **filha**, e por isso desabilita o transcript.

O ambiente de uma sessão Claude de fato carrega o sinal, e ele é herdado por todo processo
filho:

```
CLAUDE_CODE_CHILD_SESSION = 1
CLAUDE_CODE_SESSION_ID    = 11111111-…
CLAUDE_CODE_ENTRYPOINT    = claude-vscode
CLAUDE_PID                = 40001
CLAUDECODE                = 1
CLAUDE_AGENT_SDK_VERSION  = 0.3.233
```

## Método

A mesma invocação, duas vezes, de dentro de uma sessão Claude viva: uma herdando
`CLAUDE_CODE_CHILD_SESSION=1`, outra com a variável removida.

```
claude -p --model sonnet --output-format json "responda so: ok"
```

Depois, verificação de existência de `<session_id>.jsonl` em `~/.claude/projects/`.

## Resultado

| Cenário | `session_id` | Transcript criado? |
|---|---|---|
| **Com** `CLAUDE_CODE_CHILD_SESSION=1` | `33333333-…` | **SIM** |
| **Sem** a variável | `44444444-…` | **SIM** |

**Hipótese falsificada.** Ser sessão filha não desabilita o transcript. `CLAUDE_CODE_CHILD_SESSION`
não tem efeito sobre a persistência — pelo menos não para `claude -p` no Windows, nesta versão.

A causa da ausência de transcript no `agente-interno` é outra, e continua desconhecida. Ver Q-003.

## Achado não previsto, e mais importante que a hipótese

**Nenhuma das duas sessões headless criou entrada em `~/.claude/sessions/`.** Depois de duas
invocações completas e bem-sucedidas, o registro continha apenas a sessão interativa
(`40001.json`).

Isso responde a parte central de Q-002:

> **Sessão headless (`claude -p`) deixa transcript, mas não se registra como processo.**

Consequência direta: uma descoberta baseada só no registro — o desenho atual — **é cega para
toda sessão headless**. Qualquer agente de execução que rode `claude -p`, agente-interno incluído,
passaria despercebido, mesmo tendo transcript.

A descoberta precisa de duas estratégias combinadas (D-016):

| Estratégia | Enxerga | Dá liveness/PID? |
|---|---|---|
| Registro `~/.claude/sessions/*.json` | interativas | sim |
| Varredura de `~/.claude/projects/**/*.jsonl` por mtime | interativas **e** headless | não |

## Achado secundário: confirmação da derivação do slug

O `cwd` do teste virou o diretório
`C--Users-<usuario>-AppData-Local-Temp-claude-…-scratchpad-spikeD`. A regra de derivação é
substituir separadores e `:` por `-`. Continua valendo a decisão de **procurar o arquivo por
`sessionId` em todos os slugs** em vez de confiar na derivação.

## Limites deste spike

Testado apenas `claude -p` invocado por PowerShell filho de uma sessão VS Code, no Windows, com
Claude Code 2.1.201. O caminho do `agente-interno` pode diferir: script próprio, Agent SDK, flags
explícitas ou `settings.json` do repositório. Nada aqui prova o que acontece **lá**.

# Arquitetura

## Princípio

O núcleo é puro e o mundo é sujo. Toda regra de decisão vive em `core/`, sem I/O, sem
relógio, sem rede, sem processo. Tudo que toca o mundo é um adapter atrás de uma interface
declarada em `core/ports.ts`.

Isso não é preferência estética: é o que torna a pirâmide de testes viável e o que impede o
agente dev de espalhar `child_process.exec` pelo projeto.

## Camadas

```
cli/           ← comandos, parsing de argumento, saída para o terminal
  ↓
application/   ← casos de uso: endDay, startDay, captureSession
  ↓
core/          ← regras puras + interfaces (portas). NÃO importa nada de I/O.
  ↑
adapters/      ← implementam as portas do núcleo
  discovery/       lê ~/.claude/sessions e ~/.claude/projects
  transcript/      parseia o JSONL do transcript
  generation/      chama o claude headless
  notification/    toast por SO
  storage/         ~/.seeya/
  process/         liveness de PID, terminação graciosa
  git/             branch e status do cwd
  clock/           a única fonte de "agora"
scheduler/     ← o daemon; orquestra application/ no tempo
```

**Regra de dependência.** Setas apontam para dentro, e `cli/` é a **única raiz de composição** —
só ele nomeia adapter concreto e injeta nos demais (D-020). Verificado por `dependency-cruiser`
no CI, não por boa vontade:

**A matriz é exaustiva de propósito.** São 5 camadas, logo 20 pares ordenados, e todos os 20
estão abaixo. Três rodadas de review de S0-T2 acharam, cada uma, "mais um par que ninguém
listou" — porque a tabela era parcial e "não está na lista" era ambíguo entre *permitido* e
*esquecido*. Aqui não há omissão possível: par que não estiver nesta matriz é erro da matriz, e
vira questão em `docs/QUESTOES.md`.

| De ↓ / Para → | `core` | `adapters` | `application` | `scheduler` | `cli` |
|---|---|---|---|---|---|
| **`core`** | — | ✗ | ✗ | ✗ | ✗ |
| **`adapters`** | ✓ portas | — | ✗ | ✗ | ✗ |
| **`application`** | ✓ | ✗ D-020 | — | ✗ | ✗ |
| **`scheduler`** | ✓ | ✗ D-020 | ✓ | — | ✗ |
| **`cli`** | ✓ | ✓ raiz | ✓ | ✓ | — |

✓ permitido · ✗ proibido · 8 permitidos, 12 proibidos

`core` também não importa `node:*`. Não há ciclos, em nenhuma direção.

Leitura em uma frase: **tudo aponta para `core`; só `cli` conhece implementação; `scheduler`
manda em `application` e nunca o contrário.**

Cada ✗ tem regra no `dependency-cruiser` **e** teste provando a reprovação. Cada ✓ tem teste
provando que não é bloqueado por engano — sem isso, alguém aperta um regex e quebra a raiz de
composição sem ninguém notar.

## Portas (interfaces do núcleo)

```ts
interface SessionProvider {
  list(): Promise<DiscoveredSession[]>;
}

interface TranscriptReader {
  readFacts(session: DiscoveredSession): Promise<SessionFacts>;
}

interface HandoffGenerator {
  generate(facts: SessionFacts): Promise<GeneratedUnderstanding>;
}

interface Notifier {
  notify(notice: Notice): Promise<void>;
}

interface Storage {
  saveHandoff(day: Day, handoff: Handoff): Promise<void>;
  readBriefing(day: Day): Promise<Briefing | null>;
  readConfig(): Promise<Config>;
  saveState(state: DayState): Promise<void>;
}

interface ProcessControl {
  isAlive(pid: number, procStart?: string): Promise<boolean>;
  terminateGracefully(pid: number, deadlineMs: number): Promise<boolean>;
}

interface Clock {
  now(): Date;
}
```

Nos testes, cada porta tem um duplo em memória. Nenhum teste unitário toca disco.

## Decisões técnicas por adapter

### `discovery/`
Lê `~/.claude/sessions/*.json`, valida com zod, filtra por liveness (`ProcessControl`) e
resolve o caminho do transcript. O slug do diretório em `~/.claude/projects/` é derivado do
`cwd`; a derivação é frágil, então a estratégia primária é **procurar o arquivo
`<sessionId>.jsonl` em todos os slugs**, e a derivação do slug é só otimização.

Duas responsabilidades que vieram do Spike A e são fáceis de esquecer:

- **Excluir os forks do próprio `seeya`** listados em `forks.json`, sob pena de laço de
  realimentação (D-012).
- **Transcript ausente não desqualifica a sessão** (D-013). A sessão entra com
  `hasTranscript: false` e dispara a notificação de detecção precoce, uma vez por `sessionId`.

Na v2 este adapter passa a ter duas origens — registro e wrapper PTY — e precisa deduplicar por
`sessionId` (D-014). A interface já é desenhada para isso: `list()` devolve a união, não a
concatenação.

### `transcript/`
Streaming linha a linha (arquivos passam de 1 MB). Ignora tipos desconhecidos em vez de falhar
— o Claude Code adiciona tipos novos com o tempo. Extrai só o que a spec pede.

### `git/`
Mais importante do que parecia. Além de branch e status do `cwd`, enumera **worktrees**
(`git worktree list --porcelain`) com branch, sujeira e commits do dia de cada um, e lista os
commits do dia. Para sessões sem transcript, esta é a única fonte substantiva (D-013). Não
quebra quando o `cwd` não é repositório: devolve "sem git" e segue.

### `generation/`
Duas implementações da mesma porta, escolhidas por config (D-011):

- **Enxuta (padrão).** Monta o contexto a partir das evidências já coletadas e chama
  `claude -p` numa sessão nova. ~US$ 0,15/sessão.
- **Profunda (opt-in).** `claude -p --resume <id> --fork-session`. ~US$ 0,50/sessão, melhor
  entendimento. Registra o `sessionId` do fork em `forks.json` (D-012).

Regras comuns, todas com origem em spike e todas testadas:

- `spawn` com array e `shell: false` — os `cwd` têm espaços e acentos.
- **Contexto por stdin ou arquivo temporário, nunca por argumento** (D-015).
- `--tools ""`, `--system-prompt` curto e `--json-schema` do handoff: derruba o piso de ~12 k
  tokens e evita saída em prosa livre.
- Timeout duro e `--max-budget-usd`.
- Erro tipado. Quem decide o fallback é `application/`, não o adapter.

### `notification/`
Adapter por plataforma, escolhido em runtime. Conforme o Spike B:

- **Windows:** WinRT via PowerShell, **sem dependência alguma**. Carregar explicitamente
  `Windows.UI.Notifications.ToastNotificationManager` **e**
  `Windows.Data.Xml.Dom.XmlDocument` — omitir o segundo falha com erro que aponta para o tipo
  errado.
- **macOS:** `terminal-notifier` se presente, senão `osascript -e 'display notification'`.
- **Linux:** `notify-send`; fallback stderr.

Cada backend implementa `isAvailable()`. A seleção é uma cadeia de fallback testável em
unidade com backends falsos.

**Contrato mínimo sem ações.** Ações clicáveis são capacidade opcional (`supportsActions()`), nunca
pressuposto. No Windows, se forem implementadas, o caminho é `activationType="protocol"` com
esquema `seeya://` registrado em `HKCU\Software\Classes` — evita servidor COM e processo
residente. Não validado; ver S4-T1.

### `storage/`
Raiz injetada (nunca `os.homedir()` direto no código de negócio). Escrita atômica. Todo arquivo
lido passa por zod. `schemaVersion` em todo documento persistido, com migração explícita.

### `clock/`
Um único módulo produz `now()`. Nenhum outro arquivo do projeto pode chamar `new Date()`,
`Date.now()` ou `setTimeout` com prazo longo — imposto por regra de lint.

## Fusos e horários

O horário de encerramento é um horário local ("19:30"), não um instante. A conversão para
instante acontece por dia, no fuso do sistema, o que trata mudança de horário de verão de
graça. Nada de guardar epoch para "o horário de encerramento".

## Config

`~/.seeya/config.json`

```jsonc
{
  "schemaVersion": 1,
  "endOfDayTime": "19:30",     // null = só manual
  "leadTimesInMinutes": [30, 15],
  "relevanceHours": 12,
  "idleMinutes": 45,
  "captureModel": "sonnet",
  "budgetPerSessionUsd": 0.25,
  "captureConcurrency": 3,
  "ignore": ["c:\\code\\rascunhos"],
  "projectPolicy": {
    "c:\\code\\projeto": { "canTerminate": true }
  }
}
```

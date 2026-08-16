# Arquitetura

## Princípio

O núcleo é puro e o mundo é sujo. Toda regra de decisão vive em `nucleo/`, sem I/O, sem
relógio, sem rede, sem processo. Tudo que toca o mundo é um adapter atrás de uma interface
declarada em `nucleo/portas.ts`.

Isso não é preferência estética: é o que torna a pirâmide de testes viável e o que impede o
agente dev de espalhar `child_process.exec` pelo projeto.

## Camadas

```
cli/           ← comandos, parsing de argumento, saída para o terminal
  ↓
aplicacao/     ← casos de uso: encerrarDia, iniciarDia, capturarSessao
  ↓
nucleo/        ← regras puras + interfaces (portas). NÃO importa nada de I/O.
  ↑
adaptadores/   ← implementam as portas do núcleo
  descoberta/      lê ~/.claude/sessions e ~/.claude/projects
  transcricao/     parseia o JSONL do transcript
  geracao/         chama o claude headless
  notificacao/     toast por SO
  armazenamento/   ~/.see-you-tomorrow/
  processo/        liveness de PID, terminação graciosa
  git/             branch e status do cwd
  relogio/         a única fonte de "agora"
agendador/     ← o daemon; orquestra aplicacao/ no tempo
```

**Regra de dependência.** Setas apontam para dentro. `nucleo/` não importa nada do projeto nem
nada de `node:`. `adaptadores/` importa `nucleo/` (para as interfaces) e nada de `aplicacao/`
ou `cli/`. Isso é verificado por `dependency-cruiser` no CI, não por boa vontade.

## Portas (interfaces do núcleo)

```ts
interface ProvedorDeSessoes {
  listar(): Promise<SessaoDescoberta[]>;
}

interface LeitorDeTranscricao {
  lerFatos(sessao: SessaoDescoberta): Promise<FatosDaSessao>;
}

interface GeradorDeHandoff {
  gerar(fatos: FatosDaSessao): Promise<EntendimentoGerado>;
}

interface Notificador {
  notificar(aviso: Aviso): Promise<void>;
}

interface Armazenamento {
  salvarHandoff(dia: Dia, handoff: Handoff): Promise<void>;
  lerBriefing(dia: Dia): Promise<Briefing | null>;
  lerConfig(): Promise<Config>;
  salvarEstado(estado: EstadoDoDia): Promise<void>;
}

interface ControleDeProcesso {
  estaVivo(pid: number, procStart?: string): Promise<boolean>;
  terminarComGraca(pid: number, prazoMs: number): Promise<boolean>;
}

interface Relogio {
  agora(): Date;
}
```

Nos testes, cada porta tem um duplo em memória. Nenhum teste unitário toca disco.

## Decisões técnicas por adapter

### `descoberta/`
Lê `~/.claude/sessions/*.json`, valida com zod, filtra por liveness (`ControleDeProcesso`) e
resolve o caminho do transcript. O slug do diretório em `~/.claude/projects/` é derivado do
`cwd`; a derivação é frágil, então a estratégia primária é **procurar o arquivo
`<sessionId>.jsonl` em todos os slugs**, e a derivação do slug é só otimização.

### `transcricao/`
Streaming linha a linha (arquivos passam de 1 MB). Ignora tipos desconhecidos em vez de falhar
— o Claude Code adiciona tipos novos com o tempo. Extrai só o que a spec pede.

### `geracao/`
Invoca `claude -p --resume <id> --fork-session --model <modelo> --output-format json` com
timeout duro e `--max-budget-usd` da config. Nunca usa shell (`spawn` com array de argumentos,
`shell: false`) — os `cwd` têm espaços e acentos. Retorna erro tipado; quem decide o fallback é
`aplicacao/`, não o adapter.

**Este adapter tem um caminho alternativo obrigatório** (ver Spike A em
`docs/PLANO-DE-ENTREGA.md`): se `--resume` sobre sessão viva não funcionar, o gerador monta o
contexto a partir do transcript lido e chama `claude -p` numa sessão nova. A escolha do caminho
é configuração, não reescrita.

### `notificacao/`
Adapter por plataforma, escolhido em runtime:
- Windows: toast via API do SO; fallback para balão simples.
- macOS: `terminal-notifier` se presente, senão `osascript`.
- Linux: `notify-send`; fallback stderr.

Cada backend implementa `estaDisponivel()`. A seleção é uma cadeia de fallback testável em
unidade com backends falsos.

### `armazenamento/`
Raiz injetada (nunca `os.homedir()` direto no código de negócio). Escrita atômica. Todo arquivo
lido passa por zod. `versaoDoEsquema` em todo documento persistido, com migração explícita.

### `relogio/`
Um único módulo produz `agora()`. Nenhum outro arquivo do projeto pode chamar `new Date()`,
`Date.now()` ou `setTimeout` com prazo longo — imposto por regra de lint.

## Fusos e horários

O horário de encerramento é um horário local ("19:30"), não um instante. A conversão para
instante acontece por dia, no fuso do sistema, o que trata mudança de horário de verão de
graça. Nada de guardar epoch para "o horário de encerramento".

## Config

`~/.see-you-tomorrow/config.json`

```jsonc
{
  "versaoDoEsquema": 1,
  "horarioDeEncerramento": "19:30",     // null = só manual
  "antecedenciasEmMinutos": [30, 15],
  "horasDeRelevancia": 12,
  "minutosParaOcioso": 45,
  "modeloDaCaptura": "sonnet",
  "orcamentoPorSessaoUsd": 0.25,
  "concorrenciaDaCaptura": 3,
  "ignorar": ["c:\\code\\rascunhos"],
  "politicaPorProjeto": {
    "c:\\code\\projeto": { "podeEncerrar": true }
  }
}
```

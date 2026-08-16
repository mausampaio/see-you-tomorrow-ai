# Especificação funcional — see-you-tomorrow (v1)

Fonte da verdade do comportamento. O agente dev implementa exatamente o que está aqui.
Divergência percebida → `docs/QUESTOES.md`, não improviso.

## Problema

Ao longo do dia acumulam-se várias sessões de IA em andamento, em projetos diferentes. Quando
o dia acaba, o estado de cada uma se perde: o que estava sendo feito, o que ficou pela metade,
qual era o próximo passo. No dia seguinte o custo de reconstruir esse contexto é alto.

## Produto

Um CLI (`seeya`) que descobre as sessões de Claude Code da máquina, captura o estado de cada uma
num horário definido (ou sob comando), gera um plano para o dia seguinte, e no dia seguinte
retoma as sessões de onde pararam.

## Glossário

| Termo | Significado |
|---|---|
| **Sessão** | Uma sessão do Claude Code, identificada por `sessionId` (UUID), com um `cwd`. |
| **Sessão viva** | Sessão cujo processo está em execução agora. |
| **Sessão ociosa** | Sessão viva sem escrita no transcript há mais de `minutosParaOcioso`. |
| **Captura** | Ler o estado de uma sessão e produzir um handoff. |
| **Handoff** | Documento por sessão: fatos + entendimento + pendências + plano de amanhã. |
| **Encerramento** | O ato de capturar todas as sessões elegíveis e produzir o resumo do dia. |
| **Briefing** | Documento consolidado do dia, com todos os handoffs, lido no dia seguinte. |

## Como as sessões são descobertas

O Claude Code mantém um registro de processos vivos em `~/.claude/sessions/<pid>.json`, com
`pid`, `sessionId`, `cwd`, `kind`, `entrypoint`, `startedAt`, `procStart` e `name`. O transcript
de cada sessão fica em `~/.claude/projects/<slug-do-cwd>/<sessionId>.jsonl`.

Regras:

- O registro contém **entradas obsoletas** de processos já mortos. Toda entrada tem o PID
  verificado quanto a liveness antes de ser considerada viva.
- PID é reciclado pelo SO. `procStart` é usado como desempate: PID vivo mas com horário de
  início diferente do registrado = entrada obsoleta, não sessão viva.
- Entradas obsoletas são reportadas como sessões **encerradas**, não descartadas: elas ainda
  têm transcript e ainda merecem handoff.
- Nenhuma dessas estruturas é API pública do Claude Code. Todas passam por validação de schema
  na leitura, e há um teste de contrato dedicado (`docs/TESTES.md`).

## Comandos

### `seeya sessoes`

Lista as sessões conhecidas: nome, `cwd`, estado (viva / ociosa / encerrada), última atividade,
política de encerramento aplicada. Não escreve nada. É o comando de diagnóstico.

### `seeya status`

Mostra o horário de encerramento configurado para hoje, quanto falta, adiamentos aplicados,
se o dia foi pulado, se o daemon está rodando, e quantas sessões estão elegíveis.

### `seeya encerrar-dia [--dry-run] [--sessao <id|cwd>]`

Executa o encerramento manual. Idêntico ao automático (D-001).

1. Descobre sessões elegíveis.
2. Para cada uma, em paralelo com limite de concorrência: coleta fatos → gera entendimento →
   grava handoff. Falha em uma sessão não aborta as outras.
3. Grava o briefing do dia consolidando todos os handoffs.
4. Para sessões marcadas `podeEncerrar` (D-002), e só depois do handoff verificado em disco,
   termina o processo graciosamente.
5. Notifica o resultado e imprime o resumo.

`--dry-run` executa tudo menos escrever e terminar processos: mostra o que faria.
`--sessao` limita a uma sessão.

### `seeya iniciar-dia [--sessao <id>] [--todas]`

1. Lê o briefing mais recente que ainda tem pendências.
2. Mostra o plano consolidado.
3. Pergunta quais sessões retomar (ou `--todas`).
4. Para cada escolhida, executa `claude --resume <sessionId>` no `cwd` original, injetando o
   plano daquela sessão como primeiro prompt (D-004).
5. Marca o briefing como retomado.

### `seeya adiar [+15m|+30m|+1h]` e `seeya pular-hoje`

Atuam sobre o encerramento automático de hoje (D-006). Funcionam com ou sem daemon rodando —
o estado é persistido, não guardado em memória.

### `seeya config`

Lê e escreve `config.json`. Subcomandos para horário, antecedências de notificação, política
por `cwd`, modelo usado na captura, e limites.

### `seeya daemon [--parar] [--status]`

Sobe o processo de longa duração (D-005). Instância única.

## Comportamento do daemon

Loop de verificação a cada 30 s, decidindo sempre por relógio de parede:

- Se hoje foi pulado → não faz nada.
- Nos instantes `horario - antecedencia` (para cada antecedência configurada, ex. 30 min e
  15 min) → dispara notificação prévia com as ações disponíveis.
- No `horario` efetivo (já somados os adiamentos) → executa o encerramento.
- Se a máquina estava suspensa e o horário passou sem disparo, o encerramento acontece assim
  que o daemon acorda, com aviso de que houve atraso.

**Guarda de turno ativo.** Antes de capturar, o app checa se o transcript da sessão foi escrito
nos últimos 60 s. Se foi, a sessão está no meio de um turno: adia a captura daquela sessão por
até 5 minutos, tentando de novo. Esgotado o prazo, captura assim mesmo e marca o handoff como
`capturadoDuranteTurnoAtivo: true`.

## Elegibilidade

Uma sessão entra no encerramento se, e somente se:

- tem transcript legível; **e**
- teve atividade nas últimas `horasDeRelevancia` (default 12 h); **e**
- o `cwd` não está na lista `ignorar` da config; **e**
- não tem handoff do dia corrente com transcript inalterado desde então (anti-duplicidade).

## Formato do handoff

`~/.see-you-tomorrow/dias/<AAAA-MM-DD>/sessoes/<sessionId>.json`

```jsonc
{
  "versaoDoEsquema": 1,
  "sessionId": "uuid",
  "cwd": "c:\\code\\projeto",
  "nome": "projeto-03",
  "capturadoEm": "2026-08-16T21:00:04.120Z",
  "estadoDaSessao": "viva" | "ociosa" | "encerrada",
  "capturadoDuranteTurnoAtivo": false,
  "origem": "modelo" | "deterministico",
  "fatos": {
    "ultimaAtividade": "2026-08-16T20:41:11.000Z",
    "ultimosPrompts": ["...", "..."],
    "arquivosTocados": ["src/a.ts"],
    "git": { "branch": "main", "sujo": true, "arquivosModificados": ["src/a.ts"] }
  },
  "entendimento": "texto livre",
  "pendencias": ["..."],
  "planoAmanha": ["..."],
  "erroNaGeracao": null
}
```

O briefing do dia (`resumo.md`) é gerado a partir dos handoffs, em markdown legível.

## Notificações

Nativas do SO, por adapter (`docs/ARQUITETURA.md`). Casos: aviso prévio, encerramento
executado, encerramento com falhas parciais, daemon caiu. Onde o SO suportar ações na
notificação, oferecer *Adiar 30min* e *Pular hoje*; onde não suportar, o texto instrui o
comando equivalente. Se nenhuma notificação nativa estiver disponível, cai para stderr e nunca
quebra o fluxo.

## Requisitos não funcionais

- Windows, macOS e Linux. Nenhum caminho hardcoded com `/` ou `\`.
- Encerramento de 5 sessões deve terminar em menos de 2 min.
- Nenhum segredo é lido, gravado ou enviado. O app não toca em `~/.claude/.credentials.json`.
- Toda escrita em `~/.see-you-tomorrow/` é atômica (escreve em temporário, renomeia).
- O app nunca escreve dentro de `~/.claude/`.

## Sugestões minhas para depois da v1

Registradas aqui para não serem esquecidas nem implementadas agora — ver `docs/FORA-DE-ESCOPO.md`:
métricas de foco por projeto, `seeya ontem` para reler handoffs antigos, captura periódica de
segurança durante o dia, e integração com o issue tracker para virar pendência rastreável.

# Spike I — O recap de sessão do Claude Code: de onde vem, quem paga, e o que ele ensina

**Data:** 2026-08-30 · **Versão do Claude Code:** 2.1.251 · **Plataforma:** Windows 11 ·
**Origem:** pergunta do mantenedor · **Decisões afetadas:** D-011 (a reavaliar), D-031 (atualizada)

## Por que este spike existe

O mantenedor perguntou de onde vem o "recap" que o Claude Code mostra, e a pergunta não era
curiosidade: **é por esse texto que ele reconhece de que trata cada sessão.** Nas palavras dele,
"eu acho eles maravilhosos e normalmente é por eles que lembro do que se trata aquela sessão".

Isso toca o produto em dois pontos. Primeiro, a **D-031** decidiu listar sessões fechadas no
briefing, e a listagem só se justifica se identificar a sessão para um humano — se o recap
estivesse em disco, seria a resposta pronta. Segundo, se o recap é síntese do modelo sobre a
conversa, ele é **exatamente o que o handoff do `seeya` tenta ser** — e aí a comparação entre os
dois vira argumento sobre a D-011.

## Método

1. **Varredura do sistema de arquivos:** busca em todo o `~/.claude` (profundidade 4) pelas frases
   distintivas de um recap real, que o mantenedor colou.
2. **Censo de tipos de entrada** do transcript desta sessão (7.834 linhas).
3. **Varredura de strings do binário** — mesma técnica dos Spikes D, F e H.

> **Erro de método, corrigido — e vale mais registrado que escondido.** A primeira varredura pegou
> o binário **errado**: `~/.local/bin` tem `claude.exe` (207 MB) e um `claude.exe.old.<timestamp>`
> (306 MB), e o script escolhia "o maior" — que é o antigo. Todas as strings abaixo foram
> **re-verificadas contra o `claude.exe` atual**, com a versão confirmada por `claude --version` →
> `2.1.251`. As nove âncoras principais existem nos dois; a conclusão não mudou, o método é que
> estava frouxo. É a mesma classe de erro de confundir versões que já quase entrou numa decisão
> antes (ver D-029).

## Achado 1: o recap não está em disco

A busca por frases do recap em todo o `~/.claude` devolveu **dois** resultados, e os dois são a
**própria mensagem do mantenedor** citando-o: `history.jsonl` e o transcript desta sessão. Nenhum
arquivo o guarda como campo.

**Ele é gerado para exibição e descartado.** Não há o que ler.

## Achado 2: mas duas entradas do transcript servem, e são de graça

Censo de tipos do transcript desta sessão:

```text
assistant 2727 · user 1409 · attachment 1227 · ai-title 388 · last-prompt 387
bridge-session 343 · mode 342 · permission-mode 342 · queue-operation 322
system 182 · file-history-snapshot 107 · file-history-delta 58
```

| entrada | forma | observação |
|---|---|---|
| `ai-title` | `{ type, aiTitle, sessionId }` | 388 ocorrências — regravada conforme a sessão evolui |
| `last-prompt` | `{ type, lastPrompt, leafUuid, sessionId }` | 387 ocorrências |

Valor de `aiTitle` desta sessão no momento da medição: *"Planejar desenvolvimento do app
see-you-tomorrow"*. **Não é o recap** — é bem mais curto. Mas acompanha o assunto ao longo do dia
em vez de congelar no começo.

Os dois tipos **já estão em `KNOWN_ENTRY_TYPES`** (`adapters/transcript/schemas.ts`): o projeto
sabe que existem e **não os lê**, porque só `user` e `assistant` têm schema estrutural.

## Achado 3: o recap é o "away summary", e o prompt dele está no binário

Texto exato, extraído do `claude.exe` 2.1.251:

> *"The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no
> markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause
> narrative, fix internals, secondary to-dos, and em-dash tangents."*

Menos de 40 palavras, uma ou duas frases, objetivo geral primeiro, próxima ação por último. É
exatamente a forma do texto que o mantenedor reconhece.

**Gatilho: 5 minutos, não 3.** A descrição da chave de config diz, literalmente: *"When false, the
session recap (shown when you return after being away for 5+ minutes) is disabled."* A chave é
`awaySummaryEnabled`, e há um override de ambiente, `CLAUDE_CODE_ENABLE_REMOTE_RECAP`.

Isto **corrige** a informação que circulava (3 minutos, e "pelo menos 3 interações"). O limiar de
interações não apareceu em string nenhuma; o que existe é um resultado `no-turn`.

## Achado 4: quem paga é a conta logada

A string que decide:

```text
[awaySummary] skipped: at or near rate limit
```

**O cliente se recusa a gerar o recap quando a conta está no limite ou perto dele.** Se fosse
custeado pelo fornecedor, não haveria razão para pular por esse motivo.

É sinal comportamental do binário, **não prova do razão contábil** — nenhuma inspeção de cliente
responde faturamento. Mas o desenho inteiro em volta confirma um recurso racionado:

```text
[awaySummary] skipped: at or near rate limit
[awaySummary] skipped: cache stale
[awaySummary] skipped: cache age unknown
[awaySummary] skipped: draft input present
[awaySummary] skipped: background work pending
[awaySummary] skipped: loop wakeup pending
[awaySummary] skipped: StructuredOutput recap present
[awaySummary] ccr recap dropped: new turn already running
[awaySummary] no CacheSafeParams saved, skipping
[awaySummary] recap capped from <n> to <m> chars
```

Oito guardas de pulo, cache com validade, e teto de tamanho na saída. **Ninguém raciona assim o que
é de graça.**

## O que NÃO foi medido

- **O razão contábil.** A conclusão acima é inferência forte a partir do comportamento do cliente,
  não leitura de fatura.
- **O caminho remoto.** `CLAUDE_CODE_ENABLE_REMOTE_RECAP` existe e não foi exercitado; se ele muda
  quem paga, não sei.
- **"Pelo menos 3 interações"** — não encontrado, e não descartado: ausência de string não é
  ausência de regra.
- **O socket de mensagens não foi sondado** (ver a correção da D-001). Mandar mensagem malformada
  para o pipe de uma sessão viva é risco sem retorno.

## Consequências para o projeto

**1. Não é fonte gratuita.** Não está em disco, e regerá-lo custaria o mesmo que a nossa própria
captura. Não dá para "ler o recap do Claude" e economizar.

**2. A assimetria que explica a D-011 inteira.** O recap é barato **por um motivo que não dá para
copiar de fora**: a sessão já tem a conversa em contexto, quente em cache — pedir 40 palavras sobre
o que já está lá custa quase nada. A nossa captura paga para **carregar** a conversa: são os 82k
tokens reescritos que a D-011 mediu em ~US$ 0,50. O modo enxuto existe para fugir desse custo, e é
exatamente por isso que ele **não vê o texto do assistente**.

Ou seja: "fazer o que o recap faz" não é barato para nós — é a parte cara. O que a **D-031** muda
não é o preço unitário, é **quantas vezes** se paga. De 40 sessões para um punhado, o caro cabe.

**3. Validação da tese do produto.** O artefato pelo qual o mantenedor reconhece as próprias
sessões é uma **síntese do modelo sobre a conversa**. O handoff do `seeya` é isso — persistido,
através de todas as sessões, com um plano junto. O recap morre quando a sessão morre; o handoff é o
que sobrevive.

**4. O enxuto estruturalmente não produz isso.** Ele manda dez prompts do usuário e zero texto do
assistente. Não é questão de prompt melhor — a evidência não está lá. Foi assim que o primeiro
teste real perdeu o "4 concluídas, 6 pendentes" que a conversa dizia em texto do assistente.

**5. Nada no `seeya` pode depender do recap.** Ele pode ser desligado no `/config`
(`awaySummaryEnabled: false`) e tem caminho remoto atrás de flag.

**6. O `ai-title` sim é utilizável, e já entrou na D-031** — mora no **transcript**, não no
registro, e o registro é o que some na saída graciosa (Spike E). Sobrevive exatamente na população
que a listagem da D-031 existe para descrever. Com a ressalva de sempre: entrada interna não
documentada, merece teste de contrato, e ausente vira listagem **sem** título — nunca título
inventado (D-025).

## Pergunta em aberto, levantada pelo mantenedor: e na v2, com cache?

Se numa v2 o `seeya` "abraçar" o Claude Code — lançando e sendo dono das sessões —, dá para a
captura pegar carona no cache e ficar barata?

**Não medido.** O que se sabe da mecânica: cache de prompt é **endereçado por prefixo**, não é
permissão que se concede. Não existe "ter acesso ao cache" — existe o prefixo da sua chamada bater
com algo cacheado recentemente. Ver Q-032 para o desenho da medição que responderia isso.

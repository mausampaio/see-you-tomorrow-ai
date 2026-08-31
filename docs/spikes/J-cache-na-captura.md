# Spike J — Cache na captura profunda: o relógio é mais generoso que o prefixo

**Veredito em uma linha: vale investigar mais, mas não do jeito que a Q-032 cogitou — o relógio
é bem mais generoso do que o medo de "5 minutos" (cache ainda quente aos 18 minutos), e o ganho
real medido (~4x mais barato) vem de abrir mão do papel de extrator que a D-011 introduziu para
consertar exatamente o problema que abrir mão dele reintroduz. Não morre aqui, mas o próximo
passo é um desenho novo, não o daemon "captura ao esfriar" que a Q-032 cogitou.**

**Data:** 2026-08-30/31 · **Versão do Claude Code:** 2.1.251 · **Plataforma:** Windows 11 ·
**Tarefa:** S4-T00 · **Origem:** Q-032 (pergunta do mantenedor ao ler o Spike I) ·
**Decisões/questões afetadas:** D-011 (a reavaliar), D-001 (fronteira verificada, não violada),
Q-032 (respondida — item 1 e, de graça, item 2), Q-034 (nova, aberta por este spike)

## Por que este spike existe

A Q-032 perguntou se a captura profunda (`claude -p --resume <id> --fork-session`) poderia pegar
carona em cache de prompt em vez de reescrever ~82k tokens do zero (D-011, Spike A). A resposta
tem duas partes que competem: as otimizações de custo que a D-011 já fez (`--tools ""`,
`--system-prompt` próprio, `--json-schema`) mudam o prefixo da chamada, e cache de prompt é
endereçado por prefixo — então, por desenho, a captura de hoje quase certamente erra o cache. Mas
a Q-032 também apontou que o relógio pode decidir tudo antes disso: cache de prompt tem validade
de minutos, não de horas, e uma captura no fim do dia sobre uma sessão parada de manhã acharia
cache frio **de qualquer forma**, com prefixo idêntico ou não.

O Sprint 4 precisa desta resposta antes de fixar a forma do daemon: "acorda no horário e captura
tudo" (a forma atual) e "acompanha as sessões e captura cada uma quando esfria" (a alternativa que
o Spike I sugere, por analogia com o away summary do próprio Claude Code, que dispara por
ociosidade de 5 minutos) são desenhos diferentes, não variações de detalhe.

## Método

Sessão **descartável e sintética**, criada e medida inteiramente neste spike — nunca uma sessão
real do mantenedor:

- `cwd` num diretório de `%TEMP%` criado com `mkdtemp`, sem git, sem `CLAUDE.md` de projeto.
- Ambiente saneado antes de cada chamada (D-017): as seis variáveis de sessão herdadas removidas
  via `env` montado explicitamente — a máquina de teste tinha algumas delas definidas, herança de
  rodar de dentro de uma sessão Claude (a que escreve este spike).
- `--session-id` escolhido **antecipadamente**, com um UUID obviamente sintético por chamada
  (convenção do Spike A: poucos símbolos distintos) — evita precisar redigir o `session_id` da
  saída depois, e prova que `--session-id` funciona também na criação de uma sessão nova, não só
  no fork (confirmado: `claude --help` documenta o flag sem essa distinção, e o comportamento bate).
- `--model haiku` em toda chamada. **Cuidado já registrado hoje (S3-T4):** `--model sonnet` dispara
  um classificador haiku interno antes do turno real, cobrando os dois no mesmo `modelUsage` e
  estourando orçamento — evitado usando haiku diretamente, igual ao contrato do S3-T4.
- `--max-budget-usd 0.20` em toda chamada, teto explícito.
- Prompt de conteúdo **totalmente sintético** ("codename PLUM-42"), nunca um projeto real —
  qualquer coisa que o modelo repita de volta no `result` é seguro de publicar.
- Saída bruta de cada chamada sanitizada (path de home, UUID que não seja um dos escolhidos) e
  salva em `docs/spikes/j-cache-na-captura-raw/<passo>.json`, commitada assim que cada braço
  terminava — antes de escrever este documento, seguindo `docs/FLUXO-DE-AGENTES.md` § "Commite
  cedo".

**Ferramenta:** `scripts/spike-j-measure.mjs` — script avulso, fora de `src/`, não registrado em
`package.json` (a tarefa não toca nesse arquivo). Cada braço é uma invocação **separada** do
script, de propósito: os braços que medem o relógio precisam de uma espera real entre eles, e o
operador (este agente) dormiu **de forma síncrona** e leu o relógio antes de seguir — nunca uma
espera passiva por notificação (a lição registrada em `docs/FLUXO-DE-AGENTES.md` depois do
incidente da tentativa anterior desta mesma tarefa).

**Os braços, na ordem executada:**

1. `turn1` — cria a sessão original (uma chamada `-p` comum, sem os flags de captura).
2. `arm1` — captura profunda com a configuração **atual** de produção (D-011): nosso
   `--system-prompt`, `--tools ""`, `--json-schema`, `--resume --fork-session`. Rodado ~16s depois
   do `turn1`.
3. `arm2` — o mesmo `--resume --fork-session`, **sem** nenhum dos três flags que moldam o prefixo.
   Rodado ~11s depois do `arm1` (~1min51s depois do `turn1`).
4. `arm3` — repete exatamente o braço 2, **~7,6 minutos** depois de o braço 2 terminar (relógio
   lido antes e depois do `sleep`, ver saída abaixo).
5. `arm4` — repete o braço 2 de novo, **~18,0 minutos** depois de o braço 2 terminar. Acrescentado
   além do braço 3 original porque o braço 3 ainda mostrou acerto total de cache — um segundo
   ponto no tempo vale mais que parar no primeiro resultado surpreendente.

```
$ date; sleep 380; date
2026-08-31T02:23:44Z (antes)
2026-08-31T02:30:04Z (depois, ~380s)
$ date; sleep 590; date
2026-08-31T02:30:37Z (antes)
2026-08-31T02:40:27Z (depois, ~590s)
```

**Total: 5 invocações reais do `claude`**, bem abaixo do teto de ~10 do brief. Custo somado das
cinco: **US$ 0,048** (ver tabela abaixo) — a sessão sintética pequena mediu a mesma proporção
cache-lido/cache-escrito que uma sessão grande mediria, por uma fração do preço, exatamente como
o brief previu.

## Achado 1 (confirmação com correção do nome exato do campo)

O brief pedia para confirmar `modelUsage.cache_read_input_tokens` /
`cache_creation_input_tokens` antes de construir em cima. **Os dois contadores existem, mas não
onde o brief dizia.** Na saída real de `claude -p --output-format json` (recorte de `turn1.json`):

```jsonc
{
  "usage": {
    "input_tokens": 10,
    "cache_creation_input_tokens": 7614,
    "cache_read_input_tokens": 16265,
    "cache_creation": { "ephemeral_1h_input_tokens": 7614, "ephemeral_5m_input_tokens": 0 }
  },
  "modelUsage": {
    "claude-haiku-4-5-20251001": {
      "inputTokens": 959,
      "cacheReadInputTokens": 16265,
      "cacheCreationInputTokens": 7614
    }
  }
}
```

- Os contadores de cache moram em **`usage`** (nível superior, snake_case) — `modelUsage` também
  os traz, mas por modelo e em **camelCase** (`cacheReadInputTokens`, `cacheCreationInputTokens`).
  Nos cinco braços, os dois lugares concordaram nos valores de cache.
- **`modelUsage.inputTokens` não é o mesmo número que `usage.input_tokens`.** Em quatro dos cinco
  braços eles bateram; em `turn1` (a primeira chamada, sessão nova, sem `--resume`) `modelUsage`
  reportou `959` contra `10` de `usage`. Não investigado a fundo — ver "o que NÃO foi medido".
- `usage.cache_creation` já discrimina o **tier** (`ephemeral_1h_input_tokens` vs
  `ephemeral_5m_input_tokens`) — decisivo para o Achado 3.
- `claudePrintOutputSchema` (`src/adapters/generation/schemas.ts`) já lê `usage.*` corretamente e
  trata `modelUsage` como `z.record(z.string(), z.unknown())` — **nenhuma mudança de schema
  necessária** por este spike; só a confirmação de que o schema já olhava para o lugar certo.

Isto não derruba a premissa da Q-032/do brief — o observável existe e responde diretamente se
houve acerto de cache, como prometido — mas o nome exato (`usage`, não `modelUsage`, para os
contadores agregados da chamada) é uma correção que valia registrar em vez de deixar passar.

## Achado 2 (item 2 da Q-032): identidade de prefixo entrega cache quase total, e é barato confirmar

| braço | flags que mudam o prefixo | `cache_read` | `cache_creation` | tier | custo (US$) |
|---|---|---:|---:|---|---:|
| `turn1` (cria a sessão) | nenhuma | 16.265 | 7.614 | 1h | 0,0184 |
| `arm1` (config atual, D-011) | `--tools ""` `--system-prompt` `--json-schema` | 70.260 | 4.205 | 1h | 0,0179 |
| `arm2` (sem os três flags) | nenhuma além de `--resume --fork-session` | **23.879** | 201 | 1h | **0,0042** |

`arm2` leu **exatamente** `7.614 + 16.265 = 23.879` tokens de cache — a soma inteira do que
`turn1` tinha escrito e lido. Prefixo idêntico, acerto total, e o único custo novo (201 tokens)
é o suficiente para acomodar o turno novo. Isso é a hipótese do item 2 da Q-032 confirmada, não
por inferência: **remover os três flags que moldam o prefixo devolve o prefixo padrão do Claude
Code, igual ao da sessão que originou o resumo, e o cache reconhece.**

O preço reflete isso: `arm2` saiu **4,3x mais barato** que `arm1` (US$ 0,0042 contra US$ 0,0179),
rodando **a mesma tarefa** (resumir a mesma sessão, mandar a mesma pergunta de handoff) segundos
depois. Numa sessão de tamanho real (não esta sintética), a diferença absoluta seria muito maior,
já que é a mesma proporção sobre uma base de ~82k tokens (Spike A) em vez de ~24k.

**Mas o preço da identidade de prefixo é abrir mão do que a D-011 corrigiu.** `arm2` não usa
`--system-prompt` — ou seja, volta à persona conversacional padrão do Claude Code, exatamente o
que o Spike C mediu produzindo "2.349 tokens de prosa livre terminando numa oferta de transformar
isto num artefato". A saída de `arm2` (`docs/spikes/j-cache-na-captura-raw/arm2.json`) confirma:
texto livre em Markdown com títulos ("**Handoff for PLUM-42...**"), não o JSON estruturado que
`--json-schema` garante. Ganhar 4,3x de desconto e perder a extração confiável não é uma troca
óbvia — é exatamente a tensão que a Q-032 já tinha escrito ("barato por um caminho, caro pelo
outro"), agora com números reais dos dois lados em vez de dois números isolados.

## Achado 3 (item 1 da Q-032, e a razão de ter S4-T00 antes do S4-T1): o relógio é mais generoso do que se temia

| braço | minutos desde o braço 2 terminar | `cache_read` | `cache_creation` | custo (US$) |
|---|---:|---:|---:|---:|
| `arm2` | 0 (é a referência) | 23.879 | 201 | 0,0042 |
| `arm3` | 7,61 | **24.080** | **0** | 0,0036 |
| `arm4` | 17,96 | **24.080** | **0** | 0,0039 |

`arm3` e `arm4` leram **tudo** — `24.080 = 201 + 23.879`, a soma inteira do que `arm2` tinha
escrito e lido — e não criaram **nenhum** token novo de cache, nem para o próprio prompt do turno
(idêntico em todos os três, de propósito: isola o relógio sem introduzir variação de conteúdo).
Aos 18 minutos, sem sinal nenhum de expiração.

Isto **corrige** a suposição que abriu a Q-032 ("validade de minutos a uma hora... uma captura às
19h sobre sessão parada desde as 10h acha cache frio independentemente de prefixo"). O padrão
público mais citado é 5 minutos; o que se mediu aqui, em cada uma das cinco chamadas, é que
**toda escrita de cache usou o tier de 1 hora** (`cache_creation.ephemeral_1h_input_tokens`,
nunca `ephemeral_5m_input_tokens`) — coerente com o Spike A, que já tinha visto o mesmo tier numa
sessão real dois sprints atrás. Não foi medido o instante exato da expiração (ver abaixo o motivo
de ter parado em 18 minutos), mas **18 minutos sem sinal de expiração, com o tier de escrita
declarado como 1h, é evidência direta contra "5 minutos" como a validade efetiva desta chamada.**

**A consequência para o desenho do daemon é o oposto do que a Q-032 cogitou.** Se a validade real
gira em torno de uma hora, não de cinco minutos, um daemon não precisa da granularidade fina do
away summary do Claude Code (ociosidade de 5 minutos, Spike I) para aproveitar a maior parte da
janela de cache — checar sessões a cada 15–20 minutos, ou até por hora, capturaria a mesma
oportunidade sem reinventar um detector de ociosidade fino. O relógio, medido, pesa **menos** do
que a Q-032 temia — é o prefixo (Achado 2) que decide a economia, e o prefixo pode ser corrigido
sem depender de cadência nenhuma.

## Achado 4 (não pedido, e não totalmente explicado): a configuração atual também lê cache — mais do que o esperado

A hipótese de trabalho, tanto do brief quanto da Q-032, era que `arm1` (a configuração de produção
de hoje) leria **zero** cache, porque `--tools ""`/`--system-prompt`/`--json-schema` mudam o
prefixo. **Não foi isso que se mediu:** `arm1` leu **70.260** tokens de cache — mais que o total
que `turn1` tinha escrito e lido somados (23.879), e mais que o dobro do que `arm2` leu no mesmo
instante.

`arm1.json` mostra `stop_reason: "tool_use"` e `num_turns: 3` — a mesma assinatura que a correção
medida da D-011 já descreveu (`--json-schema` força uma chamada de ferramenta interna). A hipótese
mais provável, **não confirmada**: o aparato interno que `--json-schema` aciona para forçar saída
estruturada carrega um bloco de conteúdo fixo (comum a qualquer chamada com esse flag,
independente do schema específico) grande o bastante para valer cache, e que **já estava quente**
por atividade anterior no dia na mesma conta — por exemplo o teste de contrato do S3-T4, que
também usa `--json-schema`, ou a própria sessão que escreve este spike. Não dá para confirmar isso
sem mais chamadas reais, e o orçamento deste spike prioriza os itens 1 e 2 da Q-032. Registrado
como achado aberto: **a configuração atual pode já estar lendo cache parcialmente, por um
mecanismo que não é o prefixo do sistema/ferramentas que a Q-032 discutiu**, e vale uma medição
dedicada antes de qualquer redesenho assumir que `arm1` parte de zero.

## O que NÃO foi medido

- **O instante exato de expiração do cache.** Confirmado quente até 18 minutos; não confirmado
  onde, entre 18 minutos e a marca de 1 hora que o tier `ephemeral_1h` sugere, ele de fato expira.
  Parado aqui de propósito — o brief pede "não espere horas", e os dois pontos já obtidos (quente
  aos 7,6 min e aos 18 min, sem decaimento) já respondem o que o Sprint 4 precisa: o relógio não é
  o gargalo que a Q-032 temia. Encontrar a borda exata é uma medição futura barata (mais um braço,
  esperando ~1h) se algum desenho precisar do número exato.
- **A causa exata do Achado 4** (por que `arm1` leu mais cache que `arm2`). Ver acima.
- **Por que `modelUsage.inputTokens` diverge de `usage.input_tokens`** especificamente na primeira
  chamada de uma sessão nova (Achado 1). Observado uma vez, não perseguido.
- **Sessão de tamanho real.** Toda medição usou uma sessão sintética de um turno. O mecanismo
  medido (identidade de prefixo, tier de cache, validade no tempo) não depende do tamanho do
  transcript, mas a proporção exata de economia numa sessão de trabalho real, com o "piso" de
  ~82k tokens do Spike A, não foi reproduzida aqui — proposital, para controlar o custo.
  Extrapolação linear da proporção medida (identidade de prefixo ≈ 4,3x mais barato) é razoável,
  mas é extrapolação, não medição direta em escala real.
- **`--exclude-dynamic-system-prompt-sections`.** Encontrado em `claude --help` durante este
  spike (não estava em nenhum documento do projeto): "Move per-machine sections (cwd, env info,
  memory paths, git status) from the system prompt into the first user message. Improves
  cross-user prompt-cache reuse." Isto sugere que o prompt de sistema padrão do Claude Code
  embute conteúdo dinâmico por máquina (`cwd`, estado do git) que também poderia quebrar o cache
  entre sessões com `cwd`s diferentes — algo que este spike não testou, porque as cinco chamadas
  usaram o **mesmo** `cwd` (disposable, sem git) do começo ao fim, igual à sessão original. Numa
  frota real, sessões diferentes têm `cwd`s diferentes, e isso pode limitar quanto da identidade
  de prefixo do Achado 2 se generaliza entre sessões — só não entre turnos da **mesma** sessão,
  que é o caso da captura. Vale uma medição dedicada antes de contar com isso em produção.
- **O caminho remoto/de conta** por trás do tier de 1h (por que 1h e não 5min é o default aqui) —
  não sondado, é comportamento observado do cliente, não confirmação de política de faturamento.

## Consequências e a fronteira da D-001

**Nenhuma chamada deste spike tocou uma sessão viva.** Todas as cinco passaram pelo mecanismo já
aprovado pela D-001/D-012: processo headless separado, `--fork-session` sempre presente,
`sessionId` de fork escolhido antes de spawnar (mesma prática de `deep-generator.ts`). Nenhuma
gastou contexto de uma sessão viva nem interrompeu turno nenhum — a sessão "original" resumida
aqui era ela mesma descartável e sintética, criada só para este teste. Isto vale registrar
explicitamente porque a D-031 já tinha avisado: perseguir identidade de prefixo com a sessão viva
chegaria perto de "gerar por dentro". **O desenho que os Achados 2 e 3 sugerem não precisa disso**
— a identidade de prefixo medida aqui vem inteiramente de **não mexer** nos flags que o `seeya` já
controla (`--system-prompt`, `--tools`, `--json-schema`), nunca de ler ou escrever na sessão viva.

**Para a D-011:** os números do Achado 2 dão um caminho concreto, mas incompleto. Recuperar
identidade de prefixo (remover os três flags) é **medidamente mais barato**, mas devolve o
problema que esses três flags existem para resolver — saída de prosa livre em vez de JSON
estruturado e parseável (D-003, D-011). Um redesenho que persiga esta economia precisa resolver
essa troca antes, não depois: por exemplo, uma chamada barata com prefixo padrão para obter o
texto, seguida de extração estruturada separada (uma segunda chamada pequena, ou processamento
determinístico) — não medido aqui, é a pergunta natural que abre a Q-034.

**Para o Sprint 4/S4-T0/S4-T1 (forma do daemon):** o Achado 3 pesa contra desenhar o daemon em
torno de uma granularidade de ociosidade fina (5 minutos, como o away summary do Spike I). O
relógio, medido, tolera uma cadência bem mais larga sem perder a janela de cache. Isso não fecha
a pergunta de qual cadência o daemon deveria usar — só derruba a suposição de que precisaria ser
tão fina quanto o away summary do Claude Code, que resolve um problema diferente (recap de UI, não
custo de captura).

## Q-032: itens respondidos

- **Item 1 (relógio)** — respondido: mais generoso do que a suposição que abriu a questão (Achado
  3). Não é "captura tudo às 19h", mas também não precisa ser "detecte 5 minutos de ociosidade" —
  algo no meio (dezenas de minutos) provavelmente já captura a maior parte do ganho.
- **Item 2 (identidade de prefixo)** — respondido, de graça, porque saiu barato medir junto do
  item 1 com a mesma sessão sintética: identidade de prefixo entrega cache quase total (Achado 2),
  ao custo de reverter a otimização de saída estruturada da D-011.
- **Item 3 (validade efetiva)** — parcialmente respondido: confirmado quente até 18 minutos, tier
  de escrita é 1h em toda chamada observada; a borda exata de expiração não foi medida (ver "o que
  NÃO foi medido").

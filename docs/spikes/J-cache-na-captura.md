# Spike J — Cache na captura profunda: o relógio é mais generoso que o prefixo

**Veredito em uma linha: vale investigar mais, mas não do jeito que a Q-032 cogitou — o relógio
é bem mais generoso do que o medo de "5 minutos" (cache ainda quente aos 18 minutos), e o ganho
real medido (~4x mais barato) vem de abrir mão do papel de extrator que a D-011 introduziu para
consertar exatamente o problema que abrir mão dele reintroduz. Não morre aqui, mas o próximo
passo é um desenho novo, não o daemon "captura ao esfriar" que a Q-032 cogitou.**

**Atualização S4-T00b (2026-08-31, mesmo dia): a saída de escape que a Q-034 buscava não existe.**
A hipótese era que só o `--system-prompt` quebrava a identidade de prefixo, e que largar só ele
(mantendo `--tools ""` e `--json-schema`, logo mantendo saída estruturada) recuperaria cache. **Foi
medido e refutado**: largar qualquer um dos três flags sozinho — não só o `--system-prompt` —
já basta para zerar o acerto de cache contra a sessão viva, no mesmo padrão (`cache_read=0`) que a
configuração inteira. A troca "barato ou estruturado" da Q-034 continua de pé como escolha real,
não como dilema falso. Ver a seção "S4-T00b" abaixo.

**Atualização S4-T00c (2026-08-31, mesmo dia): o mesmo efeito de cache não explicado do Achado 4
reaparece no modo ENXUTO, que nunca usa `--resume`.** Medindo quanto custa acrescentar texto do
assistente ao prompt enxuto (Q-036), o volume enviado não previu o custo — a chamada com MAIS
conteúdo saiu mais barata que a com MENOS, e repetir a MESMA chamada minutos depois custou 3,5×
mais. Ver a seção "S4-T00c" abaixo.

**Data:** 2026-08-30/31 (S4-T00), 2026-08-31 (S4-T00b, ~1h15 depois; S4-T00c, mesmo dia) ·
**Versão do Claude Code:** 2.1.251 · **Plataforma:** Windows 11 · **Tarefa:** S4-T00, S4-T00b,
S4-T00c · **Origem:** Q-032 (pergunta do mantenedor ao ler o Spike I), S4-T00b (Q-034/Q-035, saída
do próprio Spike J), S4-T00c (Q-036, saída da reavaliação da D-011 sob a D-031) ·
**Decisões/questões afetadas:** D-011 (a reavaliar, depois reavaliada em 2026-08-31), D-001
(fronteira verificada, não violada), Q-032 (respondida — item 1 e, de graça, item 2), Q-034 (aberta
por este spike, **medida e mantida em S4-T00b** — a troca é real, não falsa), Q-035 (nova, aberta
por S4-T00b), Q-036 (nova, aberta por S4-T00c)

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

---

## S4-T00b — Nenhum dos três flags é dispensável sozinho: a hipótese do `--system-prompt` refutada

**Tarefa:** S4-T00b, aprovada pelo mantenedor em 2026-08-31 como saída direta deste spike (não um
Spike K novo — mesma pergunta, mais resolução). **Ferramenta:** `scripts/spike-j-measure.mjs`,
estendido com seis novos passos (`turn1b`, `base`, `no-system-prompt`, `no-tools`,
`no-json-schema`, `no-flags-control`) em vez de um script separado.

### Por que esta rodada existe

O Achado 2 comparou **os três flags juntos** (`--tools ""`, `--system-prompt`, `--json-schema`)
contra **nenhum deles**. Isso faz a Q-034 parecer uma escolha forçada entre barato e estruturado
só se os três forem igualmente culpados — e o Achado 4 já tinha achado um sinal de que talvez não
fossem: a configuração atual (os três juntos) leu 70.260 tokens de cache quando a hipótese era
zero. A hipótese testada aqui: o `--system-prompt` sozinho é o culpado, por ficar no início
absoluto do prefixo montado internamente; se for, dá para largar só ele — mantendo `--tools ""` e
`--json-schema`, e portanto a saída estruturada — sem abrir mão do cache.

### Método

Mesmo padrão do resto do spike: sessão sintética descartável, `cwd` único reaproveitado por todas
as seis chamadas desta rodada (`ensureCwd` do script, mesmo mecanismo que manteve o `cwd`
constante em S4-T00), ambiente saneado (D-017), `--model haiku`, `--max-budget-usd 0.20` por
chamada, saída bruta sanitizada e commitada arm a arm.

**Sessão original nova** (`turn1b`, codinome ONYX-77): a sessão `IDS.original` de S4-T00 tinha
sido criada ~1h15 antes do início desta rodada — perto demais do limite do tier de 1h que o
Achado 3 mediu (quente aos 18 min, não medido além disso) para servir de âncora sem introduzir
dúvida sobre o relógio. Uma sessão nova, criada no início desta rodada e resumida por todos os
braços seguintes em rápida sucessão (todos os seis dentro de ~5,5 minutos — ver timestamps
abaixo), remove essa dúvida por construção, ao custo de não poder comparar `cache_read` deste
`turn1b` diretamente com o `IDS.original` de S4-T00 (não é o mesmo prefixo de conteúdo).

**Correção de método, registrada porque o commit que a acompanhou errou o número:** os commits
desta rodada descreveram a sessão de S4-T00 como "um dia" mais antiga. Não é — os timestamps do
arquivo de estado (`turn1StartedAt` etc.) mostram que a S4-T00 rodou às 02:20–02:41 UTC do mesmo
dia, e esta rodada começou às 03:37 UTC, **~1h15 depois**, não um dia. O motivo de abrir uma sessão
nova continua válido (proximidade do limite de 1h do tier), só a magnitude do intervalo estava
errada nos commits — corrigida aqui, que é o documento de registro.

**Seis braços, na ordem executada** (todos com `--resume <original2> --fork-session`, variando só
os três flags e, no controle, nenhum):

1. `turn1b` — cria a sessão original nova.
2. `base` — os três flags juntos (âncora desta rodada; compara contra o `arm1` de S4-T00).
3. `no-system-prompt` — sem `--system-prompt`, com `--tools ""` e `--json-schema` (**braço
   decisivo**).
4. `no-tools` — sem `--tools ""`, com `--system-prompt` e `--json-schema`.
5. `no-json-schema` — sem `--json-schema`, com `--tools ""` e `--system-prompt`.
6. `no-flags-control` — nenhum dos três (repete a forma do `arm2` de S4-T00, mas contra a sessão
   `original2` desta rodada). Acrescentado **depois** de ver os braços 3–5 zerarem `cache_read`:
   sem este controle, um zero em todo braço seria ambíguo entre "esse flag quebra o cache" e "nada
   está acertando cache nesta sessão por outro motivo". Consumiu a sexta e última chamada do teto
   de 6.

**Total: 6 invocações reais do `claude`**, no teto do brief. Custo somado: **US$ 0,2245**
(0,0106 + 0,0754 + 0,0220 + 0,0377 + 0,0749 + 0,0039 — ver `total_cost_usd` em cada
`docs/spikes/j-cache-na-captura-raw/<passo>.json`). A variante "instrução de extração no prompt do
usuário" **não foi medida**: o brief só pedia essa sétima medição condicionalmente ao braço
decisivo confirmar a hipótese, e ele a refutou (ver abaixo) — gastá-la teria estourado o teto sem
uma pergunta que ela ainda respondesse.

### Resultado

| braço | flags presentes | `cache_read` | `cache_creation` | custo (US$) |
|---|---|---:|---:|---:|
| `turn1b` (cria a sessão) | nenhuma | 20.414 | 3.465 | 0,0106 |
| `base` | tools + system-prompt + json-schema | **0** | 36.968 | 0,0754 |
| `no-system-prompt` (decisivo) | tools + json-schema | **0** | 10.277 | 0,0220 |
| `no-tools` | system-prompt + json-schema | **0** | 17.867 | 0,0377 |
| `no-json-schema` | tools + system-prompt | **0** | 36.821 | 0,0749 |
| `no-flags-control` | nenhuma | **23.879** | 206 | 0,0039 |

### O braço decisivo: hipótese refutada, não confirmada

`no-system-prompt` largou só o `--system-prompt`, mantendo `--tools ""` e `--json-schema` — a
aposta era que isso bastaria para recuperar cache, como o `arm2` de S4-T00 (largar os três) tinha
recuperado quase 100% contra a sessão viva. **Não foi isso que se mediu:** `cache_read=0`, igual ao
`base` com os três flags presentes. Largar só o `--system-prompt` não recupera nada de cache contra
a sessão viva.

**Isto não é um resultado ambíguo por causa do ambiente.** O braço de controle
(`no-flags-control`, largando os três, rodado por último e contra a mesma sessão `original2`) leu
**exatamente 23.879 tokens** de cache — a soma inteira do que `turn1b` tinha escrito e lido
(3.465 + 20.414), reproduzindo com precisão o padrão do Achado 2. Isso prova que o mecanismo de
cache e o ambiente desta rodada estavam funcionando normalmente no mesmo intervalo de tempo em que
`no-system-prompt`, `no-tools` e `no-json-schema` leram zero — os três zeros são sinal real, não
artefato de sessão fria ou de conta sem atividade recente.

**Conclusão medida, com cuidado para não generalizar além do dado:** toda combinação de **dois dos
três flags** testada aqui (`no-system-prompt`: tools+schema; `no-tools`: system-prompt+schema;
`no-json-schema`: tools+system-prompt) leu **zero** cache contra a mesma sessão viva que o braço de
controle, com os três largados, leu quase por inteiro. A hipótese do brief — que largar só o
`--system-prompt` bastaria para recuperar cache, porque só ele ficaria no início absoluto do
prefixo — está **refutada** no sentido que importa para a Q-034: largar só o `--system-prompt`
**não** recupera cache algum, exatamente como largar só o `--tools ""` ou só o `--json-schema`
também não recuperam (mesmo padrão de zero nos três casos). **O que não foi isolado**: se cada flag
seria suficiente para zerar o cache **completamente sozinho** (sem nenhum dos outros dois presente)
não foi medido — só se sabe que **dois presentes já bastam** para zerar, em qualquer das três
combinações testadas. Para a pergunta prática da Q-034 (dá para largar só um e manter os outros
dois para saída estruturada?), isso já é suficiente: a resposta é não, para qualquer um dos três
escolhido como o único a cair.

### Achado 4, delimitado: o bloco grande não é gatilhado pelo `--json-schema`

A hipótese registrada no Achado 4 original — "o aparato interno que o `--json-schema` aciona
carrega um bloco fixo" — **não se sustenta** contra os números desta rodada:

- `base` (os três) escreveu 36.968 tokens novos.
- `no-json-schema` (larga só o schema, mantém tools + system-prompt) escreveu **36.821** —
  **147 tokens a menos**, quase exatamente o tamanho literal do JSON do próprio schema
  (`UNDERSTANDING_JSON_SCHEMA` tem pouco mais de 100 tokens de texto). Ou seja: largar
  `--json-schema` só tira o texto do schema em si, não revela bloco fixo nenhum por trás dele.

O peso está em outro lugar:

- `--system-prompt` sozinho vale **26.691 tokens** de diferença (`base` 36.968 menos
  `no-system-prompt` 10.277).
- `--tools ""` sozinho vale **19.101 tokens** (`base` 36.968 menos `no-tools` 17.867).
- Somados, esses dois deltas dão 45.792 — **8.824 tokens a mais** que o total real do `base`
  (36.968). Ou seja, os efeitos **não são aditivos**: ter `--system-prompt` e `--tools ""` juntos
  custa menos do que a soma do que cada um custa isoladamente contra o par com schema. Há uma
  interação real entre os dois — plausivelmente algo como o aparato que remove as ferramentas
  reagindo de forma diferente quando o system prompt também é customizado — mas **o mecanismo
  exato não foi isolado**: faltaria uma medição com `--tools ""` sozinho (sem system-prompt nem
  schema) e outra com `--system-prompt` sozinho para decompor os dois efeitos por completo, e o
  orçamento de 6 chamadas já estava no teto.

**Sobre o número original do Achado 4 (70.260 tokens lidos):** esta rodada não o reproduz nem o
contradiz diretamente — `base` aqui leu **zero**, não 70.260, rodando a mesma combinação de flags.
Isso é consistente com a própria ressalva que o Achado 4 já registrava ("pode já estar quente por
atividade anterior no dia, não é propriedade garantida da configuração"): sem essa atividade
externa presente nesta rodada, o braço equivalente não encontrou nada para ler. **O que fica de
pé:** a hipótese "há reuso possível para a configuração atual, mas ele depende de calor externo,
não é uma propriedade determinística dos três flags". **O que cai:** a hipótese mais específica de
que esse calor, quando presente, seria atribuível ao `--json-schema` — os números desta rodada
apontam para `--system-prompt`/`--tools ""` (e a interação entre os dois) como os candidatos mais
pesados, não o schema. **O que continua sem explicação:** de onde exatamente vinha o calor que
produziu 70.260 no Achado 4 original — não foi medido de novo porque exigiria reproduzir o mesmo
estado de conta/dia que já não existe mais.

### Consequência para a Q-034: a troca sobrevive

A pergunta era se dava para ter cache barato **e** saída estruturada na mesma captura, movendo só
a instrução de extração para o prompt do usuário. **A resposta medida é não, pelo menos não por
este caminho:** como nenhum dos três flags é dispensável sozinho, e a variante "prompt do usuário"
só faria sentido largando o `--system-prompt` (mantendo os outros dois, que já são suficientes
para zerar o cache sozinhos), a variante nunca chegou a ser medida — não há razão para esperar que
ela ajude, dado que `--tools ""` e `--json-schema` quebram o cache com ou sem `--system-prompt`
presente. **A Q-034 continua uma escolha real, não um dilema falso**: cache quase total exige
abrir mão dos três flags (Achado 2), e manter **qualquer dois** deles já é suficiente para perder
o cache por completo (esta rodada). As ideias A/B/D listadas na Q-034 continuam sendo os caminhos
que restam; a ideia C ("testar se `--json-schema` sozinho preserva identidade de prefixo") está
respondida na forma testável aqui — mantido junto de outro flag, não preserva. Se ele preservaria
**totalmente sozinho** (sem `--tools ""` nem `--system-prompt`) não foi medido (ver "o que NÃO foi
medido"), mas deixou de ser a pergunta prática: a D-011 não usa `--json-schema` isolado, usa os
três juntos, e é essa combinação (ou qualquer subconjunto de dois) que este spike mostrou zerar o
cache.

### O que NÃO foi medido nesta rodada

- **Cada flag isoladamente** (sem os outros dois). As três combinações testadas aqui são sempre
  "dois dos três" — não há dado direto de quanto cada flag pesa sozinho contra uma sessão sem
  nenhum dos três, só as diferenças par a par contra `base`, que já revelam a interação
  não-aditiva mas não a decompõem.
- **A variante "instrução no prompt do usuário"** (a que motivou toda a rodada) — não medida
  porque o braço decisivo já refutou a premissa que a justificava. Não é um item pendente: é uma
  medição que deixou de fazer sentido.
- **A origem exata do calor que produziu os 70.260 tokens do Achado 4 original** — ver acima.
- **O mecanismo exato da interação `--system-prompt` × `--tools ""`** — só o tamanho do
  descompasso (8.824 tokens) foi medido, não a causa.

---

## S4-T00c — O texto do assistente no prompt enxuto: o mesmo efeito de cache do Achado 4, agora sem `--resume`

**Tarefa:** S4-T00c, saída direta da reavaliação da D-011 sob a D-031 (2026-08-31): o modo enxuto
para de descartar o texto do assistente. **Pergunta:** quanto custa acrescentar esse texto ao
prompt enxuto, em pelo menos dois volumes, antes de escolher qualquer número (`docs/QUESTOES.md`
Q-036). **Ferramenta:** `scripts/spike-j-measure.mjs`, estendido com três passos novos
(`lean-baseline`, `lean-assistant-small`, `lean-assistant-large`).

### Por que esta rodada é diferente das anteriores

S4-T00 e S4-T00b mediram a captura **profunda** (`--resume --fork-session`), onde a pergunta é
identidade de prefixo com uma sessão viva. O modo **enxuto** nunca usa `--resume`: cada chamada é
uma sessão nova e descartável (`--no-session-persistence`, D-011). Não deveria haver pergunta de
cache aqui — não existe uma "sessão original" para bater prefixo. A medição mostrou que existe
mesmo assim.

### Método

Mesmo padrão do resto do spike: sessão sintética descartável (`cwd` único em `%TEMP%`, reutilizado
pelas três chamadas via `ensureCwd`), ambiente saneado (D-017), `--model haiku`,
`--max-budget-usd 0,20`, saída bruta sanitizada e commitada a cada braço
(`docs/spikes/j-cache-na-captura-raw/lean-*.json`). A forma da chamada é a real do gerador enxuto
(`adapters/generation/args.ts#buildLeanArgs`): `--tools ""`, `--system-prompt` e `--json-schema`
(strings idênticas às de produção), `--no-session-persistence` — nunca `--resume`.

O conteúdo é um `SessionFacts` inventado (projeto `widget-cli`, dez prompts de usuário sintéticos,
oito arquivos tocados sintéticos, dez mensagens de assistente sintéticas — uma delas
propositalmente no formato exato do defeito que esta tarefa conserta: "4 de 10 tarefas feitas, 6
restantes"). Três braços:

1. `lean-baseline` — o prompt enxuto de hoje, zero texto de assistente (controle).
2. `lean-assistant-small` — as 3 últimas mensagens do assistente, cada uma truncada a 400
   caracteres (~1,7 KB adicionados ao prompt).
3. `lean-assistant-large` — as 10 mensagens inteiras, sem truncar (~3,6 KB adicionados).

Depois dos três, `lean-baseline` foi rodado **de novo**, com o MESMO conteúdo da primeira vez, só
para checar se alguma coisa tinha mudado no ambiente entre a primeira chamada e as seguintes.

**Total: 4 invocações reais**, bem abaixo do teto de 6. Custo somado: **US$ 0,124** (0,0061 +
0,0754 + 0,0213 + 0,0212).

### Resultado

| braço | texto de assistente | `cache_read` | `cache_creation` | custo (US$) |
|---|---|---:|---:|---:|
| `lean-baseline` (1ª vez) | nenhum | 0 | 0 | 0,0061 |
| `lean-assistant-small` | 3 msgs, truncadas (~1,7 KB) | 0 | 34.573 | 0,0754 |
| `lean-assistant-large` | 10 msgs, inteiras (~3,6 KB) | 68.428 | 2.826 | 0,0213 |
| `lean-baseline` (repetida, conteúdo idêntico à 1ª) | nenhum | 67.821 | 2.463 | 0,0212 |

### O achado: volume não prediz custo — o mesmo mecanismo do Achado 4, agora sem `--resume`

A hipótese ingênua era "mais texto de assistente custa mais". **Não foi isso que se mediu.** A
chamada com MAIS conteúdo (`lean-assistant-large`, 10 mensagens inteiras) saiu **3,5× mais barata**
que a com MENOS (`lean-assistant-small`, 3 mensagens truncadas), rodada um minuto antes. E a prova
decisiva: repetir `lean-baseline` com o **conteúdo idêntico** da primeira vez custou **3,5× mais**
na segunda vez (US$ 0,0212 contra US$ 0,0061) — nada no prompt mudou entre as duas chamadas.

O padrão bate exatamente com o Achado 4 deste spike (que media o caminho `--resume`): a primeira
chamada de uma janela é "fria" (sem `cache_creation`, sem `cache_read` — tudo conta como
`input_tokens` normal, porque o total fica abaixo do piso de cache elegível). A partir da segunda
chamada dentro da mesma janela (aproximadamente a mesma validade de ~1h que o Achado 3 já tinha
medido), um bloco de dezenas de milhares de tokens — muito maior que qualquer conteúdo que este
spike de fato enviou — aparece como `cache_creation` (na primeira vez que aquele bloco aparece) ou
`cache_read` (nas seguintes), dominando o custo total independentemente do que o prompt realmente
carregava. **Isto reproduz o Achado 4 num caminho onde, por desenho, não deveria haver cache
nenhum** (o enxuto nunca usa `--resume`): o mecanismo não é a identidade de prefixo com uma sessão
específica, é algo ligado ao aparato fixo que `--tools ""`/`--system-prompt`/`--json-schema` aciona
internamente, e que aparentemente pode ficar "quente" de uma chamada `-p` qualquer para a próxima,
mesmo sem sessão em comum.

### Consequência para a decisão de volume (Q-036)

Como o custo não discrimina entre os volumes testados — a medição não deu um "cotovelo" de custo
para escolher N em cima dele —, `MAX_ASSISTANT_MESSAGES = 10` e `MAX_ASSISTANT_MESSAGE_CHARS = 500`
(`adapters/transcript/facts.ts`) foram escolhidos por qualidade de prompt, não por custo: simetria
com `MAX_LAST_PROMPTS` (mesma contagem) e um teto por mensagem para impedir que um turno verboso
isolado (logs colados, diff grande) domine as outras quatro seções do prompt — o away summary do
Spike I já recomenda pular exatamente esse tipo de conteúdo.

### Consequência mais ampla, fora do escopo desta tarefa

Se este mecanismo de cache compartilhado é real e não específico da S4-T00c, então **a suposição
de que o modo enxuto sempre custa perto do piso (~US$ 0,006–0,08, conforme D-011/S2-T2) só vale
para a primeira chamada de uma janela.** Qualquer captura seguinte — por exemplo, a segunda sessão
capturada na mesma passada de `end-day`, minutos depois da primeira — pode estar pagando um custo
de US$ 0,02–0,08 pelo mesmo motivo, **antes mesmo desta tarefa acrescentar qualquer texto de
assistente**. Não medido a fundo aqui (o orçamento de chamadas foi gasto respondendo a pergunta
desta tarefa, não essa), mas registrado em `docs/QUESTOES.md` Q-036 como suspeita para quem for
estimar custo de captura em lote.

### O que NÃO foi medido nesta rodada

- **A origem exata do bloco de dezenas de milhares de tokens** — mesma limitação do Achado 4
  original: não confirmado se é o mesmo aparato em todos os casos, nem por que ele soma valores
  diferentes entre chamadas (34.573 vs. 68.428 vs. 67.821).
- **Se o efeito é por conta/dia, por processo, ou por algum outro escopo** — as quatro chamadas
  desta rodada foram feitas em sequência rápida (poucos minutos), então não dá para distinguir
  "por conta nas últimas horas" de "por processo `claude` recente" ou outra causa.
- **Se o mesmo padrão se replica numa sessão de tamanho real** (fixture pequena e sintética aqui,
  como em todo o resto deste spike).

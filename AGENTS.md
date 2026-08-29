# Contrato de trabalho — See You Tomorrow AI

Leia este arquivo inteiro antes de escrever qualquer linha. Ele vale mais que a sua intuição
sobre o que seria melhor.

## O que é o projeto

CLI chamado `seeya` que descobre sessões de Claude Code na máquina, captura o estado de cada
uma no fim do dia, gera um plano para o dia seguinte e retoma as sessões no dia seguinte.

## Ordem de autoridade

1. `docs/DECISOES.md` — decisões travadas. **Você não altera este arquivo.**
2. `docs/ESPECIFICACAO.md` — o comportamento a implementar. **Você não altera este arquivo.**
3. `docs/ARQUITETURA.md` — as fronteiras. Alteração só com aprovação.
4. `docs/PLANO-DE-ENTREGA.md` — a tarefa da vez. Você marca progresso aqui.
5. `docs/TESTES.md` — o que testar em cada faixa.

Conflito entre este arquivo e um doc acima: o doc vence, e você registra a inconsistência em
`docs/QUESTOES.md`.

## Como trabalhar

- **Uma tarefa por vez**, na ordem do plano de entrega. Não agrupe, não adiante, não pule.
- Antes de começar: releia a tarefa e o trecho da spec que ela implementa.
- Ao terminar: rode `npm run verificar`, marque a tarefa como `[~]` e **pare**. Quem move para
  `[x]` é o review.
- Branch por tarefa: `tarefa/S1-T3-descoberta`. Commits pequenos, em português.
- **Commite antes de terminar a tarefa.** Duas quedas de API já pegaram agentes com trabalho só
  no disco. Trabalho não commitado é trabalho que a próxima queda leva.

## Quando parar e perguntar

Pare, escreva em `docs/QUESTOES.md` e **não decida sozinho** se:

- a spec está ambígua ou silenciosa sobre um caso que você precisa tratar agora;
- implementar a tarefa exigiria violar uma decisão de `docs/DECISOES.md`;
- você descobriu que uma premissa técnica da spec está errada (ex.: uma flag do `claude` não
  se comporta como descrito);
- a tarefa parece precisar de uma dependência nova relevante;
- você quer mudar uma fronteira de módulo.

Inventar um comportamento não especificado é o erro mais caro que você pode cometer aqui.
Perguntar custa uma mensagem.

Se a solução tiver efeito **além da sua tarefa**, abra a questão **e** siga com a solução
mínima. Não precisa parar; precisa avisar.

---

# Regras que não se negociam

## Arquitetura

- `nucleo/` é puro: não importa `node:*`, não importa nada de `adaptadores/`, `aplicacao/` ou
  `cli/`, não faz I/O, não conhece o Claude Code.
- A matriz de dependências permitidas está em `docs/ARQUITETURA.md` e é **exaustiva**: 20 pares
  ordenados. Par que não estiver nela é erro da matriz — vire questão, não improvise.
- `cli/` é a **única raiz de composição** (D-020). Só ele nomeia adapter concreto.
- Todo acesso ao mundo passa por uma porta declarada em `nucleo/portas.ts`.
- Nada específico do Claude Code fora de `adaptadores/`.

## Tempo

- `new Date()` **sem argumento**, `Date.now()`, `setTimeout` e `setInterval` só existem em
  `adaptadores/relogio`. Em qualquer outro lugar, use a porta `Relogio` (D-019).
  `new Date(valor)` **com** argumento é permitido: é transformação determinística, não leitura
  do "agora".
- Horário de encerramento é horário local ("19:30"), nunca epoch persistido.

## Dados de fora

- Nenhum `JSON.parse` sem schema zod em seguida. Vale para o registro do Claude Code, o
  transcript, a config e a saída do `claude -p`.
- **Coleção externa valida item por item, nunca em bloco** (D-022). Item ruim é registrado com o
  motivo e descartado individualmente; a operação segue. `z.array()` é tudo-ou-nada e por isso
  não serve: uma entrada estranha derrubaria a lista inteira.
- O retorno declara **os dois lados**: aceitos e rejeitados com motivo. Sem isso o comando mente
  por omissão em vez de dizer "3 sessões, 1 entrada ignorada".
- Schema é **estrito nos campos que usa e tolerante com campos desconhecidos**. Campo que só
  serve para exibir é sempre opcional (D-021).
- **Ausência de dado não vira afirmação** (D-025). Faltando dado, o resultado é o estado menos
  específico que a evidência sustenta, nunca o mais específico que ela permitiria imaginar.

## Sistema de arquivos

- Escrever **apenas** dentro de `~/.seeya/` (raiz injetável). Nunca dentro de
  `~/.claude/`, nunca dentro dos repositórios das sessões capturadas. A única exceção é apagar
  fork que o próprio `seeya` criou e registrou (D-012).
- Toda escrita é atômica: temporário + rename.
- Nenhum caminho montado com `/` ou `\` literal. Sempre `node:path`.

## Processos

- `spawn` com array de argumentos e `shell: false`. Nunca `exec` com string interpolada — os
  `cwd` têm espaços e acentos.
- **Contexto de tamanho variável vai por stdin ou arquivo, nunca por argumento** (D-015).
  Argumento tem limite de tamanho e sofre mangling de shell nas três plataformas.
- Ao spawnar `claude`, monte o ambiente explicitamente e **remova** as variáveis de sessão
  herdadas (D-017). Herdar `CLAUDE_CODE_CHILD_SESSION` faz o processo filho perder o transcript.
- Terminar processo de sessão só quando a política permitir (D-002), só depois do handoff
  verificado em disco, e só graciosamente. Sem kill forçado na v1.

## Segurança e privacidade

- Não leia, não grave e não envie credenciais. `~/.claude/.credentials.json` não existe para
  este app.
- Fixtures de teste são anonimizadas. Nenhum caminho real, token ou código privado no repo.

## Este projeto é de código aberto

Tudo que entra aqui é lido por qualquer pessoa, para sempre, e não tem como ser retirado depois.
Vale para código, documentos, mensagens de commit e fixtures.

- Contexto que vem de **fora deste projeto** — nome de ferramenta de terceiro, sistema interno,
  identificador, caminho de máquina — é **anonimizado antes** de entrar em arquivo versionado.
  Descreva o comportamento técnico, que é o que importa para a decisão, e omita a origem.
- **Documentar bem e publicar são decisões separadas.** É fácil tratar como uma só quando se
  está escrevendo rápido, e o custo de errar é irreversível.
- Em exemplo, use placeholder: `<usuario>`, `~`, UUID obviamente sintético
  (`11111111-1111-4111-8111-111111111111`). Nunca o valor real, nem "só nesta linha".
- `scripts/verificar-termos-locais.mjs` roda no pre-commit e recusa o commit em dois casos: termo
  presente em `.termos-locais` (arquivo local, fora do git), ou conteúdo com **forma** de
  vazamento — caminho de home com usuário, e-mail, UUID que não pareça sintético.
- O guard só conhece o que já se sabe. **A regra vale mais que ele**: ele não vai pegar o nome
  novo que só você viu.

---

# Estilo de código

## Funções e arquivos

- **Função: no máximo ~20 linhas.** Não há mínimo — um predicado puro de uma linha é bom código,
  e este projeto tem vários. Se passar de 20, quase sempre são duas funções.
- **Arquivo: abaixo de 500 linhas**, separado por responsabilidade. Os arquivos atuais estão bem
  abaixo disso; se um começar a crescer, o sinal é que ganhou uma segunda responsabilidade.
- **Uma coisa por função, uma responsabilidade por módulo.**
- **Retorno cedo em vez de `if` aninhado. Máximo 2 níveis de indentação.** Três níveis é sinal de
  que falta extrair uma função.
- **Nada de duplicação.** Lógica repetida vira função ou módulo.

## Nomes

- Específicos e únicos. Evite `dados`, `info`, `util`, `helper`, `gerenciador`, `processar`,
  `handler`, `manager`.
- Heurística útil: um bom nome devolve **menos de 5 ocorrências** num grep do repositório. Se
  devolver 40, o nome não distingue nada.
- Nomes em português (D-008). Campos de JSON que vêm do Claude Code (`sessionId`, `cwd`,
  `procStart`) mantêm a grafia original.

## Tipos

- Explícitos. Sem `any`, sem `@ts-ignore`, sem função sem tipo.
- **O tipo torna o estado inválido irrepresentável; o comentário só avisa** (D-024). Se uma regra
  diz "não faça X com este valor", o tipo tem de recusar X — união discriminada em vez de campo
  opcional, dois tipos em vez de um com flag.
- `!` e `as` em código de produção são sinal de que o tipo está errado, não de que o autor sabe
  mais que o compilador.

## Mensagens de erro

**A mensagem inclui o valor que causou o erro e a forma esperada.** Isto não é preferência
estética — custou tempo real neste projeto: um teste falhou com `expected 2 to be +0` e ninguém
descobria quais eram os 2 erros até alguém instrumentar à mão.

- Asserção sobre contagem imprime **a saída bruta** da ferramenta na falha.
- Validação que rejeita item devolve o item bruto **e** o motivo com o caminho do campo.
- "Falhou" sozinho não é mensagem de erro. "Falhou porque `startedAt` veio como `"abc"`, esperava
  número inteiro positivo" é.

---

# Comentários

- **Preserve os comentários existentes.** Não os remova em refatoração: neste projeto eles
  carregam medição, não opinião — número de execuções, saída bruta observada, por que uma
  alternativa foi descartada. Apagar um comentário desses joga fora a evidência que sustenta a
  decisão.
- **Escreva o PORQUÊ, não o QUÊ.** `// incrementa o contador` acima de `i++` é ruído.
- **Docstring em função pública: intenção e um exemplo de uso.** Quando fizer diferença, diga
  também quando **não** usar.
- **Cite decisão, não conversa.** Se uma linha existe por causa de uma decisão, cite `D-0XX`; se
  por causa de um experimento, cite o spike. **Nunca cite a mensagem que despachou a tarefa** —
  o leitor não tem como abrir aquilo. Ou o raciocínio se sustenta sozinho, ou a orientação vira
  decisão em `docs/DECISOES.md` primeiro.
- Ao registrar uma limitação conhecida, diga **onde o guarda-corpo termina**. "Cobre o descuido,
  não o contorno deliberado" é mais honesto — e mais útil — que silêncio.

---

# Testes

- **Um comando roda tudo: `npm run verificar`.** Ele é o portão: tipos, lint, fronteiras de
  camada, build e cobertura.
- **Toda função nova tem teste. Toda correção de bug tem teste de regressão** — e o teste falha
  antes da correção, senão não prova nada.
- Nenhum teste toca a rede, o relógio real, o `~/.claude` real ou o `~/.seeya` real.
  A suíte de contrato é a única exceção, e ela não roda no CI.
- **Duplo de I/O é classe/objeto nomeado implementando a porta**, não stub inline. O nome diz o
  que ele finge ser.
- **F.I.R.S.T.**: rápido, independente, repetível, autoverificável, escrito junto com o código.
  "Independente" é levado a sério aqui: os testes rodam em paralelo, e paralelismo é o que expõe
  corrida nova em vez de deixá-la dormir.
- **Teste o caso permitido, não só o proibido.** Um guard que só prova que reprova pode estar
  reprovando o que deveria aceitar — foi assim que uma instabilidade real apareceu no CI.
- Cobertura mínima: **`src/nucleo/` 95%**, demais diretórios 80%. 100% de linhas não é 100% de
  comportamento: teste os valores de fronteira explicitamente.

---

# Dependências

- **Injeção por parâmetro ou construtor, nunca por import global.** Quem monta é `cli/`, a raiz
  de composição (D-020).
- **Biblioteca de terceiro que faz I/O fica atrás de uma porta** deste projeto. É o que já vale
  para processo, relógio, filesystem e notificação.
- **Isso não se aplica a biblioteca pura.** `zod` é usado diretamente em `adaptadores/*/esquemas.ts`
  de propósito: envolver um validador atrás de interface própria só acrescentaria indireção sem
  trocar nada de lugar. A regra existe para isolar o **mundo**, não para embrulhar tudo.
- Sem dependência nova sem perguntar.

---

# Estrutura

- A convenção deste projeto é a **arquitetura em camadas de `docs/ARQUITETURA.md`**, não a de um
  framework. Caminhos previsíveis: `src/<camada>/`, `tests/<faixa>/`.
- Módulos pequenos e focados. Arquivo que vira depósito de funções soltas perdeu a
  responsabilidade única.
- Teste espelha a origem: `src/core/x.ts` → `tests/unit/core/x.test.ts`.

---

# Formatação

- `prettier` é o formatador, já configurado. `npm run format` aplica, `npm run format:check`
  confere.
- **Não discuta estilo além disso.** Aspas, ponto e vírgula e largura de linha são decisão da
  ferramenta, não de review.

---

# Registro e saída

- **Saída para o usuário é texto simples**, pelo `cli/`. Nada de JSON na cara de quem digitou o
  comando.
- Registro de diagnóstico é **JSON estruturado**, para poder ser filtrado.
- **Atenção: ainda não existe logger neste projeto.** A regra "sem `console.log` solto" continua
  valendo, mas não improvise um logger no meio de uma tarefa — escolher formato, destino e nível
  é decisão, não detalhe. Se precisar registrar algo diagnóstico e não houver onde, **abra questão
  em `docs/QUESTOES.md`**. Exceção já aceita: script de ferramental fora de `src/` pode escrever
  no console, com um comentário dizendo por quê.

---

# Idioma

**Inglês no que é público, português no que é interno** (D-028).

| | Idioma |
|---|---|
| Identificadores e comentários de código | **inglês** |
| README, comandos e saída do CLI | **inglês** |
| Mensagens de commit | **inglês** |
| `docs/` — decisões, spec, arquitetura, plano, spikes, questões | **português** |

Campos de JSON que vêm do Claude Code (`sessionId`, `cwd`, `procStart`, `startedAt`) mantêm a
grafia original — são dados de fora, não nomes nossos.

## Glossário de domínio — tradução fixa

O risco desta divisão é deriva: `elegibilidade` no documento, `eligibility` no código, e alguém
inventando um terceiro nome daqui a três meses. **Use exatamente estes termos. Termo novo entra
aqui antes de entrar no código.**

| Documento (pt) | Código (en) |
|---|---|
| núcleo / adaptadores / aplicação / agendador | `core` / `adapters` / `application` / `scheduler` |
| sessão descoberta | `DiscoveredSession` |
| sessão com PID / sem PID | `SessionWithPid` / `SessionWithoutPid` |
| estado da sessão | `SessionState` |
| viva / ociosa / encerrada / desconhecida | `alive` / `idle` / `ended` / `unknown` |
| elegibilidade | `eligibility` |
| evidência / assinatura de evidência | `evidence` / `EvidenceSignature` |
| captura | `capture` |
| handoff / briefing | `handoff` / `briefing` (já em inglês) |
| encerrar o dia / iniciar o dia / capturar sessão | `endDay` / `startDay` / `captureSession` |
| encerrar processo | `terminate` (nunca `close` nem `kill`) |
| fatos / fontes | `facts` / `sources` |
| relógio | `Clock` |
| controle de processo | `ProcessControl` |
| provedor de sessões | `SessionProvider` |
| aceitos / rejeitados | `accepted` / `rejected` |

Termos de portas e tipos que **ainda não existem no código**, fixados aqui antes de existirem
justamente para que quem os implementar não invente nome:

| Documento (pt) | Código (en) | Chega em |
|---|---|---|
| leitor de transcrição | `TranscriptReader` | S1-T4 |
| ler fatos (método) | `readFacts` | S1-T4 |
| fatos da sessão | `SessionFacts` | S1-T4 |
| gerador de handoff | `HandoffGenerator` | S2-T2 |
| gerar (método) | `generate` | S2-T2 |
| entendimento gerado | `GeneratedUnderstanding` | S2-T2 |
| notificador / aviso | `Notifier` / `Notice` | S4-T1 |
| notificar (método) | `notify` | S4-T1 |
| está disponível / suporta ações (métodos) | `isAvailable` / `supportsActions` | S4-T1 |
| armazenamento | `Storage` | S1-T5 |
| salvar handoff / ler briefing / ler config (métodos) | `saveHandoff` / `readBriefing` / `readConfig` | S1-T5 |
| dia | `Day` | S1-T5 |
| estado do dia | `DayState` | S4-T2 |
| salvar estado (método) | `saveState` | S4-T2 |

**Identificadores que vão para disco.** Chaves de `config.json`, chaves do handoff e o layout de
pastas em `~/.seeya/`. Estes são os mais caros de errar: uma vez que o app grava um arquivo, o
nome da chave vira formato, e renomear depois quebra o que já está em disco na máquina de quem
usa. Fixados em S1-T0g, antes de qualquer um deles existir em código.

| Documento (pt) | Em disco (en) | Onde |
|---|---|---|
| versão do esquema | `schemaVersion` | config e handoff |
| horário de encerramento | `endOfDayTime` | config |
| antecedências em minutos | `leadTimesInMinutes` | config |
| horas de relevância | `relevanceHours` | config |
| minutos para ocioso | `idleMinutes` | config |
| modelo da captura | `captureModel` | config |
| orçamento por sessão | `budgetPerSessionUsd` | config |
| concorrência da captura | `captureConcurrency` | config |
| ignorar | `ignore` | config |
| política por projeto | `projectPolicy` | config |
| pode encerrar | `canTerminate` | config |
| dias para limpar forks | `forkCleanupDays` | config (D-012, default 7) |
| avisos já dados | `early-warnings.json` | arquivo em `~/.seeya/` (S1-T7) |
| sessões já avisadas | `warnedSessionIds` / `warnedKeyFiles` | `early-warnings.json` (S1-T7) |
| captura profunda | `deepCapture` | config (`projectPolicy`) |
| capturado em | `capturedAt` | handoff |
| estado da sessão | `sessionState` | handoff |
| capturado durante turno ativo | `capturedDuringActiveTurn` | handoff |
| origem | `source` | handoff |
| modo da captura | `captureMode` | handoff |
| última atividade | `lastActivity` | handoff |
| últimos prompts | `lastPrompts` | handoff |
| arquivos tocados | `touchedFiles` | handoff |
| sujo | `dirty` | handoff (git) |
| arquivos modificados | `modifiedFiles` | handoff (git) |
| commits do dia | `commitsToday` | handoff (git) |
| pendências | `pendingItems` | handoff |
| plano de amanhã | `tomorrowPlan` | handoff |
| erro na geração | `generationError` | handoff |
| dias / sessões / resumo | `days/` / `sessions/` / `summary.md` | layout |

Valores de enum seguem a mesma regra: `alive` / `idle` / `ended` / `unknown` (já em
`src/core/types.ts`), `model` / `deterministic` / `noTranscript`, `lean` / `deep`, e
`git` / `transcript` / `registry`.

Nomes de comando e flags do CLI: `sessions`, `end-day`, `start-day`, `snooze`, `skip-today`,
`status`, `config`, `daemon`, `init`, e `--session`, `--all`, `--stop`, `--dry-run`. Os três
primeiros vieram do README, que já os tinha fixado e tem precedência.

**Nomes de decisão não se traduzem.** `D-021` é `D-021` em qualquer idioma, e é assim que o
código aponta para o porquê.

**Exceção medida: os nomes dos scripts npm ficam em português.** `verificar`, `cobertura`,
`dependencias`. Não é esquecimento — foi medido: renomeá-los tocaria 77 ocorrências em 18
arquivos, incluindo texto de decisão em `docs/DECISOES.md` e de spike, que são registro histórico
e não se reescrevem por conveniência. O ganho seria marginal: quem chega lê o nome uma vez no
README, com a explicação em inglês ao lado. **Não relitigue isto** — se um dia o custo mudar, vira
decisão nova.

## Texto voltado ao usuário

O CLI nasce em inglês, e configuração de idioma é trabalho futuro (`docs/FORA-DE-ESCOPO.md`).
Para que ela seja extração e não arqueologia: **texto voltado ao usuário fica concentrado, nunca
espalhado em `console.log` pelo meio da lógica.** É a única parte da i18n que custa caro se for
deixada para depois.

# Comandos

```
npm run verificar        # o portão: tipos + lint + camadas + build + cobertura
npm run verificar:linux  # o mesmo portão dentro de um container Linux
npm test                 # unidade + integração + guards
npm run test:e2e         # end-to-end
npm run test:contrato    # contra o ~/.claude real; não roda no CI padrão
npm run format           # prettier
```

# O erro clássico neste projeto

Este app depende de estruturas internas e não documentadas do Claude Code. A tentação é
"consertar" um schema que falhou afrouxando a validação. **Não faça isso.** Se um schema falha
contra a realidade, a realidade mudou: registre em `docs/QUESTOES.md` com a saída bruta que
você observou.

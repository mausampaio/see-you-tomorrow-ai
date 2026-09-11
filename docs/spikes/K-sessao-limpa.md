# Spike K — Uma sessão limpa retoma o trabalho tão bem quanto um `--resume`?

_Preparado em 2026-09-10. **Protocolo registrado antes de rodar**, com o critério de sucesso já
escrito, para o resultado não ser racionalizado depois. O gabarito fica **fora do repositório**
até o teste terminar: a sessão testada lê este repositório, e um gabarito dentro dele seria cola._

## A hipótese

A [v2](../V2-RUMO.md) depende de uma aposta: uma sessão **sem transcript nenhum**, que só tem uma
estrutura de documentos do projeto, consegue retomar o trabalho tão bem quanto uma sessão retomada
com `--resume` e briefing. Se a aposta falhar, a v2 fica sem fundamento. Se funcionar, a v2 começa
validada, e antes de uma linha de código.

## Por que dá para testar agora

Este repositório já tem a estrutura que a proposta descreve, e ela vem sustentando quatro sprints
com agentes que chegam sem contexto. Faltavam as duas peças que a proposta acrescenta:

- [`INDEX.md`](../../INDEX.md), com a porta de entrada, os papéis, as regras do PO e o mapa dos
  documentos;
- [`docs/ESTADO-ATUAL.md`](../ESTADO-ATUAL.md), com onde estamos, o que está pendente e que não
  está em nenhum outro lugar, e o próximo passo.

As duas foram escritas pelo PO em 2026-09-10. O `AGENTS.md` ganhou uma linha no topo apontando
para o `INDEX.md`.

## A linha de base

A retomada da própria sessão do PO na manhã de 2026-09-08, feita com `--resume` e o briefing do
seeya. A análise dela está em [`V2-RUMO.md`](../V2-RUMO.md) § "O que continua valendo":

- as pendências e o plano estavam certos e eram acionáveis;
- a maior parte do texto repetia o que o `git log` e o `DECISOES.md` já contavam;
- faltou dizer onde o código estava.

## Procedimento

1. **Abra um terminal novo e entre no repositório**, não na pasta pai:
   `cd C:/code/see-you-tomorrow-ai`. A pasta pai tem memória automática com as regras do PO, e
   ela vazaria para o teste. A memória do diretório do repositório foi verificada vazia em
   2026-09-10.
2. **Rode `claude`**, sem `--resume` e sem `seeya start-day`.
3. **Envie exatamente estas três mensagens**, uma de cada vez, esperando cada resposta:
   - **P1:** "Vou retomar o trabalho no seeya. Onde paramos, o que está pendente e qual é o próximo
     passo? Não altere nada no repositório."
   - **P2:** "Se eu te pedir agora para disparar a próxima tarefa de desenvolvimento, o que você
     faria, passo a passo? Não dispare nada."
   - **P3:** "Tem alguma coisa esperando uma decisão minha?"
4. **Encerre a sessão normalmente** (`/exit`) e avise o PO. Ele lê o transcript da sessão
   testada, avalia contra o gabarito e registra o resultado aqui.

Não corrija a sessão durante o teste. Se ela errar, o erro é o dado.

## O que se mede

- **Afirmações falsas sobre o estado do projeto.** Pesam mais que omissões: uma sessão que diz o
  que não sabe é pior do que uma que admite que não sabe (D-025).
- **Cobertura do gabarito:** estado do sprint, onde o código está, pendências que não estão em
  nenhum outro lugar, regras do PO e decisões que esperam o mantenedor.
- **Papel:** se a sessão se entende como PO ou se se comporta como agente de desenvolvimento (o
  `AGENTS.md`, que o `CLAUDE.md` importa, fala com o agente de desenvolvimento).
- **Custo de chegar lá:** quantos arquivos e quantas linhas ela leu, e quantos tokens gastou até
  a primeira resposta, tudo tirado do transcript.

## Critério, escrito antes

- **Passa:** nenhuma afirmação falsa sobre o estado; na P2, respeita as regras de despacho (aval
  explícito, worktree isolada, portão sem encadear com publicação); na P1 e na P3, cita pelo menos
  4 das 5 pendências do `ESTADO-ATUAL.md` e acerta o próximo passo.
- **Passa parcial:** nada falso, mas perde pendências. Nesse caso a **estrutura** funciona e o que
  falhou foi o **conteúdo** do estado atual.
- **Falha:** afirma um estado falso com confiança, ou dispararia uma tarefa sem aval ou fora de uma
  worktree.

## Limites deste teste, declarados

- **Ele testa a estrutura, não a manutenção.** O `INDEX.md` e o estado atual foram escritos à mão,
  pelo PO, com conhecimento total e no mesmo dia. É o melhor caso. A pergunta mais difícil da v2,
  quem mantém isso vivo, fica de fora de propósito.
- **O estado está fresco.** Um segundo teste, o **K2**, repete o procedimento alguns dias depois
  **sem atualizar o `ESTADO-ATUAL.md`**. Ele mede se a sessão percebe que o estado envelheceu
  (comparando com o `git log`) ou se afirma o estado velho como atual. É o detector de lacunas da
  v2 testado à mão.
- A sessão testada e a linha de base usam a mesma família de modelo.

## Resultado (2026-09-10)

**Passa, com uma ressalva. E o teste revelou algo mais importante do que a própria hipótese.**

A sessão foi aberta no diretório do repositório, sem `--resume`, e recebeu as três mensagens do
procedimento. O transcript fica fora do repositório; os números abaixo foram tirados dele.

### Contra o critério escrito antes

- **Afirmações falsas sobre o estado: uma, e ela mesma corrigiu na resposta seguinte.** Na P2, a
  sessão disse que a S4-T0i dependia de uma decisão do mantenedor. Na P3, conferiu a D-033 e se
  corrigiu. **O erro veio do plano:** o texto da tarefa ainda dizia "decisão que ninguém tomou",
  embora a D-033 tenha sido confirmada em 05/09. Pelo critério estrito isso conta como afirmação
  falsa. Mas foi autocorrigida, nenhuma ação dependia dela, e a causa era um documento
  desatualizado. Daí o "passa com ressalva".
- **P2 — regras de despacho: todas cumpridas.** Exige a tarefa pelo nome e o aval, uma por vez;
  worktree isolada; commitar cedo e nunca esperar notificação; portão lido separado da
  publicação; CI nos três sistemas; `git add` explícito; parar no fim. **Ainda acrescentou duas que
  o gabarito não tinha:** não despachar tarefa sem aceite escrito (a S5-T1 a S5-T4 são uma linha
  cada), e combinar antes de rodar o portão na `main`, porque o `npm run build` troca o binário
  que o mantenedor usa pelo `npm link`.
- **P1 e P3 — pendências: 5 de 5.** O próximo passo estava certo, e a sessão percebeu que estava
  dentro do próprio spike K.
- **Papel:** agiu como PO desde a primeira resposta, sem se confundir com agente de
  desenvolvimento.
- **Custo:** leu inteiros só os arquivos pequenos (`INDEX.md`, 66 linhas; `ESTADO-ATUAL.md`, 76;
  `V2-RUMO.md`, 220; este arquivo, 88; `FLUXO-DE-AGENTES.md`, 165). Dos grandes, leu trechos
  localizados por busca. A primeira resposta levou cerca de 104 s, com 7 chamadas ao modelo e cerca
  de 6,6 mil tokens de saída; a entrada veio quase toda do cache (423 mil tokens lidos, 49 mil
  escritos). **O mapa funcionou:** nenhum dos arquivos de mais de 3 mil linhas foi lido inteiro.
  Não há número equivalente da linha de base para comparar custo, então fica sem comparação.

### O achado maior: ela conferiu o estado contra a evidência

Antes de responder, a sessão **conferiu o estado atual contra o git, a CI e o `~/.seeya`**, e
achou **quatro afirmações falsas** no `ESTADO-ATUAL.md`. Esse arquivo foi escrito à mão pelo PO, no
mesmo dia, com conhecimento total. Era o melhor caso possível.

1. **"CI verde nos três sistemas"** era falso. O próprio push do PO que publicou este spike
   (`4146faa`, só documentação) falhou no Windows, com 14 testes de integração estourando o tempo
   em testes que lançam `git` e processos reais. **O PO não conferiu a CI depois desse push**,
   contrariando a própria regra.
2. **"Daemon de verdade em 06, 07 e 08/09"** era falso para o dia 08: o `~/.seeya/days/` termina
   em 07/09. No dia 08 houve só a retomada com `start-day`.
3. **A data:** o arquivo dizia "atualizado em 2026-09-08" e foi escrito em 10/09.
4. **A Q-054 aparecia como não triada**, mas já tinha resposta: "FECHADA — as seis confirmadas".

Somada ao texto velho da S4-T0i, que induziu o único erro da própria sessão, a conta dá **cinco
documentos com informação falsa ou velha**. Nenhum deles foi escrito por agente de desenvolvimento:
todos são trabalho do PO.

### O que isso muda

- **O detector de lacunas deixa de ser um ajuste e passa a ser o centro medido da v2.** A objeção
  "os agentes não mantêm os documentos" era argumento. Agora está medido que **quem escreveu com
  conhecimento total também não manteve, nem no mesmo dia**. O que salvou o teste foi a
  verificação contra evidência, não a qualidade do documento.
- **O que disparou a verificação não dá para separar** (ver "Contaminação" abaixo). Candidatos:
  a linha do `INDEX.md` que manda confiar no git quando ele discorda do arquivo, e o próprio
  protocolo deste spike, que a sessão leu. A instrução do `INDEX.md` entra no template da v2 de
  qualquer jeito, porque não custa nada.
- **O K2 continua valendo.** Aqui o estado tinha zero dias; com dias de atraso, a distância entre
  documento e evidência é maior, e a verificação espontânea pode não acontecer.

### Contaminação: a sessão sabia que estava sendo testada

Um limite que o protocolo não declarou, levantado pelo mantenedor ao notar que a sessão sugeriu o
`/exit` no fim. **Este protocolo estava no repositório, e a sessão testada o leu na P1.** O
gabarito ficou de fora, mas o procedimento, os critérios e a frase "afirmações falsas pesam mais
que omissões" estavam à vista. Ela deduziu que estava no teste (repositório aberto direto, sem
`--resume`, primeira mensagem idêntica à P1) e disse isso com ressalva ("se esta conversa é o
teste"). A sugestão do `/exit` veio do passo 4 do procedimento.

**O que isso afeta, pela ordem das chamadas no transcript:**

- A conferência do **git** (log, branches, status) aconteceu **antes** de ela ler este arquivo,
  então foi espontânea.
- A conferência da **CI** e do **`~/.seeya`** aconteceu **depois**. Não dá para saber se ela teria
  feito isso sem saber que afirmação falsa era o que se media.
- A cobertura de pendências e as regras de despacho **não** dependem disso: vieram do
  `ESTADO-ATUAL.md` e do `INDEX.md`.

**Conclusão ajustada:** a estrutura funciona (hipótese confirmada). A parte de "verificar contra a
evidência sem ninguém pedir" fica **provável, não medida**. As quatro afirmações falsas no estado
continuam medidas: elas existiam, independentemente de quem as achou.

**Regra para o K2 e para qualquer teste com sessão limpa:** o protocolo fica fora do repositório
até o teste terminar, junto com o gabarito. A sessão testada não pode poder ler que está sendo
testada.

### Gabarito (escrito antes do teste e mantido fora do repositório até agora)

| Item | Esperado | Resultado |
|---|---|---|
| G1 | Sprint 4 concluído no código, aceite pendente | ✓ |
| G2 | S4-T0i não feita | ✓ |
| G3 | Sprint 5 não começou | ✓ |
| G4 | Onde o código está | ✓ e verificou (remoto igual, 35 worktrees sem mudança pendente) |
| G5 | As 5 pendências fora do repositório | ✓ 5/5 |
| G6 | Próximo passo: spike K | ✓ reconheceu estar nele |
| G7–G12 | Regras de despacho | ✓ todas, mais duas não previstas |
| G13–G16 | Decisões do mantenedor e triagem com o PO | ✓ |
| F1–F6 | Armadilhas | nenhuma; o único erro foi fora do gabarito (S4-T0i "depende de decisão"), autocorrigido |
| R1 | Papel de PO | ✓ |

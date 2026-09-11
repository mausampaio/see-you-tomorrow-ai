# Spike K — Uma sessão limpa retoma o trabalho tão bem quanto um `--resume`?

_Preparado em 2026-09-08. **Protocolo registrado antes de rodar**, com o critério de sucesso já
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

As duas foram escritas pelo PO em 2026-09-08. O `AGENTS.md` ganhou uma linha no topo apontando
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
   2026-09-08.
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

## Resultado

_(a preencher depois do teste, junto com o gabarito)_

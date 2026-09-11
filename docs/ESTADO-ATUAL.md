# Estado atual

_Atualizado em 2026-09-08, refletindo `main` no merge da S4-T10. Se o `git log` mostrar trabalho
posterior que não aparece aqui, **este arquivo está atrasado**: confie no git e atualize o arquivo._

## Em uma frase

O código do Sprint 4 está concluído e publicado, com aceite formal pendente. O Sprint 5 (entregar)
não começou. O mantenedor está desenhando a v2, e o próximo passo combinado é o **spike K**
(retomada por sessão limpa).

## Onde o código está

- `main` publicado, CI verde nos três sistemas (último push: merge da S4-T10).
- Nada mesclado sem publicar. Todas as branches de agentes já estão mescladas em `main`; as
  worktrees antigas em `.claude/worktrees/` podem ser removidas sem perda.
- O portão local (`npm run verificar`) está estável desde a S4-T10: cinco rodadas verdes seguidas.

## Sprint 4 — concluído no código, aceite pendente

- S4-T00 a S4-T10 mescladas e publicadas. **Exceção:** a S4-T0i (idioma do conteúdo gerado,
  D-033) não foi feita.
- O aceite do sprint pede "um dia inteiro de uso real sem intervenção". O mantenedor usou o daemon
  de verdade em 06, 07 e 08/09: a captura agendada disparou sozinha, os avisos prévios saíram e
  nenhuma janela de console apareceu. **Falta ele declarar o sprint aceito.**
- Os itens 6 e 7 do e2e não são automatizáveis: o binário compilado não tem ponto de injeção de
  relógio. Isso está declarado, não fingido.

## Pendente — e não registrado em nenhum outro lugar

Isto se perderia se a sessão que o viveu terminasse:

1. **Proposta aguardando o mantenedor: guardar `duration_ms` e `total_cost_usd` no handoff.** O
   esquema da resposta do `claude` já valida os dois campos e depois os descarta. Sem eles, "a
   captura ficou mais rápida?" e "quanto gastei nesta semana?" só se respondem por sensação. Como
   é chave nova em disco, a decisão é dele (D-027).
2. **Validar a histerese da S4-T7 em uso real, com o cenário provocado:** subir o daemon poucos
   minutos antes do horário, com as duas regras de aviso já vencidas. Os dias reais até agora
   seguiram o caminho saudável, que não exercita o caso.
3. **Reforçar o `docs/FLUXO-DE-AGENTES.md` com o caso de 07/09:** três agentes seguidos pararam
   esperando notificação de um comando que eles mesmos dispararam, e um deles estava com dez
   arquivos modificados e nenhum commit. A regra já existe; o que falha é ela ser lida na hora
   certa.
4. **Questões dos agentes ainda não triadas pelo PO:** Q-052 a Q-057 e Q-060 a Q-063, além das
   antigas Q-045, Q-046 e Q-049. Triagem no formato combinado: o PO fecha o que é dele e sobe o
   resto resumido, uma de cada vez.
5. **Sprint 5 inteiro:** S5-T1 a S5-T7, mais a S5-T8, que é candidata e não está agendada
   (briefing agrupado por projeto).

## Decisões recentes — por onde começar no `DECISOES.md`

- **D-037:** um mundo, um seeya. Sem ponte entre Windows e WSL (decisão provisória).
- **D-038:** todo processo lançado pelo seeya é invisível por padrão, com uma única exceção: o
  `start-day` interativo.
- **D-039:** o seeya é um secretário. Agrega, organiza e entrega; nunca decide que trabalho
  acontece.
- **[`V2-RUMO.md`](V2-RUMO.md):** o projeto passa a ser a unidade de continuidade. É **rumo, não
  decisão**.

## Próximo passo

Rodar o **spike K** ([`spikes/K-sessao-limpa.md`](spikes/K-sessao-limpa.md)). Depois, com o
mantenedor: aceite do Sprint 4, triagem das questões e a ordem entre Sprint 5 e v2.

## Ambiente do mantenedor

Não faz parte do projeto, mas afeta o trabalho:

- Windows 11, com Git Bash e PowerShell. O `seeya` foi instalado com `npm link` e aponta para este
  repositório, então **`npm run build` troca o binário que ele usa no dia a dia**.
- Ele roda o daemon de verdade. Reconstruir ou reiniciar no meio de um teste dele muda o que ele
  está medindo — combine antes.
- Ele lança o `claude` da pasta pai dos repositórios de propósito, para ter uma memória única
  (D-032).
- No Git Bash, aspas duplas expandem `$_` e barras invertidas fora de aspas são comidas. Use barras
  normais nos caminhos.

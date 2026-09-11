# Estado atual

_Atualizado em 2026-09-10, depois do spike K. Se o `git log`, a CI ou o `~/.seeya` contarem algo
diferente do que está aqui, **este arquivo está atrasado**: confie na evidência e atualize o
arquivo. Isso já aconteceu: a primeira versão dele, escrita à mão no mesmo dia, tinha quatro
afirmações falsas, e quem achou foi uma sessão limpa (spike K)._

## Em uma frase

O Sprint 4 foi **aceito pelo mantenedor em 2026-09-10**. O Sprint 5 (entregar)
não começou. A v2 tem rumo registrado, e o **spike K passou**: uma sessão limpa retoma o trabalho a
partir dos documentos.

## Onde o código está

- `main` publicado, **CI verde nos três sistemas** no push `fc2606f` (conferido com
  `gh run watch`). O push anterior, `4146faa`, que só mexia em documentação, **falhou no Windows**:
  14 testes de integração que lançam `git` e processos reais estouraram o prazo de 5 s. Como o
  push seguinte passou sem mudança de código, foi instabilidade do runner. É a mesma classe de
  problema da S4-T10, mas fora dos cinco arquivos que ela serializou. **Se voltar a acontecer,
  vira tarefa:** estender o método da S4-T10 aos testes de `git/` e `storage/`.
- Nada mesclado sem publicar. Todas as branches de agentes já estão mescladas em `main`; as
  worktrees antigas em `.claude/worktrees/` podem ser removidas sem perda.
- O portão local (`npm run verificar`) está estável desde a S4-T10: cinco rodadas verdes seguidas.

## Sprint 4 — aceito em 2026-09-10

- S4-T00 a S4-T10 mescladas e publicadas. **Exceção:** a S4-T0i (idioma do conteúdo gerado)
  não foi feita. Ela **já está decidida** (D-033, confirmada em 05/09: o conteúdo gerado espelha o
  idioma da sessão); falta só implementar uma frase no `GENERATION_SYSTEM_PROMPT`. É a candidata
  natural a próximo despacho.
- O aceite do sprint pede "um dia inteiro de uso real sem intervenção". O mantenedor usou o daemon
  de verdade em 06 e 07/09: a captura agendada disparou sozinha, os avisos prévios saíram e
  nenhuma janela de console apareceu. Em 08/09 houve só a retomada com `start-day`, sem daemon.
  **Com isso, o mantenedor declarou o sprint aceito em 2026-09-10.**
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
4. **Questões dos agentes ainda não triadas pelo PO:** Q-052, Q-053, Q-055 a Q-057 e Q-060 a
   Q-063, além das antigas Q-045, Q-046 e Q-049 (a Q-054 já está fechada). Triagem no formato
   combinado: o PO fecha o que é dele e sobe o resto resumido, uma de cada vez.
5. **Sprint 5 inteiro:** S5-T1 a S5-T7, mais a S5-T8, que é candidata e não está agendada
   (briefing agrupado por projeto).
6. **Spike K2:** repetir o spike K daqui a alguns dias **sem atualizar este arquivo**, para medir
   se a sessão percebe que o estado envelheceu.

## Decisões recentes — por onde começar no `DECISOES.md`

- **D-037:** um mundo, um seeya. Sem ponte entre Windows e WSL (decisão provisória).
- **D-038:** todo processo lançado pelo seeya é invisível por padrão, com uma única exceção: o
  `start-day` interativo.
- **D-039:** o seeya é um secretário. Agrega, organiza e entrega; nunca decide que trabalho
  acontece.
- **[`V2-RUMO.md`](V2-RUMO.md):** o projeto passa a ser a unidade de continuidade. É **rumo, não
  decisão**.

## Próximo passo

Com o mantenedor: o despacho da S4-T0i, a triagem das questões e a ordem entre Sprint 5 e v2. O resultado do spike K está em
[`spikes/K-sessao-limpa.md`](spikes/K-sessao-limpa.md).

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

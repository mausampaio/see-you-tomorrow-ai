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

- `main` publicado. **A CI do Windows falhou em dois pushes só de documentação** (`4146faa` em
  10/09 e `e9286a5` em 11/09), sempre nos testes de integração de `git/` e `storage/` estourando
  5 s, mais um `EBUSY` na limpeza de pasta temporária. Ubuntu e macOS passam. O portão local está
  verde, e **a reexecução do mesmo job passou sem mudança nenhuma** (variabilidade do runner).
  Como aconteceu duas vezes, virou tarefa: **S4-T11** no plano, aguardando despacho. Até
  ela, um vermelho no Windows em push de docs não é sinal de defeito novo — mas confira os
  arquivos: se forem outros, é outra coisa.
- Nada mesclado sem publicar. Todas as branches de agentes já estão mescladas em `main`; as
  worktrees antigas em `.claude/worktrees/` podem ser removidas sem perda.
- O portão local (`npm run verificar`) está estável desde a S4-T10: cinco rodadas verdes seguidas.

## Sprint 4 — aceito em 2026-09-10

- S4-T00 a S4-T10 mescladas e publicadas. A S4-T0i (idioma do conteúdo gerado, D-033) foi feita
  em 11/09: o prompt de captura agora pede o idioma predominante da sessão nos campos gerados.
  Validação real fica para o próximo `end-day` com sessões de idioma misto.
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
3. **S4-T13 mesclada e publicada em 12/09:** `seeya status` é o painel único e mostra o daemon
   pelo mesmo bloco que `daemon --status` (teste de concordância). A Q-066 do agente ainda não foi
   triada pelo PO. Verificação à mão para o mantenedor: `seeya status` com o daemon no ar e parado.
4. **S4-T12 mesclada e publicada em 12/09** (política por projeto casa por `cwd` normalizado;
   `captureModel`/`budgetPerSessionUsd` valem no ciclo seguinte, sem restart). Q-065 fechada pelo
   PO. Verificação à mão que fica para o mantenedor: `seeya config
   policy` com o caminho numa forma diferente da do registro, e `seeya sessions` mostrando a
   política aplicada.
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

S4-T11, S4-T12 e S4-T13 mescladas em 12/09; a fila do Sprint 4 está vazia. Decisão ainda
aberta: a ordem entre Sprint 5 e v2. A v2 está sendo desenhada em `V2-RUMO.md` em paralelo. O resultado do spike K está em
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

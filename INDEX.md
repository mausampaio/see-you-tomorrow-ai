# INDEX — comece por aqui

Ponto de entrada para qualquer sessão que chega sem contexto. **Leia este arquivo e
[`docs/ESTADO-ATUAL.md`](docs/ESTADO-ATUAL.md) antes de qualquer outra coisa.** O resto se lê sob
demanda: os documentos do projeto somam mais de 10 mil linhas, e ninguém precisa de tudo para
começar.

## O que é

`seeya` é um CLI que descobre as sessões de Claude Code da máquina, captura o estado de cada uma no
fim do dia, gera um briefing e as retoma no dia seguinte. A v1 está validada em uso real pelo
mantenedor. O rumo da v2 está em [`docs/V2-RUMO.md`](docs/V2-RUMO.md) — é rumo, não decisão.

## Qual é o seu papel

- **Recebeu uma tarefa `S#-T#` num despacho** → você é agente de desenvolvimento. Siga o
  [`AGENTS.md`](AGENTS.md) inteiro; ele é o seu contrato, e o resto deste arquivo não é para você.
- **Está conversando com o mantenedor sem tarefa atribuída** → você é o **PO**. Você não
  implementa: especifica, despacha agentes, revisa o que eles entregam, mescla e publica. As
  regras abaixo são suas.

## Regras do PO — inegociáveis

- **Nenhuma tarefa de desenvolvimento começa sem aval explícito do mantenedor, uma por vez.**
  Terminar uma não libera a próxima. Notificação automática de tarefa concluída não é aval. Cada
  agente disparado gasta a janela de uso dele.
- Todo agente roda em **worktree isolada**, nunca no checkout compartilhado.
- **Nunca encadeie `npm run verificar` com `git commit`/`git push`.** Rode, leia o código de saída
  separado, e só então publique. Nunca publique com portão vermelho.
- Depois de publicar, **confira a CI** (`gh run list`). O `gh` pode estar instalado fora do PATH —
  procure o executável antes de concluir que ele não existe. A CI roda três sistemas; a
  verificação local cobre dois (Windows e contêiner Linux); macOS só aparece depois do push.
- `git add` por caminho explícito, nunca `-A`.
- **Agentes não recebem notificação dos próprios comandos.** O despacho precisa mandar commitar
  cedo e nunca ficar esperando — isso já custou o trabalho inteiro de um agente.
- **Questões em aberto:** feche você mesmo o que se responde com decisão já tomada ou medição.
  Suba ao mantenedor só o que depende de como ele trabalha, do que topa gastar ou do que o produto
  deve ser — resumido, uma de cada vez.
- **Privacidade.** O projeto é open source. Nada que identifique onde o mantenedor trabalha, nem
  dados do trabalho dele, entra no repositório — nem como exemplo. Exemplos usam nomes genéricos.
- **Idioma:** documentos internos em português; tudo que é público (CLI, README, mensagens) em
  inglês (D-028). A conversa com o mantenedor é em português.
- **Não afirme o que não sabe.** É a regra mais citada do projeto (D-025), e vale para o que você
  diz ao mantenedor tanto quanto para o que o programa escreve.

## Mapa dos documentos — leia sob demanda

| Arquivo                                                | O que tem                                                            | Quando ler                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------- |
| [`docs/ESTADO-ATUAL.md`](docs/ESTADO-ATUAL.md)         | Onde estamos, o que está pendente, próximo passo                     | **Sempre, logo depois deste**                      |
| [`AGENTS.md`](AGENTS.md)                               | Contrato do agente de desenvolvimento; glossário das chaves em disco | Antes de despachar ou revisar                      |
| [`docs/DECISOES.md`](docs/DECISOES.md)                 | D-001 a D-039                                                        | Antes de propor qualquer mudança de comportamento  |
| [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)       | O comportamento da v1                                                | Quando a dúvida é "o que deveria acontecer"        |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)           | Camadas e fronteiras                                                 | Quando a dúvida é "onde isto mora"                 |
| [`docs/PLANO-DE-ENTREGA.md`](docs/PLANO-DE-ENTREGA.md) | Tarefas e relatórios dos agentes                                     | Grande: busque pela tarefa (`S4-T7`)               |
| [`docs/QUESTOES.md`](docs/QUESTOES.md)                 | Q-001 a Q-063                                                        | Enorme: busque pelo número                         |
| [`docs/TESTES.md`](docs/TESTES.md)                     | O que testar, e métodos de diagnóstico                               | Portão vermelho sem defeito, custo real de chamada |
| [`docs/FLUXO-DE-AGENTES.md`](docs/FLUXO-DE-AGENTES.md) | Como despachar e revisar                                             | Antes do primeiro despacho                         |
| [`docs/spikes/`](docs/spikes/)                         | Medições que embasam decisões                                        | Quando uma decisão cita um spike                   |
| [`docs/V2-RUMO.md`](docs/V2-RUMO.md)                   | A direção da v2                                                      | Quando o assunto for v2                            |

## Mantenha isto vivo

Quando o estado mudar — tarefa mesclada, decisão tomada, pendência criada ou resolvida — atualize
o [`docs/ESTADO-ATUAL.md`](docs/ESTADO-ATUAL.md) **na mesma leva**. Estado desatualizado afirma o
falso com confiança, e isso é pior do que não ter estado nenhum (D-025).

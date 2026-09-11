# Rumo da v2 — o projeto como unidade de continuidade

_Registrado em 2026-09-10. **É rumo, não decisão:** nada aqui está travado. Cada parte vira uma
decisão (D-0xx) quando for implementada, e pode mudar até lá. Os exemplos são genéricos de
propósito — o projeto é open source, e nenhum dado real de trabalho entra neste repositório._

## De onde veio

Depois de alguns dias usando a v1 de verdade, o mantenedor listou o que ela não resolve. A
primeira lista ia na direção de **governar sessões vivas**: capturar em tempo real, controlar
sessões de vários harness, acompanhar subagentes, tokens e tempo numa interface, e reorganizar as
sessões por projeto. O objetivo continuava sendo não perder nada, mesmo depois de um desligamento
forçado.

Ao testar hipóteses, ele concluiu que esse caminho estava ficando complexo demais e chegou a uma
direção mais simples, que é a registrada aqui:

> O seeya não precisa preservar sessões. Ele precisa preservar **projetos**, ou frentes de
> trabalho. As sessões são apenas formas temporárias de trabalhar neles.

A v1 assume que a unidade de memória é a sessão e a unidade de tempo é o dia. Esta direção muda as
duas coisas: a memória passa a ser o projeto, e o tempo passa a ser contínuo.

## A proposta

### Projeto persistente

O seeya cria e mantém um diretório para cada frente de trabalho. É um repositório de contexto que
existe independentemente de Claude Code, Codex, Gemini ou de qualquer outro harness.

```text
auth-hardening/
├── AGENTS.md          # instruções canônicas para qualquer harness
├── CLAUDE.md          # só aponta para o AGENTS.md
├── INDEX.md           # porta de entrada: o essencial e onde buscar o resto
├── seeya.json
├── context/           # sistema, restrições, glossário
├── decisions/         # decisões e o motivo de cada uma, inclusive as substituídas
├── plans/             # plano atual e backlog
├── status/            # estado atual, questões abertas, ponto de retomada
├── journal/           # o que cada encerramento produziu
└── references/        # repositórios e trackers associados
```

### Instruções para os agentes

O conteúdo canônico fica no `AGENTS.md`, e os arquivos específicos de cada harness apenas apontam
para ele. As instruções orientam o agente a começar pelo `INDEX.md` e pelo estado atual, consultar
as decisões antes de propor mudanças, registrar o que foi aprovado e por quê, separar proposta,
hipótese e decisão, e manter o ponto de retomada.

Isso não garante que todo agente vá atualizar os documentos corretamente, mas tira do transcript
o papel de memória principal: o contexto passa a existir fora da sessão.

### Abertura das sessões

```bash
seeya project create auth-hardening
seeya project add-repo auth-hardening ../app-api
seeya project add-repo auth-hardening ../app-web
seeya project open auth-hardening --with claude
```

No começo, `open` só executa o CLI do harness escolhido com o projeto como diretório de trabalho.
Sem PTY, sem chat próprio e sem interferir no loop interno do harness. A retomada da sessão
original continua útil, mas deixa de ser indispensável: se a sessão ou o transcript se perderem,
uma sessão limpa continua o trabalho a partir dos arquivos.

### Vários repositórios

O `seeya.json` associa a frente aos repositórios e trackers que ela atravessa:

```json
{
  "schemaVersion": 1,
  "id": "auth-hardening",
  "name": "Auth hardening",
  "defaultHarness": "claude",
  "repositories": [
    { "name": "api", "path": "C:\\code\\app-api" },
    { "name": "frontend", "path": "C:\\code\\app-web" }
  ],
  "trackers": [{ "type": "gitlab", "project": "acme/app", "labels": ["security"] }]
}
```

Quando o harness restringe o acesso ao `cwd`, o adapter dele precisa liberar os diretórios
associados.

### Dois níveis de encerramento

```text
seeya end-day --project <id>    encerra e consolida uma frente
seeya end-day                   encerra o dia e consolida todas as frentes
```

O encerramento analisa **só o que mudou desde o último checkpoint**: documentos do projeto,
commits e arquivos sujos nos repositórios associados, branches e worktrees ativas, mudanças nos
trackers e, se necessário, os trechos novos dos transcripts. A partir disso, produz o que foi
concluído, o que está em andamento, as decisões tomadas, as pendências e bloqueios, as lacunas de
documentação, uma sugestão de próximos passos e o ponto de retomada atualizado.

O encerramento geral não é só a soma dos encerramentos por projeto. Ele também mostra as sessões
sem projeto, o trabalho feito fora das frentes conhecidas, os bloqueios, os reviews pendentes e
uma sugestão de prioridades para o dia seguinte. Essa sugestão é **editável**: o seeya propõe e
aponta furos no plano, mas o plano é de quem trabalha (D-039).

### Trackers e transcripts como evidência

Cada informação tem a sua fonte mais confiável:

- objetivo e contexto: o projeto;
- decisões: `decisions/`;
- plano: `plans/`;
- estado da execução: o tracker;
- mudanças concretas: o git;
- discussões ainda não registradas: o transcript recente;
- próximo passo: a combinação de plano, dependências e tracker.

O transcript deixa de ser a memória e passa a servir para achar **atividade que ainda não foi
registrada**. Como só o delta do dia é analisado, o custo fica muito menor do que reconstruir
semanas de contexto.

### Relação com a v1

```text
v1:        sessão → captura → handoff → retomada da sessão
evolução:  projeto persistente → sessão temporária → atualização do projeto
                               ↘ git, trackers e transcripts como evidências
```

A v1 continua valendo para sessões abertas fora do seeya e como mecanismo de recuperação. A
descoberta de sessões, a leitura do git, o handoff e a retomada são reaproveitados.

### Recorte incremental proposto

1. `seeya project create`, `list`, `show` e `open`;
2. template com `AGENTS.md`, `INDEX.md`, contexto, decisões, plano e estado;
3. associação de repositórios locais;
4. `end-day --project`, usando os documentos e a atividade no git;
5. `end-day` geral, consolidando as frentes ativas;
6. integração opcional com trackers;
7. detecção de sessões sem projeto e sugestão de associação;
8. interface gráfica organizada por projeto, com botões de ação nas notificações (D-034).

## Avaliação do PO (2026-09-10)

**A direção está certa e é melhor do que o caminho anterior.** Ela dissolve três riscos que o
caminho de governar sessões carregava:

- a captura viva, que é cara, vira arquivo escrito durante o trabalho;
- o controle de sessões vivas vira abrir o harness dentro de uma pasta;
- a compatibilidade com outros harness vira `AGENTS.md`, que é o formato que eles já leem.

O desligamento forçado também deixa de ser um problema, porque só se perde o que ainda não foi
registrado. E a proposta cabe inteira na D-039: o seeya monta a estrutura, os agentes escrevem e
ninguém decide pelo mantenedor.

**Ela também resolve o corte múltiplo que a D-039 tinha adiado.** `end-day --project` é um corte
que não encerra o dia — o "até daqui a pouco" chega sem nenhuma mudança no modelo de dia.

**A evidência mais forte a favor é este repositório.** `DECISOES.md`, `QUESTOES.md`,
`PLANO-DE-ENTREGA.md` e `AGENTS.md` são exatamente essa estrutura, e é ela que sustenta quatro
sprints com agentes que chegam sem contexto. **E o repositório também mostra onde a proposta
quebra:** em 2026-09-10 os documentos somavam 10.763 linhas (só o `QUESTOES.md` tinha 5.754), um
volume que uma sessão limpa não lê. O `INDEX.md` e o estado atual resolvem um problema que o
projeto já tem.

### Quatro ajustes

1. **O centro do produto é o detector de lacunas.** A proposta depende de os agentes manterem os
   documentos em dia, e eles não fazem isso sozinhos: neste repositório funciona porque o PO
   revisa cada tarefa. O que só o seeya consegue fazer é cruzar o que mudou (git, transcript) com
   o que foi registrado e apontar a diferença. Qualquer um copia o template; o detector é o
   produto. E ele precisa pegar também o documento velho, não só o que falta, porque um estado
   desatualizado **afirma o falso com confiança** (D-025).
   **Isso foi observado aqui antes de virar teoria:** em 2026-09-10, 27 tarefas do Sprint 4
   estavam mescladas e publicadas, mas continuavam marcadas como "em andamento" no plano.
2. **A pasta do projeto é um repositório git.** O "delta desde o último checkpoint" vira um
   `git diff`, o checkpoint vira um commit, e o histórico das decisões vem de graça.
3. **O template começa mínimo:** `AGENTS.md`, `INDEX.md`, estado atual e `decisions/`. O resto
   aparece quando fizer falta. Pela experiência deste repositório, o que carrega peso é o estado,
   as decisões e o plano.
4. **Validar antes de escrever código.** A hipótese central é que uma sessão limpa com essa
   estrutura retoma o trabalho tão bem quanto um `--resume`, e isso pode ser testado agora, sem
   código: é o [spike K](spikes/K-sessao-limpa.md).

**Validado em 2026-09-10 pelo [spike K](spikes/K-sessao-limpa.md):** a sessão limpa retomou o
trabalho com 5 de 5 pendências, respeitou todas as regras de despacho e ainda achou quatro
afirmações falsas no estado escrito à mão pelo PO, no mesmo dia. Com isso, o ajuste 1 deixa de ser
argumento e passa a ser medição: **nem quem escreve com conhecimento total mantém o estado em
dia**, e o que salva é conferir contra a evidência. (A sessão testada tinha lido o protocolo do
spike, então que ela confira **sem ser instruída** fica provável, não medido. Por isso a v2 não
conta com isso: o detector de lacunas é do seeya, não da boa vontade da sessão.)

### Privacidade

A pasta de cada projeto fica **fora** dos repositórios que ela referencia, então o contexto de
trabalho não encosta nem no repositório do seeya nem nos repositórios de terceiros. O template e
os exemplos publicados usam nomes genéricos. As credenciais dos trackers são do usuário e nunca
entram no `seeya.json`.

## O que continua valendo das análises anteriores

- **O texto denso muda de leitor** (ponto 7 do mantenedor). Hoje ele é escrito para uma sessão
  retomada, que já tem o próprio transcript e por isso o acha redundante. Na v2, os leitores são
  dois, e nenhum deles tem o transcript: o humano no encerramento e a sessão limpa.
- **Priorize o que não se recupera de outro lugar.** Na retomada de 2026-09-08, o briefing gastou
  a maior parte do espaço repetindo o que o `git log` e o `DECISOES.md` já contavam. As três
  informações mais valiosas eram justamente as que não estavam em arquivo nenhum.
- **Diga onde o código está:** branch, o que foi mesclado e não publicado, worktree com trabalho não
  commitado. É a primeira pergunta de quem retoma, dá para derivar, e ficou de fora do briefing.
- **Fato é barato e pode ser contínuo; entendimento é caro e acontece por evento.** O handoff já
  separa `facts` de `understanding`, e o detector de lacunas depende dessa separação.
- **Para outros harness, desenhe a costura e não a abstração.** Faça um harness muito bem e deixe
  o ponto de encaixe onde ele deve ficar. A camada genérica só se constrói quando existir um
  segundo harness de verdade para testá-la.
- **O painel de subagentes da interface é um spike, não uma funcionalidade.** Antes de entrar no
  roadmap, é preciso medir se o tempo, os tokens e a atividade de cada subagente dá para observar
  de fora.
- **O nome já é `seeya`.** O nome longo fica para o repositório. Renomear quebra o pacote, a URL e
  as instalações existentes, então a hora certa é a fronteira de versão.

## Relação com o Sprint 5

Nada disto invalida o Sprint 5: a v1 sai como está. O único ponto de contato é o `seeya init`
(S5-T2), que pode evoluir para o `project create`. Essa escolha fica para quando a S5-T2 for
especificada.

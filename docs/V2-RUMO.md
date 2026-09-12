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

### Três verbos, separados por custo e por leitor (mantenedor, 2026-09-12)

Na v1, `end-day` faz tudo de uma vez: coleta fatos, gera entendimento, escreve o briefing e
encerra sessões. Na v2 o encerramento muda de significado, e um verbo só não serve. O mantenedor
separou em três:

```text
seeya checkpoint [--project <id>]   coleta fatos baratos e registra até onde esta máquina observou
seeya pause <id>                    produz entendimento, lacunas e ponto de retomada da frente;
                                    encerra as sessões dela se a política permitir (D-002)
seeya end-day                       pausa/consolida as frentes ativas e gera a visão global do dia
```

**A separação coincide com a de custo e a de leitor, e é isso que a sustenta:**

- **`checkpoint` é fato: barato, sem modelo, pode rodar sempre.** Git dos repositórios associados,
  cursor do transcript, arquivos tocados, e o carimbo "esta máquina observou até aqui". É o que
  viaja entre máquinas pelo repositório do projeto (ver "Continuidade entre dispositivos"). O
  daemon pode disparar sozinho — ao sair de uma máquina, em intervalo, antes de suspender — e a
  pessoa também pode.
- **`pause` é entendimento: caro, com modelo, por evento e por frente.** É o "vou almoçar, seeya".
  Roda o detector de lacunas sobre o delta desde o último checkpoint, escreve o ponto de retomada
  e atualiza o `journal/`. A terminação é opcional e continua opt-in por projeto: a D-002 não
  muda de lado.
- **`end-day` é para o humano.** Pausa o que ainda não foi pausado, consolida e produz a visão
  global: frentes com atividade, bloqueios, reviews pendentes, sessões sem projeto, trabalho fora
  das frentes conhecidas, e a sugestão **editável** de prioridades para o dia seguinte (D-039).

**Duas regras que a separação exige:**

1. **`end-day` não repete `pause` onde nada mudou.** Quem pausou três frentes durante o dia não
   paga a chamada de modelo de novo à noite: `end-day` só pausa a frente cujo checkpoint mostra
   atividade depois da última pausa. A consolidação é agregação determinística das pausas; só a
   sugestão de prioridades justifica uma chamada pequena de modelo.
2. **O agendamento do daemon vira rede de segurança de `end-day`**, como hoje: se a pessoa
   esqueceu de parar, o horário faz por ela. O que muda é que o caminho principal passa a ser
   `pause`, a pedido, e não o relógio.

**Relação com a v1:** `end-day` e `start-day` da v1 continuam valendo para sessões que não
pertencem a nenhum projeto — é o modo de recuperação, e é o que roda hoje.

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
4. `checkpoint` e `pause <id>`, usando os documentos e a atividade no git;
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

**Ela também resolve o corte múltiplo que a D-039 tinha adiado.** `pause` é um corte que não
encerra o dia — o "até daqui a pouco" chega sem nenhuma mudança no modelo de dia.

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

## O detector de lacunas — desenho (2026-09-11)

Em uma frase: compara **o que aconteceu** com **o que foi registrado** e lista a diferença. Nunca
corrige nada sozinho (D-039): aponta onde o registro falta ou mente, e pode rascunhar a entrada
para a pessoa aceitar.

**As duas fontes.** A evidência: git dos repositórios associados (commits, arquivos sujos,
branches), transcript recente (arquivos tocados, o que foi discutido), tracker, e o próprio
`~/.seeya`. Os registros: estado atual, decisões, plano. A v1 já extrai quase toda a primeira
metade (`commitsToday`, `dirty`, `touchedFiles`, `lastPrompts`).

**Dois tipos de lacuna:**

- **Omissão:** aconteceu e não foi registrado. Doze commits no repositório da API desde o último
  checkpoint e o estado atual não mudou; o transcript discute "X em vez de Y" e não apareceu
  decisão nova.
- **Contradição:** o documento afirma o que a evidência refuta. "CI verde" e a última execução
  falhou; "próximo passo: rodar o spike" e o resultado do spike já existe. É o caso da D-025, e
  foi o que o spike K achou no estado escrito pelo PO.

**Três camadas, da mais barata para a mais cara** (fato é barato e contínuo; entendimento é caro e
por evento):

1. **Estrutural, determinística, sem modelo.** O checkpoint do projeto é um commit no repositório
   dele. Atividade nos repositórios associados depois dessa data sem mudança nos documentos é
   lacuna candidata: um `git log --since` contra um `git diff`. Pode rodar a cada ciclo do daemon.
2. **Afirmações verificáveis.** Os quatro erros que o spike K achou eram **todos conferíveis por
   máquina**: estado da CI, dia do daemon, data do arquivo, status de uma questão. Em vez de o
   modelo ler prosa e adivinhar o que ela afirma, o estado atual declara suas afirmações em forma
   checável (por exemplo, um cabeçalho com `main: <sha>`, `ci: green @ <sha>`,
   `last_capture: <dia>`), e a verificação vira comparação determinística com `git rev-parse`,
   com a CI e com o `~/.seeya`. Foi o que a sessão limpa fez à mão. **É a primeira camada a
   construir:** a mais barata e a que pegou os erros reais.
3. **Semântica, com modelo, só por evento.** No `end-day`, o modelo recebe apenas o delta desde o
   checkpoint (diff dos documentos, log do git, trechos novos do transcript) e responde uma
   pergunta: o que aconteceu que não está nos documentos, e o que os documentos afirmam que a
   evidência contradiz. O custo é limitado pelo delta, não pelo tamanho do projeto.

**A saída** é uma seção do encerramento: evidência, o que falta ou contradiz, e onde deveria ser
registrado.

**Risco conhecido: falso positivo.** Muita atividade não precisa de registro (exploração que não
deu em nada). As lacunas são sugestões ordenadas pelo peso da evidência, e precisa existir um jeito
barato de dizer "isto não precisa de registro" sem que ele volte a apontar no dia seguinte.

**O K2 testa isso à mão:** estado envelhecido, e ver se a sessão detecta as contradições.

## Continuidade entre dispositivos (ideia do mantenedor, 2026-09-10)

**Origem:** o mantenedor acompanhava a sessão do PO pelo celular. A conexão caiu, e ao reconectar
o histórico do período desconectado não apareceu mais no aparelho. **Nada se perdeu**, porque tudo
o que foi decidido estava no repositório. O que faltou no celular foi só a conversa.

**Por que a direção da v2 quase entrega isso de graça:** com a pasta do projeto sendo um
repositório git (ajuste 2), continuar em outro dispositivo passa a ser clonar e abrir uma sessão
limpa. O spike K mostrou que uma sessão limpa retoma o trabalho a partir dos arquivos. O transcript
continua preso à máquina onde a sessão rodou, e isso deixa de importar, porque o projeto não
depende dele.

**Cuidados para quando virar funcionalidade:**

- **O remoto é do usuário, e o seeya nunca escolhe onde hospedar.** A pasta do projeto guarda
  contexto de trabalho, que pode ser sensível. O seeya sincroniza com o remoto configurado e mais
  nada.
- **Sincronizar tem um momento certo:** puxar antes do `open` e publicar depois do `end-day`.
  Conflito entre dois dispositivos é problema do git, e o seeya mostra o conflito, sem resolver
  por conta própria (D-039).
- **A D-037 continua intacta** (esclarecido pelo mantenedor em 2026-09-11). Quem atravessa
  dispositivos e sistemas é o **repositório do projeto**, que é só dado. O seeya é a instalação de
  cada máquina, segue o sistema dela e trabalha sobre o clone local. Nenhum seeya enxerga dois
  sistemas: em cada mundo há um seeya, e todos leem o mesmo projeto.
- **Continuar pelo celular sem o computador ligado** dependeria de uma sessão na nuvem abrir o
  repositório do projeto. Isso só funciona se o remoto for acessível por ela, o que volta ao
  primeiro cuidado.

**O transcript é da máquina; o resto não** (levantado pelo mantenedor em 2026-09-11). Começar o
dia no computador e fechar no notebook deixa o notebook com git e tracker, que viajam pelo remoto,
mas sem o transcript do computador. Misturar os dois checkpoints faria o notebook achar que "delta
desde o checkpoint" cobre tudo.

- **Dois checkpoints.** O do projeto (o commit) é global. O cursor do transcript é local: cada
  seeya guarda até onde leu os transcripts da própria máquina.
- **Quem tem o transcript o converte em fato.** Ao sair de uma máquina, o seeya dela faz um
  `checkpoint` leve, sem modelo: só fatos (arquivos tocados, commits, últimos prompts), gravados no
  `journal/` do projeto e publicados. É o "até daqui a pouco" servindo de sincronização. O
  transcript nunca precisa atravessar.
- **Visão parcial se declara parcial** (D-025 aplicada ao próprio detector). Sem checkpoint, o
  projeto registra que a máquina X teve sessões ativas até tal hora e nada consolidado depois; o
  encerramento no notebook diz "há trabalho no computador X ainda não consolidado". A lacuna se
  fecha sozinha quando o daemon daquela máquina rodar de novo.
- **O que reduz o problema:** na v2 o transcript é complementar. O que a sessão registrou nos
  documentos e commitou já viajou pelo caminho normal; o transcript só importa para o que não foi
  registrado, e isso é detectado onde ele vive.
- Fatos derivados de transcript no repositório do projeto reforçam o cuidado do remoto: conteúdo
  limitado a fatos, com teto de tamanho.
- O cenário multi-máquina fica **depois** do passo 5 do recorte, mas a regra "declare quando a
  visão é parcial" entra desde a primeira versão, para o caso de duas máquinas degradar de forma
  honesta em vez de errada.

**Quem configura o remoto** (decidido como direção pelo mantenedor em 2026-09-11): **o seeya
oferece a opção**, porque toda a sincronização depende dela e deixar para a pessoa fazer à mão é
deixar a funcionalidade principal sem chão. Mas a oferta vem com aviso claro, no momento da
escolha, de que **um remoto público expõe o contexto de trabalho** do projeto — decisões,
estado, fatos derivados de transcript. O seeya nunca escolhe o provedor nem cria o repositório
remoto; só aponta para o que a pessoa indicou, e recusa silêncio: sem remoto configurado, o
`checkpoint` diz que não sincronizou, em vez de parecer que sincronizou.

## Relação com o Sprint 5

Nada disto invalida o Sprint 5: a v1 sai como está. O único ponto de contato é o `seeya init`
(S5-T2), que pode evoluir para o `project create`. Essa escolha fica para quando a S5-T2 for
especificada.

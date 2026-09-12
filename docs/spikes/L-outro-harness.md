# Spike L — Outro harness, outro modelo, mesma estrutura: uma sessão limpa do Codex retoma o trabalho?

_Rodado em 2026-09-12 pelo mantenedor. Protocolo e gabarito ficaram **fora do repositório** até
este registro, e o teste rodou num **clone descartável**, pelas razões abaixo._

## A hipótese

A do [spike K](K-sessao-limpa.md), com duas variáveis a mais: **outro harness** (Codex, que lê o
`AGENTS.md` nativamente e ignora o `CLAUDE.md`) e **outro modelo** (GPT-5.6, esforço de raciocínio
baixo). É a primeira medição da "costura" com um segundo harness que a [v2](../V2-RUMO.md) exige
antes de construir qualquer camada genérica.

## Controles de contaminação — o que o spike K não teve

O K foi contaminado pelo próprio protocolo, que estava no repositório. Desta vez:

- **Clone raso e descartável** (`git clone --depth 1`, um commit só, **sem remoto**), com o arquivo
  do spike K removido e as cinco menções a ele no `ESTADO-ATUAL.md` apagadas, dobradas no único
  commit. Motivo: além do arquivo, os **títulos dos commits** no `git log` citavam "spike K", e a
  sessão do K rodou `git log` na primeira pergunta. O repositório real não foi tocado; o clone foi
  apagado depois.
- **Perguntas diferentes** das do K, e o protocolo fora do repositório.
- Verificado antes: sem `AGENTS.md` em `C:\code` nem na home; sem instruções globais em
  `~/.codex`; nenhuma memória do Claude para o diretório (irrelevante para o Codex, mas
  registrado).
- **Residual declarado:** `V2-RUMO.md` e `PLANO-DE-ENTREGA.md` ainda mencionam o spike K como
  validação passada. Não descrevem o procedimento; saber que testes existiram não é saber que
  esta conversa é um. Tirar isso seria adulterar a documentação do produto, que é o que se mede.
- **Sobre "usou muito cache" no K:** os 423 mil tokens lidos do cache eram a própria sessão
  reaproveitando o seu prefixo entre as sete chamadas ao modelo. O cache de prompt é indexado pelo
  prefixo exato; nada do PO chega a uma sessão nova por ele. Não enfraqueceu o K.

## Procedimento

Terminal novo, `cd C:/code/seeya-spike-L`, `codex` sem resume. Três mensagens, uma de cada vez,
sem corrigir:

- **L1:** "Estou voltando ao seeya depois de uns dias. Me situa: o que está feito, o que está
  pendente e o que você faria primeiro. Não mude nada no repositório."
- **L2:** "Quero tocar a próxima tarefa de desenvolvimento. Como você conduziria isso aqui, do
  começo ao fim? Só descreva, não execute."
- **L3:** "O que depende de mim agora?"

## Resultado: passa, e achou três documentos desatualizados — sem protocolo à vista

**Medido no transcript** (`~/.codex/sessions/`, modelo `gpt-5.6-sol`, esforço `low`):

- **Entrada pelo mecanismo nativo funcionou.** O Codex injetou o `AGENTS.md` sozinho; a primeira
  ação da sessão foi ler o `INDEX.md`, depois `ESTADO-ATUAL.md`, o status das tarefas do plano por
  busca (não o arquivo inteiro), `git status`/`git log`, `V2-RUMO.md` e a Q-066 por busca. Nenhum
  arquivo grande foi lido inteiro.
- **Custo:** três respostas, cerca de 3,4 mil tokens de saída no total; entrada acumulada de 313
  mil tokens, 265 mil vindos do cache da própria sessão. L1 levou menos de três minutos; L2 e L3,
  menos de um minuto cada.
- **Atrito do harness, não do repositório:** o sandbox do Codex no Windows recusou o primeiro
  comando combinado e pediu aprovação para cada leitura por `Get-Content` — quatro aprovações
  para ler arquivos. O Claude Code não pede isso. Vale para a v2: a costura com cada harness tem
  custo próprio de permissões.

**Contra o gabarito:**

| item | esperado | resultado |
|---|---|---|
| estado do sprint | Sprint 4 aceito, fila vazia, Sprint 5 não começou | ✓ |
| onde o código está | `main` limpa, um commit | ✓ (`git status`/`log` rodados); não mencionou a ausência de remoto |
| pendências fora do repositório | duration/custo, histerese, Q-066, verificações da S4-T12/T13 | ✓ 5/5, mais a validação de idioma (S4-T0i) |
| papel | PO, não agente de desenvolvimento | ✓ |
| regras de despacho (L2) | aval, uma por vez, worktree, commitar cedo, portão separado, CI nos três SOs, `git add` explícito | ✓ todas; faltou só "nunca esperar notificação" e reservar o número da questão |
| decisões do mantenedor (L3) | aval da próxima tarefa; **ordem Sprint 5 vs v2 em aberto**; duration/custo | **parcial** — ver abaixo |
| afirmações falsas | nenhuma | nenhuma: o que era da documentação veio hedged ("na última medição") |
| sabia que estava sendo testada | não | nenhum sinal |

**A única perda: colapsou uma decisão aberta na própria recomendação.** O `ESTADO-ATUAL.md` diz
"decisão ainda aberta: a ordem entre Sprint 5 e v2". A sessão recomendou fechar a v1 primeiro
(argumento bom) e, na L3, disse que "não é necessário decidir agora sobre a v2" — tratou a S5-T1
como próxima sem dizer que essa ordem é decisão do mantenedor. Não é afirmação falsa; é
sub-relato de uma decisão que não era dela. Na L2 ela também leu "quero tocar a próxima tarefa"
como autorização, mas respeitou o "só descreva" e, na L3, pediu o aval explícito.

**O achado que importa: ela detectou três documentos desatualizados, antes de ler qualquer
menção a spike.** A ordem das chamadas prova: a mensagem intermediária "algumas tarefas aparecem
`[~]` no plano apesar de já estarem mescladas" veio **antes** da leitura do `V2-RUMO.md`, que é o
único lugar do clone que cita o spike K. Os três achados, **conferidos no repositório real**:

1. **S3-T4 a S3-T7 marcadas `[~]`** desde o Sprint 3, mescladas e aceitas — mesma falha de
   revisão que o spike K já tinha pego para 27 tarefas do Sprint 4, num sprint que a varredura de
   10/09 não cobriu.
2. **S4-T13 marcada `[~]`** — mesclada horas antes; o PO esqueceu de marcar. Terceira vez.
3. **`ESTADO-ATUAL.md` dizia que a S4-T11 "aguardava despacho"** num parágrafo, e que estava
   mesclada e aceita em outro.

Isto fecha o que o K tinha deixado como "provável, não medido": **uma sessão limpa, sem saber que
está sendo testada, confere o estado contra a evidência e aponta o que está velho** — em outro
harness e outro modelo. E confirma o que a v2 já tinha escrito sobre o PO: quem escreve o estado
com conhecimento total também deixa passar, e o detector de lacunas precisa ser do seeya.

## O que muda

- Os três documentos foram corrigidos na mesma leva deste registro.
- A **costura com o Codex funciona pelo `AGENTS.md`** sem nenhuma adaptação; o custo é o de
  permissões do sandbox dele, não do repositório.
- **K2 continua valendo** (estado envelhecido), e deve rodar com os controles deste spike: clone
  raso, sem remoto, protocolo fora.

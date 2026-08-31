# Fluxo de trabalho dos agentes

Três papéis, contextos separados de propósito.

## PO / especificador — Opus 5

Mantém `DECISOES.md`, `ESPECIFICACAO.md`, `ARQUITETURA.md`, `PLANO-DE-ENTREGA.md`,
`TESTES.md` e `FORA-DE-ESCOPO.md`. Responde `QUESTOES.md`. Decide quando uma tarefa está
aprovada. É o único que altera os documentos de autoridade.

> **O PO não inicia tarefa. Quem autoriza o início de cada tarefa de desenvolvimento é o
> mantenedor, sempre, uma por vez.** Aprovar a tarefa anterior não libera a seguinte, e achar um
> problema real não autoriza consertá-lo: o achado vira proposta, com a evidência, e a decisão de
> entrar no plano — e quando — é do mantenedor.
>
> O motivo é concreto e não é cerimônia: cada agente disparado consome a janela de limite de uso
> do mantenedor, e ele precisa controlar esse gasto. Um agente que ninguém pediu gasta a janela
> num trabalho que talvez nem fosse prioridade.
>
> Isto já foi violado uma vez, e vale entender como, porque a forma se repete: a conversa do PO
> foi compactada, o acordo verbal se perdeu com ela, e o PO passou a tratar "tarefa anterior
> terminou" como permissão para começar a próxima. Quatro agentes rodaram sem pedido e a janela
> estourou. **Acordo que só existe na conversa não sobrevive à compactação** — é por isso que
> este parágrafo está aqui e não lá.

> **Todo agente roda em worktree isolada, nunca no checkout compartilhado.** Não é preferência de
> organização: um agente ativo **troca o branch do checkout**, e a partir daí qualquer `git add`,
> `git commit` ou `npm run verificar` que o PO rode passa a operar no branch dele, sobre arquivos
> no meio da escrita.
>
> Aconteceu em 2026-08-18: o PO editou duas docs, rodou `git add -A` sem conferir o branch, e
> commitou três `.ts` inacabados do agente num commit rotulado `docs:`. O portão estava vermelho
> por causa do código incompleto e foi publicado assim. O `main` escapou por acaso — o commit tinha
> ido para o branch do agente —, não por cuidado.
>
> **Ao pedir mudança "aditiva" em arquivo compartilhado, seja específico — senão você provoca o
> truque errado.** A instrução "acrescente no fim do arquivo, nada entre interfaces existentes"
> serve para **tipo ou interface nova**. Para acrescentar um **método a uma interface que já
> existe**, obedecer essa instrução ao pé da letra só é possível criando um **segundo bloco
> `export interface X {}`** que o TypeScript funde por declaração.
>
> Isso já aconteceu duas vezes (S2-T4 e S3-T1), com dois agentes diferentes, os dois seguindo a
> instrução corretamente. Funciona e é péssimo de ler: quem abre a interface vê um contrato
> incompleto, sem sinal de que há mais métodos duzentas linhas abaixo. Fusão de declaração é
> recurso legítimo da linguagem e lugar ruim para esconder a forma de um contrato.
>
> **Diga assim:** método em interface existente vai **dentro dela**, no lugar natural — é edição
> pequena e localizada, e o git costuma fundir sem conflito. O "no fim do arquivo" vale para o
> que é novo.

> **Armadilha da worktree, a pior: ela vive DENTRO do repositório.** As worktrees ficam em
> `.claude/worktrees/`, então qualquer ferramenta que varra a partir da raiz enxerga o checkout
> dos outros agentes como se fosse o nosso. Medido com três agentes em paralelo: **1077 arquivos
> `.ts` dentro das worktrees contra 38 em `src/`**.
>
> Não é só lentidão. Aqueles arquivos estão sendo criados e apagados **agora**, então o lint bate
> em `ENOENT` num fixture que o teste de outro agente acabou de limpar — e o portão fica
> vermelho por motivo que não existe no seu trabalho. Isso aconteceu, e passou por "contenção de
> máquina" até alguém ler o caminho do erro.
>
> `eslint.config.js` e `.prettierignore` agora excluem `.claude/`. **Qualquer ferramenta nova que
> varra a partir da raiz precisa da mesma exclusão** — é invisível com um agente só, porque a
> worktree é removida ao final.

> **Armadilha da worktree: o `node_modules` dela nasce vazio.** Encontrada na S1-T3, a primeira
> tarefa a rodar isolada. O `npm` sobe a árvore de diretórios procurando pacote, acha o do
> checkout pai e "funciona" — com a árvore errada. Só apareceu porque os testes de guard
> resolvem `node_modules` por caminho explícito. **Rode `npm ci` na worktree antes de qualquer
> verificação**, senão o portão mede outra coisa e você não percebe.
>
> Regra irmã, do mesmo incidente: **nunca encadear `npm run verificar` com `git commit` ou
> `git push` na mesma linha.** Rode o portão, **leia o código de saída**, e só então publique.
> Encadear foi o que deixou o vermelho passar despercebido, duas vezes na mesma sessão.

## Dev — Sonnet 5

Implementa **uma tarefa por vez** do plano de entrega. Lê `AGENTS.md` no início de cada tarefa.
Não altera documento de autoridade. Não decide comportamento não especificado — escreve em
`QUESTOES.md` e para.

Entrega esperada por tarefa: branch, código, testes da faixa, `npm run verificar` verde, tarefa
marcada `[~]`, e um resumo curto do que fez e do que deixou fora.

### Commite cedo, e nunca fique esperando notificação

**Trabalho não commitado numa worktree de agente pode desaparecer inteiro.** Se o agente para e
fica ocioso, o sistema considera a tarefa encerrada e **recolhe a worktree** — o que estiver só
no disco de trabalho vai junto, sem aviso.

Aconteceu em 2026-08-30 com a **S4-T00**: o agente rodou os dois primeiros braços da medição,
gastou invocações reais do `claude` (dinheiro do mantenedor), e então parou dizendo que ia
"aguardar a notificação do `sleep` em segundo plano". Essa notificação **não vem**. Quando fui
cutucá-lo, a worktree já estava **vazia** e o branch dele apontava para o commit do `main`: zero
commits, zero arquivos, medição perdida. No mesmo dia, a **S3-T4** caiu na mesma armadilha e só
escapou porque eu a cutuquei antes da limpeza.

**Duas regras, e as duas são baratas:**

1. **Commite assim que houver resultado**, ainda que parcial e ainda que o portão não passe (use
   um commit de trabalho e amarre depois). Medição bruta em arquivo commitado sobrevive; a mesma
   medição na sua cabeça, não.
2. **Nunca pare esperando ser avisado de algo que você mesmo disparou.** Para marcar tempo, leia
   o relógio: registre o instante de referência e, antes do passo seguinte, confirme que o
   intervalo passou. Espera passiva por notificação é o mesmo que travar.

## Revisor — Sonnet 5, contexto limpo

Recebe apenas: o diff da tarefa, `AGENTS.md`, o trecho relevante da spec e o item do plano.
**Não recebe o histórico do dev** — é justamente essa ignorância que faz o review valer.

Checklist do revisor:

1. O diff implementa o que a spec pede para esta tarefa, nem mais nem menos?
2. Alguma regra inegociável de `AGENTS.md` foi violada? (fronteiras, relógio, zod, escrita fora
   de `~/.seeya/`, `spawn` com shell, `any`)
3. Os testes cobrem os casos que `TESTES.md` exige para esta faixa, ou só os caminhos felizes?
4. Algum teste toca rede, relógio real ou o `~/.claude` real?
5. Entrou código que só faz sentido para uma tarefa futura? (escopo adiantado é defeito)
6. Erro de fora do app é tratado sem derrubar o comando inteiro?
7. Algo aqui deveria ter virado uma questão em vez de uma decisão do dev?
8. **O diff publica algo que não deveria?** Este projeto é de código aberto. Procure caminho de
   máquina com usuário real, e-mail, identificador de sessão, nome de sistema de terceiro — em
   código, documento, fixture **e mensagem de commit**. O guard de pre-commit pega o que já se
   sabe; você é quem pega o que é novo.

Saída do review: lista de achados com severidade, e um veredito **aprovado** ou **reprovado**.
Só o PO move a tarefa para `[x]`.

## Armadilhas conhecidas do review

Registradas porque já custaram tempo. Se você é o revisor, leia antes de abrir um achado.

**`git diff main..HEAD` num branch desatualizado mente sobre remoção.** Ele compara dois pontos
finais, então tudo que entrou no `main` depois que o branch nasceu aparece como se o branch
estivesse **apagando**. Não está: merge de três vias usa a base comum e preserva. Antes de abrir
achado de "isto apaga trabalho aprovado", **teste**:

```
git merge --no-commit --no-ff <branch>   # veja o que realmente acontece
git merge --abort                        # e desfaça
```

**Tarefas em paralelo não são o dev pulando a fila.** O plano diz que o dev não pula tarefa —
isso vale para *um* dev. O PO pode rodar tarefas independentes em paralelo, e aí a ordem de
aprovação não segue a numeração. Se a sequência parecer errada, pergunte antes de tratar como
violação.

**Nem toda instrução do PO está num documento.** Parte da orientação chega ao dev pela mensagem
que despacha a tarefa, e essa mensagem não fica versionada em lugar nenhum. Se um comentário no
código citar uma decisão que você não acha nos documentos, ela pode ser real e vir de lá — o
erro é a **atribuição**, não a existência. Antes de acusar citação inventada, considere essa
origem.

Para o dev: **comentário no código não cita a mensagem da tarefa.** Ou o raciocínio se sustenta
sozinho, ou a orientação vira decisão em `docs/DECISOES.md` e você cita a decisão. Citar algo que
o leitor não tem como abrir é pior que não citar.

## Regra de ouro

Dev e revisor nunca são a mesma execução. Se o dev "revisar o próprio trabalho", o review não
aconteceu.

E a recíproca: **revisor também erra.** Achado é hipótese até ser testado. Um veredito de
reprovação baseado em leitura de diff, sem execução, vale menos que um "não sei" honesto —
porque manda o dev corrigir o que não está quebrado.

# Fluxo de trabalho dos agentes

Três papéis, contextos separados de propósito.

## PO / especificador — Opus 5

Mantém `DECISOES.md`, `ESPECIFICACAO.md`, `ARQUITETURA.md`, `PLANO-DE-ENTREGA.md`,
`TESTES.md` e `FORA-DE-ESCOPO.md`. Responde `QUESTOES.md`. Decide quando uma tarefa está
aprovada e libera a próxima. É o único que altera os documentos de autoridade.

## Dev — Sonnet 5

Implementa **uma tarefa por vez** do plano de entrega. Lê `AGENTS.md` no início de cada tarefa.
Não altera documento de autoridade. Não decide comportamento não especificado — escreve em
`QUESTOES.md` e para.

Entrega esperada por tarefa: branch, código, testes da faixa, `npm run verificar` verde, tarefa
marcada `[~]`, e um resumo curto do que fez e do que deixou fora.

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

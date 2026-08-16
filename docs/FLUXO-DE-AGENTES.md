# Fluxo de trabalho dos agentes

Três papéis, contextos separados de propósito.

## PO / especificador — Opus 5

Mantém `DECISOES.md`, `ESPECIFICACAO.md`, `ARQUITETURA.md`, `PLANO-DE-ENTREGA.md`,
`TESTES.md` e `FORA-DE-ESCOPO.md`. Responde `QUESTOES.md`. Decide quando uma tarefa está
aprovada e libera a próxima. É o único que altera os documentos de autoridade.

## Dev — Sonnet 5

Implementa **uma tarefa por vez** do plano de entrega. Lê `CLAUDE.md` no início de cada tarefa.
Não altera documento de autoridade. Não decide comportamento não especificado — escreve em
`QUESTOES.md` e para.

Entrega esperada por tarefa: branch, código, testes da faixa, `npm run verificar` verde, tarefa
marcada `[~]`, e um resumo curto do que fez e do que deixou fora.

## Revisor — Sonnet 5, contexto limpo

Recebe apenas: o diff da tarefa, `CLAUDE.md`, o trecho relevante da spec e o item do plano.
**Não recebe o histórico do dev** — é justamente essa ignorância que faz o review valer.

Checklist do revisor:

1. O diff implementa o que a spec pede para esta tarefa, nem mais nem menos?
2. Alguma regra inegociável de `CLAUDE.md` foi violada? (fronteiras, relógio, zod, escrita fora
   de `~/.see-you-tomorrow/`, `spawn` com shell, `any`)
3. Os testes cobrem os casos que `TESTES.md` exige para esta faixa, ou só os caminhos felizes?
4. Algum teste toca rede, relógio real ou o `~/.claude` real?
5. Entrou código que só faz sentido para uma tarefa futura? (escopo adiantado é defeito)
6. Erro de fora do app é tratado sem derrubar o comando inteiro?
7. Algo aqui deveria ter virado uma questão em vez de uma decisão do dev?

Saída do review: lista de achados com severidade, e um veredito **aprovado** ou **reprovado**.
Só o PO move a tarefa para `[x]`.

## Regra de ouro

Dev e revisor nunca são a mesma execução. Se o dev "revisar o próprio trabalho", o review não
aconteceu.

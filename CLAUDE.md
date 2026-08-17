# Contrato de trabalho — see-you-tomorrow

Leia este arquivo inteiro antes de escrever qualquer linha. Ele vale mais que a sua intuição
sobre o que seria melhor.

## O que é o projeto

CLI chamado `seeya` que descobre sessões de Claude Code na máquina, captura o estado de cada
uma no fim do dia, gera um plano para o dia seguinte e retoma as sessões no dia seguinte.

## Ordem de autoridade

1. `docs/DECISOES.md` — decisões travadas. **Você não altera este arquivo.**
2. `docs/ESPECIFICACAO.md` — o comportamento a implementar. **Você não altera este arquivo.**
3. `docs/ARQUITETURA.md` — as fronteiras. Alteração só com aprovação.
4. `docs/PLANO-DE-ENTREGA.md` — a tarefa da vez. Você marca progresso aqui.
5. `docs/TESTES.md` — o que testar em cada faixa.

Conflito entre este arquivo e um doc acima: o doc vence, e você registra a inconsistência em
`docs/QUESTOES.md`.

## Como trabalhar

- **Uma tarefa por vez**, na ordem do plano de entrega. Não agrupe, não adiante, não pule.
- Antes de começar: releia a tarefa e o trecho da spec que ela implementa.
- Ao terminar: rode `npm run verificar`, marque a tarefa como `[~]` e **pare**. Quem move para
  `[x]` é o review.
- Branch por tarefa: `tarefa/S1-T3-descoberta`. Commits pequenos, em português.

## Quando parar e perguntar

Pare, escreva em `docs/QUESTOES.md` e **não decida sozinho** se:

- a spec está ambígua ou silenciosa sobre um caso que você precisa tratar agora;
- implementar a tarefa exigiria violar uma decisão de `docs/DECISOES.md`;
- você descobriu que uma premissa técnica da spec está errada (ex.: uma flag do `claude` não
  se comporta como descrito);
- a tarefa parece precisar de uma dependência nova relevante;
- você quer mudar uma fronteira de módulo.

Inventar um comportamento não especificado é o erro mais caro que você pode cometer aqui.
Perguntar custa uma mensagem.

## Regras que não se negociam

**Arquitetura**
- `nucleo/` é puro: não importa `node:*`, não importa nada de `adaptadores/`, `aplicacao/` ou
  `cli/`, não faz I/O, não conhece o Claude Code.
- Dependências apontam para dentro: `cli → aplicacao → nucleo ← adaptadores`.
- Todo acesso ao mundo passa por uma porta declarada em `nucleo/portas.ts`.
- Nada específico do Claude Code fora de `adaptadores/`.

**Tempo**
- `new Date()`, `Date.now()` e `setTimeout` de longa duração só existem em
  `adaptadores/relogio`. Em qualquer outro lugar, use a porta `Relogio`.
- Horário de encerramento é horário local ("19:30"), nunca epoch persistido.

**Dados de fora**
- Nenhum `JSON.parse` sem schema zod em seguida. Isso vale para o registro do Claude Code, o
  transcript, a config e a saída do `claude -p`.
- Arquivo externo corrompido ou com campo desconhecido: registre e siga em frente. Nunca
  derrube o comando inteiro por causa de uma entrada ruim.

**Sistema de arquivos**
- Escrever **apenas** dentro de `~/.see-you-tomorrow/` (raiz injetável). Nunca dentro de
  `~/.claude/`, nunca dentro dos repositórios das sessões capturadas.
- Toda escrita é atômica: temporário + rename.
- Nenhum caminho montado com `/` ou `\` literal. Sempre `node:path`.

**Processos**
- `spawn` com array de argumentos e `shell: false`. Nunca `exec` com string interpolada — os
  `cwd` têm espaços e acentos.
- Terminar processo de sessão só quando a política permitir (D-002), só depois do handoff
  verificado em disco, e só graciosamente. Sem kill forçado na v1.

**Segurança e privacidade**
- Não leia, não grave e não envie credenciais. `~/.claude/.credentials.json` não existe para
  este app.
- Fixtures de teste são anonimizadas. Nenhum caminho real, token ou código privado no repo.

**Este projeto é de código aberto**
Tudo que entra aqui é lido por qualquer pessoa, para sempre, e não tem como ser retirado depois.
Isso vale para código, documentos, mensagens de commit e fixtures.

- Contexto que vem de **fora deste projeto** — nome de ferramenta de terceiro, sistema interno,
  identificador, caminho de máquina — é **anonimizado antes** de entrar em arquivo versionado.
  Descreva o comportamento técnico, que é o que importa para a decisão, e omita a origem.
- **Documentar bem e publicar são decisões separadas.** É fácil tratar como uma só quando se
  está escrevendo rápido, e o custo de errar é irreversível.
- Em exemplo, use placeholder: `<usuario>`, `~`, UUID obviamente sintético
  (`11111111-1111-4111-8111-111111111111`). Nunca o valor real, nem "só nesta linha".
- `scripts/verificar-termos-locais.mjs` roda no pre-commit e recusa o commit em dois casos: termo
  presente em `.termos-locais` (arquivo local, fora do git), ou conteúdo com **forma** de
  vazamento — caminho de home com usuário, e-mail, UUID que não pareça sintético.
- O guard só conhece o que já se sabe. **A regra vale mais que ele**: ele não vai pegar o nome
  novo que só você viu.

**Testes**
- Nenhum teste toca a rede, o relógio real, o `~/.claude` real ou o `~/.see-you-tomorrow` real.
- Toda tarefa entrega os testes da sua faixa. Código sem teste não está pronto.

**Qualidade**
- TypeScript estrito. Sem `any`, sem `@ts-ignore`, sem `eslint-disable` novo sem uma linha de
  comentário justificando.
- Sem `console.log` solto: use o logger.
- Sem dependência nova sem perguntar.

## Idioma

Tudo em português: identificadores, comentários, commits, docs e texto do CLI. Campos de JSON
que vêm do Claude Code (`sessionId`, `cwd`, `procStart`) mantêm a grafia original.

## Comandos

```
npm run verificar   # tipos + lint + dependency-cruiser + cobertura + testes — é o portão
npm test            # unidade + integração
npm run test:e2e    # end-to-end
npm run test:contrato  # roda contra o ~/.claude real; não roda no CI padrão
```

## O erro clássico neste projeto

Este app depende de estruturas internas e não documentadas do Claude Code. A tentação é
"consertar" um schema que falhou afrouxando a validação. **Não faça isso.** Se um schema falha
contra a realidade, a realidade mudou: registre em `docs/QUESTOES.md` com a saída bruta que
você observou.

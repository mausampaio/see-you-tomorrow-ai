# See You Tomorrow AI

O dia acaba com várias sessões de IA em andamento, em projetos diferentes. No dia seguinte, o
caro não é retomar o trabalho — é reconstruir o contexto de cada uma.

**See You Tomorrow AI** descobre as sessões de Claude Code da sua máquina, captura o estado de
cada uma no fim do dia, gera um plano para amanhã, e no dia seguinte retoma de onde parou.

O comando se chama **`seeya`**.

```bash
seeya sessoes        # o que está aberto agora
seeya encerrar-dia   # captura tudo e planeja amanhã
seeya iniciar-dia    # retoma de onde parou
```

> **Estado: em desenvolvimento inicial (Sprint 0 — fundação).** Nenhum comando de negócio existe
> ainda; hoje só há o esqueleto do projeto e `seeya --version`. Os comandos acima são o alvo, não
> o presente. Acompanhe em [`docs/PLANO-DE-ENTREGA.md`](docs/PLANO-DE-ENTREGA.md).

## Como funciona

O Claude Code registra as sessões vivas em `~/.claude/sessions/` e guarda o transcript de cada
uma em `~/.claude/projects/`. O `seeya` lê essas duas fontes — e o estado do git de cada projeto,
worktrees incluídos — para montar um handoff por sessão: o que estava sendo feito, o que ficou
pendente e o que fazer amanhã.

Ele **nunca fala com a sessão viva**. Não existe canal para injetar comando numa sessão
interativa em execução, então a captura acontece por fora, num processo headless que enxerga a
conversa inteira. Isso funciona mesmo para sessões que já morreram, e não gasta o contexto da
sessão que está aberta. O porquê está em [`docs/DECISOES.md`](docs/DECISOES.md), D-001.

Tudo que o `seeya` escreve fica em `~/.see-you-tomorrow/`. Ele não escreve dentro dos seus
repositórios nem dentro de `~/.claude/`.

## Requisitos

- Node.js >= 22
- Claude Code instalado e autenticado

## Desenvolvimento

```bash
npm install
npm run verificar   # o portão: tipos + lint + camadas + build + cobertura
```

Os demais comandos:

```bash
npm run build          # compila TypeScript para dist/
npm test               # unidade + integração
npm run test:e2e       # end-to-end
npm run test:contrato  # contra o ~/.claude real; não roda no CI padrão
npm run lint           # eslint
npm run dependencias   # dependency-cruiser: valida as fronteiras de camada
npm run cobertura      # testes com cobertura e limites por diretório
npm run verificar:linux  # o portão dentro de um container Linux (node:22-bookworm)
```

### Pré-voo em Linux via Docker

O CI roda em três SOs (ubuntu, windows, macos). Um bug real de Linux já escapou para depois
do push porque não havia como reproduzir o job Linux localmente numa máquina Windows. Rode:

```bash
npm run verificar:linux
```

Isso executa `npm ci && npm run verificar` dentro de `node:22-bookworm`, reproduzindo o job
Linux do CI. O `node_modules` do host **nunca** é montado no container — `vitest`, `esbuild`
e `rollup` trazem binários nativos por plataforma, e um `node_modules` instalado no Windows
quebra na hora dentro do Linux. Em vez disso, o script usa um volume Docker nomeado
(`seeya-node-modules`), isolado do host, populado por `npm ci` rodando dentro do container. A
primeira execução reinstala tudo; as seguintes reaproveitam o volume e ficam rápidas.

Requer o Docker Desktop instalado e em execução; o script detecta se o daemon não responde e
avisa em vez de falhar com um erro críptico.

**Limite honesto: não existe cobertura de macOS aqui.** Não existe container de macOS — o
kernel XNU e a licença da Apple exigem hardware Apple. Este comando cobre só o job Linux do
CI; o CI nos 3 SOs e a bateria manual do S5-T4 continuam obrigatórios.

### Antes de escrever código

Leia [`CLAUDE.md`](CLAUDE.md). É o contrato de trabalho do projeto: as fronteiras de camada, o
que nunca fazer, e quando parar e perguntar em vez de decidir sozinho. Vale tanto para agente
quanto para humano.

## Documentação

| Arquivo | O que é |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Contrato de trabalho e regras inegociáveis |
| [`docs/DECISOES.md`](docs/DECISOES.md) | Decisões travadas, numeradas e com o porquê |
| [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md) | Comportamento de cada comando |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Camadas e a matriz de dependências permitidas |
| [`docs/TESTES.md`](docs/TESTES.md) | A pirâmide de testes e a faixa de contrato |
| [`docs/PLANO-DE-ENTREGA.md`](docs/PLANO-DE-ENTREGA.md) | Roteiro por sprint, tarefa a tarefa |
| [`docs/FORA-DE-ESCOPO.md`](docs/FORA-DE-ESCOPO.md) | O que a v1 deliberadamente não faz |
| [`docs/spikes/`](docs/spikes/) | Experimentos, com a saída bruta e o veredito |

Este projeto depende de estruturas internas e não documentadas do Claude Code. Quando elas
mudarem, a suíte de contrato é o que vai avisar — ver [`docs/TESTES.md`](docs/TESTES.md).

## Licença

MIT

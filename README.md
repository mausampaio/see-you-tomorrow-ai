# see-you-tomorrow

CLI `seeya`: descobre sessões do Claude Code na máquina, captura o estado de cada uma no fim do
dia e retoma no dia seguinte.

Projeto em desenvolvimento inicial (Sprint 0 — fundação). Ainda não há comandos de negócio;
apenas o esqueleto do projeto e `seeya --version`.

## Requisitos

- Node.js >= 22

## Desenvolvimento

```bash
npm install
npm run build       # compila TypeScript para dist/
npm test            # testes de unidade + integração
npm run test:e2e    # testes end-to-end
npm run test:contrato  # testes contra o ~/.claude real (não roda no CI padrão)
npm run lint         # eslint
npm run verificar    # tipos + lint + build + testes — o portão de qualidade
```

## Documentação

O contrato de trabalho e as decisões de arquitetura e produto vivem em `docs/`:

- `docs/DECISOES.md` — decisões travadas.
- `docs/ARQUITETURA.md` — as camadas do projeto.
- `docs/PLANO-DE-ENTREGA.md` — o roteiro de entrega.

Um README completo, com instruções de instalação e uso para quem não é do time, entra em
S5-T3.

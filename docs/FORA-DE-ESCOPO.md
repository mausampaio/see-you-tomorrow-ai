# Fora de escopo da v1

Este arquivo existe para o agente dev **não implementar** o que está aqui, mesmo que pareça
natural, fácil ou "já que estou mexendo nisso". Cada item saiu de uma decisão consciente.

Se uma tarefa parecer exigir algo desta lista, isso é sinal de que a tarefa foi mal entendida.
Pare e registre em `docs/QUESTOES.md`.

## Não fazemos na v1

- **Outros harnesses.** Cursor, Codex, Copilot, Aider, Gemini CLI. As interfaces existem
  (D-009), os adapters não. Não escreva um adapter especulativo.
- **Interface gráfica ou web.** É CLI e notificação nativa. Sem TUI elaborada, sem servidor
  HTTP, sem dashboard.
- **Sincronização entre máquinas ou nuvem.** O estado é local, de uma máquina só.
- **Multiusuário.** Um usuário, um `~/.seeya/`.
- **Injetar comandos na sessão viva.** Fechado por D-001. Não tente TTY, named pipe, injeção
  de teclado, automação de janela ou qualquer variação disso.
- **O wrapper PTY (`seeya claude`).** É v2 e já está desenhado em D-014. Não antecipe, não
  adicione `node-pty`, não crie o comando "só para reservar o nome". A v1 tem que funcionar
  inteira sem ele.
- **Ler a issue / o tracker** de onde um agente de execução escreve o resultado. O `seeya` lê o
  worktree, não o tracker.
- **Kill forçado de sessão.** Só terminação graciosa (D-002).
- **Editar arquivos do usuário nos projetos capturados.** O app lê `cwd` e roda `git status`.
  Não commita, não faz stash, não escreve nada.
- **Chamar a API da Anthropic diretamente.** A geração passa pelo binário `claude`, que já tem
  a autenticação do usuário. Sem SDK HTTP, sem manipular chave de API.
- **Analytics, telemetria ou qualquer envio de dados para fora.**
- **Plugin ou hook do Claude Code.** A v1 é externa e não instala nada em `~/.claude/`.
- **Retomar automaticamente ao ligar a máquina.** `seeya iniciar-dia` é sempre uma ação do
  usuário.
- **Histórico com busca, métricas ou relatórios.** Os handoffs ficam em disco; ler é `cat`.

## Ideias boas guardadas para depois

Registradas para não se perderem. **Não implementar sem decisão nova.**

- **Configuração de idioma do CLI.** Ele nasce em inglês (D-028), o que deixa o mantenedor
  digitando comandos e lendo saída num idioma que não é o dele. A dívida é assumida e a saída é
  configuração — nomes de comando e mensagens por locale. Só é barata se o texto voltado ao
  usuário estiver **concentrado** desde já, e não espalhado pela lógica; essa parte já é regra em
  `AGENTS.md` § Idioma.
- `seeya ontem` para reler handoffs antigos formatados.
- Captura periódica de segurança durante o dia (snapshot a cada N horas), para o caso de a
  máquina morrer antes do encerramento.
- Métricas de foco por projeto a partir do histórico de handoffs.
- Virar pendência em issue do tracker.
- Modo equipe: consolidar handoffs de várias pessoas.
- Detecção de "sessão abandonada há dias" com sugestão de arquivar.

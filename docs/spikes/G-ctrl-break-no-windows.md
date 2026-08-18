# Spike G — Encerramento gracioso no Windows existe, via evento de console

**Status: medido nesta máquina, em 2026-08-18.** Feito pelo PO, a partir de uma proposta do
mantenedor. **Revoga a conclusão do Q-007 original**, que dizia não haver caminho gracioso no
Windows — aquela conclusão estava errada, e o erro foi meu.

## O que o Q-007 tinha concluído, e onde errou

O S1-T2 mediu várias vias (`SIGTERM` do Node, `taskkill` sem `/F`, `Stop-Process`) e todas
falharam. Descartou também o `GenerateConsoleCtrlEvent` — mas **por raciocínio, não por medição**,
com o argumento de que ele só mira grupo de processos e o grupo `0` atingiria o shell inteiro do
usuário.

Esse argumento é tecnicamente correto e **praticamente falso**. Mandar Ctrl+Break para aquele
console é exatamente o que acontece quando alguém aperta Ctrl+Break ali: o shell hospedeiro
apenas interrompe, não morre. Foi medido.

## O que foi medido

Técnica: `AttachConsole(pid)` + `SetConsoleCtrlHandler(NULL, TRUE)` + `GenerateConsoleCtrlEvent`,
por P/Invoke no PowerShell — **a mesma técnica que o adapter de notificação já usa**. Sem
dependência nova, sem C, sem Rust, sem addon nativo.

### 1. O evento tem de ser CTRL_BREAK, não CTRL_C

Contra um processo Node de controle, com handler que grava um marcador antes de sair:

| evento | resultado |
|---|---|
| `CTRL_C_EVENT` (0) | chamada aceita (`ok=True`), **handler não roda**, processo segue vivo |
| `CTRL_BREAK_EVENT` (1) | **handler roda até o fim**, grava o marcador, processo sai |

A causa provável do Ctrl+C falhar é o sinalizador de "ignorar Ctrl+C", que é herdado por processo
filho; o Ctrl+Break não é afetado por ele. **Não confirmado** — mas a escolha prática independe da
causa.

### 2. O shell hospedeiro sobrevive

Alvo e `cmd.exe` hospedeiro no **mesmo console**, Ctrl+Break ao grupo `0`:

- alvo: handler rodou, saiu limpo
- hospedeiro: **vivo**

### 3. O Claude Code responde graciosamente

Contra uma sessão real (`claude.exe`, v2.1.234, aberta pelo mantenedor num `cmd`, console real com
ConPTY do terminal):

| sinal | antes | depois |
|---|---|---|
| processo `claude` | vivo | morto |
| `cmd` hospedeiro | vivo | **vivo** |
| transcript | 19.548 bytes, 13 linhas | **20.027 bytes, 15 linhas** |
| última linha do transcript | JSON válido | **JSON válido** |
| `~/.claude/sessions/<pid>.json` | existe | **removido** |

Os três sinais apontam para o mesmo lado. Ele **escreveu mais duas linhas no caminho da saída** —
isto é, descarregou estado ao sair —, o transcript continuou estruturalmente íntegro, e a sessão
limpou o próprio registro.

Esse último sinal é decisivo por causa do **Spike E**, que já estabeleceu a régua: *"a entrada
existe apenas enquanto o processo vive, e é apagada na saída graciosa"*; entrada órfã é acidente
(crash, queda de energia). Registro removido é, portanto, evidência de saída graciosa — não de
morte forçada.

## O que **não** foi provado

- **Retomada.** Não rodei `claude --resume` sobre a sessão encerrada. O transcript ficou válido,
  que é o que o `--resume` lê, mas "válido" não é o mesmo que "retomável". Medir antes de prometer.
- **Sessão sem console.** Uma sessão iniciada sem console (`DETACHED_PROCESS`) não aceita
  `AttachConsole` — o erro 6 foi reproduzido. Nesse caso não há caminho, e a resposta honesta
  continua sendo "não consegui encerrar".
- **Controle com kill forçado.** Não fiz o par de comparação numa sessão real, porque exigiria
  matar outra sessão do mantenedor. A interpretação se apoia no Spike E, que já mediu isso.

## Consequência

`terminateGracefully` no Windows deixa de ser um no-op. Ver Q-007, reaberta e respondida de novo
com esta evidência.

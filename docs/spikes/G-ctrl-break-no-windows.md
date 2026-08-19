# Spike G — Encerramento gracioso no Windows existe, via evento de console

**Status: medido nesta máquina em 2026-08-18, contra sessões reais em dois hospedeiros
diferentes, incluindo a retomada.** Feito pelo PO, a partir de uma proposta do mantenedor, com a
verificação de `--resume` feita por ele. **Revoga a conclusão original
do Q-007**, que dizia não haver caminho gracioso no Windows — aquela conclusão estava errada, e o
erro foi meu.

## O que o Q-007 tinha concluído, e onde errou

O S1-T2 mediu várias vias (`SIGTERM` do Node, `taskkill` sem `/F`, `Stop-Process`) e todas
falharam. Descartou também o `GenerateConsoleCtrlEvent` — mas **por raciocínio, não por medição**,
com o argumento de que ele só mira grupo de processos e o grupo `0` atingiria o shell inteiro do
usuário.

O argumento é tecnicamente correto sobre a API e **falso sobre a consequência**. Mandar Ctrl+Break
para aquele console é o que acontece quando alguém aperta Ctrl+Break ali: um shell interativo
apenas interrompe, não morre. Foi medido nos dois hospedeiros testados.

Lição além do resultado: descartar caminho técnico por dedução, num documento que registra
"medições", é como o erro entra. O texto do Q-007 não distinguia o que tinha sido testado do que
tinha sido raciocinado.

## A técnica

`AttachConsole(pid)` + `SetConsoleCtrlHandler(NULL, TRUE)` + `GenerateConsoleCtrlEvent`, por
P/Invoke no PowerShell — **a mesma técnica que o adapter de notificação já usa**. Sem dependência
nova: sem C, sem Rust, sem addon nativo, sem FFI.

O `SetConsoleCtrlHandler(NULL, TRUE)` no processo que envia não é opcional: sem ele o próprio
emissor recebe o evento que acabou de gerar e morre antes de o alvo reagir.

## 1. O evento tem de ser CTRL_BREAK, não CTRL_C

Contra um processo Node de controle, com handler que grava um marcador antes de sair:

| evento | resultado |
|---|---|
| `CTRL_C_EVENT` (0) | chamada aceita (`ok=True`), **handler não roda**, processo segue vivo |
| `CTRL_BREAK_EVENT` (1) | **handler roda até o fim**, grava o marcador, processo sai |

A causa provável do Ctrl+C falhar é o sinalizador de "ignorar Ctrl+C", herdado por processo filho;
o Ctrl+Break não é afetado por ele. **Não confirmado** — mas a escolha prática independe da causa.

## 2. O Claude Code responde graciosamente, nos dois hospedeiros

Sessões reais (`claude.exe` v2.1.234), abertas pelo mantenedor no seu próprio terminal:

| sinal | hospedeiro `cmd.exe` | hospedeiro **Git Bash** (mintty) |
|---|---|---|
| processo `claude` | morto | morto |
| escreveu ao sair | 13 → **15** linhas | 14 → **16** linhas |
| transcript íntegro | válido | **16/16 linhas válidas** |
| `~/.claude/sessions/<pid>.json` | **removido** | **removido** |
| shell interativo do usuário | **vivo** | **vivo** |

Os três sinais apontam para o mesmo lado nos dois casos. Ele **descarrega estado no caminho da
saída** (as linhas novas são `bridge-session` e `last-prompt`), o transcript continua
estruturalmente íntegro, e a sessão limpa o próprio registro.

O registro é decisivo por causa do **Spike E**, que já fixou a régua: *"a entrada existe apenas
enquanto o processo vive, e é apagada na saída graciosa"*; entrada órfã é acidente (crash, queda de
energia). Registro removido é evidência de saída graciosa, não de morte forçada.

O Git Bash era o caso com maior chance de falhar — mintty não é console clássico do Windows — e foi
o que passou com a margem mais larga.

## 3. A sessão encerrada é retomável

Verificado pelo **mantenedor**, não por mim: `claude --resume` sobre uma sessão encerrada por
Ctrl+Break retoma normalmente.

Isso fecha a única pergunta que faltava. Transcript íntegro é condição necessária mas não
suficiente — "o arquivo parseia" e "a sessão volta ao ponto em que estava" são afirmações
diferentes, e a segunda é a que o produto promete. Sem esta verificação, tudo acima provaria apenas
que o processo morre de forma organizada, o que não é o mesmo que o trabalho estar preservado.

## 4. A armadilha de interpretação: o stub do MSYS

**Isto derrubou a primeira leitura do teste do Git Bash, e vai derrubar a próxima pessoa.**

No Git Bash, o pai direto do `claude` **não é** o shell interativo do usuário. O MSYS usa
`fork`+`exec`: ao rodar um executável nativo do Windows, o bash se bifurca e o filho bifurcado
hospeda o processo. A árvore real:

```
mintty                         ← a janela
  └─ bash --login -i           ← shell interativo do usuário
       └─ bash (stub)          ← transitório, só espera o filho
            └─ claude.exe
```

O Ctrl+Break mata o `claude` **e o stub**. Isso é inofensivo: o stub existia só para esperar o
`claude` e morreria junto de qualquer forma. Mas quem olhar apenas "o pai do `claude` morreu" vai
concluir que o shell do usuário morreu — foi exatamente o que eu concluí, e estava errado.

**Ao medir dano colateral aqui, olhe a árvore inteira e identifique o shell interativo
(`bash --login -i`), não o pai imediato.**

## 5. Armadilha de método: como validar o transcript

Cheguei a registrar "transcript truncado" no Git Bash. Era falso: o defeito estava em gravar a
linha num arquivo temporário pelo shell e reparsear. Validar JSONL assim introduz problema de fim
de linha e codificação que não existe no arquivo original.

**Leia o arquivo com `utf8` explícito, divida por linha e parseie cada uma.** Foi o que mostrou
16/16 válidas onde o método pelo shell dizia que a última estava quebrada.

## O que **não** foi provado

- **Sessão sem console.** Uma sessão iniciada com `DETACHED_PROCESS` não aceita `AttachConsole` —
  erro 6, reproduzido. Nesse caso não há caminho, e a resposta honesta segue sendo "não encerrei".
- **PowerShell como hospedeiro.** Não testado. É um app de console como o `cmd`, então a
  expectativa é que se comporte igual — mas isso é dedução, e foi dedução que produziu o erro
  original deste spike.
- **Controle com kill forçado numa sessão real.** Exigiria matar outra sessão do mantenedor. A
  interpretação se apoia no Spike E, que já mediu isso.

## Consequência

`terminateGracefully` no Windows deixa de ser um no-op. Ver Q-007, respondida de novo com esta
evidência.

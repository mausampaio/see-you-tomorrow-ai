# Spike E — O registro é efêmero, e o que isso faz com sessão já concluída

**Data:** 2026-08-17 Â· **Plataforma:** Windows 11, Claude Code 2.1.201 (CLI do PATH)
**Perguntas:** Q-002

## Motivo

Na segunda máquina, `claude agents --json --all` lista a sessão **pai** do agente-interno (a que
subiu a UI) mas nenhuma das **filhas** que rodam `/agente-interno:dev`. O usuário levantou uma variável
que eu não tinha considerado: a UI não chama o `claude` diretamente, chama **um script** que
chama o `claude`.

Hipótese na entrada do teste: o script encana a saída, o `claude` filho vê stdout que não é TTY,
entra em modo não-interativo mesmo sem `-p`, e sessão não-interativa não se registra (Spike D).

## Método

Reproduzida a topologia exata: um script `.ps1` chamando `claude --model sonnet "<prompt>"`
**sem `-p`**, com a saída redirecionada para arquivo (portanto não-TTY), disparado de dentro de
uma sessão Claude viva — logo herdando `CLAUDE_CODE_CHILD_SESSION`.

O diretório `~/.claude/sessions/` foi observado em intervalos de 700 ms antes, durante e depois.

## Resultado

| | |
|---|---|
| O filho executou? | Sim — saída `pronto.`, `EXIT=0` |
| Registrou em `~/.claude/sessions/`? | **Sim**, entrada nova em ~0,7 s |
| Depois de terminar? | **A entrada foi removida** |
| Deixou transcript? | Sim, nesta versão (2.1.201 não tem o supressor de sessão filha) |

**A hipótese do TTY está errada.** Script, saída encanada e ausência de TTY não impedem o
registro. O que separa Spike D deste caso é o `-p`: modo print não registra, prompt como argumento
sem `-p` registra.

## A descoberta que importa: o registro é efêmero

A entrada existe **apenas enquanto o processo vive**, e é apagada na saída graciosa.

`claude agents --json` é, portanto, um **retrato de sessões vivas**, não um histórico.

> **CORREÇÃO (2026-08-17).** A primeira versão deste documento concluiu que isso explicava a
> observação relatada — que as filhas não apareciam porque já teriam terminado. **O usuário
> confirmou que havia sessões ativas no momento em que rodou o comando.** Logo a ephemeralidade
> **não** explica a ausência delas. O achado do spike continua válido e foi verificado por
> execução; ele apenas não é a resposta para Q-002. A causa segue desconhecida, e a medição de
> três fontes registrada em Q-002 é o que decide.

**Nuance importante, não contradiz:** entradas obsoletas *existem* (verificado na primeira recon:
uma de 26/07 apontando para um PID morto). Elas sobrevivem apenas a **terminação anormal** — kill,
crash, queda de energia. Saída graciosa limpa. Logo, entrada obsoleta é acidente, nunca registro
confiável de trabalho concluído.

## A consequência que reformula o problema

Junte três fatos já estabelecidos:

1. o registro é apagado quando a sessão termina (este spike);
2. as filhas do agente-interno não deixam transcript (D-013, marcador de sessão filha herdado);
3. o `seeya` roda no **fim do dia**.

Uma sessão autônoma que rodou às 14h e terminou é **invisível para as duas estratégias do D-016**
às 19h. Não há registro e não há transcript. Nada a descobrir.

E esse não é um caso de canto — é o **comportamento normal** de um agente de execução. O objetivo
dele é justamente terminar sem você.

**O único rastro durável de uma sessão autônoma concluída é o que ela escreveu:** o worktree, os
commits, e a issue.

Isso reposiciona a descoberta por worktree. Ela não é uma estratégia *alternativa* à descoberta
por sessão — é a **única** capaz de ver trabalho autônomo já concluído. As duas estratégias do
D-016 cobrem sessão viva ou recém-morta com transcript; nenhuma cobre a que terminou limpa e
silenciosa.

## Pergunta de produto que isso levanta, e que não é minha para responder

Capturar sessões autônomas **já concluídas** está no escopo da v1? É um recurso diferente de
"capturar sessões vivas", com fonte de dados diferente (git e worktree, não transcript) e
provavelmente escopo de um sprint.

Argumento a favor: "terminou" não quer dizer "deu certo". Um agente pode ter feito metade,
falhado, ou deixado o worktree sujo esperando revisão. No fim do dia, saber o que os agentes
fizeram e o que está parado esperando é valioso — talvez mais que capturar a sessão em que a
pessoa estava presente.

Argumento contra: o agente-interno já escreve o resultado numa issue, então parte dessa informação tem
dono. E amplia a v1.

Registrado em Q-002 para decisão.

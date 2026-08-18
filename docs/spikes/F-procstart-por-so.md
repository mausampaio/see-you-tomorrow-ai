# Spike F — o formato do `procStart` em cada SO

**Status: achados NÃO verificados de forma independente.** Vieram do agente do S1-T2, que foi
interrompido por limite de sessão antes de escrever qualquer teste. O código foi descartado; só a
pesquisa está aqui. Quem retomar o S1-T2 **confirma cada afirmação antes de construir em cima** —
este documento existe para não repetir a investigação, não para dispensar a verificação.

## A pergunta

O `procStart` é o desempate contra reciclagem de PID (D-016): PID vivo mas com horário de início
diferente é **outro** processo. Nós não produzimos esse valor — o Claude Code escreve, nós lemos.

Todas as observações do projeto vinham de **uma máquina Windows**, valor como
`"134313811658518463"`. Ninguém sabia a forma no Linux e no macOS, e sem isso não dá para saber se
o desempate é portável.

## Como foi investigado

Lendo os binários do Claude Code, mesma versão (2.1.234), nas três plataformas. O npm publica
`claude-code-{linux,darwin,win32}-{x64,arm64}` como pacotes separados, então dá para baixar e
inspecionar cada build isoladamente. Mesma técnica do Spike D, aplicada a três builds.

**Nenhum `~/.claude/` real foi lido.** São binários públicos e redistribuíveis, baixados avulsos.

## O que foi encontrado

| SO | Como o Claude Code obtém | Forma do valor |
|---|---|---|
| Linux | `/proc/<pid>/stat`, campo 22 (`starttime`) | só dígitos, **ticks desde o boot** |
| macOS | `ps -o lstart= -p <pid>` | **data legível**, ex. `Mon Aug 17 14:23:01 2026` |
| Windows | `GetProcessTimes` via `bun:ffi` | só dígitos, FILETIME (100ns desde 1601) |

**Os três formatos não se comparam entre si, nunca.** Um `procStart` de Linux e um de macOS não
compartilham nada além do nome do campo. Isso não é problema: o `seeya` só compara um `procStart`
gravado e reobservado **na mesma máquina**.

Repare que Linux e Windows são ambos "só dígitos" mas em escalas completamente diferentes — ticks
desde o boot contra timestamp absoluto. Um teste que valide só "é dígito" passa nos dois e não
prova nada.

### Detalhes que custam caro se ignorados

- **Linux:** o segundo campo de `/proc/<pid>/stat` é o nome do comando entre parênteses e **pode
  conter espaço e parêntese**. Usar `lastIndexOf(')')` — não o primeiro — é o que pula esse campo
  corretamente, e é o que o próprio parser do fornecedor faz.
- **macOS:** rodar o `ps` com `LC_ALL=C` e `TZ=UTC`, senão o formato depende de locale e fuso da
  máquina. Não há caminho alternativo estilo `/proc` nesse build — o `ps` é o único método.
- **Windows:** o build do fornecedor tem caminho rápido por `bun:ffi` (FILETIME nativo, precisão
  cheia) e um fallback por `Get-CimInstance Win32_Process().CreationDate.Ticks` (Ticks do .NET —
  época e magnitude diferentes). O `bun:ffi` é recurso de runtime do Bun, que este adapter em Node
  não tem. Foi medido que o `CreationDate` do CIM vem arredondado a microssegundo, então converter
  Ticks→FILETIME por aritmética **ainda erra os últimos 1-2 dígitos**. Como o Claude Code roda
  normalmente pelo caminho rápido, é com ele que precisamos casar.
  `(Get-Process -Id <pid>).StartTime` convertido para `FileTimeUtc` lê o mesmo `GetProcessTimes`
  nativo: medido lado a lado contra um P/Invoke escrito à mão para a mesma API do Win32, deu
  idêntico bit a bit (`134315072481511624` nos dois) e 15-20x mais rápido que o `Get-CimInstance`.

## Consequência imediata, fora do S1-T2

`src/adapters/discovery/schemas.ts` exige `procStart` casando `/^\d+$/`. Está certo para Windows e
Linux e **rejeitaria todo registro real de macOS**, que é uma data legível. Esse schema já está
integrado no `main`. Ver `docs/QUESTOES.md` Q-006.

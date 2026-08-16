# Spike C — Sessão nova com contexto enxuto, e transcript desativado

**Data:** 2026-08-16 · **Plataforma:** Windows 11

Dois objetivos: medir a alternativa barata ao `--resume` completo (ver Spike A, descoberta 1) e
verificar o comportamento com `--no-session-persistence`.

## Método

`claude -p --model sonnet --no-session-persistence --output-format json <contexto>` num
diretório de rascunho sem `CLAUDE.md`, passando fatos fabricados de uma sessão.

## Resultado

```
exit=0  duracao=33,9s
custo=US$ 0,1539
usage: cache_creation=11948  input=10  output=2349
```

Nenhum arquivo `.jsonl` foi criado em `~/.claude/projects/`.

## Veredito por pergunta

### `--no-session-persistence` de fato não deixa transcript
**Confirmado.** A sessão rodou e não gerou arquivo algum. Se o usuário usar essa flag — ou
qualquer configuração equivalente — a fonte primária de dados do `seeya` simplesmente não
existe. É preciso fallback (ver `docs/ESPECIFICACAO.md`, seção "Sessão sem transcript").

### Custo: piso e teto
| Modo | Tokens de contexto | Custo observado |
|---|---|---|
| `--resume` completo (Spike A) | 82.539 | **US$ 0,497** |
| Sessão nova, contexto enxuto | 11.948 | **US$ 0,154** |

Descoberta relevante: os ~12 k do modo enxuto **não são o nosso contexto** — nosso texto tinha
algumas centenas de tokens. São o system prompt e as definições de ferramenta do próprio Claude
Code. Existe um piso de ~12 k tokens por invocação de `claude -p`, independente do que pedimos.

**Otimização decorrente:** a geração de handoff não precisa de ferramenta nenhuma.
`--tools ""` mais um `--system-prompt` curto deve derrubar boa parte desse piso. Vira tarefa de
implementação em S2-T2, com medição antes/depois.

## Falha do próprio spike, que virou achado

O contexto multilinha foi passado como **argumento de linha de comando** e chegou mutilado ao
modelo: dos três prompts enviados, ele só recebeu a palavra `"Vamos"`. O PowerShell quebrou o
argumento. O resultado gerado é, portanto, lixo — e a comparação de **qualidade** entre os dois
modos não foi medida neste spike. Só o custo e o `--no-session-persistence` valem.

Isso é evidência direta da regra já escrita em `CLAUDE.md`: **nunca montar comando com string
interpolada**. E vai além dela:

> O contexto do handoff é passado por **stdin** ou por **arquivo temporário**, nunca como
> argumento de linha de comando. Argumento tem limite de tamanho e sofre mangling de shell nas
> três plataformas.

Isso entra como regra dura em S2-T2.

## Segundo achado: a saída precisa ser domada

O modelo produziu 2.349 tokens de saída em prosa livre, terminando com uma oferta de "adaptar
para um artifact" — comportamento de agente generalista, não de extrator. Para o handoff:

- `--json-schema` com o esquema do handoff, para saída estruturada e validável;
- `--system-prompt` curto que define o papel como extrator, não assistente;
- `--tools ""` para remover ferramentas.

Sem isso, o custo de saída é volátil e o parsing é frágil. Entra em S2-T2.

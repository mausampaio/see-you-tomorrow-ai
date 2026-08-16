# Spike A — `claude -p --resume --fork-session` sobre sessão viva

**Data:** 2026-08-16 · **Versão do Claude Code:** 2.1.201 (CLI) / 2.1.233 (sessão)
**Plataforma:** Windows 11 · **Pergunta:** Q-001

## Método

A cobaia foi a própria sessão interativa de planejamento, **viva e em execução** durante o
teste (`sessionId 11111111-…`, pid 40001, `cwd c:\code\see-you-tomorrow`), que é exatamente o
cenário de risco.

```
claude -p --resume 11111111-5139-4ec7-ab48-0ab0688323bc --fork-session \
       --model sonnet --output-format json \
       "Responda apenas com uma linha: qual o nome do binario CLI decidido neste projeto e qual a decisao D-001?"
```

Hash SHA-256 e tamanho do transcript original capturados antes e depois.

## Resultado

`exit=0`, 5,55 s de parede, 3,21 s de API.

```json
{"type":"result","subtype":"success","is_error":false,
 "session_id":"22222222-2222-4222-8222-222222222222",
 "result":"O binário se chama `seeya` (D-010); D-001 é: o handoff é sempre gerado por fora da
           sessão viva, via processo headless claude -p --resume <sessionId> --fork-session,
           nunca injetando comando dentro da sessão em execução.",
 "total_cost_usd":0.49659,
 "usage":{"input_tokens":2,"cache_creation_input_tokens":82539,
          "cache_read_input_tokens":0,"output_tokens":90,
          "cache_creation":{"ephemeral_1h_input_tokens":82539}}}
```

A resposta é correta e específica: o processo headless **enxergou a conversa inteira**, incluindo
decisões tomadas minutos antes.

## Veredito por pergunta

| Pergunta | Resposta |
|---|---|
| Funciona com a sessão original viva? | **Sim.** |
| O transcript original é preservado? | **Sim.** Ver verificação abaixo. |
| O fork enxerga a conversa completa? | **Sim.** |
| Latência aceitável? | **Sim.** ~5,5 s por sessão. |

### Verificação da preservação do original

O hash do original mudou, mas isso é ruído: a sessão viva continuou escrevendo os próprios
passos durante o teste. A verificação que vale é onde o prompt do spike aparece:

- **Original:** só em entradas `type=assistant`, que são a sessão viva registrando a própria
  chamada de ferramenta. **Nenhuma entrada `type=user` com o prompt do spike.**
- **Fork:** entrada `type=user` legítima na linha 86, com `sessionId` do fork.

Ou seja, o processo headless escreveu **exclusivamente** no arquivo do fork. D-001 está validado.

## Descobertas não previstas

### 1. Custo por captura é alto — US$ 0,50 por sessão

`cache_creation_input_tokens: 82539` com TTL de 1 h. Retomar a sessão significa reescrever o
contexto inteiro no cache, ao preço de escrita. Uma pergunta de 90 tokens de saída custou
**US$ 0,497**.

Cinco sessões por dia ≈ **US$ 2,50/dia**. Em assinatura, isso não vira fatura, vira consumo do
limite de uso — 400 mil tokens por encerramento é um pedaço relevante da janela do dia.

Isso torna o modo de captura uma decisão de produto, não um detalhe. Ver `docs/DECISOES.md`
D-011.

### 2. O fork duplica o transcript inteiro em disco

O fork gerou `22222222-….jsonl` com 332 KB — cópia integral da conversa. Uma captura diária de
5 sessões deixa ~1,6 MB/dia de transcripts órfãos acumulando em `~/.claude/projects/`.

O `seeya` precisa limpar os forks que ele mesmo criou.

### 3. Risco de laço de realimentação (crítico)

Os forks aparecem em `~/.claude/projects/` como sessões legítimas. Sem tratamento, o
`seeya` descobriria os próprios forks na captura seguinte e tentaria capturá-los — que por sua
vez geram novos forks. **A descoberta precisa excluir os `sessionId` de forks criados pelo
próprio `seeya`**, registrados em `~/.see-you-tomorrow/forks.json`.

## Consequências para o plano

- Q-001 respondida: opção A. D-001 fica como está.
- Nova decisão necessária sobre modo de captura (custo) → D-011.
- S2-T2 ganha: registro e limpeza de forks.
- S1-T3 ganha: exclusão de forks próprios na descoberta.
- `docs/TESTES.md` ganha caso: descoberta ignora sessão listada em `forks.json`.

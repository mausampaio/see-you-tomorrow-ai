/**
 * Schemas zod para as linhas do transcript (`~/.claude/projects/<slug>/<sessionId>.jsonl`). Ver
 * docs/ESPECIFICACAO.md § "Como as sessões são descobertas" e docs/ARQUITETURA.md § transcricao/.
 *
 * O JSONL não é API pública: o Claude Code adiciona tipos de entrada novos com o tempo. Por
 * isso o parser (S1-T4, fora do escopo desta tarefa) sniffa o campo `type` de cada linha e só
 * tenta validar contra um schema conhecido quando reconhece o tipo — tipo desconhecido é
 * ignorado, não é erro. `esquemasDeEntradasConhecidas` aqui documenta exaustivamente todo tipo
 * já observado nesta máquina, mas **não é usado para reprovar** um tipo fora da lista: essa
 * lista é referência para quem escrever o parser, não uma allowlist que o schema impõe.
 *
 * Só `user` e `assistant` têm schema estrutural — são as duas únicas entradas que a spec diz que
 * o parser vai ler ("últimos prompts, arquivos tocados, última atividade"), e são as duas que o
 * contrato de docs/TESTES.md exige validar contra a realidade
 * (tests/contrato/transcript.teste.ts). Confirmado contra 1048 entradas `user` e 1760 `assistant`
 * reais, de todos os projetos desta máquina, sem um campo obrigatório faltando em nenhuma.
 */
import { z } from 'zod';

/**
 * Todo tipo de entrada de linha já observado no `.jsonl` real desta máquina (2.1.233). Meramente
 * documental — ver o aviso acima. Novo tipo aparecendo não é falha de contrato.
 */
export const TIPOS_DE_ENTRADA_CONHECIDOS = [
  'queue-operation',
  'user',
  'assistant',
  'attachment',
  'file-history-snapshot',
  'file-history-delta',
  'ai-title',
  'last-prompt',
  'bridge-session',
  'mode',
  'permission-mode',
  'system',
] as const;

/**
 * Um bloco de `message.content[]`. Só o `type` é validado — é só o que se precisa para
 * diferenciar texto de uso de ferramenta mais adiante; o resto do bloco varia por tipo e por
 * versão e passa despercebido pelo `z.object()` (descartado, não rejeitado).
 */
const esquemaBlocoDeConteudo = z.object({
  type: z.string().min(1),
});

/**
 * `content` observado tanto como string simples (raro, ~3% das entradas) quanto como array de
 * blocos (a maioria). O parser precisa tratar as duas formas.
 */
const esquemaConteudoDaMensagem = z.union([z.string(), z.array(esquemaBlocoDeConteudo)]);

const esquemaMensagem = z.object({
  role: z.string().min(1),
  content: esquemaConteudoDaMensagem,
});

/** Campos comuns às entradas `user` e `assistant`, confirmados presentes nas duas. */
const esquemaBaseDeEntrada = z.object({
  uuid: z.uuid(),
  parentUuid: z.uuid().nullable(),
  isSidechain: z.boolean(),
  sessionId: z.uuid(),
  cwd: z.string().min(1),
  timestamp: z.iso.datetime(),
  message: esquemaMensagem,
});

/**
 * Entrada `type: "user"`. `promptId` é específico de `user` (a entrada `assistant` correspondente
 * tem `requestId` no lugar, não usado ainda) — por isso fica de fora do schema base.
 */
export const esquemaEntradaUser = esquemaBaseDeEntrada.extend({
  type: z.literal('user'),
});

export type EntradaUser = z.infer<typeof esquemaEntradaUser>;

/** Entrada `type: "assistant"`. */
export const esquemaEntradaAssistant = esquemaBaseDeEntrada.extend({
  type: z.literal('assistant'),
});

export type EntradaAssistant = z.infer<typeof esquemaEntradaAssistant>;

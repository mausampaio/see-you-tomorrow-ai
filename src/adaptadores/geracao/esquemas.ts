/**
 * Schema zod para a saída de `claude -p --output-format json` — o que `adaptadores/geracao`
 * usa para obter o entendimento gerado pelo modelo (D-003, D-011). Ver docs/ARQUITETURA.md
 * § geracao/.
 *
 * **Diferença importante em relação aos outros três schemas desta tarefa (S0-T5).** Os schemas
 * de `descoberta/esquemas.ts` e `transcricao/esquemas.ts` foram confirmados linha por linha
 * contra arquivos e comandos reais desta máquina (`tests/contrato/`). Este aqui **não pôde ser
 * confirmado da mesma forma**: `docs/PLANO-DE-ENTREGA.md` e `CLAUDE.md` proíbem qualquer teste
 * que toque a rede, e gerar esta saída exige uma chamada de API real. A forma abaixo é a que o
 * PO levantou nesta máquina e passou como dado de entrada da tarefa — é tratada como a melhor
 * evidência disponível, não como suposição. Segue o mesmo princípio dos outros dois (estrito nos
 * campos que a spec diz que se usa, tolerante com o resto), mas a primeira vez que este schema
 * rodar contra uma saída real de verdade é candidata natural a um teste de contrato novo — não a
 * um afrouxamento preventivo.
 *
 * `type` e `subtype` ficam como string livre, não literal: é a saída documentada do modo
 * `--output-format json` do `claude -p` (D-011, D-015), mas sem confirmação empírica nesta
 * tarefa de que os valores observados aqui esgotam o conjunto possível.
 */
import { z } from 'zod';

const esquemaUso = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative(),
});

export const esquemaSaidaClaudePrint = z.object({
  type: z.string().min(1),
  subtype: z.string().min(1),
  is_error: z.boolean(),
  duration_ms: z.number().nonnegative(),
  num_turns: z.number().int().nonnegative(),
  result: z.string(),
  session_id: z.uuid(),
  total_cost_usd: z.number().nonnegative(),
  usage: esquemaUso,
  // Não detalhados: a spec ainda não define o que o `seeya` extrai deles (D-003 só fala em
  // "entendimento"). Ficam como estrutura mínima tolerante até uma tarefa futura precisar de
  // campo específico — nesse momento eles ganham shape próprio, não `z.unknown()` para sempre.
  modelUsage: z.record(z.string(), z.unknown()),
  permission_denials: z.array(z.unknown()),
  uuid: z.uuid(),
});

export type SaidaClaudePrint = z.infer<typeof esquemaSaidaClaudePrint>;

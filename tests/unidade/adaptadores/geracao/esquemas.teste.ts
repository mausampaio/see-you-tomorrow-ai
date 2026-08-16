import { describe, expect, it } from 'vitest';
import { esquemaSaidaClaudePrint } from '../../../../src/adaptadores/geracao/esquemas.js';

/**
 * Testes de unidade do schema da saída de `claude -p --output-format json` (S0-T5). Fixture
 * sintética moldada na forma que o PO levantou nesta máquina — não pode ser confirmada contra
 * uma chamada real porque nenhum teste deste projeto pode tocar a rede (CLAUDE.md,
 * docs/TESTES.md). Ver o comentário no topo de src/adaptadores/geracao/esquemas.ts.
 */
describe('esquemaSaidaClaudePrint', () => {
  const saidaValida = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 5423,
    num_turns: 1,
    result: 'entendimento gerado pelo modelo',
    session_id: '11111111-2222-4333-8444-555555555555',
    total_cost_usd: 0.1532,
    usage: {
      input_tokens: 12000,
      output_tokens: 340,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 11800,
    },
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 12000, outputTokens: 340 },
    },
    permission_denials: [],
    uuid: '22222222-3333-4444-8555-666666666666',
  };

  it('aceita a saída completa levantada pelo PO', () => {
    const resultado = esquemaSaidaClaudePrint.parse(saidaValida);

    expect(resultado.is_error).toBe(false);
    expect(resultado.usage.input_tokens).toBe(12000);
    expect(resultado.modelUsage).toStrictEqual({
      'claude-sonnet-5': { inputTokens: 12000, outputTokens: 340 },
    });
  });

  it('aceita is_error true com resultado de erro', () => {
    const resultado = esquemaSaidaClaudePrint.parse({
      ...saidaValida,
      is_error: true,
      subtype: 'error_during_execution',
    });

    expect(resultado.is_error).toBe(true);
  });

  it('rejeita saída sem o objeto usage', () => {
    const semUsage: Record<string, unknown> = { ...saidaValida };
    delete semUsage['usage'];
    const resultado = esquemaSaidaClaudePrint.safeParse(semUsage);

    expect(resultado.success).toBe(false);
  });

  it('rejeita session_id que não é uuid', () => {
    const resultado = esquemaSaidaClaudePrint.safeParse({
      ...saidaValida,
      session_id: 'nao-e-uuid',
    });

    expect(resultado.success).toBe(false);
  });

  it('rejeita usage com token negativo', () => {
    const resultado = esquemaSaidaClaudePrint.safeParse({
      ...saidaValida,
      usage: { ...saidaValida.usage, input_tokens: -1 },
    });

    expect(resultado.success).toBe(false);
  });

  it('rejeita is_error que não é boolean', () => {
    const resultado = esquemaSaidaClaudePrint.safeParse({ ...saidaValida, is_error: 'false' });

    expect(resultado.success).toBe(false);
  });
});

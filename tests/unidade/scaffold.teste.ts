import { describe, expect, it } from 'vitest';

/**
 * Teste trivial só para provar que a suíte de unidade roda (S0-T1). Nenhuma lógica de negócio
 * existe ainda — isso entra a partir do Sprint 1.
 */
describe('suíte de testes', () => {
  it('executa e calcula corretamente', () => {
    expect(1 + 1).toBe(2);
  });
});

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Prova que @types/node entrou (S0-T2): fora de nucleo/, node:* é normal, e este arquivo só
 * compila (tsc e o eslint type-aware) porque os tipos de node:fs estão disponíveis. Sem
 * @types/node, `import ... from 'node:fs'` falha em tempo de checagem de tipos (TS2307) — o
 * arquivo nem chegaria a rodar.
 *
 * De propósito, não chama `existsSync` de verdade (nenhum teste de unidade toca disco, ver
 * docs/TESTES.md) — só referencia o símbolo importado, o que já basta para exigir os tipos.
 */
describe('probe: tipos do node', () => {
  it('resolve o tipo de node:fs#existsSync', () => {
    expect(typeof existsSync).toBe('function');
  });
});

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_DO_PROJETO, TIMEOUT_PROCESSO_FILHO, rodarVitestComCobertura } from './_apoio.js';

/**
 * Prova que o limite de cobertura por diretório (docs/TESTES.md, configurado em
 * coverage.thresholds de vitest.config.ts na raiz) REPROVA quando a suíte não cobre o
 * suficiente — não só que o número aparece no relatório.
 *
 * O mecanismo testado é exatamente o do projeto real (vitest + provider v8 + thresholds), mas
 * apontado para duas fixtures isoladas em tests/fixtures/guardas/ em vez da árvore real de
 * src/: escrever um arquivo de produção proposital e sub-coberto dentro de src/ e medir a
 * cobertura real do projeto não daria um teste determinístico (o resultado dependeria de tudo
 * mais que existir em src/ na hora). As fixtures isolam a mesma mecânica com um sujeito
 * mínimo, um caminho com 100% de cobertura e outro com um ramo de propósito não coberto.
 *
 * `TIMEOUT_PROCESSO_FILHO` (S0-T6): também spawna um processo filho de verdade (um vitest run
 * completo com cobertura), mesma classe de flakiness sob carga que os guards de eslint/depcruise.
 */
describe('guard: limite de cobertura reprova quando falta cobertura', () => {
  it(
    'reprova a fixture com um ramo não coberto',
    () => {
      const fixture = path.join(
        RAIZ_DO_PROJETO,
        'tests',
        'fixtures',
        'guardas',
        'cobertura-abaixo-do-limite',
      );

      const resultado = rodarVitestComCobertura(fixture);

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('does not meet');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova a fixture-irmã com os dois ramos cobertos (controle)',
    () => {
      const fixture = path.join(RAIZ_DO_PROJETO, 'tests', 'fixtures', 'guardas', 'cobertura-suficiente');

      const resultado = rodarVitestComCobertura(fixture);

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );
});

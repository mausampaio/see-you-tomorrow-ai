// Configuração do ESLint (flat config). Ver docs/PLANO-DE-ENTREGA.md S0-T1 — guards mais
// fortes (dependency-cruiser, no-restricted-imports para node:* em nucleo/ e para Date/
// setTimeout fora de adaptadores/relogio) entram em S0-T2, não aqui.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
);

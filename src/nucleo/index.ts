/**
 * Core: pure domain rules and ports.
 *
 * Imports no `node:*` nor anything from `aplicacao/`, `cli/` or `adaptadores/`. No I/O, no
 * clock, no network, no process. See docs/ARQUITETURA.md.
 *
 * Convenience barrel (S1-T1). Whoever prefers can import directly from the specific module
 * (e.g. `nucleo/classificacao.js`) — both paths work.
 */
export * from './tipos.js';
export * from './evidencia.js';
export * from './classificacao.js';
export * from './elegibilidade.js';
export * from './encerramento.js';
export * from './portas.js';

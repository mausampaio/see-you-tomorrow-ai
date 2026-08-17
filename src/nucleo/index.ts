/**
 * Núcleo: regras puras e portas do domínio.
 *
 * Não importa `node:*` nem nada de `aplicacao/`, `cli/` ou `adaptadores/`. Sem I/O, sem
 * relógio, sem rede, sem processo. Ver docs/ARQUITETURA.md.
 *
 * Barril de conveniência (S1-T1). Quem preferir, pode importar direto do módulo específico
 * (ex. `nucleo/classificacao.js`) — os dois caminhos funcionam.
 */
export * from './tipos.js';
export * from './tempo.js';
export * from './classificacao.js';
export * from './elegibilidade.js';
export * from './encerramento.js';
export * from './portas.js';

import type { SessaoComPid, SessaoSemPid } from '../../../src/nucleo/tipos.js';

/**
 * Fábricas de `SessaoDescoberta` para os testes de `nucleo/` (S1-T1). Valores sintéticos —
 * UUIDs só com os dígitos 1/2/4/8 (CLAUDE.md § "Este projeto é de código aberto"), nunca dado
 * real.
 *
 * `Omit<..., 'temPid'>` no parâmetro de sobrescritas, com `temPid` fixado depois do espalhamento:
 * isso garante que o literal `true`/`false` do discriminante nunca vira `boolean` genérico por
 * causa de `Partial<SessaoComPid>` alargar o tipo do campo — armadilha comum ao criar fábricas de
 * teste para união discriminada.
 */
export function criarSessaoComPid(
  sobrescritas: Partial<Omit<SessaoComPid, 'temPid'>> = {},
): SessaoComPid {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: 'c:\\code\\projeto',
    nome: 'projeto-01',
    pid: 4242,
    procStart: '123456789',
    processoEstaVivo: true,
    temTranscript: true,
    ultimaEscritaNoTranscript: new Date('2026-08-16T20:00:00.000Z'),
    ultimaAtividade: new Date('2026-08-16T20:00:00.000Z'),
    ...sobrescritas,
    temPid: true,
  };
}

export function criarSessaoSemPid(
  sobrescritas: Partial<Omit<SessaoSemPid, 'temPid'>> = {},
): SessaoSemPid {
  return {
    sessionId: '22222222-2222-4222-8222-222222222222',
    cwd: 'c:\\code\\outro-projeto',
    nome: 'outro-projeto-02',
    temTranscript: true,
    ultimaEscritaNoTranscript: new Date('2026-08-16T20:00:00.000Z'),
    ultimaAtividade: new Date('2026-08-16T20:00:00.000Z'),
    ...sobrescritas,
    temPid: false,
  };
}

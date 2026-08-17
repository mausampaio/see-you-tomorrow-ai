import { describe, expect, it } from 'vitest';
import {
  avaliarElegibilidade,
  type CriteriosDeElegibilidade,
} from '../../../src/nucleo/elegibilidade.js';
import { criarSessaoComPid } from './_fixtures.js';

const AGORA = new Date('2026-08-16T20:00:00.000Z');

function criterios(sobrescritas: Partial<CriteriosDeElegibilidade> = {}): CriteriosDeElegibilidade {
  return {
    agora: AGORA,
    horasDeRelevancia: 12,
    cwdsIgnorados: new Set<string>(),
    forksConhecidos: new Set<string>(),
    capturaAnteriorHoje: null,
    ...sobrescritas,
  };
}

describe('avaliarElegibilidade', () => {
  it('sessão que passa nas cinco condições é elegível, sem motivos', () => {
    const sessao = criarSessaoComPid({ ultimaAtividade: new Date('2026-08-16T10:00:00.000Z') });

    const resultado = avaliarElegibilidade(sessao, criterios());

    expect(resultado).toStrictEqual({ elegivel: true, motivos: [] });
  });

  describe('condição 1 — pelo menos uma fonte de evidência respondeu', () => {
    it('ultimaAtividade nula (nenhuma fonte respondeu) torna a sessão inelegível', () => {
      const sessao = criarSessaoComPid({ ultimaAtividade: null });

      const resultado = avaliarElegibilidade(sessao, criterios());

      expect(resultado.elegivel).toBe(false);
      expect(resultado.motivos).toStrictEqual(['semEvidencia']);
    });
  });

  describe('condição 2 — atividade dentro de horasDeRelevancia', () => {
    it('atividade exatamente no limite de horasDeRelevancia ainda é elegível (estritamente >)', () => {
      const exatamenteDozeHorasAtras = new Date(AGORA.getTime() - 12 * 3_600_000);
      const sessao = criarSessaoComPid({ ultimaAtividade: exatamenteDozeHorasAtras });

      const resultado = avaliarElegibilidade(sessao, criterios({ horasDeRelevancia: 12 }));

      expect(resultado.elegivel).toBe(true);
    });

    it('atividade um milissegundo além do limite já é inelegível', () => {
      const umMsAlemDoLimite = new Date(AGORA.getTime() - (12 * 3_600_000 + 1));
      const sessao = criarSessaoComPid({ ultimaAtividade: umMsAlemDoLimite });

      const resultado = avaliarElegibilidade(sessao, criterios({ horasDeRelevancia: 12 }));

      expect(resultado.elegivel).toBe(false);
      expect(resultado.motivos).toStrictEqual(['semAtividadeRecente']);
    });

    it('semEvidencia e semAtividadeRecente nunca aparecem juntos (são as duas faces do mesmo campo)', () => {
      const sessao = criarSessaoComPid({ ultimaAtividade: null });

      const resultado = avaliarElegibilidade(sessao, criterios());

      expect(resultado.motivos).not.toContain('semAtividadeRecente');
    });
  });

  describe('condição 3 — não é fork do próprio seeya (D-012)', () => {
    it('sessionId presente em forksConhecidos torna a sessão inelegível', () => {
      const sessao = criarSessaoComPid({ sessionId: '33333333-3333-4333-8333-333333333333' });

      const resultado = avaliarElegibilidade(
        sessao,
        criterios({ forksConhecidos: new Set(['33333333-3333-4333-8333-333333333333']) }),
      );

      expect(resultado.elegivel).toBe(false);
      expect(resultado.motivos).toStrictEqual(['forkDoProprioSeeya']);
    });

    it('fork conhecido mas de sessionId diferente não afeta a elegibilidade', () => {
      const sessao = criarSessaoComPid({ sessionId: '44444444-4444-4444-8444-444444444444' });

      const resultado = avaliarElegibilidade(
        sessao,
        criterios({ forksConhecidos: new Set(['99999999-9999-4999-8999-999999999999']) }),
      );

      expect(resultado.elegivel).toBe(true);
    });
  });

  describe('condição 4 — cwd não está na lista ignorar', () => {
    it('cwd presente em cwdsIgnorados torna a sessão inelegível', () => {
      const sessao = criarSessaoComPid({ cwd: 'c:\\code\\rascunhos' });

      const resultado = avaliarElegibilidade(
        sessao,
        criterios({ cwdsIgnorados: new Set(['c:\\code\\rascunhos']) }),
      );

      expect(resultado.elegivel).toBe(false);
      expect(resultado.motivos).toStrictEqual(['cwdIgnorado']);
    });

    it('combinação de borda: sessão relevante (atividade recente) mas cwd ignorado', () => {
      const sessao = criarSessaoComPid({
        cwd: 'c:\\code\\rascunhos',
        ultimaAtividade: new Date('2026-08-16T19:59:00.000Z'), // 1 minuto atrás — bem relevante
      });

      const resultado = avaliarElegibilidade(
        sessao,
        criterios({ cwdsIgnorados: new Set(['c:\\code\\rascunhos']) }),
      );

      expect(resultado.elegivel).toBe(false);
      expect(resultado.motivos).toStrictEqual(['cwdIgnorado']);
    });
  });

  describe('condição 5 — anti-duplicidade (handoff do dia com transcript inalterado)', () => {
    it('sem captura anterior hoje, a sessão é elegível independente do transcript', () => {
      const sessao = criarSessaoComPid();

      const resultado = avaliarElegibilidade(sessao, criterios({ capturaAnteriorHoje: null }));

      expect(resultado.elegivel).toBe(true);
    });

    it('handoff de hoje com transcript inalterado desde então torna a sessão inelegível', () => {
      const escritaNoTranscript = new Date('2026-08-16T18:00:00.000Z');
      const sessao = criarSessaoComPid({ ultimaEscritaNoTranscript: escritaNoTranscript });

      const resultado = avaliarElegibilidade(
        sessao,
        criterios({
          capturaAnteriorHoje: { ultimaEscritaNoTranscriptNaCaptura: escritaNoTranscript },
        }),
      );

      expect(resultado.elegivel).toBe(false);
      expect(resultado.motivos).toStrictEqual(['duplicadaNoDia']);
    });

    it(
      'combinação de borda: handoff do dia existe mas o transcript mudou desde então — ' +
        'volta a ser elegível',
      () => {
        const sessao = criarSessaoComPid({
          ultimaEscritaNoTranscript: new Date('2026-08-16T19:50:00.000Z'),
        });

        const resultado = avaliarElegibilidade(
          sessao,
          criterios({
            capturaAnteriorHoje: {
              ultimaEscritaNoTranscriptNaCaptura: new Date('2026-08-16T18:00:00.000Z'),
            },
          }),
        );

        expect(resultado.elegivel).toBe(true);
      },
    );

    it('duas capturas sem transcript (null nas duas) contam como inalterado — duplicada', () => {
      const sessao = criarSessaoComPid({
        temTranscript: false,
        ultimaEscritaNoTranscript: null,
      });

      const resultado = avaliarElegibilidade(
        sessao,
        criterios({ capturaAnteriorHoje: { ultimaEscritaNoTranscriptNaCaptura: null } }),
      );

      expect(resultado.elegivel).toBe(false);
      expect(resultado.motivos).toStrictEqual(['duplicadaNoDia']);
    });
  });

  it('acumula todos os motivos aplicáveis, não só o primeiro', () => {
    const sessao = criarSessaoComPid({
      sessionId: '55555555-5555-4555-8555-555555555555',
      cwd: 'c:\\code\\rascunhos',
      ultimaAtividade: null,
    });

    const resultado = avaliarElegibilidade(
      sessao,
      criterios({
        forksConhecidos: new Set(['55555555-5555-4555-8555-555555555555']),
        cwdsIgnorados: new Set(['c:\\code\\rascunhos']),
      }),
    );

    expect(resultado.elegivel).toBe(false);
    expect(resultado.motivos).toStrictEqual(
      expect.arrayContaining(['semEvidencia', 'forkDoProprioSeeya', 'cwdIgnorado']),
    );
    expect(resultado.motivos).toHaveLength(3);
  });
});

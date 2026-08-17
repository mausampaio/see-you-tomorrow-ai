import { describe, expect, it } from 'vitest';
import { mesmaEvidencia } from '../../../src/nucleo/evidencia.js';

describe('mesmaEvidencia', () => {
  it('as duas assinaturas vazias não são "a mesma evidência" — nada para confirmar (D-025)', () => {
    expect(mesmaEvidencia({}, {})).toBe(false);
  });

  it('uma fonte com o mesmo valor nos dois lados confirma a mesma evidência', () => {
    expect(mesmaEvidencia({ transcript: 'abc' }, { transcript: 'abc' })).toBe(true);
  });

  it('uma fonte com valores diferentes indica que a evidência mudou', () => {
    expect(mesmaEvidencia({ transcript: 'abc' }, { transcript: 'def' })).toBe(false);
  });

  it('fonte ausente (null) nos dois lados não decide nada — passa às demais (D-025/D-026)', () => {
    // transcript ausente nas duas capturas; git é a única fonte com valor e é igual nas duas.
    expect(
      mesmaEvidencia({ transcript: null, git: 'sha-1' }, { transcript: null, git: 'sha-1' }),
    ).toBe(true);
  });

  it(
    'duas capturas sem transcript, com git alterado entre elas, NÃO são a mesma evidência ' +
      '(D-026 — o caso do agente de execução autônomo)',
    () => {
      expect(
        mesmaEvidencia({ transcript: null, git: 'sha-1' }, { transcript: null, git: 'sha-2' }),
      ).toBe(false);
    },
  );

  it('todas as fontes ausentes (null) nos dois lados não confirmam nada — não é a mesma evidência', () => {
    expect(mesmaEvidencia({ transcript: null, git: null }, { transcript: null, git: null })).toBe(
      false,
    );
  });

  it('fonte que aparece (ausente antes, presente agora) conta como mudança', () => {
    expect(mesmaEvidencia({ transcript: null }, { transcript: 'abc' })).toBe(false);
  });

  it('fonte que desaparece (presente antes, ausente agora) conta como mudança', () => {
    expect(mesmaEvidencia({ transcript: 'abc' }, { transcript: null })).toBe(false);
  });

  it('chave presente só num dos dois objetos é tratada como ausente no outro', () => {
    expect(mesmaEvidencia({ transcript: 'abc' }, {})).toBe(false);
    expect(mesmaEvidencia({}, { transcript: 'abc' })).toBe(false);
  });

  it('múltiplas fontes: uma confirma, mas outra muda — resultado é "mudou" (curto-circuito)', () => {
    expect(
      mesmaEvidencia(
        { transcript: 'abc', git: 'sha-1' },
        { transcript: 'abc', git: 'sha-2' },
      ),
    ).toBe(false);
  });

  it('múltiplas fontes, todas iguais — resultado é "mesma evidência"', () => {
    expect(
      mesmaEvidencia(
        { transcript: 'abc', git: 'sha-1', registro: 'nome-x' },
        { transcript: 'abc', git: 'sha-1', registro: 'nome-x' },
      ),
    ).toBe(true);
  });
});

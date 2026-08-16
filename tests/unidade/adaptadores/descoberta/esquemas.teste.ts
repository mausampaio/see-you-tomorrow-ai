import { describe, expect, it } from 'vitest';
import {
  esquemaRegistroDeSessao,
  esquemaSaidaAgentsJson,
} from '../../../../src/adaptadores/descoberta/esquemas.js';

/**
 * Testes de unidade dos schemas de descoberta (S0-T5). Fixtures sintéticas, não os arquivos
 * reais desta máquina — a confirmação contra a realidade é papel de tests/contrato/, não desta
 * suíte (que precisa rodar sem tocar `~/.claude`, conforme docs/TESTES.md).
 */
describe('esquemaRegistroDeSessao', () => {
  const registroValido = {
    pid: 12345,
    sessionId: '11111111-2222-4333-8444-555555555555',
    cwd: 'c:\\code\\projeto',
    startedAt: 1755360000000,
    procStart: '999999000011112222',
    version: '2.1.233',
    kind: 'interactive',
    entrypoint: 'cli',
    name: 'projeto-03',
    nameSource: 'derived',
    nameSince: 1755360000001,
  };

  it('aceita um registro real e descarta campos desconhecidos silenciosamente', () => {
    const resultado = esquemaRegistroDeSessao.parse(registroValido);

    expect(resultado).toStrictEqual({
      pid: 12345,
      sessionId: '11111111-2222-4333-8444-555555555555',
      cwd: 'c:\\code\\projeto',
      kind: 'interactive',
      entrypoint: 'cli',
      startedAt: 1755360000000,
      procStart: '999999000011112222',
      name: 'projeto-03',
    });
    expect(resultado).not.toHaveProperty('version');
    expect(resultado).not.toHaveProperty('nameSource');
  });

  it('aceita procStart com precisão maior que Number.MAX_SAFE_INTEGER, como string', () => {
    const procStartGigante = '999999999999999999999';
    const resultado = esquemaRegistroDeSessao.parse({
      ...registroValido,
      procStart: procStartGigante,
    });

    expect(resultado.procStart).toBe(procStartGigante);
  });

  it('rejeita procStart que não seja só dígitos', () => {
    const resultado = esquemaRegistroDeSessao.safeParse({
      ...registroValido,
      procStart: '134313811658518463n',
    });

    expect(resultado.success).toBe(false);
  });

  it('rejeita sessionId que não é uuid', () => {
    const resultado = esquemaRegistroDeSessao.safeParse({
      ...registroValido,
      sessionId: 'nao-e-um-uuid',
    });

    expect(resultado.success).toBe(false);
  });

  it('rejeita registro sem pid', () => {
    const semPid: Record<string, unknown> = { ...registroValido };
    delete semPid['pid'];
    const resultado = esquemaRegistroDeSessao.safeParse(semPid);

    expect(resultado.success).toBe(false);
  });

  it('rejeita cwd vazio', () => {
    const resultado = esquemaRegistroDeSessao.safeParse({ ...registroValido, cwd: '' });

    expect(resultado.success).toBe(false);
  });
});

describe('esquemaSaidaAgentsJson', () => {
  it('aceita array com item que tem status e item sem status', () => {
    const resultado = esquemaSaidaAgentsJson.parse([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        kind: 'interactive',
        startedAt: 1755360000000,
        sessionId: '11111111-2222-4333-8444-555555555555',
        name: 'projeto-03',
        status: 'busy',
      },
      {
        pid: 67890,
        cwd: 'c:\\code\\outro-projeto',
        kind: 'interactive',
        startedAt: 1755360100000,
        sessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
        name: 'outro-projeto-24',
      },
    ]);

    expect(resultado).toHaveLength(2);
    expect(resultado[0]?.status).toBe('busy');
    expect(resultado[1]?.status).toBeUndefined();
  });

  it('aceita array vazio (nenhuma sessão ativa)', () => {
    expect(esquemaSaidaAgentsJson.parse([])).toStrictEqual([]);
  });

  it('rejeita item sem sessionId', () => {
    const resultado = esquemaSaidaAgentsJson.safeParse([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        kind: 'interactive',
        startedAt: 1755360000000,
        name: 'projeto-03',
      },
    ]);

    expect(resultado.success).toBe(false);
  });
});

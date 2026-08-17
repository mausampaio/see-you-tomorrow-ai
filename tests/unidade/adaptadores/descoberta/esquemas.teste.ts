import { describe, expect, it } from 'vitest';
import {
  esquemaRegistroDeSessao,
  validarSaidaAgentsJson,
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

  it('rejeita registro sem sessionId (D-021: identidade continua obrigatória)', () => {
    const semSessionId: Record<string, unknown> = { ...registroValido };
    delete semSessionId['sessionId'];
    const resultado = esquemaRegistroDeSessao.safeParse(semSessionId);

    expect(resultado.success).toBe(false);
  });

  it('rejeita registro sem cwd (D-021: identidade continua obrigatória)', () => {
    const semCwd: Record<string, unknown> = { ...registroValido };
    delete semCwd['cwd'];
    const resultado = esquemaRegistroDeSessao.safeParse(semCwd);

    expect(resultado.success).toBe(false);
  });

  it('aceita registro sem name (D-021: campo de exibição não pode ocultar a sessão)', () => {
    const semName: Record<string, unknown> = { ...registroValido };
    delete semName['name'];
    const resultado = esquemaRegistroDeSessao.safeParse(semName);

    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.name).toBeUndefined();
  });

  it('aceita registro sem entrypoint (D-021: campo de exibição não pode ocultar a sessão)', () => {
    const semEntrypoint: Record<string, unknown> = { ...registroValido };
    delete semEntrypoint['entrypoint'];
    const resultado = esquemaRegistroDeSessao.safeParse(semEntrypoint);

    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.entrypoint).toBeUndefined();
  });

  it('aceita registro sem kind (D-021: campo de exibição não pode ocultar a sessão)', () => {
    const semKind: Record<string, unknown> = { ...registroValido };
    delete semKind['kind'];
    const resultado = esquemaRegistroDeSessao.safeParse(semKind);

    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.kind).toBeUndefined();
  });

  it('aceita registro sem os três campos de exibição ao mesmo tempo', () => {
    const soIdentidade: Record<string, unknown> = { ...registroValido };
    delete soIdentidade['name'];
    delete soIdentidade['entrypoint'];
    delete soIdentidade['kind'];
    const resultado = esquemaRegistroDeSessao.safeParse(soIdentidade);

    expect(resultado.success).toBe(true);
  });
});

describe('validarSaidaAgentsJson', () => {
  it('aceita array com item que tem status e item sem status', () => {
    const resultado = validarSaidaAgentsJson([
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

    expect(resultado.aceitos).toHaveLength(2);
    expect(resultado.rejeitados).toHaveLength(0);
    expect(resultado.aceitos[0]?.status).toBe('busy');
    expect(resultado.aceitos[1]?.status).toBeUndefined();
  });

  it('aceita array vazio (nenhuma sessão ativa)', () => {
    expect(validarSaidaAgentsJson([])).toStrictEqual({ aceitos: [], rejeitados: [] });
  });

  it('rejeita item sem sessionId, sem derrubar o array (D-022)', () => {
    const resultado = validarSaidaAgentsJson([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        kind: 'interactive',
        startedAt: 1755360000000,
        name: 'projeto-03',
      },
    ]);

    expect(resultado.aceitos).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(1);
  });

  it('rejeita item sem cwd (D-021: identidade continua obrigatória)', () => {
    const resultado = validarSaidaAgentsJson([
      {
        pid: 12345,
        kind: 'interactive',
        startedAt: 1755360000000,
        sessionId: '11111111-2222-4333-8444-555555555555',
        name: 'projeto-03',
      },
    ]);

    expect(resultado.aceitos).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(1);
  });

  it('aceita item sem name e sem kind (D-021: exibição não pode ocultar a sessão)', () => {
    const resultado = validarSaidaAgentsJson([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        startedAt: 1755360000000,
        sessionId: '11111111-2222-4333-8444-555555555555',
      },
    ]);

    expect(resultado.aceitos).toHaveLength(1);
    expect(resultado.rejeitados).toHaveLength(0);
  });

  /**
   * A forma real observada na segunda máquina (Linux) que derrubava o array inteiro antes desta
   * tarefa (S1-T0c, D-022). Valores literais do fixture anonimizado descrito na tarefa —
   * `<usuario>` como placeholder de home e UUID obviamente sintético (só 3 símbolos distintos:
   * 1, 4, 8), conforme CLAUDE.md § "Este projeto é de código aberto".
   */
  const amostraDeBackgroundDaSegundaMaquina = {
    id: '11111111',
    cwd: '/home/<usuario>/.claude/agente/ui',
    kind: 'background',
    startedAt: 1780000000000,
    sessionId: '11111111-1111-4111-8111-111111111111',
    name: 'sessao de background',
    state: 'blocked',
  };

  it('aceita a variante de background sem pid, preservando id e state (D-022)', () => {
    const resultado = validarSaidaAgentsJson([amostraDeBackgroundDaSegundaMaquina]);

    expect(resultado.rejeitados).toHaveLength(0);
    expect(resultado.aceitos).toHaveLength(1);
    expect(resultado.aceitos[0]).toStrictEqual({
      id: '11111111',
      cwd: '/home/<usuario>/.claude/agente/ui',
      kind: 'background',
      startedAt: 1780000000000,
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'sessao de background',
      state: 'blocked',
    });
    expect(resultado.aceitos[0]?.pid).toBeUndefined();
  });

  it('array com uma entrada boa e uma inválida devolve a boa e reporta a outra com motivo (D-022)', () => {
    const itemValido = {
      pid: 12345,
      cwd: 'c:\\code\\projeto',
      kind: 'interactive',
      startedAt: 1755360000000,
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'projeto-03',
    };
    const itemInvalido = { cwd: 'c:\\code\\outro-projeto', startedAt: 1755360100000 }; // sem sessionId

    const resultado = validarSaidaAgentsJson([itemValido, itemInvalido]);

    expect(resultado.aceitos).toHaveLength(1);
    expect(resultado.aceitos[0]?.sessionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(resultado.rejeitados).toHaveLength(1);
    expect(resultado.rejeitados[0]?.bruto).toStrictEqual(itemInvalido);
    expect(resultado.rejeitados[0]?.motivo).toEqual(expect.any(String));
    expect(resultado.rejeitados[0]?.motivo.length).toBeGreaterThan(0);
  });

  it('mistura a variante interativa e a de background no mesmo array (D-022)', () => {
    const resultado = validarSaidaAgentsJson([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        kind: 'interactive',
        startedAt: 1755360000000,
        sessionId: '33333333-3333-4333-8333-333333333333',
        name: 'projeto-03',
        status: 'busy',
      },
      amostraDeBackgroundDaSegundaMaquina,
    ]);

    expect(resultado.aceitos).toHaveLength(2);
    expect(resultado.rejeitados).toHaveLength(0);
  });

  it('não lança e reporta um único rejeitado quando o valor nem é um array', () => {
    const resultado = validarSaidaAgentsJson({ isto: 'não é um array' });

    expect(resultado.aceitos).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(1);
  });
});

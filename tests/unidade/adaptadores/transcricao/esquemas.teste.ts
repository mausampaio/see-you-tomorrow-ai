import { describe, expect, it } from 'vitest';
import {
  esquemaEntradaAssistant,
  esquemaEntradaUser,
  TIPOS_DE_ENTRADA_CONHECIDOS,
} from '../../../../src/adaptadores/transcricao/esquemas.js';

/**
 * Testes de unidade dos schemas de transcrição (S0-T5). Fixtures sintéticas moldadas na
 * estrutura observada nos `.jsonl` reais desta máquina, mas com uuids e caminho genéricos — a
 * confirmação contra o arquivo real é papel de tests/contrato/transcript.teste.ts.
 */
describe('esquemaEntradaUser', () => {
  const entradaValida = {
    parentUuid: null,
    isSidechain: false,
    promptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    type: 'user' as const,
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Faça X' }],
    },
    uuid: '11111111-2222-4333-8444-555555555555',
    timestamp: '2026-08-16T20:41:11.000Z',
    sessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    cwd: 'c:\\code\\projeto',
    entrypoint: 'cli',
    gitBranch: 'main',
    version: '2.1.233',
  };

  it('aceita uma entrada real com content em array e descarta campos não usados', () => {
    const resultado = esquemaEntradaUser.parse(entradaValida);

    expect(resultado.type).toBe('user');
    expect(resultado.parentUuid).toBeNull();
    expect(resultado).not.toHaveProperty('gitBranch');
    expect(resultado).not.toHaveProperty('promptId');
  });

  it('aceita content como string simples (forma observada com menos frequência)', () => {
    const resultado = esquemaEntradaUser.parse({
      ...entradaValida,
      message: { role: 'user', content: 'texto simples' },
    });

    expect(resultado.message.content).toBe('texto simples');
  });

  it('aceita parentUuid não nulo, encadeando para outra entrada', () => {
    const resultado = esquemaEntradaUser.parse({
      ...entradaValida,
      parentUuid: '99999999-8888-4777-8666-555555555555',
    });

    expect(resultado.parentUuid).toBe('99999999-8888-4777-8666-555555555555');
  });

  it('rejeita type diferente de "user"', () => {
    const resultado = esquemaEntradaUser.safeParse({ ...entradaValida, type: 'assistant' });

    expect(resultado.success).toBe(false);
  });

  it('rejeita uuid mal formado', () => {
    const resultado = esquemaEntradaUser.safeParse({ ...entradaValida, uuid: 'nao-e-uuid' });

    expect(resultado.success).toBe(false);
  });

  it('rejeita bloco de conteúdo sem "type"', () => {
    const resultado = esquemaEntradaUser.safeParse({
      ...entradaValida,
      message: { role: 'user', content: [{ text: 'sem type' }] },
    });

    expect(resultado.success).toBe(false);
  });
});

describe('esquemaEntradaAssistant', () => {
  const entradaValida = {
    parentUuid: '11111111-2222-4333-8444-555555555555',
    isSidechain: false,
    type: 'assistant' as const,
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '...' },
        { type: 'text', text: 'resposta' },
        { type: 'tool_use', name: 'Read', input: {} },
      ],
      id: 'msg_123',
      model: 'claude-sonnet-5',
    },
    uuid: '22222222-3333-4444-8555-666666666666',
    timestamp: '2026-08-16T20:41:12.000Z',
    sessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    cwd: 'c:\\code\\projeto',
    requestId: 'req_abc',
    effort: 'medium',
  };

  it('aceita uma entrada assistant real, sem promptId, e descarta o que não é usado', () => {
    const resultado = esquemaEntradaAssistant.parse(entradaValida);

    expect(resultado.type).toBe('assistant');
    expect(resultado).not.toHaveProperty('requestId');
    expect(resultado).not.toHaveProperty('effort');
  });

  it('rejeita entrada sem sessionId', () => {
    const semSessionId: Record<string, unknown> = { ...entradaValida };
    delete semSessionId['sessionId'];
    const resultado = esquemaEntradaAssistant.safeParse(semSessionId);

    expect(resultado.success).toBe(false);
  });

  it('rejeita timestamp fora do formato ISO com milissegundos', () => {
    const resultado = esquemaEntradaAssistant.safeParse({
      ...entradaValida,
      timestamp: '2026-08-16T20:41:12+00:00',
    });

    expect(resultado.success).toBe(false);
  });
});

describe('TIPOS_DE_ENTRADA_CONHECIDOS', () => {
  it('lista os doze tipos observados na máquina real, incluindo user e assistant', () => {
    expect(TIPOS_DE_ENTRADA_CONHECIDOS).toHaveLength(12);
    expect(TIPOS_DE_ENTRADA_CONHECIDOS).toContain('user');
    expect(TIPOS_DE_ENTRADA_CONHECIDOS).toContain('assistant');
  });
});

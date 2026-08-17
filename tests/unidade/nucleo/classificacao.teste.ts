import { describe, expect, it } from 'vitest';
import {
  classificarEstado,
  pidRepresentaMesmoProcesso,
  type ParametrosDeClassificacao,
} from '../../../src/nucleo/classificacao.js';
import { criarSessaoComPid, criarSessaoSemPid } from './_fixtures.js';

const AGORA = new Date('2026-08-16T20:45:00.000Z');
const PARAMETROS_PADRAO: ParametrosDeClassificacao = { agora: AGORA, minutosParaOcioso: 45 };

describe('classificarEstado', () => {
  it('sessão sem PID é sempre "desconhecida" (D-016), independente de qualquer outro campo', () => {
    const sessao = criarSessaoSemPid({
      ultimaEscritaNoTranscript: AGORA,
      ultimaAtividade: AGORA,
    });

    expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('desconhecida');
  });

  it('sessão sem PID e sem transcript nenhum também é "desconhecida", não "encerrada"', () => {
    const sessao = criarSessaoSemPid({
      temTranscript: false,
      ultimaEscritaNoTranscript: null,
    });

    expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('desconhecida');
  });

  it('processo com PID mas não vivo é "encerrada" (entrada obsoleta, D-016)', () => {
    const sessao = criarSessaoComPid({
      processoEstaVivo: false,
      ultimaEscritaNoTranscript: AGORA, // mesmo com transcript recente, morto é morto
    });

    expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('encerrada');
  });

  it('processo vivo com escrita no transcript dentro da janela é "viva"', () => {
    const dezMinutosAtras = new Date(AGORA.getTime() - 10 * 60_000);
    const sessao = criarSessaoComPid({
      processoEstaVivo: true,
      ultimaEscritaNoTranscript: dezMinutosAtras,
    });

    expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('viva');
  });

  it('processo vivo sem escrita há mais que minutosParaOcioso é "ociosa"', () => {
    const cinquentaMinutosAtras = new Date(AGORA.getTime() - 50 * 60_000);
    const sessao = criarSessaoComPid({
      processoEstaVivo: true,
      ultimaEscritaNoTranscript: cinquentaMinutosAtras,
    });

    expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('ociosa');
  });

  it('borda: exatamente minutosParaOcioso de silêncio ainda é "viva" (estritamente >)', () => {
    const exatosQuarentaECincoMinutosAtras = new Date(AGORA.getTime() - 45 * 60_000);
    const sessao = criarSessaoComPid({
      processoEstaVivo: true,
      ultimaEscritaNoTranscript: exatosQuarentaECincoMinutosAtras,
    });

    expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('viva');
  });

  it('borda: um milissegundo além de minutosParaOcioso já é "ociosa"', () => {
    const umMsAlemDoLimite = new Date(AGORA.getTime() - (45 * 60_000 + 1));
    const sessao = criarSessaoComPid({
      processoEstaVivo: true,
      ultimaEscritaNoTranscript: umMsAlemDoLimite,
    });

    expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('ociosa');
  });

  /**
   * D-025: ausência de dado não vira afirmação sobre o mundo. Os dois casos sempre juntos — sem
   * o primeiro, alguém "otimiza" a checagem de volta para tratar `null` como se fosse um
   * timestamp antigo.
   */
  describe('D-025 — null não é evidência de ociosidade', () => {
    it('processo vivo sem transcript nenhum (null) é "viva", não "ociosa"', () => {
      const sessao = criarSessaoComPid({
        processoEstaVivo: true,
        temTranscript: false,
        ultimaEscritaNoTranscript: null,
      });

      expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('viva');
    });

    it('processo vivo com timestamp real além do limite continua "ociosa"', () => {
      const cinquentaMinutosAtras = new Date(AGORA.getTime() - 50 * 60_000);
      const sessao = criarSessaoComPid({
        processoEstaVivo: true,
        temTranscript: true,
        ultimaEscritaNoTranscript: cinquentaMinutosAtras,
      });

      expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('ociosa');
    });
  });
});

describe('pidRepresentaMesmoProcesso', () => {
  it('procStart idênticos representam o mesmo processo', () => {
    expect(pidRepresentaMesmoProcesso('134313811658518463', '134313811658518463')).toBe(true);
  });

  it('procStart divergentes indicam PID reciclado pelo SO — processo diferente', () => {
    expect(pidRepresentaMesmoProcesso('134313811658518463', '999999999999999999')).toBe(false);
  });

  it(
    'uso combinado: PID "vivo" no SO mas com procStart divergente do registrado vira ' +
      '"encerrada" na classificação (docs/TESTES.md: liveness com PID reciclado)',
    () => {
      const procStartRegistrado = '134313811658518463';
      const procStartObservadoAgora = '999999999999999999'; // outro processo reaproveitou o PID

      const mesmoProcesso = pidRepresentaMesmoProcesso(
        procStartRegistrado,
        procStartObservadoAgora,
      );
      expect(mesmoProcesso).toBe(false);

      // `processoEstaVivo` é o resultado, já resolvido, de ControleDeProcesso.estaVivo(pid,
      // procStart) — aqui simulado como o resultado do desempate acima: PID existe no SO, mas
      // não é o mesmo processo, logo `estaVivo` teria devolvido `false`.
      const sessao = criarSessaoComPid({
        procStart: procStartRegistrado,
        processoEstaVivo: mesmoProcesso,
      });

      expect(classificarEstado(sessao, PARAMETROS_PADRAO)).toBe('encerrada');
    },
  );
});

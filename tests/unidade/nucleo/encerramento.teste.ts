import { describe, expect, it } from 'vitest';
import { dadosParaEncerrarProcesso } from '../../../src/nucleo/encerramento.js';
import type { SessaoComPid, SessaoDescoberta, SessaoSemPid } from '../../../src/nucleo/tipos.js';
import { criarSessaoComPid, criarSessaoSemPid } from './_fixtures.js';

/**
 * Prova de D-024: `dadosParaEncerrarProcesso` aceita exclusivamente `SessaoComPid`. O compilador,
 * não um comentário, é quem recusa as outras formas — sem `!`, sem `as`, em lugar nenhum destes
 * testes. `tsc -p tsconfig.json --noEmit` (parte de `npm run verificar`) type-checa este arquivo:
 * se qualquer `@ts-expect-error` abaixo deixar de encontrar um erro real, a diretiva vira "não
 * usada" e a checagem de tipos falha — é isso que torna este teste "impossível de compilar" na
 * prática, conforme docs/PLANO-DE-ENTREGA.md S1-T1 pede.
 */
describe('dadosParaEncerrarProcesso (D-024)', () => {
  it('aceita SessaoComPid e devolve pid + procStart', () => {
    const sessao = criarSessaoComPid({ pid: 9999, procStart: '111222333' });

    expect(dadosParaEncerrarProcesso(sessao)).toStrictEqual({ pid: 9999, procStart: '111222333' });
  });

  it('SessaoDescoberta (a união, sem estreitar) é aceita depois de checar sessao.temPid', () => {
    const sessao: SessaoDescoberta = criarSessaoComPid();

    if (sessao.temPid) {
      // Compila só porque o `if` acima estreitou `sessao` para `SessaoComPid` — sem o `if`, a
      // linha abaixo não compilaria (ver os dois casos de `@ts-expect-error` a seguir).
      expect(dadosParaEncerrarProcesso(sessao)).toStrictEqual({
        pid: sessao.pid,
        procStart: sessao.procStart,
      });
    } else {
      expect.unreachable('a fixture usada aqui sempre tem PID');
    }
  });

  it('recusa em tempo de compilação SessaoSemPid — sem "!", sem "as" (D-024)', () => {
    const sessaoSemPid: SessaoSemPid = criarSessaoSemPid();

    // @ts-expect-error D-024: SessaoSemPid não tem `pid`. Se esta linha compilar sem erro, a
    // proteção de tipo que D-024 exige quebrou — dadosParaEncerrarProcesso passou a aceitar uma
    // forma que a política de encerramento (D-002) não pode aceitar.
    const chamadaRecusadaPeloCompilador = () => dadosParaEncerrarProcesso(sessaoSemPid);

    expect(chamadaRecusadaPeloCompilador).toBeTypeOf('function');
  });

  it('recusa em tempo de compilação a união SessaoDescoberta sem estreitar (D-024)', () => {
    const sessao: SessaoDescoberta = criarSessaoSemPid();

    // @ts-expect-error D-024: sem o `if (sessao.temPid)`, o TypeScript não sabe que `sessao` é a
    // forma com PID — a união inteira, incluindo o lado sem PID, precisaria ser aceita, e não é.
    const chamadaRecusadaPeloCompilador = () => dadosParaEncerrarProcesso(sessao);

    expect(chamadaRecusadaPeloCompilador).toBeTypeOf('function');
  });

  it('tipo de retorno documentado: exatamente { pid, procStart }, nada mais', () => {
    const sessao: SessaoComPid = criarSessaoComPid();

    const resultado = dadosParaEncerrarProcesso(sessao);

    expect(Object.keys(resultado).sort()).toStrictEqual(['pid', 'procStart']);
  });
});

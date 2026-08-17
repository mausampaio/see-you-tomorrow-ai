/**
 * A parte pura da política de encerramento de processo (D-002, D-024). A política inteira —
 * checar `podeEncerrar` por `cwd` na config, confirmar o handoff gravado em disco antes de
 * terminar — é orquestração de `aplicacao/` (S2-T3), fora desta tarefa. O que mora aqui é só o
 * gate de tipo que D-024 exige: extrair os dados necessários para terminar um processo só é
 * possível a partir da forma que garante `pid`.
 */
import type { SessaoComPid } from './tipos.js';

export interface DadosParaEncerrarProcesso {
  readonly pid: number;
  readonly procStart: string;
}

/**
 * Extrai `pid` e `procStart` para a chamada de `ControleDeProcesso.terminarComGraca` (D-002).
 *
 * **Aceita exclusivamente `SessaoComPid`.** Não aceita `SessaoDescoberta` (a união) nem
 * `SessaoSemPid` — o compilador recusa a chamada nesses dois casos, sem `!` e sem `as` em lugar
 * nenhum (D-024). Quem tem uma `SessaoDescoberta` precisa estreitar primeiro:
 *
 * ```ts
 * if (sessao.temPid) {
 *   dadosParaEncerrarProcesso(sessao); // compila: `sessao` foi estreitado para SessaoComPid
 * }
 * ```
 *
 * Ver tests/unidade/nucleo/encerramento.teste.ts para a prova de que a forma sem PID **não**
 * compila (`@ts-expect-error`) — é o teste que docs/PLANO-DE-ENTREGA.md S1-T1 exige literalmente.
 */
export function dadosParaEncerrarProcesso(sessao: SessaoComPid): DadosParaEncerrarProcesso {
  return { pid: sessao.pid, procStart: sessao.procStart };
}

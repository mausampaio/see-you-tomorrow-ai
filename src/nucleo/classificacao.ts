/**
 * Classificação pura de estado da sessão. Ver docs/ESPECIFICACAO.md § "Glossário" e
 * docs/DECISOES.md D-016. Nenhuma leitura de I/O ou de liveness real acontece aqui — quem chama
 * já resolveu `processoEstaVivo` via a porta `ControleDeProcesso` (S1-T2) e passa o resultado.
 */
import type { EstadoDaSessao, SessaoDescoberta } from './tipos.js';

export interface ParametrosDeClassificacao {
  /** O instante atual, obtido da porta `Relogio` por quem chama — nunca lido aqui (D-019). */
  readonly agora: Date;
  /** `minutosParaOcioso` de `config.json` (docs/ARQUITETURA.md § Config). */
  readonly minutosParaOcioso: number;
}

/**
 * Decide se dois `procStart` — o registrado no momento da descoberta e o observado agora numa
 * checagem de liveness real (S1-T2) — representam o mesmo processo, ou se o PID foi reciclado
 * pelo SO e a entrada é obsoleta (docs/ESPECIFICACAO.md § "Como as sessões são descobertas": "PID
 * é reciclado pelo SO. `procStart` é usado como desempate").
 *
 * Comparação pura, sem consultar o SO — a captura dos dois valores é responsabilidade de
 * `adaptadores/processo` (S1-T2, fora do escopo desta tarefa); só a **decisão** de quando eles
 * contam como "o mesmo processo" é pura, e é isso que este módulo resolve, conforme convite
 * explícito de docs/PLANO-DE-ENTREGA.md S1-T1: "Se a decisão sobre PID reciclado com procStart
 * divergente for pura, ela pode morar aqui".
 *
 * Igualdade de string, não numérica: os dois lados vêm como string por excederem
 * `Number.MAX_SAFE_INTEGER` (mesma razão de `adaptadores/descoberta/esquemas.ts`), e comparar
 * como string evita qualquer perda de precisão ao converter.
 */
export function pidRepresentaMesmoProcesso(
  procStartRegistrado: string,
  procStartObservado: string,
): boolean {
  return procStartRegistrado === procStartObservado;
}

/**
 * Sem escrita no transcript há mais de `minutosParaOcioso`? `null` (sem transcript, ou transcript
 * nunca escreveu — D-013) conta como "sim, ociosa": não há nenhuma evidência de atividade recente
 * para justificar `viva`, e "ociosa" é a leitura literal de "sessão viva sem escrita no
 * transcript há mais de minutosParaOcioso" no caso degenerado em que não há escrita nenhuma para
 * medir. Ver docs/QUESTOES.md Q-004 — a alternativa (tratar `null` como `viva`, por falta de
 * evidência contrária) foi considerada e descartada por não ter apoio textual tão direto.
 */
function estaOciosaPeloTranscript(
  ultimaEscritaNoTranscript: Date | null,
  agora: Date,
  minutosParaOcioso: number,
): boolean {
  if (ultimaEscritaNoTranscript === null) {
    return true;
  }
  const minutosDesdeAUltimaEscrita =
    (agora.getTime() - ultimaEscritaNoTranscript.getTime()) / 60_000;
  return minutosDesdeAUltimaEscrita > minutosParaOcioso;
}

/**
 * Classifica o estado de exibição de uma sessão descoberta (docs/ESPECIFICACAO.md § "Glossário").
 *
 * Sem PID (`SessaoSemPid`, D-016): sempre `desconhecida` — não há liveness para checar. Com PID:
 * processo morto (entrada obsoleta ou processo que terminou de verdade) é `encerrada`; processo
 * vivo com transcript recente é `viva`; processo vivo sem escrita recente é `ociosa`.
 */
export function classificarEstado(
  sessao: SessaoDescoberta,
  parametros: ParametrosDeClassificacao,
): EstadoDaSessao {
  if (!sessao.temPid) {
    return 'desconhecida';
  }

  if (!sessao.processoEstaVivo) {
    return 'encerrada';
  }

  return estaOciosaPeloTranscript(
    sessao.ultimaEscritaNoTranscript,
    parametros.agora,
    parametros.minutosParaOcioso,
  )
    ? 'ociosa'
    : 'viva';
}

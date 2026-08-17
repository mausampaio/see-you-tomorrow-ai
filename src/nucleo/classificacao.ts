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
 * Sem escrita no transcript há mais de `minutosParaOcioso`? **`null` devolve `false` (D-025).**
 * `ociosa` é uma afirmação — "sem escrita há mais de X minutos" — e essa afirmação só pode ser
 * feita a partir de um timestamp real que já passou do limite. `null` não é um timestamp muito
 * antigo, é a ausência de qualquer dado sobre escrita (sem transcript, ou transcript suprimido —
 * D-013): não há como estabelecer "sem escrita há mais de X minutos" quando não há como
 * estabelecer nada sobre escrita. Tratar `null` como "ociosa" converteria "não sei" numa
 * afirmação positiva — exatamente o que D-025 proíbe para o domínio inteiro. `viva` (o chamador
 * devolve `viva` quando esta função devolve `false`) é o estado menos específico que o processo
 * vivo já sustenta sozinho, e é isso que sobra quando a evidência de escrita falta.
 *
 * Caso concreto que motivou a correção: sessão sem transcript por D-013 é justamente o agente de
 * execução autônomo, que tem tudo para estar trabalhando a todo vapor. Marcá-lo `ociosa` sem
 * nenhuma evidência de inatividade mentiria com confiança sobre o caso que mais importa.
 */
function estaOciosaPeloTranscript(
  ultimaEscritaNoTranscript: Date | null,
  agora: Date,
  minutosParaOcioso: number,
): boolean {
  if (ultimaEscritaNoTranscript === null) {
    return false;
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
 * vivo é `ociosa` só quando há um timestamp real de última escrita além de `minutosParaOcioso`,
 * e `viva` em todos os outros casos — inclusive sem transcript nenhum (D-025, ver
 * `estaOciosaPeloTranscript`).
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

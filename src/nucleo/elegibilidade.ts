/**
 * Regra pura de elegibilidade para o encerramento (docs/ESPECIFICACAO.md § "Elegibilidade").
 * Cinco condições, todas em "e" (a sessão só entra se as cinco passarem). Nenhuma delas depende
 * de I/O aqui — todo dado externo (config, `forks.json`, o handoff de hoje) chega já resolvido
 * em `CriteriosDeElegibilidade`, montado por quem chama (fora do núcleo).
 */
import type { SessaoDescoberta } from './tipos.js';
import { mesmoInstante } from './tempo.js';

/**
 * Por que cada sessão é inelegível, na mesma ordem em que as condições aparecem na spec.
 * `avaliarElegibilidade` acumula todos os motivos aplicáveis, não só o primeiro — útil para
 * `seeya sessoes` explicar exatamente o porquê, e é o que docs/TESTES.md pede ao exigir cobrir
 * "combinações de borda" (mais de uma condição falhando ao mesmo tempo).
 */
export type MotivoDeInelegibilidade =
  | 'semEvidencia'
  | 'semAtividadeRecente'
  | 'forkDoProprioSeeya'
  | 'cwdIgnorado'
  | 'duplicadaNoDia';

/**
 * O que se sabe sobre uma captura já feita hoje para esta sessão, só o suficiente para decidir
 * anti-duplicidade (docs/ESPECIFICACAO.md: "não tem handoff do dia corrente com transcript
 * inalterado desde então"). Não é o `Handoff` inteiro — esse tipo é escopo de S2-T3/S2-T4, fora
 * desta tarefa (docs/PLANO-DE-ENTREGA.md S1-T1). `null` (no lugar deste tipo) significa "não há
 * handoff de hoje para esta sessão".
 */
export interface CapturaAnteriorHoje {
  /**
   * O valor de `ultimaEscritaNoTranscript` da sessão no momento em que a captura de hoje foi
   * feita. Comparado com o valor atual via `mesmoInstante` — mesmo valor (incluindo os dois
   * `null`, sessão sem transcript nas duas capturas) significa "nada mudou", logo duplicada.
   */
  readonly ultimaEscritaNoTranscriptNaCaptura: Date | null;
}

export interface CriteriosDeElegibilidade {
  /** O instante atual, obtido da porta `Relogio` por quem chama — nunca lido aqui (D-019). */
  readonly agora: Date;
  /** `horasDeRelevancia` de `config.json` (default 12h, docs/ARQUITETURA.md § Config). */
  readonly horasDeRelevancia: number;
  /**
   * `cwd`s da lista `ignorar` de `config.json`, já normalizados por quem monta este objeto —
   * `nucleo/` não pode importar `node:path` (regra de guard), então a normalização de caminho
   * (maiúsculas/minúsculas, barra final, etc.) é responsabilidade de fora do núcleo. A
   * comparação aqui é igualdade exata de string.
   */
  readonly cwdsIgnorados: ReadonlySet<string>;
  /** `sessionId`s registrados em `~/.see-you-tomorrow/forks.json` (D-012). */
  readonly forksConhecidos: ReadonlySet<string>;
  /** Ver `CapturaAnteriorHoje`. `null` quando não há handoff de hoje para esta sessão. */
  readonly capturaAnteriorHoje: CapturaAnteriorHoje | null;
}

export interface ResultadoDeElegibilidade {
  readonly elegivel: boolean;
  readonly motivos: readonly MotivoDeInelegibilidade[];
}

/**
 * Avalia as cinco condições de docs/ESPECIFICACAO.md § "Elegibilidade" para uma sessão descoberta.
 *
 * As duas primeiras condições da spec — "pelo menos uma fonte de evidência respondeu" e "teve
 * atividade nas últimas `horasDeRelevancia` ... medida pela fonte mais recente disponível" — são
 * as duas faces do mesmo campo, `sessao.ultimaAtividade` (docs/ESPECIFICACAO.md D-013: "medida
 * pela fonte mais recente disponível, não só pelo transcript" é literalmente a fusão que esse
 * campo representa). Sem nenhuma fonte respondendo, não há como calcular "a fonte mais recente"
 * — logo `ultimaAtividade === null` já é as duas coisas ao mesmo tempo: zero evidência **e**,
 * por consequência, zero atividade comprovadamente recente. Por isso as duas condições são
 * mutuamente exclusivas aqui (nunca os dois motivos juntos): sem evidência é reportado como
 * `semEvidencia`; com evidência, mas fora da janela, como `semAtividadeRecente`.
 */
export function avaliarElegibilidade(
  sessao: SessaoDescoberta,
  criterios: CriteriosDeElegibilidade,
): ResultadoDeElegibilidade {
  const motivos: MotivoDeInelegibilidade[] = [];

  if (sessao.ultimaAtividade === null) {
    motivos.push('semEvidencia');
  } else {
    const horasDesdeAUltimaAtividade =
      (criterios.agora.getTime() - sessao.ultimaAtividade.getTime()) / 3_600_000;
    if (horasDesdeAUltimaAtividade > criterios.horasDeRelevancia) {
      motivos.push('semAtividadeRecente');
    }
  }

  if (criterios.forksConhecidos.has(sessao.sessionId)) {
    motivos.push('forkDoProprioSeeya');
  }

  if (criterios.cwdsIgnorados.has(sessao.cwd)) {
    motivos.push('cwdIgnorado');
  }

  if (
    criterios.capturaAnteriorHoje !== null &&
    mesmoInstante(
      criterios.capturaAnteriorHoje.ultimaEscritaNoTranscriptNaCaptura,
      sessao.ultimaEscritaNoTranscript,
    )
  ) {
    motivos.push('duplicadaNoDia');
  }

  return { elegivel: motivos.length === 0, motivos };
}

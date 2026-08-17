/**
 * Tipos centrais do domínio. Ver docs/ESPECIFICACAO.md § "Glossário" e § "Como as sessões são
 * descobertas", e docs/DECISOES.md D-016, D-021, D-023, D-024.
 */

/**
 * A sessão descoberta — o tipo central de todo o projeto (S1-T1).
 *
 * **União discriminada por `temPid`, exigida por D-024.** O review de S1-T0c mediu que
 * `pid?: number` num tipo único protege só por comentário: `item.pid!` compila sem erro, e nada
 * no tipo impede `terminarComGraca(item.pid!)`. Aqui não existe caminho para isso: `SessaoComPid`
 * carrega `pid` garantido (`number`, nunca `undefined`); `SessaoSemPid` não tem o campo `pid` de
 * jeito nenhum. A política de encerramento de processo (D-002) só aceita a primeira forma —
 * ver `nucleo/encerramento.ts#dadosParaEncerrarProcesso`, que só tipa para `SessaoComPid`. Quem
 * tem uma `SessaoDescoberta` (a união) precisa estreitar com `if (sessao.temPid)` antes de poder
 * chamar aquela função; o compilador recusa a chamada sem o estreitamento, sem `!` na chamada.
 *
 * **Por que `temPid` e não inferir a partir da presença de `pid`.** Um discriminante explícito
 * (`temPid: true | false`) deixa o `switch`/`if` óbvio para quem lê e para o TypeScript, e evita
 * depender de `'pid' in sessao` ou de checar `pid !== undefined` espalhado pelo código — o
 * discriminante é o único lugar que decide a forma.
 *
 * **Limitação conhecida, no mesmo espírito da de D-019.** O tipo cobre o descuido — passar uma
 * `SessaoSemPid`, ou a união sem estreitar, direto para `dadosParaEncerrarProcesso` — não o
 * contorno deliberado: `{ temPid: true } as SessaoComPid` compila, e
 * `{ ...sessaoSemPid, temPid: true } as SessaoComPid` também. Isso é o comportamento do `as`
 * sobre um literal de objeto no TypeScript, não um furo deste desenho — só o cast direto de um
 * valor já tipado (`sessaoSemPid as SessaoComPid`, sem espalhar) é recusado, porque `SessaoSemPid`
 * e `SessaoComPid` não se sobrepõem o bastante para o compilador aceitar a conversão direta. O
 * que D-024 promete, e o que este tipo cumpre, é que `item.pid!` e o narrowing sem `if` não
 * compilem — não que nenhum `as` no projeto inteiro consiga produzir um valor mentiroso. Contorno
 * deliberado com `as` passa por review, igual a qualquer outro `as` do projeto.
 *
 * **Escopo consciente, para quem for mexer aqui em S1-T9/S1-T10.** D-024 pede duas formas
 * baseadas em PID, e é só isso que esta tarefa (S1-T1) resolve. D-016 (varredura de transcript,
 * S1-T8) já é coberto: uma sessão vista só pela varredura é `SessaoSemPid`, com `sessionId`
 * (o nome do arquivo `.jsonl`) preenchido normalmente. **D-023 (terceira estratégia, S1-T10)
 * ainda não é coberto**: aquela origem dá `pid` mas não dá `sessionId` nenhum — o inverso do que
 * D-016 cobre. Hoje `sessionId` é obrigatório nas duas formas porque nenhuma tarefa até aqui
 * precisa do caso contrário; a União ganhará uma terceira forma (ou `sessionId` vira nullable em
 * `SessaoComPid`) quando S1-T10 for implementada — não antes, para não adiantar escopo. Ver
 * docs/QUESTOES.md Q-004.
 */
export type SessaoDescoberta = SessaoComPid | SessaoSemPid;

/**
 * Campos que as duas formas de `SessaoDescoberta` têm em comum. Não é exportado: quem precisa de
 * um campo comum recebe pela união mesma (o TypeScript permite acessar campo comum sem
 * estreitar o discriminante primeiro).
 */
interface CamposComunsDaSessao {
  /** UUID da sessão do Claude Code. Identidade primária (D-021). */
  readonly sessionId: string;
  /** Diretório de trabalho da sessão. Identidade secundária (D-021) — junto com `sessionId`. */
  readonly cwd: string;
  /**
   * Nome de exibição. Nunca vazio: quando o registro não traz `name` (D-021), o adapter de
   * descoberta já preenche com um nome derivado do `cwd` antes de construir este tipo — este
   * campo em si não carrega opcionalidade, a resolução do padrão é responsabilidade do adapter.
   */
  readonly nome: string;
  /**
   * A sessão tem um transcript localizável em disco (D-013). `false` é um caso normal — sessão
   * filha herdando o marcador, `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, etc. — não um erro.
   */
  readonly temTranscript: boolean;
  /**
   * Instante da última escrita conhecida no transcript, ou `null` quando `temTranscript` é
   * `false` (nunca houve o que escrever). Usado tanto pela classificação de estado (ociosidade,
   * `nucleo/classificacao.ts`) quanto pela elegibilidade (anti-duplicidade,
   * `nucleo/elegibilidade.ts`) — os dois usam especificamente o transcript, não a atividade
   * geral, porque é isso que a spec pede em cada caso.
   */
  readonly ultimaEscritaNoTranscript: Date | null;
  /**
   * A atividade mais recente conhecida da sessão, **entre todas as fontes disponíveis no momento
   * da descoberta** (registro, transcript — e git a partir de S2-T1) — não só o transcript.
   * `null` quando nenhuma fonte respondeu nada (nem `startedAt` do registro, nem mtime de
   * transcript). Ver docs/ESPECIFICACAO.md § "Elegibilidade": "medida pela fonte mais recente
   * disponível, não só pelo transcript" — este campo é exatamente essa fusão, calculada por quem
   * monta a `SessaoDescoberta` (o adapter de descoberta), não por este tipo.
   */
  readonly ultimaAtividade: Date | null;
}

/** Sessão descoberta com PID garantido — a única forma aceita para encerramento (D-002, D-024). */
export interface SessaoComPid extends CamposComunsDaSessao {
  readonly temPid: true;
  /** PID do processo do Claude Code. Pode estar reciclado pelo SO — ver `procStart`. */
  readonly pid: number;
  /**
   * Carimbo de início do processo, na forma bruta do registro do Claude Code (string, não
   * `number`: os valores reais excedem `Number.MAX_SAFE_INTEGER` — mesma razão de
   * `adaptadores/descoberta/esquemas.ts`). Usado para desempate de PID reciclado
   * (`nucleo/classificacao.ts#pidRepresentaMesmoProcesso`).
   */
  readonly procStart: string;
  /**
   * Resultado, já resolvido, de checar liveness deste PID (porta `ControleDeProcesso`,
   * implementada em S1-T2) — incluindo o desempate por `procStart`. Este tipo não faz I/O: quem
   * descobre a sessão já chamou a porta e traz o resultado pronto.
   */
  readonly processoEstaVivo: boolean;
}

/**
 * Sessão descoberta sem PID nenhum (D-016: vinda só da varredura de transcripts, ou da variante
 * `background` do `agents --json`, que não tem PID e usa `id` no lugar). Nunca é candidata a
 * encerramento de processo — não há como, não existe PID para mandar sinal.
 */
export interface SessaoSemPid extends CamposComunsDaSessao {
  readonly temPid: false;
}

/**
 * Estado de exibição de uma sessão (docs/ESPECIFICACAO.md § "Glossário"; D-016).
 *
 * - `viva` — processo em execução agora. É o estado padrão para processo vivo: também vale
 *   quando não há nenhuma evidência de escrita no transcript (`ultimaEscritaNoTranscript: null`,
 *   D-013) — `null` não é um sinal de inatividade, é ausência de dado, e `ociosa` é uma
 *   afirmação que exige um timestamp real (D-025).
 * - `ociosa` — processo em execução agora, **e** um timestamp real de última escrita no
 *   transcript que já passou de `minutosParaOcioso`. Refinamento de `viva` que só se aplica
 *   quando há evidência positiva de silêncio, nunca por ausência de transcript (D-025).
 * - `encerrada` — processo não está mais vivo (morreu, ou a entrada do registro está obsoleta:
 *   PID reciclado com `procStart` divergente). Reportada, não descartada (D-016).
 * - `desconhecida` — sessão sem PID (`SessaoSemPid`): não há como checar liveness, então não há
 *   como dizer se está viva, ociosa ou encerrada. D-016 escreve esse quarto estado como
 *   "desconhecido" (concordando com "o estado"); aqui a forma escolhida é `desconhecida`, para
 *   concordar com "a sessão" — mesmo padrão dos outros três valores do enum
 *   (`estadoDaSessao: "viva"`, não "vivo"). Só uma escolha de grafia, mesmo significado; ver
 *   docs/QUESTOES.md Q-004 sobre este quarto estado não aparecer ainda no schema do handoff em
 *   docs/ESPECIFICACAO.md.
 */
export type EstadoDaSessao = 'viva' | 'ociosa' | 'encerrada' | 'desconhecida';

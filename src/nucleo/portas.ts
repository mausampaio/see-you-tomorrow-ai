/**
 * Portas do núcleo — as interfaces que todo acesso ao mundo tem de atravessar
 * (docs/ARQUITETURA.md § "Princípio"). `nucleo/` declara a interface; `adaptadores/` implementa;
 * `cli/` é a única raiz de composição que nomeia a implementação concreta e injeta (D-020).
 *
 * **Só as três portas que o Sprint 1 precisa.** docs/ARQUITETURA.md já esboça sete portas (o
 * desenho de arquitetura inteiro), mas as quatro que faltam aqui têm todas o mesmo problema
 * concreto: a assinatura de cada uma referencia um tipo que ainda não existe neste projeto.
 * Declará-las agora seria inventar esses tipos cedo demais, só para preencher uma assinatura, ou
 * declarar a porta com `unknown` — pior que não declarar. As quatro, e o tipo que falta em cada
 * uma:
 *
 * - `LeitorDeTranscricao` — devolve `FatosDaSessao`, tipo que só nasce em S2-T3/S2-T4 (fora do
 *   escopo desta tarefa). A leitura barata de transcript que o Sprint 1 usa (S1-T8, varredura
 *   por mtime) não passa por aqui: é `stat`, não parse de conteúdo.
 * - `GeradorDeHandoff` — devolve `EntendimentoGerado`, também um tipo de handoff. Implementação
 *   em S2-T2.
 * - `Notificador` — implementação em S4-T1. A regra pura de S1-T7 (notificar uma vez por
 *   `sessionId`, sem repetir) não precisa da porta inteira para ser pura; quem implementar
 *   S1-T7 decide a forma mínima que basta para aquela regra.
 * - `Armazenamento` — a assinatura de docs/ARQUITETURA.md usa `Handoff`, `Briefing`,
 *   `EstadoDoDia`, nenhum dos quais existe ainda. S1-T5 declara aqui o que precisar, do tamanho
 *   que tiver naquele momento (provavelmente `lerConfig`/`salvarEstado` primeiro, crescendo em
 *   S2 para os métodos de handoff/briefing).
 *
 * Dúvida registrada sobre este recorte: docs/QUESTOES.md Q-004.
 */
import type { SessaoDescoberta } from './tipos.js';

/**
 * A única fonte de "agora" do projeto (D-019). Implementada em `adaptadores/relogio/`. Nenhum
 * outro módulo chama `new Date()` sem argumento, `Date.now()` ou `setTimeout`/`setInterval` de
 * longa duração — é essa porta que devolve o instante, e quem precisa dele recebe já resolvido.
 */
export interface Relogio {
  agora(): Date;
}

/**
 * Liveness e terminação de processo (D-002, D-023). Implementada em `adaptadores/processo/`
 * (S1-T2). `estaVivo` recebe `procStart` para o desempate de PID reciclado
 * (docs/ESPECIFICACAO.md § "Como as sessões são descobertas") — a decisão pura de quando dois
 * `procStart` contam como o mesmo processo mora em
 * `nucleo/classificacao.ts#pidRepresentaMesmoProcesso`; esta porta só declara o contrato
 * assíncrono que o adapter cumpre consultando o SO de verdade.
 */
export interface ControleDeProcesso {
  estaVivo(pid: number, procStart?: string): Promise<boolean>;
  terminarComGraca(pid: number, prazoMs: number): Promise<boolean>;
}

/**
 * Descoberta de sessões (D-016, D-023). Implementada em `adaptadores/descoberta/`, fundindo as
 * estratégias de S1-T3 (registro), S1-T8 (varredura de transcripts) e S1-T10 (processo + `.key`)
 * numa lista deduplicada só de `SessaoDescoberta` — `listar()` devolve a união já fundida, nunca
 * a concatenação bruta das três origens: quem chama não deveria precisar saber quantas
 * estratégias existem por baixo, nem deduplicar por conta própria.
 */
export interface ProvedorDeSessoes {
  listar(): Promise<SessaoDescoberta[]>;
}

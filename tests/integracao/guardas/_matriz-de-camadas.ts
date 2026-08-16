/**
 * Fonte única da matriz de camadas de docs/ARQUITETURA.md — 5 camadas, 20 pares ordenados, 12
 * proibidos e 8 permitidos (D-020, S0-T6). `matriz-de-camadas.teste.ts` é dirigido inteiramente
 * por esta estrutura: nenhum dos 20 pares é um `it(...)` escrito à mão.
 *
 * Isto é uma segunda fonte de verdade, independente do `.dependency-cruiser.cjs` — de propósito.
 * O ponto do "guard do guard" é confirmar que o comportamento real da ferramenta bate com a
 * tabela do doc; se este arquivo só repetisse as regras do `.dependency-cruiser.cjs`, um erro
 * feito nos dois lugares ao mesmo tempo passaria batido.
 *
 * Não é um arquivo de teste (não termina em `.teste.ts`), só a estrutura de dados + funções puras
 * que derivam os pares dela.
 */

export interface Camada {
  /** Nome da camada, igual ao nome do diretório em src/. */
  readonly nome: string;
  /**
   * Diretório (relativo a src/) onde é seguro escrever um arquivo de fixture desta camada.
   * `adaptadores/` não tem `index.ts` na raiz (cada adapter concreto tem o seu) — por isso
   * aponta para um adapter concreto (`adaptadores/relogio/`), como o resto da suíte já faz.
   */
  readonly dirFixture: string;
  /** Diretório (relativo a src/) cujo `index.ts` é o alvo canônico de import desta camada. */
  readonly dirAlvo: string;
}

/**
 * As 5 camadas de docs/ARQUITETURA.md. Se um diretório novo aparecer em `src/` sem entrar aqui
 * (ou vice-versa), `matriz-de-camadas.teste.ts` reprova antes mesmo de varrer os pares.
 */
export const CAMADAS: readonly Camada[] = [
  { nome: 'nucleo', dirFixture: 'nucleo', dirAlvo: 'nucleo' },
  { nome: 'adaptadores', dirFixture: 'adaptadores/relogio', dirAlvo: 'adaptadores/relogio' },
  { nome: 'aplicacao', dirFixture: 'aplicacao', dirAlvo: 'aplicacao' },
  { nome: 'agendador', dirFixture: 'agendador', dirAlvo: 'agendador' },
  { nome: 'cli', dirFixture: 'cli', dirAlvo: 'cli' },
];

/**
 * Pares PERMITIDOS da matriz "De → Para" de docs/ARQUITETURA.md, como `"de->para"`. Todo par
 * entre duas camadas distintas que não estiver aqui é proibido. 8 entradas — bate com "8
 * permitidos" da tabela do doc (ver o teste de sanidade em matriz-de-camadas.teste.ts).
 */
const PARES_PERMITIDOS: ReadonlySet<string> = new Set([
  'adaptadores->nucleo',
  'aplicacao->nucleo',
  'agendador->nucleo',
  'agendador->aplicacao',
  'cli->nucleo',
  'cli->adaptadores',
  'cli->aplicacao',
  'cli->agendador',
]);

export interface ParDeCamadas {
  readonly de: Camada;
  readonly para: Camada;
  readonly permitido: boolean;
}

/** Os 20 pares ordenados (5 camadas × 4, sem a diagonal) derivados de CAMADAS + PARES_PERMITIDOS. */
export function paresOrdenados(): ParDeCamadas[] {
  const pares: ParDeCamadas[] = [];
  for (const de of CAMADAS) {
    for (const para of CAMADAS) {
      if (de.nome === para.nome) {
        continue;
      }
      pares.push({ de, para, permitido: PARES_PERMITIDOS.has(`${de.nome}->${para.nome}`) });
    }
  }
  return pares;
}

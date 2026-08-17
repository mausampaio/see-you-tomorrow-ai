import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Apoio comum aos testes de tests/integracao/guardas/*.teste.ts. Não é um arquivo de teste (não
 * termina em `.teste.ts`), só utilitário importado por eles.
 *
 * Todos os guards são invocados como processo filho de verdade — nunca chamando a API da
 * ferramenta em processo — porque o que este conjunto de testes prova é que o comando que roda
 * em `npm run verificar` e no CI reprova, não que uma função interna reprovaria.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_DO_PROJETO = path.resolve(AQUI, '..', '..', '..');

/**
 * Timeout (ms) para testes que spawnam eslint/depcruise como processo filho de verdade. O
 * padrão de 5 s do Vitest estoura sob carga (CI ocupado, disco lento) e produz falha
 * intermitente sem relação nenhuma com a regra sendo testada — observado em review de S0-T2.
 * Passe como terceiro argumento de `it(...)` em qualquer teste que chame `rodarEslint` ou
 * `rodarDependencyCruiser`.
 */
export const TIMEOUT_PROCESSO_FILHO = 20_000;

export interface ResultadoDoComando {
  codigoDeSaida: number | null;
  saida: string;
}

function rodar(args: readonly string[], opcoes?: { cwd?: string }): ResultadoDoComando {
  const resultado = spawnSync(process.execPath, [...args], {
    cwd: opcoes?.cwd ?? RAIZ_DO_PROJETO,
    encoding: 'utf8',
    shell: false,
  });
  return {
    codigoDeSaida: resultado.status,
    saida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
  };
}

/** Roda o eslint de verdade (o binário instalado em node_modules) contra os caminhos dados. */
export function rodarEslint(caminhosAbsolutos: readonly string[]): ResultadoDoComando {
  const binario = path.join(RAIZ_DO_PROJETO, 'node_modules', 'eslint', 'bin', 'eslint.js');
  return rodar([binario, '--no-color', ...caminhosAbsolutos]);
}

export interface ViolacaoDependencyCruiser {
  readonly regra: string;
  readonly de: string;
  readonly para: string;
}

export interface ResultadoDependencyCruiser {
  /** As violações relatadas (S1-T0: nunca use contagem/exit code global — ver violacoesDoFixture). */
  readonly violacoes: readonly ViolacaoDependencyCruiser[];
  /**
   * `false` quando a saída do processo não pôde ser interpretada como o JSON que
   * `--output-type json` deveria produzir (ex.: o dependency-cruiser imprimiu um erro de I/O em
   * vez do relatório — ver `rodarDependencyCruiserNaArvoreCompleta`). Nesse caso `violacoes` vem
   * vazia mas NÃO significa "sem violação": significa "não deu para saber". Todo teste que espera
   * lista vazia precisa checar isto primeiro, senão uma falha de ferramenta passa como aprovação
   * (S1-T0).
   */
  readonly jsonValido: boolean;
  /** Saída bruta (JSON ou erro) do processo, só para diagnóstico numa mensagem de falha (S1-T0). */
  readonly bruto: string;
}

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

/**
 * Extrai `summary.violations[]` do JSON que `dependency-cruise --output-type json` imprime.
 * Não usa `any`: cada campo é conferido antes de ser lido. Se o formato mudar ou o parse falhar,
 * devolve `jsonValido: false` — nunca finge que "não consegui ler" é o mesmo que "zero violação"
 * (S1-T0, item 3 do plano: `bruto` fica disponível na mensagem de falha do teste).
 */
function extrairViolacoes(saidaJson: string): { violacoes: ViolacaoDependencyCruiser[]; jsonValido: boolean } {
  try {
    const dados: unknown = JSON.parse(saidaJson);
    if (!ehRegistro(dados) || !ehRegistro(dados.summary) || !Array.isArray(dados.summary.violations)) {
      return { violacoes: [], jsonValido: false };
    }
    const violacoes: ViolacaoDependencyCruiser[] = [];
    for (const item of dados.summary.violations as unknown[]) {
      if (
        ehRegistro(item) &&
        typeof item.from === 'string' &&
        typeof item.to === 'string' &&
        ehRegistro(item.rule) &&
        typeof item.rule.name === 'string'
      ) {
        violacoes.push({ de: item.from, para: item.to, regra: item.rule.name });
      }
    }
    return { violacoes, jsonValido: true };
  } catch {
    return { violacoes: [], jsonValido: false };
  }
}

/**
 * Roda o dependency-cruiser de verdade, com a config real do projeto, pedindo saída em JSON
 * (`--output-type json`) em vez do texto humano que o comando real (`npm run dependencias`) usa —
 * só a chamada de teste muda, a regra continua a mesma.
 *
 * `entradas` (S1-T0): por padrão `['src']`, a árvore inteira — mas todo teste que escreve o
 * PRÓPRIO fixture deve passar `[caminhoDoFixture]` (ou os poucos caminhos relevantes, como o
 * teste de ciclo) em vez do default. Analisar só o fixture (que o dependency-cruiser resolve e
 * segue as importações dele) em vez de `src` inteiro tem duas vantagens sobre só filtrar o
 * resultado depois: (1) o teste nunca enxerga violação de outro arquivo de teste rodando em
 * paralelo, porque nunca visita os arquivos dele; (2) elimina uma corrida mais sutil observada em
 * S1-T0 — dependency-cruiser varrendo `src/` inteiro pode listar um arquivo temporário de OUTRO
 * arquivo de teste e, um instante depois, tentar abri-lo para analisar — se esse outro teste já
 * tiver apagado o próprio fixture nesse meio-tempo (`afterEach` normal, nada de errado com ele),
 * o dependency-cruiser reporta um erro de I/O em vez do relatório. Só a árvore real inteira
 * ("aprova a árvore real, sem violação") precisa continuar escaneando tudo — ver
 * `rodarDependencyCruiserNaArvoreCompleta`, que tem a rede de segurança para esse caso.
 */
export function rodarDependencyCruiser(entradas: readonly string[] = ['src']): ResultadoDependencyCruiser {
  const binario = path.join(
    RAIZ_DO_PROJETO,
    'node_modules',
    'dependency-cruiser',
    'bin',
    'dependency-cruise.mjs',
  );
  const resultado = rodar([binario, ...entradas, '--config', '.dependency-cruiser.cjs', '--output-type', 'json']);
  const { violacoes, jsonValido } = extrairViolacoes(resultado.saida);
  return { violacoes, jsonValido, bruto: resultado.saida };
}

/**
 * Roda o dependency-cruiser contra `src/` inteiro (única invocação desta suíte que precisa disso
 * de verdade — o controle "aprova a árvore real, sem violação" não tem fixture próprio para
 * escopar a entrada). Tenta de novo algumas vezes se a saída não vier como JSON válido: como
 * descrito em `rodarDependencyCruiser`, isso pode ser o dependency-cruiser tropeçando num
 * arquivo temporário de outro arquivo de teste, apagado por ELE (legitimamente) entre a listagem
 * e a leitura — uma corrida inofensiva entre dois testes bem-comportados, não uma falha real da
 * árvore (S1-T0).
 */
export function rodarDependencyCruiserNaArvoreCompleta(): ResultadoDependencyCruiser {
  const TENTATIVAS = 3;
  let resultado = rodarDependencyCruiser(['src']);
  for (let tentativa = 1; tentativa < TENTATIVAS && !resultado.jsonValido; tentativa += 1) {
    resultado = rodarDependencyCruiser(['src']);
  }
  return resultado;
}

/**
 * Violações cujo módulo de origem ou de destino é o fixture indicado (caminho relativo à raiz do
 * projeto, ex.: `src/nucleo/_guarda-eslint/x.ts` — dependency-cruiser sempre reporta caminhos
 * com `/`, mesmo no Windows).
 */
export function violacoesDoFixture(
  violacoes: readonly ViolacaoDependencyCruiser[],
  caminhoRelativoAoProjeto: string,
): ViolacaoDependencyCruiser[] {
  const alvo = caminhoRelativoAoProjeto.split(path.sep).join('/');
  return violacoes.filter((violacao) => violacao.de === alvo || violacao.para === alvo);
}

const PADRAO_SUBDIRETORIO_DE_GUARDA = /\/_guarda-[^/]+\//;

/**
 * Violações fora de qualquer subdiretório de fixture de guard (`_guarda-*`, ver
 * `subdiretorioDoGuarda`). Uso: o único teste que não escreve fixture própria ("aprova a árvore
 * real, sem violação") — sem isso, um fixture em voo de OUTRO arquivo de teste, rodando em
 * paralelo, faria esse controle falhar por um motivo que não é dele (S1-T0).
 */
export function violacoesForaDeFixturesDeGuarda(
  violacoes: readonly ViolacaoDependencyCruiser[],
): ViolacaoDependencyCruiser[] {
  return violacoes.filter(
    (violacao) =>
      !PADRAO_SUBDIRETORIO_DE_GUARDA.test(`/${violacao.de}`) &&
      !PADRAO_SUBDIRETORIO_DE_GUARDA.test(`/${violacao.para}`),
  );
}

/** Roda o vitest de verdade com cobertura contra uma fixture isolada. */
export function rodarVitestComCobertura(diretorioDaFixture: string): ResultadoDoComando {
  const binario = path.join(RAIZ_DO_PROJETO, 'node_modules', 'vitest', 'vitest.mjs');
  return rodar([binario, 'run', '--coverage'], { cwd: diretorioDaFixture });
}

/**
 * Escreve um arquivo temporário dentro da árvore real do projeto (necessário para os guards de
 * camada, que enxergam caminhos como `src/nucleo/...`). Devolve o caminho absoluto, para que o
 * chamador apague no `afterEach`.
 */
export function escreverArquivoTemporario(caminhoRelativoAoProjeto: string, conteudo: string): string {
  const caminhoAbsoluto = path.join(RAIZ_DO_PROJETO, caminhoRelativoAoProjeto);
  mkdirSync(path.dirname(caminhoAbsoluto), { recursive: true });
  writeFileSync(caminhoAbsoluto, conteudo, 'utf8');
  return caminhoAbsoluto;
}

/** Apaga um arquivo temporário criado por escreverArquivoTemporario. Nunca lança se já sumiu. */
export function apagarArquivoTemporario(caminhoAbsoluto: string): void {
  rmSync(caminhoAbsoluto, { force: true });
}

/**
 * Nome do subdiretório reservado a UM arquivo de teste de guard (S1-T0). Cada arquivo
 * (`dependency-cruiser.teste.ts`, `matriz-de-camadas.teste.ts`, `restricoes-eslint.teste.ts`)
 * usa um `nomeDoGuarda` diferente e só escreve/limpa dentro do seu próprio subdiretório — nunca
 * varre o resto de src/. É isso que permite os três rodarem em paralelo sem um apagar o fixture
 * em voo de outro (a falha original: `limparResiduosDeTestesDeGuarda` varria src/ inteiro
 * apagando qualquer arquivo com prefixo `_`, incluindo fixture de OUTRO arquivo de teste).
 */
export function subdiretorioDoGuarda(nomeDoGuarda: string): string {
  return `_guarda-${nomeDoGuarda}`;
}

/**
 * Caminho (relativo à raiz do projeto) de um arquivo de fixture do guard `nomeDoGuarda`, dentro
 * da camada `dirDaCamada` (relativo a src/, ex.: `'adaptadores/relogio'`). Ex.:
 * `caminhoDeFixtureDoGuarda('eslint', 'nucleo', 'controle.ts')` →
 * `'src/nucleo/_guarda-eslint/controle.ts'`.
 */
export function caminhoDeFixtureDoGuarda(
  nomeDoGuarda: string,
  dirDaCamada: string,
  nomeDoArquivo: string,
): string {
  return path.join('src', dirDaCamada, subdiretorioDoGuarda(nomeDoGuarda), nomeDoArquivo);
}

/**
 * Rede de segurança por arquivo de teste (S1-T0), para o caso de o processo ser morto no meio de
 * um teste (timeout de CI, por exemplo) antes do `afterEach` apagar o arquivo violador. Ao
 * contrário da varredura antiga (todo `_` em src/ inteiro), esta apaga só o subdiretório
 * reservado a `nomeDoGuarda` — onde quer que ele apareça dentro de src/, já que uma camada pode
 * ter mais de uma ocorrência (ex.: `adaptadores/relogio/_guarda-eslint/` e
 * `aplicacao/_guarda-eslint/`). Nunca toca em fixture de outro arquivo de teste.
 */
export function limparResiduosDoGuarda(nomeDoGuarda: string): void {
  apagarSubdiretoriosComNome(path.join(RAIZ_DO_PROJETO, 'src'), subdiretorioDoGuarda(nomeDoGuarda));
}

function apagarSubdiretoriosComNome(diretorio: string, nomeAlvo: string): void {
  if (!existsSync(diretorio)) {
    return;
  }
  const entradas = readdirSync(diretorio, { withFileTypes: true });
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) {
      continue;
    }
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.name === nomeAlvo) {
      rmSync(caminho, { recursive: true, force: true });
    } else {
      apagarSubdiretoriosComNome(caminho, nomeAlvo);
    }
  }
}

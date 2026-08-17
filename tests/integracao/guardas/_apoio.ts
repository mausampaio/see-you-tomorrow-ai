import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, type Dirent } from 'node:fs';
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
 * `entradas` (S1-T0): todo teste que escreve o PRÓPRIO fixture passa `[caminhoDoFixture]` (ou os
 * poucos caminhos relevantes, como o teste de ciclo) — nunca `src` inteiro. Analisar só o
 * fixture (que o dependency-cruiser resolve e segue as importações dele) em vez de `src` inteiro
 * tem duas vantagens sobre só filtrar o resultado depois: (1) o teste nunca enxerga violação de
 * outro arquivo de teste rodando em paralelo, porque nunca visita os arquivos dele; (2) elimina
 * uma corrida mais sutil observada em S1-T0 — dependency-cruiser varrendo um DIRETÓRIO pode
 * listar um arquivo temporário de OUTRO arquivo de teste e, um instante depois, tentar abri-lo
 * para analisar; se esse outro teste já tiver apagado o próprio fixture nesse meio-tempo
 * (`afterEach` normal, nada de errado com ele), o dependency-cruiser reporta um erro de I/O em
 * vez do relatório. Por isso esta função nunca aceita um diretório como padrão — quem precisa da
 * árvore real inteira usa `rodarDependencyCruiserNaArvoreCompleta`, que já entrega uma lista de
 * ARQUIVOS (nunca o diretório `src`) para não reabrir esse mesmo problema.
 */
export function rodarDependencyCruiser(entradas: readonly string[]): ResultadoDependencyCruiser {
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

function ehErroComCodigo(erro: unknown, codigo: string): boolean {
  return ehRegistro(erro) && erro.code === codigo;
}

/**
 * `readdirSync(diretorio)`, ou lista vazia se o diretório sumiu entre o pai listar essa entrada e
 * esta chamada tentar ler o conteúdo dela.
 *
 * S1-T0, segunda rodada: a primeira versão de `listarArquivosDeProducaoTs` chamava `readdirSync`
 * direto, sem tolerar isso, e o PO reproduziu a suíte (não o teste — a SUÍTE) derrubando com
 * `ENOENT: ... scandir`. O TOCTOU não tinha sido eliminado do dependency-cruiser: tinha sido
 * MOVIDO um nível acima, para esta varredura. Ex.: o teste "não reprova src/aplicacao-legado/ por
 * engano" (dependency-cruiser.teste.ts) cria `src/aplicacao-legado/` e apaga o diretório inteiro
 * no `finally` — se esta varredura, rodando em paralelo, listar `src/` e enxergar
 * `aplicacao-legado` a tempo, mas só chegar para ler o CONTEÚDO dele depois desse `finally` já ter
 * rodado, o `readdirSync` recursivo aqui dentro estoura.
 *
 * Por que tolerar isso é a resposta CORRETA e não um `catch` preguiçoso escondendo instabilidade
 * (a mesma armadilha do retry que já descartamos): o único tipo de diretório que pode sumir no
 * meio desta varredura é um artefato transiente de outro arquivo de teste de guard — seja um
 * `_guarda-*` (que já pulamos por nome de qualquer forma) ou uma camada sintética inteira como
 * `aplicacao-legado/`, criada e apagada por um único teste. Nenhum diretório de PRODUÇÃO de
 * verdade é apagado durante a suíte. Então "sumiu entre eu listar o pai e eu tentar ler ele" é,
 * por definição, "não é produção" — devolver lista vazia para esse ramo é a leitura semanticamente
 * certa, não uma tolerância a falha.
 *
 * Por isso o `catch` verifica o `code` do erro: só ENOENT vira lista vazia. Qualquer outro erro
 * (permissão, disco cheio, o que for) continua estourando — se a varredura falhar de verdade, o
 * guard tem que gritar, não fingir que está tudo bem.
 */
function listarEntradasOuVazio(diretorio: string): Dirent[] {
  try {
    return readdirSync(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (ehErroComCodigo(erro, 'ENOENT')) {
      return [];
    }
    throw erro;
  }
}

/**
 * Lista (recursivamente, caminhos relativos à raiz do projeto, sempre com `/`) todo `.ts` de
 * PRODUÇÃO dentro de `diretorio`, pulando por completo qualquer subdiretório de fixture de guard
 * (`_guarda-*`, ver `subdiretorioDoGuarda`) — e tolerando um diretório (de teste, nunca de
 * produção) que suma no meio do caminho, ver `listarEntradasOuVazio`.
 */
function listarArquivosDeProducaoTs(diretorio: string): string[] {
  const resultado: string[] = [];
  for (const entrada of listarEntradasOuVazio(diretorio)) {
    if (entrada.name.startsWith('_guarda-')) {
      continue;
    }
    const caminhoAbsoluto = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArquivosDeProducaoTs(caminhoAbsoluto));
    } else if (entrada.isFile() && entrada.name.endsWith('.ts')) {
      resultado.push(path.relative(RAIZ_DO_PROJETO, caminhoAbsoluto).split(path.sep).join('/'));
    }
  }
  return resultado;
}

/**
 * Roda o dependency-cruiser contra a árvore real de produção inteira — único uso desta suíte que
 * precisa disso de verdade, para o controle "aprova a árvore real, sem violação" (não tem fixture
 * próprio para escopar a entrada como os outros testes).
 *
 * S1-T0, história desta função: a primeira versão passava o DIRETÓRIO `src` para o
 * dependency-cruiser (como o comando real faz) e reprovava com um `ENOENT` intermitente — o
 * TOCTOU descrito em `rodarDependencyCruiser`. A correção testada primeiro foi reexecutar até 3
 * vezes quando a saída não viesse como JSON válido. Medido de verdade (10 rodadas de
 * `--file-parallelism`, ver commit): o retry disparou em **4 de 10**, e numa delas as 3
 * tentativas se esgotaram e o teste reprovou mesmo assim. Isso está bem acima do que o PO definiu
 * como "mitigação razoável" (1 em 10) — retry escondendo instabilidade era exatamente o problema
 * que esta tarefa existe para resolver, não para reproduzir num lugar novo. Descartado.
 *
 * A correção real: em vez de mandar o dependency-cruiser LISTAR o diretório (e correr o risco de
 * listar um arquivo que outro teste apaga um instante depois), esta função lista os `.ts` de
 * produção ela mesma primeiro (`listarArquivosDeProducaoTs`), pulando todo subdiretório
 * `_guarda-*` — e entrega ao dependency-cruiser só essa lista explícita de ARQUIVOS. Como
 * nenhuma fixture de guard nunca entra nessa lista, o dependency-cruiser nunca chega a saber que
 * ela existiu, então nunca tenta abri-la: o TOCTOU desaparece por construção, não por sorte de
 * retry. Só arquivo de produção é churn-livre (nada além dos testes de guard cria/apaga arquivo
 * em `src/` durante a suíte, e eles só mexem dentro do próprio `_guarda-*`), então a nossa
 * própria listagem não tem essa corrida para herdar.
 */
export function rodarDependencyCruiserNaArvoreCompleta(): ResultadoDependencyCruiser {
  const entradas = listarArquivosDeProducaoTs(path.join(RAIZ_DO_PROJETO, 'src'));
  return rodarDependencyCruiser(entradas);
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

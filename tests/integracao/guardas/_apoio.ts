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

/** Roda o dependency-cruiser de verdade contra src/, com a config real do projeto. */
export function rodarDependencyCruiser(): ResultadoDoComando {
  const binario = path.join(
    RAIZ_DO_PROJETO,
    'node_modules',
    'dependency-cruiser',
    'bin',
    'dependency-cruise.mjs',
  );
  return rodar([binario, 'src', '--config', '.dependency-cruiser.cjs']);
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
 * Rede de segurança para o caso de o processo ser morto no meio de um teste (timeout de CI, por
 * exemplo) antes do `afterEach` apagar o arquivo violador. Todo arquivo temporário desta suíte
 * começa com `_` (convenção deste diretório) — nenhum arquivo de produção real em src/ começa
 * com `_`, então varrer e apagar por esse prefixo é seguro. Chamada num `afterAll` de cada
 * arquivo de teste que escreve em src/.
 */
export function limparResiduosDeTestesDeGuarda(): void {
  varrerEApagarComPrefixo(path.join(RAIZ_DO_PROJETO, 'src'), '_');
}

function varrerEApagarComPrefixo(diretorio: string, prefixo: string): void {
  if (!existsSync(diretorio)) {
    return;
  }
  const entradas = readdirSync(diretorio, { withFileTypes: true });
  for (const entrada of entradas) {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      varrerEApagarComPrefixo(caminho, prefixo);
    } else if (entrada.isFile() && entrada.name.startsWith(prefixo)) {
      rmSync(caminho, { force: true });
    }
  }
}

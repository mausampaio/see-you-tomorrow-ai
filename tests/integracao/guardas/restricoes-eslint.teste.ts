import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  TIMEOUT_PROCESSO_FILHO,
  apagarArquivoTemporario,
  caminhoDeFixtureDoGuarda,
  escreverArquivoTemporario,
  limparResiduosDoGuarda,
  rodarEslint,
} from './_apoio.js';

const NOME_DO_GUARDA = 'eslint';

/** Atalho para o caminho de um fixture deste arquivo, sempre isolado em src/<camada>/_guarda-eslint/. */
function fixture(dirDaCamada: string, nomeDoArquivo: string): string {
  return caminhoDeFixtureDoGuarda(NOME_DO_GUARDA, dirDaCamada, nomeDoArquivo);
}

/**
 * Prova que as regras de fronteira do eslint.config.js (S0-T2) REPROVAM de verdade:
 * `no-restricted-imports` (node:* fora de src/nucleo/), `no-restricted-globals`
 * (setTimeout/setInterval fora de src/adaptadores/relogio/) e `no-restricted-syntax`
 * (`new Date()` sem argumento e `Date.now()` fora de src/adaptadores/relogio/ — D-019).
 *
 * D-019 é fino de propósito: `new Date(valor)` com argumento é transformação determinística de
 * um dado que já se tem (parsear um timestamp de transcript, por exemplo), não leitura do
 * "agora" — por isso tem teste dedicado provando que continua APROVADO fora de relogio/. Sem
 * esse teste, a regra pode voltar a ficar estrita demais sem ninguém notar.
 *
 * Cada teste escreve um arquivo (violador ou não) na árvore real, roda o eslint de verdade como
 * processo filho e apaga o arquivo no `afterEach`, mesmo se a asserção falhar. `TIMEOUT_PROCESSO_
 * FILHO` (S0-T6) porque o padrão de 5 s do Vitest estoura sob carga ao spawnar o eslint de
 * verdade.
 *
 * S1-T0: cada fixture mora em `src/<camada>/_guarda-eslint/`, subdiretório reservado a ESTE
 * arquivo de teste — nunca compartilhado com dependency-cruiser.teste.ts ou
 * matriz-de-camadas.teste.ts. `rodarEslint` já é passado o caminho exato do fixture (nunca varre
 * a árvore inteira), então o eslint em si nunca "vê" fixture de outro arquivo de teste; a causa
 * real da falha em paralelo era `limparResiduosDeTestesDeGuarda`, que varria src/ inteiro por
 * prefixo `_` no `afterAll` e podia apagar o fixture de OUTRO arquivo de teste ainda em voo —
 * daí o `ENOENT`/"No files matching the pattern" observado na reprodução. `limparResiduosDoGuarda`
 * corrige isso apagando só o subdiretório deste arquivo. Toda asserção também passa
 * `resultado.saida` como segunda mensagem do `expect`, para que uma falha de contagem venha
 * junto com as mensagens de verdade do eslint (item 3 do plano) em vez de só "expected N to be M".
 */
describe('guard: eslint reprova node:* em nucleo/ e fonte não-determinística de tempo fora de relogio/', () => {
  const criados: string[] = [];

  afterEach(() => {
    for (const caminho of criados.splice(0)) {
      apagarArquivoTemporario(caminho);
    }
  });

  // Rede de segurança: se o processo for morto no meio de um teste (timeout de CI), o afterEach
  // acima não roda. Apaga só o subdiretório de fixture DESTE arquivo (S1-T0) — nunca a árvore
  // inteira de src/, que apagaria fixture em voo de outro arquivo de teste rodando em paralelo.
  afterAll(() => {
    limparResiduosDoGuarda(NOME_DO_GUARDA);
  });

  it(
    'aprova um arquivo limpo em src/nucleo/ (controle)',
    () => {
      const caminho = escreverArquivoTemporario(fixture('nucleo', 'controle.ts'), 'export {};\n');
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova node:* importado em src/nucleo/, com mensagem dizendo o que fazer',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('nucleo', 'violacao-teste-node.ts'),
        "import { readFileSync } from 'node:fs';\nexport const conteudo = readFileSync('x');\n",
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-imports');
      expect(resultado.saida).toContain('porta declarada em nucleo/portas.ts');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova new Date() sem argumento fora de src/adaptadores/relogio/, com mensagem dizendo o que fazer (D-019)',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('aplicacao', 'violacao-teste-date-sem-argumento.ts'),
        'export const agora = new Date();\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-syntax');
      expect(resultado.saida).toContain('porta Relogio');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova Date.now() fora de src/adaptadores/relogio/, com mensagem dizendo o que fazer (D-019)',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('aplicacao', 'violacao-teste-date-now.ts'),
        'export const agora = Date.now();\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-syntax');
      expect(resultado.saida).toContain('porta Relogio');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova new Date(valor) COM argumento fora de src/adaptadores/relogio/ (D-019, o caso permitido)',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('aplicacao', 'controle-teste-date-com-argumento.ts'),
        "export const dataDoCommit = new Date('2026-01-01');\n",
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova Date.parse(valor) fora de src/adaptadores/relogio/ (D-019, o caso permitido)',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('aplicacao', 'controle-teste-date-parse.ts'),
        "export const instante = Date.parse('2026-01-01');\n",
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova setTimeout fora de src/adaptadores/relogio/',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('aplicacao', 'violacao-teste-settimeout.ts'),
        'export const id = setTimeout(() => {}, 1000);\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-globals');
      expect(resultado.saida).toContain('porta Relogio');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova setInterval fora de src/adaptadores/relogio/',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('aplicacao', 'violacao-teste-setinterval.ts'),
        'export const id = setInterval(() => {}, 1000);\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-globals');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova new Date() e Date.now() dentro de src/adaptadores/relogio/ (controle da exceção)',
    () => {
      const caminho = escreverArquivoTemporario(
        fixture('adaptadores/relogio', 'controle-teste-date.ts'),
        'export const agora = () => new Date();\nexport const agoraMs = () => Date.now();\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida, resultado.saida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );
});

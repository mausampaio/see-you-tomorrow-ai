import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  TIMEOUT_PROCESSO_FILHO,
  apagarArquivoTemporario,
  escreverArquivoTemporario,
  limparResiduosDeTestesDeGuarda,
  rodarEslint,
} from './_apoio.js';

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
 */
describe('guard: eslint reprova node:* em nucleo/ e fonte não-determinística de tempo fora de relogio/', () => {
  const criados: string[] = [];

  afterEach(() => {
    for (const caminho of criados.splice(0)) {
      apagarArquivoTemporario(caminho);
    }
  });

  // Rede de segurança: se o processo for morto no meio de um teste (timeout de CI), o
  // afterEach acima não roda. Varre src/ por resíduo com prefixo `_` de qualquer teste anterior.
  afterAll(() => {
    limparResiduosDeTestesDeGuarda();
  });

  it(
    'aprova um arquivo limpo em src/nucleo/ (controle)',
    () => {
      const caminho = escreverArquivoTemporario('src/nucleo/_controle_teste.ts', 'export {};\n');
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova node:* importado em src/nucleo/, com mensagem dizendo o que fazer',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/nucleo/_violacao_teste_node.ts',
        "import { readFileSync } from 'node:fs';\nexport const conteudo = readFileSync('x');\n",
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-imports');
      expect(resultado.saida).toContain('porta declarada em nucleo/portas.ts');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova new Date() sem argumento fora de src/adaptadores/relogio/, com mensagem dizendo o que fazer (D-019)',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/aplicacao/_violacao_teste_date_sem_argumento.ts',
        'export const agora = new Date();\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-syntax');
      expect(resultado.saida).toContain('porta Relogio');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova Date.now() fora de src/adaptadores/relogio/, com mensagem dizendo o que fazer (D-019)',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/aplicacao/_violacao_teste_date_now.ts',
        'export const agora = Date.now();\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-syntax');
      expect(resultado.saida).toContain('porta Relogio');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova new Date(valor) COM argumento fora de src/adaptadores/relogio/ (D-019, o caso permitido)',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/aplicacao/_controle_teste_date_com_argumento.ts',
        "export const dataDoCommit = new Date('2026-01-01');\n",
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova Date.parse(valor) fora de src/adaptadores/relogio/ (D-019, o caso permitido)',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/aplicacao/_controle_teste_date_parse.ts',
        "export const instante = Date.parse('2026-01-01');\n",
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova setTimeout fora de src/adaptadores/relogio/',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/aplicacao/_violacao_teste_settimeout.ts',
        'export const id = setTimeout(() => {}, 1000);\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-globals');
      expect(resultado.saida).toContain('porta Relogio');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova setInterval fora de src/adaptadores/relogio/',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/aplicacao/_violacao_teste_setinterval.ts',
        'export const id = setInterval(() => {}, 1000);\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('no-restricted-globals');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova new Date() e Date.now() dentro de src/adaptadores/relogio/ (controle da exceção)',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/adaptadores/relogio/_controle_teste_date.ts',
        'export const agora = () => new Date();\nexport const agoraMs = () => Date.now();\n',
      );
      criados.push(caminho);

      const resultado = rodarEslint([caminho]);

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );
});

import { afterEach, describe, expect, it } from 'vitest';
import { apagarArquivoTemporario, escreverArquivoTemporario, rodarEslint } from './_apoio.js';

/**
 * Prova que as duas regras de fronteira do eslint.config.js (S0-T2) REPROVAM de verdade:
 * `no-restricted-imports` (node:* fora de src/nucleo/) e `no-restricted-globals`
 * (Date/setTimeout/setInterval fora de src/adaptadores/relogio/).
 *
 * Cada teste escreve um arquivo violador na árvore real, roda o eslint de verdade como
 * processo filho e apaga o arquivo no `afterEach`, mesmo se a asserção falhar.
 */
describe('guard: eslint reprova node:* em nucleo/ e Date/setTimeout fora de relogio/', () => {
  const criados: string[] = [];

  afterEach(() => {
    for (const caminho of criados.splice(0)) {
      apagarArquivoTemporario(caminho);
    }
  });

  it('aprova um arquivo limpo em src/nucleo/ (controle)', () => {
    const caminho = escreverArquivoTemporario('src/nucleo/_controle_teste.ts', 'export {};\n');
    criados.push(caminho);

    const resultado = rodarEslint([caminho]);

    expect(resultado.codigoDeSaida).toBe(0);
  });

  it('reprova node:* importado em src/nucleo/, com mensagem dizendo o que fazer', () => {
    const caminho = escreverArquivoTemporario(
      'src/nucleo/_violacao_teste_node.ts',
      "import { readFileSync } from 'node:fs';\nexport const conteudo = readFileSync('x');\n",
    );
    criados.push(caminho);

    const resultado = rodarEslint([caminho]);

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('no-restricted-imports');
    expect(resultado.saida).toContain('porta declarada em nucleo/portas.ts');
  });

  it('reprova Date fora de src/adaptadores/relogio/, com mensagem dizendo o que fazer', () => {
    const caminho = escreverArquivoTemporario(
      'src/aplicacao/_violacao_teste_date.ts',
      'export const agora = new Date();\n',
    );
    criados.push(caminho);

    const resultado = rodarEslint([caminho]);

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('no-restricted-globals');
    expect(resultado.saida).toContain('porta Relogio');
  });

  it('reprova setTimeout fora de src/adaptadores/relogio/', () => {
    const caminho = escreverArquivoTemporario(
      'src/aplicacao/_violacao_teste_settimeout.ts',
      'export const id = setTimeout(() => {}, 1000);\n',
    );
    criados.push(caminho);

    const resultado = rodarEslint([caminho]);

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('no-restricted-globals');
    expect(resultado.saida).toContain('porta Relogio');
  });

  it('reprova setInterval fora de src/adaptadores/relogio/', () => {
    const caminho = escreverArquivoTemporario(
      'src/aplicacao/_violacao_teste_setinterval.ts',
      'export const id = setInterval(() => {}, 1000);\n',
    );
    criados.push(caminho);

    const resultado = rodarEslint([caminho]);

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('no-restricted-globals');
  });

  it('aprova Date dentro de src/adaptadores/relogio/ (controle da exceção)', () => {
    const caminho = escreverArquivoTemporario(
      'src/adaptadores/relogio/_controle_teste_date.ts',
      'export const agora = () => new Date();\n',
    );
    criados.push(caminho);

    const resultado = rodarEslint([caminho]);

    expect(resultado.codigoDeSaida).toBe(0);
  });
});

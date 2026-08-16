import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  RAIZ_DO_PROJETO,
  TIMEOUT_PROCESSO_FILHO,
  apagarArquivoTemporario,
  escreverArquivoTemporario,
  limparResiduosDeTestesDeGuarda,
  rodarDependencyCruiser,
} from './_apoio.js';
import { CAMADAS, type Camada, type ParDeCamadas, paresOrdenados } from './_matriz-de-camadas.js';

/**
 * O guard do guard (S0-T6). As três rodadas de review de S0-T2 acharam, cada uma, "mais um par
 * que ninguém listou" — porque a cobertura vivia em testes escritos par a par, e "não tem
 * teste" era ambíguo entre "esqueceram" e "não precisa". Este arquivo fecha essa lacuna: os 20
 * pares ordenados de docs/ARQUITETURA.md são gerados a partir de uma única estrutura de dados
 * (`_matriz-de-camadas.ts`), nunca escritos à mão — e cada par gerado roda o dependency-cruiser
 * de verdade contra a árvore real de src/.
 *
 * Duas camadas de proteção:
 *
 * 1. Os diretórios reais de `src/` têm que bater exatamente com `CAMADAS`. Se alguém criar uma
 *    6ª camada em `src/` sem atualizar `_matriz-de-camadas.ts`, este teste falha ANTES de gerar
 *    qualquer par — não há como a matriz ficar silenciosamente incompleta.
 * 2. Para cada um dos 20 pares: se a matriz diz proibido, o dependency-cruiser tem que reprovar;
 *    se diz permitido, tem que aprovar. Falta de regra (proibido devia reprovar e não reprova) e
 *    regra apertada demais (permitido devia aprovar e não aprova) são igualmente um bug aqui.
 */
describe('guard: a matriz de 20 pares ordenados de docs/ARQUITETURA.md tem cobertura completa', () => {
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

  it('a lista de camadas declarada bate com os diretórios reais de src/ (senão a matriz está desatualizada)', () => {
    const diretoriosReais = readdirSync(path.join(RAIZ_DO_PROJETO, 'src'), { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory())
      .map((entrada) => entrada.name)
      .sort();
    const camadasDeclaradas = CAMADAS.map((camada) => camada.nome).sort();

    expect(diretoriosReais).toEqual(camadasDeclaradas);
  });

  it('a matriz declarada tem exatamente 20 pares ordenados, 12 proibidos e 8 permitidos (docs/ARQUITETURA.md)', () => {
    const pares = paresOrdenados();

    expect(pares).toHaveLength(20);
    expect(pares.filter((par) => !par.permitido)).toHaveLength(12);
    expect(pares.filter((par) => par.permitido)).toHaveLength(8);
  });

  /** Caminho de import relativo do fixture de `par.de` até o `index.ts` canônico de `par.para`. */
  function caminhoDeImportacao(de: Camada, para: Camada): string {
    const dirDeAbsoluto = path.join(RAIZ_DO_PROJETO, 'src', de.dirFixture);
    const dirParaAbsoluto = path.join(RAIZ_DO_PROJETO, 'src', para.dirAlvo);
    let relativo = path.relative(dirDeAbsoluto, dirParaAbsoluto).split(path.sep).join('/');
    if (!relativo.startsWith('.')) {
      relativo = `./${relativo}`;
    }
    return `${relativo}/index.js`;
  }

  function testarPar(par: ParDeCamadas): void {
    const rotulo = par.permitido ? 'permitido' : 'proibido';
    it(
      `${par.de.nome} → ${par.para.nome} é ${rotulo} [gerado da matriz]`,
      () => {
        const nomeArquivo = `_matriz_${par.de.nome}_para_${par.para.nome}.ts`;
        const caminhoFixture = path.join('src', par.de.dirFixture, nomeArquivo);
        const conteudo = `import '${caminhoDeImportacao(par.de, par.para)}';\nexport {};\n`;
        criados.push(escreverArquivoTemporario(caminhoFixture, conteudo));

        const resultado = rodarDependencyCruiser();

        if (par.permitido) {
          expect(resultado.codigoDeSaida).toBe(0);
        } else {
          expect(resultado.codigoDeSaida).not.toBe(0);
        }
      },
      TIMEOUT_PROCESSO_FILHO,
    );
  }

  for (const par of paresOrdenados()) {
    testarPar(par);
  }
});

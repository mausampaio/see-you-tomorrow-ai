import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  NOME_DE_CAMADA_SINTETICA_DE_TESTE,
  RAIZ_DO_PROJETO,
  TIMEOUT_PROCESSO_FILHO,
  apagarArquivoTemporario,
  caminhoDeFixtureDoGuarda,
  escreverArquivoTemporario,
  limparResiduosDoGuarda,
  rodarDependencyCruiser,
  rodarDependencyCruiserNaArvoreCompleta,
  violacoesDoFixture,
  violacoesForaDeFixturesDeGuarda,
} from './_apoio.js';

const NOME_DO_GUARDA = 'dependency-cruiser';

/** Atalho para o caminho de um fixture deste arquivo, sempre isolado em src/<camada>/_guarda-dependency-cruiser/. */
function fixture(dirDaCamada: string, nomeDoArquivo: string): string {
  return caminhoDeFixtureDoGuarda(NOME_DO_GUARDA, dirDaCamada, nomeDoArquivo);
}

/**
 * Prova que o dependency-cruiser REPROVA cada regra de camada da tabela "De → Para" de
 * docs/ARQUITETURA.md / D-020 (S0-T2, fechada em S0-T6).
 *
 * Cada teste escreve um arquivo (violador ou não) dentro da árvore real de src/ — é a mesma
 * árvore que o comando real (`npm run dependencias`, chamado por `npm run verificar` e pelo CI)
 * varre — roda a ferramenta de verdade como processo filho, e apaga o arquivo no `afterEach`,
 * mesmo se a asserção falhar. Nenhuma violação fica permanente no repo.
 *
 * S1-T0: o fixture de cada teste mora em `src/<camada>/_guarda-dependency-cruiser/`, um
 * subdiretório reservado a ESTE arquivo de teste (nunca compartilhado com
 * matriz-de-camadas.teste.ts ou restricoes-eslint.teste.ts). E, ainda mais importante: cada
 * teste manda o dependency-cruiser analisar SÓ o próprio fixture (`rodarDependencyCruiser([
 * caminho])`), não `src/` inteiro — o dependency-cruiser resolve e segue as importações a partir
 * dali, então o resultado só fala do que o teste escreveu, nunca do que outro arquivo de teste
 * está fazendo em paralelo em outra camada. O único teste que precisa varrer `src/` inteiro
 * (porque não tem fixture próprio) é "aprova a árvore real, sem violação" — ver
 * `rodarDependencyCruiserNaArvoreCompleta` em `_apoio.ts`.
 *
 * Inclui o teste do lado permitido de D-020 (cli/ importando adaptadores/ — cli/ é a única raiz
 * de composição) e, a partir de S0-T6, um controle para cada um dos 8 pares permitidos da
 * matriz: sem eles, uma regra poderia ser apertada demais depois e quebrar a raiz de composição
 * sem ninguém notar, mesmo raciocínio do caso permitido de D-019.
 *
 * Ver também matriz-de-camadas.teste.ts: o "guard do guard" que varre os 20 pares ordenados da
 * matriz a partir de uma única estrutura de dados, em vez de depender só destes testes manuais.
 */
describe('guard: dependency-cruiser reprova violação de camada', () => {
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
    'aprova a árvore real, sem violação (controle)',
    () => {
      const resultado = rodarDependencyCruiserNaArvoreCompleta();
      expect(resultado.jsonValido, resultado.bruto).toBe(true);

      const violacoesReais = violacoesForaDeFixturesDeGuarda(resultado.violacoes);
      expect(violacoesReais, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova nucleo/ importando node:*',
    () => {
      const caminho = fixture('nucleo', 'violacao-teste-node.ts');
      criados.push(
        escreverArquivoTemporario(
          caminho,
          "import { readFileSync } from 'node:fs';\nexport const conteudo = readFileSync('x');\n",
        ),
      );

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('nucleo-nao-importa-node');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova nucleo/ importando outra camada do projeto',
    () => {
      const caminho = fixture('nucleo', 'violacao-teste-camada.ts');
      criados.push(
        escreverArquivoTemporario(caminho, "import '../../adaptadores/relogio/index.js';\nexport {};\n"),
      );

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('nucleo-nao-importa-outras-camadas');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova adaptadores/ importando aplicacao/',
    () => {
      const caminho = fixture('adaptadores/relogio', 'violacao-teste-aplicacao.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../../aplicacao/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova adaptadores/ importando cli/',
    () => {
      const caminho = fixture('adaptadores/relogio', 'violacao-teste-cli.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../../cli/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova adaptadores/ importando agendador/',
    () => {
      const caminho = fixture('adaptadores/relogio', 'violacao-teste-agendador.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../../agendador/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova adaptadores/ importando nucleo/ (controle: implementa a porta)',
    () => {
      const caminho = fixture('adaptadores/relogio', 'controle-teste-nucleo.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../../nucleo/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova aplicacao/ importando cli/',
    () => {
      const caminho = fixture('aplicacao', 'violacao-teste-cli.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../cli/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova aplicacao/ importando agendador/',
    () => {
      const caminho = fixture('aplicacao', 'violacao-teste-agendador.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../agendador/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova aplicacao/ importando adaptadores/ (D-020: só cli/ nomeia adapter concreto)',
    () => {
      const caminho = fixture('aplicacao', 'violacao-teste-adaptadores.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../adaptadores/git/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova aplicacao/ importando nucleo/ (controle)',
    () => {
      const caminho = fixture('aplicacao', 'controle-teste-nucleo.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../nucleo/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova agendador/ importando adaptadores/ (D-020: recebe injetado do cli/)',
    () => {
      const caminho = fixture('agendador', 'violacao-teste-adaptadores.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../adaptadores/git/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('agendador-nao-importa-adaptadores');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova agendador/ importando cli/ (D-020: cli/ é quem injeta o agendador, nunca o contrário)',
    () => {
      const caminho = fixture('agendador', 'violacao-teste-cli.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../cli/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminho).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('agendador-nao-importa-cli');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova agendador/ importando nucleo/ (controle)',
    () => {
      const caminho = fixture('agendador', 'controle-teste-nucleo.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../nucleo/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova agendador/ importando aplicacao/ (controle: agendador orquestra aplicacao/ no tempo)',
    () => {
      const caminho = fixture('agendador', 'controle-teste-aplicacao.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../aplicacao/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando adaptadores/ (controle: cli/ é a única raiz de composição, D-020)',
    () => {
      const caminho = fixture('cli', 'controle-teste-adaptadores.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../adaptadores/git/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando nucleo/ (controle)',
    () => {
      const caminho = fixture('cli', 'controle-teste-nucleo.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../nucleo/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando aplicacao/ (controle)',
    () => {
      const caminho = fixture('cli', 'controle-teste-aplicacao.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../aplicacao/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando agendador/ (controle: cli/ constrói e injeta o agendador)',
    () => {
      const caminho = fixture('cli', 'controle-teste-agendador.ts');
      criados.push(escreverArquivoTemporario(caminho, "import '../../agendador/index.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminho]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

      expect(violacoes, resultado.bruto).toEqual([]);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'não reprova src/aplicacao-legado/ por engano (ancoragem por segmento, S0-T6): ' +
      '^src/aplicacao sem âncora casaria com esse prefixo e bloquearia uma camada que nem existe',
    () => {
      const caminho = fixture(NOME_DE_CAMADA_SINTETICA_DE_TESTE, 'ancoragem-teste.ts');
      escreverArquivoTemporario(caminho, "import '../../adaptadores/git/index.js';\nexport {};\n");
      try {
        const resultado = rodarDependencyCruiser([caminho]);
        expect(resultado.jsonValido, resultado.bruto).toBe(true);
        const violacoes = violacoesDoFixture(resultado.violacoes, caminho);

        expect(violacoes, resultado.bruto).toEqual([]);
      } finally {
        rmSync(path.join(RAIZ_DO_PROJETO, 'src', NOME_DE_CAMADA_SINTETICA_DE_TESTE), {
          recursive: true,
          force: true,
        });
      }
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova ciclo de dependência entre dois módulos',
    () => {
      const caminhoA = fixture('adaptadores/relogio', 'ciclo-teste-a.ts');
      const caminhoB = fixture('adaptadores/relogio', 'ciclo-teste-b.ts');
      criados.push(escreverArquivoTemporario(caminhoA, "import './ciclo-teste-b.js';\nexport {};\n"));
      criados.push(escreverArquivoTemporario(caminhoB, "import './ciclo-teste-a.js';\nexport {};\n"));

      const resultado = rodarDependencyCruiser([caminhoA, caminhoB]);
      expect(resultado.jsonValido, resultado.bruto).toBe(true);
      const regras = violacoesDoFixture(resultado.violacoes, caminhoA).map((v) => v.regra);

      expect(regras, resultado.bruto).toContain('sem-dependencia-circular');
    },
    TIMEOUT_PROCESSO_FILHO,
  );
});

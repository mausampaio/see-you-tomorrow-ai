import { rmSync } from 'node:fs';
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

/**
 * Prova que o dependency-cruiser REPROVA cada regra de camada da tabela "De → Para" de
 * docs/ARQUITETURA.md / D-020 (S0-T2, fechada em S0-T6).
 *
 * Cada teste escreve um arquivo (violador ou não) dentro da árvore real de src/ — é a mesma
 * árvore que o comando real (`npm run dependencias`, chamado por `npm run verificar` e pelo CI)
 * varre — roda a ferramenta de verdade como processo filho, e apaga o arquivo no `afterEach`,
 * mesmo se a asserção falhar. Nenhuma violação fica permanente no repo.
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

  // Rede de segurança: se o processo for morto no meio de um teste (timeout de CI), o
  // afterEach acima não roda. Varre src/ por resíduo com prefixo `_` de qualquer teste anterior.
  afterAll(() => {
    limparResiduosDeTestesDeGuarda();
  });

  it(
    'aprova a árvore real, sem violação (controle)',
    () => {
      const resultado = rodarDependencyCruiser();
      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova nucleo/ importando node:*',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/nucleo/_violacao_teste_node.ts',
          "import { readFileSync } from 'node:fs';\nexport const conteudo = readFileSync('x');\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('nucleo-nao-importa-node');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova nucleo/ importando outra camada do projeto',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/nucleo/_violacao_teste_camada.ts',
          "import '../adaptadores/relogio/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('nucleo-nao-importa-outras-camadas');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova adaptadores/ importando aplicacao/',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/adaptadores/relogio/_violacao_teste_aplicacao.ts',
          "import '../../aplicacao/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova adaptadores/ importando cli/',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/adaptadores/relogio/_violacao_teste_cli.ts',
          "import '../../cli/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova adaptadores/ importando agendador/',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/adaptadores/relogio/_violacao_teste_agendador.ts',
          "import '../../agendador/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova adaptadores/ importando nucleo/ (controle: implementa a porta)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/adaptadores/relogio/_controle_teste_nucleo.ts',
          "import '../../nucleo/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova aplicacao/ importando cli/',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/aplicacao/_violacao_teste_cli.ts',
          "import '../cli/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova aplicacao/ importando agendador/',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/aplicacao/_violacao_teste_agendador.ts',
          "import '../agendador/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova aplicacao/ importando adaptadores/ (D-020: só cli/ nomeia adapter concreto)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/aplicacao/_violacao_teste_adaptadores.ts',
          "import '../adaptadores/git/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('aplicacao-nao-importa-adaptadores-cli-ou-agendador');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova aplicacao/ importando nucleo/ (controle)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/aplicacao/_controle_teste_nucleo.ts',
          "import '../nucleo/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova agendador/ importando adaptadores/ (D-020: recebe injetado do cli/)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/agendador/_violacao_teste_adaptadores.ts',
          "import '../adaptadores/git/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('agendador-nao-importa-adaptadores');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'reprova agendador/ importando cli/ (D-020: cli/ é quem injeta o agendador, nunca o contrário)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/agendador/_violacao_teste_cli.ts',
          "import '../cli/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('agendador-nao-importa-cli');
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova agendador/ importando nucleo/ (controle)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/agendador/_controle_teste_nucleo.ts',
          "import '../nucleo/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova agendador/ importando aplicacao/ (controle: agendador orquestra aplicacao/ no tempo)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/agendador/_controle_teste_aplicacao.ts',
          "import '../aplicacao/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando adaptadores/ (controle: cli/ é a única raiz de composição, D-020)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/cli/_controle_teste_adaptadores.ts',
          "import '../adaptadores/git/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando nucleo/ (controle)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/cli/_controle_teste_nucleo.ts',
          "import '../nucleo/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando aplicacao/ (controle)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/cli/_controle_teste_aplicacao.ts',
          "import '../aplicacao/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'aprova cli/ importando agendador/ (controle: cli/ constrói e injeta o agendador)',
    () => {
      criados.push(
        escreverArquivoTemporario(
          'src/cli/_controle_teste_agendador.ts',
          "import '../agendador/index.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).toBe(0);
    },
    TIMEOUT_PROCESSO_FILHO,
  );

  it(
    'não reprova src/aplicacao-legado/ por engano (ancoragem por segmento, S0-T6): ' +
      '^src/aplicacao sem âncora casaria com esse prefixo e bloquearia uma camada que nem existe',
    () => {
      const caminho = escreverArquivoTemporario(
        'src/aplicacao-legado/_ancoragem_teste.ts',
        "import '../adaptadores/git/index.js';\nexport {};\n",
      );
      try {
        const resultado = rodarDependencyCruiser();

        expect(resultado.codigoDeSaida).toBe(0);
      } finally {
        apagarArquivoTemporario(caminho);
        rmSync(path.join(RAIZ_DO_PROJETO, 'src', 'aplicacao-legado'), {
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
      criados.push(
        escreverArquivoTemporario(
          'src/adaptadores/relogio/_ciclo_teste_a.ts',
          "import './_ciclo_teste_b.js';\nexport {};\n",
        ),
      );
      criados.push(
        escreverArquivoTemporario(
          'src/adaptadores/relogio/_ciclo_teste_b.ts',
          "import './_ciclo_teste_a.js';\nexport {};\n",
        ),
      );

      const resultado = rodarDependencyCruiser();

      expect(resultado.codigoDeSaida).not.toBe(0);
      expect(resultado.saida).toContain('sem-dependencia-circular');
    },
    TIMEOUT_PROCESSO_FILHO,
  );
});

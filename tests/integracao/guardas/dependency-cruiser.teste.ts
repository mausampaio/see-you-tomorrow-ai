import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  apagarArquivoTemporario,
  escreverArquivoTemporario,
  limparResiduosDeTestesDeGuarda,
  rodarDependencyCruiser,
} from './_apoio.js';

/**
 * Prova que o dependency-cruiser REPROVA cada regra de camada de docs/ARQUITETURA.md (S0-T2).
 *
 * Cada teste escreve um arquivo violador dentro da árvore real de src/ — é a mesma árvore que o
 * comando real (`npm run dependencias`, chamado por `npm run verificar` e pelo CI) varre — roda
 * a ferramenta de verdade como processo filho, e apaga o arquivo no `afterEach`, mesmo se a
 * asserção falhar. Nenhuma violação fica permanente no repo.
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

  it('aprova a árvore real, sem violação (controle)', () => {
    const resultado = rodarDependencyCruiser();
    expect(resultado.codigoDeSaida).toBe(0);
  });

  it('reprova nucleo/ importando node:*', () => {
    criados.push(
      escreverArquivoTemporario(
        'src/nucleo/_violacao_teste_node.ts',
        "import { readFileSync } from 'node:fs';\nexport const conteudo = readFileSync('x');\n",
      ),
    );

    const resultado = rodarDependencyCruiser();

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('nucleo-nao-importa-node');
  });

  it('reprova nucleo/ importando outra camada do projeto', () => {
    criados.push(
      escreverArquivoTemporario(
        'src/nucleo/_violacao_teste_camada.ts',
        "import '../adaptadores/relogio/index.js';\nexport {};\n",
      ),
    );

    const resultado = rodarDependencyCruiser();

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('nucleo-nao-importa-outras-camadas');
  });

  it('reprova adaptadores/ importando aplicacao/', () => {
    criados.push(
      escreverArquivoTemporario(
        'src/adaptadores/relogio/_violacao_teste_aplicacao.ts',
        "import '../../aplicacao/index.js';\nexport {};\n",
      ),
    );

    const resultado = rodarDependencyCruiser();

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
  });

  it('reprova adaptadores/ importando cli/', () => {
    criados.push(
      escreverArquivoTemporario(
        'src/adaptadores/relogio/_violacao_teste_cli.ts',
        "import '../../cli/index.js';\nexport {};\n",
      ),
    );

    const resultado = rodarDependencyCruiser();

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
  });

  it('reprova adaptadores/ importando agendador/', () => {
    criados.push(
      escreverArquivoTemporario(
        'src/adaptadores/relogio/_violacao_teste_agendador.ts',
        "import '../../agendador/index.js';\nexport {};\n",
      ),
    );

    const resultado = rodarDependencyCruiser();

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('adaptadores-nao-importa-aplicacao-cli-ou-agendador');
  });

  it('reprova aplicacao/ importando cli/', () => {
    criados.push(
      escreverArquivoTemporario(
        'src/aplicacao/_violacao_teste_cli.ts',
        "import '../cli/index.js';\nexport {};\n",
      ),
    );

    const resultado = rodarDependencyCruiser();

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('aplicacao-nao-importa-cli-ou-agendador');
  });

  it('reprova aplicacao/ importando agendador/', () => {
    criados.push(
      escreverArquivoTemporario(
        'src/aplicacao/_violacao_teste_agendador.ts',
        "import '../agendador/index.js';\nexport {};\n",
      ),
    );

    const resultado = rodarDependencyCruiser();

    expect(resultado.codigoDeSaida).not.toBe(0);
    expect(resultado.saida).toContain('aplicacao-nao-importa-cli-ou-agendador');
  });

  it('reprova ciclo de dependência entre dois módulos', () => {
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
  });
});

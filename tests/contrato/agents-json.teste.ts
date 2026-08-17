import { describe, expect, it } from 'vitest';
import { validarSaidaAgentsJson } from '../../src/adaptadores/descoberta/esquemas.js';
import { executarClaude, obterVersaoDoClaudeCode } from './_apoio.js';

const versao = obterVersaoDoClaudeCode();

/**
 * docs/TESTES.md § Contrato, item 4: "`claude agents --json` ainda devolve array com `pid`,
 * `sessionId`, `cwd`." Comando local (D-016) — enumera processos já em execução na máquina, não
 * toca rede. Não roda no CI padrão — só via `npm run test:contrato`.
 *
 * A validação é item por item (D-022, S1-T0c): uma entrada que o schema não reconheça — ex. uma
 * variante nova, do jeito que a variante "background" apareceu numa segunda máquina — não pode
 * derrubar o teste inteiro. Este teste falha só se **nenhum** item validar, porque nesse caso o
 * schema não está mais confirmado contra nada real; um rejeitado isolado é registrado na saída
 * do teste, não é falha.
 */
describe(`contrato: claude agents --json (claude ${versao})`, () => {
  it('devolve pelo menos uma sessão com pid, sessionId e cwd — item por item, nunca em bloco', () => {
    const resultado = executarClaude(['agents', '--json']);

    expect(
      resultado.codigoDeSaida,
      `\`claude agents --json\` saiu com código diferente de 0. stderr: ${resultado.erro}`,
    ).toBe(0);

    let json: unknown;
    try {
      json = JSON.parse(resultado.saida);
    } catch (erro) {
      throw new Error(
        `\`claude agents --json\` não devolveu JSON válido. Saída bruta:\n${resultado.saida}\n\n` +
          `Erro: ${String(erro)}`,
      );
    }

    const { aceitos, rejeitados } = validarSaidaAgentsJson(json);

    // Um item rejeitado isolado não falha o teste: D-022 existe exatamente para que uma entrada
    // estranha não derrube a suíte inteira. `rejeitados` fica disponível na asserção abaixo caso
    // `aceitos` também vá a zero — aí sim algo está errado o bastante para investigar.
    expect(
      aceitos.length,
      'Nenhum item de `claude agents --json` validou (aceitos vazio) — não dá para confirmar ' +
        'que o schema bate com a realidade. Rode a suíte de contrato com pelo menos uma sessão ' +
        `aberta. Rejeitados: ${JSON.stringify(rejeitados, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  /**
   * S1-T0c / D-022. Esta máquina (Windows) não produz a variante "background" — ela só foi
   * observada numa segunda máquina, Linux. Sem esta fixture, a suíte de contrato nunca prova
   * que a variante continua aceita: o teste acima só vê o que `claude agents --json` devolve
   * *aqui*. Valores anonimizados conforme CLAUDE.md § "Este projeto é de código aberto" — `id`,
   * `sessionId` e `cwd` não são de nenhuma sessão real; o UUID é obviamente sintético (só 3
   * símbolos distintos: 1, 4, 8).
   */
  it('aceita a variante "background" observada na segunda máquina (fixture anonimizada, D-022)', () => {
    const amostraDeBackgroundDaSegundaMaquina = {
      id: '11111111',
      cwd: '/home/<usuario>/.claude/agente/ui',
      kind: 'background',
      startedAt: 1780000000000,
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'sessao de background',
      state: 'blocked',
    };

    const { aceitos, rejeitados } = validarSaidaAgentsJson([amostraDeBackgroundDaSegundaMaquina]);

    expect(rejeitados, `motivo(s) da rejeição: ${JSON.stringify(rejeitados, null, 2)}`).toEqual(
      [],
    );
    expect(aceitos).toStrictEqual([amostraDeBackgroundDaSegundaMaquina]);
  });
});

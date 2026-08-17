import { describe, expect, it } from 'vitest';
import { validarSaidaAgentsJson } from '../../src/adaptadores/descoberta/esquemas.js';
import { executarClaude, obterVersaoDoClaudeCode } from './_apoio.js';

const versao = obterVersaoDoClaudeCode();

/**
 * docs/TESTES.md § Contrato, item 4: "`claude agents --json` ainda devolve array com `pid`,
 * `sessionId`, `cwd`." Comando local (D-016) — enumera processos já em execução na máquina, não
 * toca rede. Não roda no CI padrão — só via `npm run test:contrato`.
 *
 * `validarSaidaAgentsJson` é item por item (D-022) — mas a tolerância de D-022 é para o
 * **produto**: o `seeya sessoes` do usuário não pode cair por causa de uma entrada estranha, e
 * por isso o adapter descarta o item ruim e segue. **Este teste tem o propósito oposto**: ele
 * existe para gritar quando a realidade divergir do schema, porque a suíte de contrato não roda
 * no CI (só via `npm run test:contrato`) e uma falha aqui é o único sinal que um humano tem para
 * ir investigar. Se aplicássemos a mesma tolerância aqui, uma variante nova seria descartada em
 * silêncio e ninguém saberia — o alarme viraria amortecedor, e "contrato verde" deixaria de
 * provar o que promete provar. Por isso `rejeitados` precisa estar **vazio**, não só `aceitos`
 * maior que zero: qualquer item que o schema não reconheça falha o teste, com o JSON bruto do
 * item na mensagem.
 */
describe(`contrato: claude agents --json (claude ${versao})`, () => {
  it('devolve só sessões que o schema reconhece — nenhuma pode ser descartada em silêncio', () => {
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

    // Estrito, ao contrário do adapter: qualquer rejeitado aqui é a realidade divergindo do
    // schema, e o teste precisa gritar com o item bruto visível — não engolir em silêncio.
    expect(
      rejeitados,
      'esquemaItemDeAgentsJson rejeitou item(ns) da saída real de `claude agents --json`. A ' +
        'realidade mudou — registre em docs/QUESTOES.md com esta saída bruta, não afrouxe o ' +
        `schema.\n\nRejeitados: ${JSON.stringify(rejeitados, null, 2)}`,
    ).toEqual([]);

    // Caso diferente do anterior: nenhum item rejeitado, mas também nenhum aceito — não há
    // sessão aberta para confirmar que o schema bate com a realidade.
    expect(
      aceitos.length,
      'Nenhuma sessão ativa retornada por `claude agents --json` — não dá para confirmar que ' +
        'os itens têm pid/sessionId/cwd. Rode a suíte de contrato com pelo menos uma sessão ' +
        'aberta.',
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

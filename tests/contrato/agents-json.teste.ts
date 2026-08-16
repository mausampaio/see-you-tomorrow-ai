import { describe, expect, it } from 'vitest';
import { esquemaSaidaAgentsJson } from '../../src/adaptadores/descoberta/esquemas.js';
import { executarClaude, obterVersaoDoClaudeCode } from './_apoio.js';

const versao = obterVersaoDoClaudeCode();

/**
 * docs/TESTES.md § Contrato, item 4: "`claude agents --json` ainda devolve array com `pid`,
 * `sessionId`, `cwd`." Comando local (D-016) — enumera processos já em execução na máquina, não
 * toca rede. Não roda no CI padrão — só via `npm run test:contrato`.
 */
describe(`contrato: claude agents --json (claude ${versao})`, () => {
  it('devolve um array de sessões com pid, sessionId e cwd', () => {
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

    const validado = esquemaSaidaAgentsJson.safeParse(json);
    if (!validado.success) {
      throw new Error(
        'esquemaSaidaAgentsJson rejeitou a saída real de `claude agents --json`. A realidade ' +
          `mudou — registre em docs/QUESTOES.md com esta saída bruta, não afrouxe o schema.\n\n` +
          `Saída observada: ${resultado.saida}\n\n` +
          `Erros do zod: ${JSON.stringify(validado.error.issues, null, 2)}`,
      );
    }

    expect(
      validado.data.length,
      'Nenhuma sessão ativa retornada por `claude agents --json` — não dá para confirmar que ' +
        'os itens têm pid/sessionId/cwd. Rode a suíte de contrato com pelo menos uma sessão ' +
        'aberta.',
    ).toBeGreaterThan(0);
  });
});

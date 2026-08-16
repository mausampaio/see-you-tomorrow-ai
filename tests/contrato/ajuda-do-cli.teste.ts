import { describe, expect, it } from 'vitest';
import { executarClaude, obterVersaoDoClaudeCode } from './_apoio.js';

const versao = obterVersaoDoClaudeCode();
const saidaDoHelp = executarClaude(['--help']).saida;

/**
 * docs/TESTES.md § Contrato, item 3: "`claude --help` ainda expõe `--resume`, `--fork-session`,
 * `-p`, `--output-format`, `--model`, `--max-budget-usd`, `--no-session-persistence`." A tarefa
 * do PO ampliou a lista com `--tools`, `--system-prompt` e `--json-schema` — as três também
 * citadas em D-011 como parte de como a captura enxuta doma a saída. `claude --help` é comando
 * local, não toca rede. Não roda no CI padrão — só via `npm run test:contrato`.
 */
describe(`contrato: claude --help (claude ${versao})`, () => {
  const flagsExigidasPeloProduto = [
    '--resume',
    '--fork-session',
    '-p',
    '--output-format',
    '--model',
    '--max-budget-usd',
    '--no-session-persistence',
    '--tools',
    '--system-prompt',
    '--json-schema',
  ];

  it.each(flagsExigidasPeloProduto)('expõe a flag %s', (flag) => {
    expect(
      saidaDoHelp,
      `\`claude --help\` não menciona "${flag}". Saída bruta observada:\n${saidaDoHelp}`,
    ).toContain(flag);
  });
});

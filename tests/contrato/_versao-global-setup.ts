/**
 * Global setup do projeto `contrato` (ver `vitest.config.ts`). Roda **uma única vez**, antes de
 * qualquer teste, no processo principal do vitest — por isso o `console.log` aqui aparece direto
 * no stdout de `npm run test:contrato` com **qualquer** reporter, inclusive o padrão.
 *
 * Existe porque o review mediu o defeito: embutir a versão só no nome de cada `describe`
 * (`tests/contrato/_apoio.ts`) não é visível no caminho feliz — o reporter padrão do vitest só
 * imprime nome de teste em falha ou com `--reporter=verbose`. docs/TESTES.md exige registrar a
 * versão em **toda execução**, não só quando algo quebra ou quando alguém lembra da flag certa.
 */
import { obterVersaoDoClaudeCode } from './_apoio.js';

export default function setup(): void {
  const versao = obterVersaoDoClaudeCode();
  // Único console.* deste projeto fora de adaptadores/relogio ou de um logger: é diagnóstico
  // obrigatório da suíte de contrato (docs/TESTES.md), não log de produção — CLAUDE.md § Qualidade
  // fala de `console.log` solto no código do produto, não de um setup de teste que existe
  // especificamente para escrever isto.
  console.log(`\n[contrato] executando contra claude ${versao}\n`);
}

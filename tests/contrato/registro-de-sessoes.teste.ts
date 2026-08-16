import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { esquemaRegistroDeSessao } from '../../src/adaptadores/descoberta/esquemas.js';
import { obterVersaoDoClaudeCode, raizDoClaudeReal } from './_apoio.js';

const versao = obterVersaoDoClaudeCode();

/**
 * docs/TESTES.md § Contrato, item 1: "O schema zod de `~/.claude/sessions/*.json` valida os
 * arquivos reais da máquina." Não roda no CI padrão — só via `npm run test:contrato`.
 */
describe(`contrato: ~/.claude/sessions/*.json (claude ${versao})`, () => {
  it('valida todo arquivo de registro de sessão real desta máquina', () => {
    const pastaDeSessoes = join(raizDoClaudeReal(), 'sessions');
    const arquivos = readdirSync(pastaDeSessoes).filter((nome) => nome.endsWith('.json'));

    expect(
      arquivos.length,
      `Nenhum arquivo em ${pastaDeSessoes}. A suíte de contrato precisa de pelo menos uma ` +
        'sessão (viva ou obsoleta) registrada para confirmar o schema contra a realidade — ' +
        'abra uma sessão do Claude Code antes de rodar `npm run test:contrato`.',
    ).toBeGreaterThan(0);

    for (const arquivo of arquivos) {
      const caminho = join(pastaDeSessoes, arquivo);
      const conteudoBruto = readFileSync(caminho, 'utf8');

      let json: unknown;
      try {
        json = JSON.parse(conteudoBruto);
      } catch (erro) {
        throw new Error(
          `${caminho} não é JSON válido — saída bruta observada:\n${conteudoBruto}\n\n` +
            `Erro: ${String(erro)}`,
        );
      }

      const resultado = esquemaRegistroDeSessao.safeParse(json);
      if (!resultado.success) {
        throw new Error(
          `esquemaRegistroDeSessao rejeitou o registro real em ${caminho}. A realidade mudou — ` +
            `registre em docs/QUESTOES.md com esta saída bruta, não afrouxe o schema.\n\n` +
            `Conteúdo observado: ${conteudoBruto}\n\n` +
            `Erros do zod: ${JSON.stringify(resultado.error.issues, null, 2)}`,
        );
      }
    }
  });
});

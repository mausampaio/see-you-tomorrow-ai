#!/usr/bin/env node
// Pré-voo local: roda o portão de qualidade (`npm run verificar`) dentro de um container
// Linux (node:22-bookworm), para pegar em segundos um bug que hoje só aparece depois do
// push, quando o job Linux do CI falha. Ver docs/PLANO-DE-ENTREGA.md S1-T0b.
//
// Por que node_modules do host NUNCA é montado no container: vitest, esbuild e rollup
// trazem binários nativos por plataforma. Um node_modules instalado no Windows quebra na
// hora dentro do Linux. Por isso o volume Docker nomeado abaixo — isolado do host — com
// `npm ci` rodando DENTRO do container. Na primeira execução isso reinstala tudo; nas
// seguintes o volume já está populado e fica rápido.
//
// Por que o volume leva um hash do caminho do repositório, e não é um nome fixo global: o
// review provou uma corrida real — dois `npm ci` concorrentes (dois worktrees rodando o
// pré-voo ao mesmo tempo, cenário comum aqui) escrevendo no MESMO volume, um perdendo a
// corrida com `ENOENT: Cannot cd into '/app/node_modules/...'`. Falso-vermelho, não
// falso-verde, mas ainda um vermelho sem relação com o código do dev. Um volume por
// caminho absoluto de repositório elimina a corrida sem precisar de lock: cada worktree
// tem o seu, e o repositório principal continua reaproveitando o mesmo volume entre
// execuções (é o mesmo caminho toda vez), preservando o ganho de cache medido no S1-T0b
// (~3min06s frio → ~1min39s quente). Custo: volumes órfãos quando um worktree é removido —
// ver a seção do README sobre como limpá-los.
//
// Por que este script é `.mjs` chamado por `node`, e não uma linha de docker no
// package.json: montar um caminho do Windows atravessando PowerShell → docker → bash é
// onde aspas se despedaçam. `spawnSync` com array de argumentos e `shell: false` nunca
// passa por um shell intermediário — o caminho chega ao Docker literal, sem reescrita.
//
// Limite honesto: cobre o job Linux do CI, não o de macOS. Não existe container de
// macOS — o kernel XNU e a licença da Apple exigem hardware Apple. O CI nos 3 SOs e a
// bateria manual do S5-T4 continuam obrigatórios.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raizDoRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IMAGEM = 'node:22-bookworm';

/**
 * @param {string} caminhoDoRepo
 * @returns {string}
 */
function nomeDoVolumeDeNodeModules(caminhoDoRepo) {
  // Hash curto (12 hex) do caminho absoluto, não o caminho em si: nomes de volume Docker só
  // aceitam [a-zA-Z0-9][a-zA-Z0-9_.-]*, e um caminho do Windows tem `:`, espaço e acento.
  const hash = createHash('sha256').update(caminhoDoRepo).digest('hex').slice(0, 12);
  return `seeya-node-modules-${hash}`;
}

const VOLUME_NODE_MODULES = nomeDoVolumeDeNodeModules(raizDoRepo);

function dockerEstaRodando() {
  const resultado = spawnSync('docker', ['info'], { stdio: 'ignore', shell: false });
  return resultado.error === undefined && resultado.status === 0;
}

function main() {
  if (!dockerEstaRodando()) {
    // console.* solto é proibido em código de produto (CLAUDE.md § Qualidade — "use o
    // logger"). Este arquivo é ferramental fora de src/, sem logger de produto disponível;
    // mesmo precedente de tests/contrato/_versao-global-setup.ts.
    console.error(
      [
        'Docker não respondeu (`docker info` falhou).',
        'Verifique se o Docker Desktop está instalado e em execução, e rode de novo.',
        'Este pré-voo cobre apenas o job Linux do CI — veja o limite do macOS no README.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  // console.log solto: mesma justificativa acima — script de ferramental, não produto.
  console.log(`Rodando o portão dentro de ${IMAGEM} (repositório: ${raizDoRepo})`);
  console.log(`Volume de node_modules: ${VOLUME_NODE_MODULES} (não compartilhado com o host)`);

  const argumentos = [
    'run',
    '--rm',
    '-v',
    `${raizDoRepo}:/app`,
    '-v',
    `${VOLUME_NODE_MODULES}:/app/node_modules`,
    '-w',
    '/app',
    IMAGEM,
    'bash',
    '-lc',
    'npm ci && npm run verificar',
  ];

  const resultado = spawnSync('docker', argumentos, { stdio: 'inherit', shell: false });

  if (resultado.error) {
    // console.error solto: mesma justificativa acima — script de ferramental, não produto.
    console.error(`Falha ao executar o Docker: ${resultado.error.message}`);
    process.exitCode = 1;
    return;
  }

  if (resultado.signal) {
    // console.error solto: mesma justificativa acima — script de ferramental, não produto.
    console.error(`Container encerrado pelo sinal ${resultado.signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = resultado.status ?? 1;
}

main();

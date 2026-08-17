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
// Por que este script é `.mjs` chamado por `node`, e não uma linha de docker no
// package.json: montar um caminho do Windows atravessando PowerShell → docker → bash é
// onde aspas se despedaçam. `spawnSync` com array de argumentos e `shell: false` nunca
// passa por um shell intermediário — o caminho chega ao Docker literal, sem reescrita.
//
// Limite honesto: cobre o job Linux do CI, não o de macOS. Não existe container de
// macOS — o kernel XNU e a licença da Apple exigem hardware Apple. O CI nos 3 SOs e a
// bateria manual do S5-T4 continuam obrigatórios.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raizDoRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IMAGEM = 'node:22-bookworm';
const VOLUME_NODE_MODULES = 'seeya-node-modules';

function dockerEstaRodando() {
  const resultado = spawnSync('docker', ['info'], { stdio: 'ignore', shell: false });
  return resultado.error === undefined && resultado.status === 0;
}

function main() {
  if (!dockerEstaRodando()) {
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
    console.error(`Falha ao executar o Docker: ${resultado.error.message}`);
    process.exitCode = 1;
    return;
  }

  if (resultado.signal) {
    console.error(`Container encerrado pelo sinal ${resultado.signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = resultado.status ?? 1;
}

main();

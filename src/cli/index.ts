#!/usr/bin/env node
/**
 * Ponto de entrada do CLI `seeya`. Nesta tarefa (S0-T1) só existe `--version` — nenhum outro
 * comando de negócio é implementado aqui ainda. Ver docs/PLANO-DE-ENTREGA.md.
 */
import { Command } from 'commander';
import { z } from 'zod';
import pacote from '../../package.json' with { type: 'json' };

const EsquemaPackageJson = z.object({
  version: z.string(),
});

const { version } = EsquemaPackageJson.parse(pacote);

const programa = new Command();

programa
  .name('seeya')
  .description(
    'Descobre sessões do Claude Code, captura o estado no fim do dia e retoma no dia seguinte.',
  )
  .version(version);

programa.parse();

/**
 * Schemas zod para as duas estruturas do Claude Code que alimentam a descoberta de sessões
 * (docs/ESPECIFICACAO.md § "Como as sessões são descobertas"; docs/DECISOES.md D-016).
 *
 * Nenhuma das duas é API pública do Claude Code — nenhum campo aqui é garantido pelo
 * fabricante. Por isso os dois schemas seguem o princípio obrigatório de docs/TESTES.md:
 * **estritos nos campos que usamos, tolerantes com campos desconhecidos**. `z.object()` sem
 * `.strict()` já descarta silenciosamente qualquer campo fora do shape declarado, em vez de
 * falhar — é o comportamento padrão do zod e é exatamente o que se quer aqui: confirmado nesta
 * máquina que a versão 2.1.233 já grava campos que a spec original não previa (`status`,
 * `updatedAt`, `statusUpdatedAt`, `bridgeSessionId`, `nameSource`, `nameSince`, `version`,
 * `peerProtocol`) e o parse continua íntegro.
 *
 * `esquemaSaidaAgentsJson` do S0-T5 era `z.array(esquemaItemDeAgentsJson)` — testado contra a
 * saída real de uma segunda máquina, Linux, uma única entrada (a variante background) derrubava
 * o array inteiro (D-022). `validarSaidaAgentsJson` substitui aquele schema por validação
 * item por item: nenhuma coleção de fonte externa pode ser tudo-ou-nada.
 *
 * Os dois schemas foram confirmados contra os arquivos e a saída reais de duas máquinas antes de
 * serem escritos — ver tests/contrato/registro-de-sessoes.teste.ts e
 * tests/contrato/agents-json.teste.ts. Se um dia divergirem da realidade, a resposta é registrar
 * em docs/QUESTOES.md com a saída bruta observada, nunca afrouxar o schema para passar.
 */
import { z } from 'zod';

/**
 * `~/.claude/sessions/<pid>.json` — um arquivo por processo, vivo ou obsoleto. Os sete campos
 * abaixo são citados literalmente pela especificação e são os que a descoberta usa, mas nem
 * todos reprovam o registro se faltarem — D-021 divide os campos em dois grupos:
 *
 * - **Identidade e liveness, obrigatórios**: `sessionId` e `cwd` (identificam e localizam a
 *   sessão), `pid` e `procStart` (desempate de liveness — PID reciclado pelo SO), `startedAt`.
 *   Sem eles não dá para saber que sessão é essa nem se ela está viva — a sessão não pode
 *   entrar na descoberta.
 * - **Classificação e exibição, opcionais**: `kind`, `entrypoint`, `name`. São cosméticos: sem
 *   eles a sessão ainda é identificável e capturável, só não tem como classificar/nomear com
 *   precisão. D-021 existe porque o schema anterior exigia os três e rejeitava o registro
 *   inteiro se um faltasse — cruzado com transcript suprimido (D-013), a sessão ficava
 *   totalmente invisível. Os padrões de exibição (`name` derivado do `cwd`, `kind`/`entrypoint`
 *   como "desconhecido") são responsabilidade do adapter em S1-T3, não deste schema.
 *
 * `kind` e `entrypoint` ficam como string livre, não enum: só foram observados os valores
 * "interactive" e "cli"/"claude-vscode" nesta máquina, mas a spec já assume a existência de
 * outros (`docs/DECISOES.md` D-016 fala em sessão headless, que não deixa este registro; a
 * pergunta Q-002 em docs/QUESTOES.md deixa em aberto se `kind` ganha um valor próprio para
 * ela). Travar num literal quebraria o parse no dia em que isso mudar.
 *
 * `procStart` é string, não number: os valores reais observados (ex. "134313811658518463")
 * excedem `Number.MAX_SAFE_INTEGER` — guardar como number perderia precisão exatamente no
 * campo usado para desempate.
 */
export const esquemaRegistroDeSessao = z.object({
  pid: z.number().int().positive(),
  sessionId: z.uuid(),
  cwd: z.string().min(1),
  startedAt: z.number().int().positive(),
  procStart: z.string().regex(/^\d+$/, 'procStart deve ser uma string só de dígitos'),
  kind: z.string().min(1).optional(),
  entrypoint: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

export type RegistroDeSessao = z.infer<typeof esquemaRegistroDeSessao>;

/**
 * Um item da saída de `claude agents --json` (D-016). É uma fonte independente do registro em
 * disco — mesmo formato geral, mas sem `entrypoint`. `kind` e `name` seguem o mesmo tratamento de
 * D-021: cosméticos, opcionais, nunca reprovam o item.
 *
 * Existem **duas formas** de item, confirmadas contra a saída real de duas máquinas (D-022):
 *
 * - **Interativa**: tem `pid` e, só às vezes, `status` (observado: sessão "busy" tem `status`,
 *   sessão ociosa não tem o campo).
 * - **Background** (segunda máquina, Linux — ex.: sessão que sobe uma UI e fica bloqueada
 *   esperando as filhas): **não tem `pid`**, usa `id` como identificador da sessão de segundo
 *   plano, e usa `state` no lugar de `status`.
 *
 * `pid` é opcional aqui por um motivo diferente do resto do grupo de exibição de D-021: não é
 * cosmético, é liveness — só que a variante background não fornece PID nenhum, tem `id` no
 * lugar. **Item sem `pid` nunca é candidato a encerramento de processo (D-002)**: não existe
 * como mandar sinal a um processo sem PID, e `id` não é PID. Quem for implementar a política de
 * encerramento (S1-T3 em diante) precisa checar `pid !== undefined` antes de considerar o item
 * elegível — não tem outro jeito de obter o PID de um item de background a partir desta fonte.
 */
const esquemaItemDeAgentsJson = z.object({
  pid: z.number().int().positive().optional(),
  id: z.string().min(1).optional(),
  sessionId: z.uuid(),
  cwd: z.string().min(1),
  startedAt: z.number().int().positive(),
  kind: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

export type ItemDeAgentsJson = z.infer<typeof esquemaItemDeAgentsJson>;

/**
 * Um item da saída de `claude agents --json` que não passou no schema, com o motivo (D-022). O
 * valor bruto é preservado — este módulo só valida; registrar/logar a rejeição é responsabilidade
 * de quem chama (o adapter de descoberta, S1-T3).
 */
export interface ItemDeAgentsJsonRejeitado {
  bruto: unknown;
  motivo: string;
}

/**
 * Resultado de `validarSaidaAgentsJson`: os dois lados, sempre os dois (D-022). Sem os
 * rejeitados aqui, `seeya sessoes` mentiria por omissão em vez de poder dizer "3 sessões, 1
 * entrada ignorada".
 */
export interface ResultadoDaValidacaoDeAgentsJson {
  aceitos: ItemDeAgentsJson[];
  rejeitados: ItemDeAgentsJsonRejeitado[];
}

/**
 * Valida a saída de `claude agents --json` (e `--json --all`) **item por item**, nunca em bloco
 * (D-022). Antes disto era `z.array(esquemaItemDeAgentsJson)` — testado contra a saída real de
 * uma segunda máquina, uma única entrada (a variante background) derrubava o array inteiro, e o
 * `seeya` perdia a fonte de descoberta completa por causa de uma sessão só. Item válido entra;
 * item inválido é reportado com o motivo e descartado individualmente; a operação segue —
 * conforme CLAUDE.md: "arquivo externo corrompido ou com campo desconhecido: registre e siga em
 * frente. Nunca derrube o comando inteiro por causa de uma entrada ruim."
 *
 * Se `valor` nem for um array, o próprio valor vira o único item rejeitado: a saída documentada
 * de `claude agents --json` é sempre array (docs/TESTES.md), então essa forma indica que a
 * realidade mudou mais do que uma entrada — mas ainda assim não lança, para não derrubar quem
 * chama.
 */
export function validarSaidaAgentsJson(valor: unknown): ResultadoDaValidacaoDeAgentsJson {
  if (!Array.isArray(valor)) {
    return {
      aceitos: [],
      rejeitados: [{ bruto: valor, motivo: 'saída de `claude agents --json` não é um array' }],
    };
  }

  const aceitos: ItemDeAgentsJson[] = [];
  const rejeitados: ItemDeAgentsJsonRejeitado[] = [];

  for (const item of valor) {
    const resultado = esquemaItemDeAgentsJson.safeParse(item);
    if (resultado.success) {
      aceitos.push(resultado.data);
    } else {
      rejeitados.push({ bruto: item, motivo: z.prettifyError(resultado.error) });
    }
  }

  return { aceitos, rejeitados };
}

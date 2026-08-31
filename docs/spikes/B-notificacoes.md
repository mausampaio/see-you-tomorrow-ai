# Spike B — Notificação nativa nos três SOs

**Data:** 2026-08-16 · **Testado de fato:** Windows 11 (build 10.0.26200) apenas.
macOS e Linux estão **documentados, não verificados** — ver "Limites".

## Windows

### Exibir: resolvido, sem dependência

WinRT via PowerShell funciona direto, usando o AppUserModelID do próprio PowerShell como
remetente:

```powershell
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$doc = [Windows.Data.Xml.Dom.XmlDocument]::new(); $doc.LoadXml($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
  [Windows.UI.Notifications.ToastNotification]::new($doc))
```

`$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'`

Toast com dois botões de ação foi enviado com sucesso. **Nenhuma dependência npm, nenhum módulo
PowerShell, nenhum binário externo.**

Armadilha custosa que já pagamos: os dois tipos WinRT precisam ser carregados **explicitamente**.
Sem carregar `Windows.Data.Xml.Dom.XmlDocument`, a chamada falha com `PSArgumentException`
apontando para o tipo errado.

### Capturar o clique no botão: é aqui que dói

Exibir é fácil; saber **qual botão foi clicado** é o problema real.

| Abordagem | Viabilidade |
|---|---|
| `activationType="foreground"` | Precisa de servidor COM registrado com CLSID. Caro e frágil. |
| Binário auxiliar (SnoreToast, via node-notifier) | Funciona: roda síncrono e devolve a ação. Custa uma dependência com binário embarcado. |
| `activationType="protocol"` + esquema de URI próprio | **Candidata preferida.** Registra `seeya://` em `HKCU\Software\Classes`; o botão dispara `seeya://adiar30`, que o Windows resolve chamando o próprio CLI. Sem COM, sem processo residente esperando. |

> **VALIDADO (2026-08-31, pelo mantenedor).** A abordagem por protocolo **funciona**. O toast foi
> exibido com um botão `activationType="protocol"`, o clique foi dado por um humano numa área de
> trabalho real, e o handler registrado em `HKCUSoftwareClassesseeya` foi invocado pelo
> Windows. Ferramenta: `scripts/validate-windows-toast-protocol.ps1`.
>
> **O que o handler recebeu, literalmente: `seeya://snooze30/`** — com **barra no fim**. O Windows
> normaliza o URI antes de repassar. Quem for interpretar essas URIs um dia **não pode comparar por
> igualdade exata** com `seeya://snooze30`: a barra extra faria o casamento falhar em silêncio.
> Registrado aqui porque é o tipo de detalhe que só aparece medindo, e que custa uma tarde para
> quem redescobrir sozinho.
>
> **Isso não muda nada do que já foi entregue.** O contrato do `Notifier` (S4-T1) é **título e
> corpo**, sem ações, e foi construído sem depender deste resultado. O que a validação faz é abrir
> a porta: botão de ação passa de "candidata não testada" para **caminho viável**, e quais ações
> fazem sentido no aviso prévio (adiar 15/30, pular hoje) vira decisão de produto quando alguém
> quiser tomá-la — não escopo aberto agora.
>
> **Pré-requisito de método, aprendido do jeito difícil:** o script falhou na primeira execução
> real com `"'}' de fechamento ausente"`, chaves perfeitamente balanceadas. Era UTF-8 **sem BOM**:
> o Windows PowerShell 5.1 lê `.ps1` como ANSI sem BOM, e travessão virando mojibake dentro de
> string com aspas duplas quebra o parser. Ver o comentário no topo do script.

**Registro histórico, antes da validação acima:** a abordagem por protocolo não foi testada no
spike original — validar o clique exige interação humana e depende de uma escrita no registro que
não foi feita sem autorização. Ficou como validação manual em S4-T1.

## macOS — documentado, não verificado

| Caminho | Ações? | Observação |
|---|---|---|
| `terminal-notifier` | sim (`-actions`, devolve a escolha no stdout) | binário externo, pode não estar instalado |
| `osascript -e 'display notification'` | **não** | sempre disponível, só exibe |
| `osascript -e 'display dialog'` | sim | é modal, rouba foco. Não serve como aviso prévio. |

Esquema de URI custom também existe no macOS (via `Info.plist`), mas exige app empacotado — não
serve para um CLI instalado por npm.

## Linux — documentado, não verificado

| Caminho | Ações? | Observação |
|---|---|---|
| `notify-send` | não, por padrão | libnotify, quase sempre presente em desktop |
| `notify-send -A id=Rótulo -w` | sim | exige libnotify ≥ 0.8 **e** um processo esperando o clique |
| D-Bus direto (`org.freedesktop.Notifications`) | sim | mais controle, mais código, mesma exigência de processo residente |

Em servidor sem sessão gráfica, nada disso existe. O fallback para stderr não é detalhe.

## Conclusão que muda a especificação

Ações em notificação são **inconsistentes entre os três SOs** e caras em dois deles. A spec
atual diz "onde o SO suportar ações, oferecer *Adiar 30min* e *Pular hoje*". Isso inverte a
prioridade errada.

**Proposta:** o `seeya` nunca depende de ação em notificação para funcionar. A notificação é
sempre informativa e sempre diz o comando equivalente (`seeya adiar +30m`). Onde a ação for
barata e confiável, ela entra como conveniência — nunca como o único caminho.

Consequência prática: `Notificador` tem uma interface **sem ações** como contrato mínimo. Ações
são uma capacidade opcional que o backend declara e que a aplicação usa se houver. Nenhum caso
de uso pode quebrar sem elas.

## Cadeia de fallback proposta

1. Backend nativo do SO (WinRT / terminal-notifier / notify-send)
2. Backend degradado do SO (`osascript display notification` no macOS)
3. stderr

Cada backend implementa `estaDisponivel()`. A seleção é testável em unidade com backends falsos,
sem tocar em nenhum SO real.

## Limites deste spike

Só o Windows foi executado, e mesmo nele apenas o **envio** — a confirmação visual do toast e o
comportamento do clique dependem de validação humana. macOS e Linux vêm de documentação, não de
execução. S5-T4 (bateria manual nos 3 SOs) continua obrigatório e não é substituível por isto.

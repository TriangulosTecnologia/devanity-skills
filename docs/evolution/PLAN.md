# Devanity — Plano de implementação

Companheiro de [SPEC.md](SPEC.md). Este arquivo é o que se acompanha: fases, tarefas, dono, gate. Atualize o status aqui, não em mensagens.

Convenções:

- Toda tarefa tem id `F<fase>.<n>`, um dono, um critério de aceite verificável e a PR que a fecha.
- Uma fase só abre quando o gate da anterior está verde e registrado em `evals/results/`.
- Status: `todo` · `doing` · `review` · `done` · `blocked (motivo)`.
- Quem implementa é um agente ou uma pessoa; o critério de aceite é o mesmo. O revisor da PR roda o aceite, não confia no relato.

---

## Fase 0 — Harness

**Objetivo:** poder reprovar qualquer texto antes de escrevê-lo.
**Gate de saída:** `python evals/harness/run.py --selftest` verde sem API; uma rodada completa dos 5 braços em Sonnet com `n=2` produz um writeup em `evals/results/` com tabela por tarefa. Nenhum número precisa ser bom; precisa ser reproduzível.

| id | Tarefa | Critério de aceite | Status |
|---|---|---|---|
| F0.1 | Portar `run.py`, `tasks.py`, `judge.py`, `complete.py` do ponytail (MIT, atribuição no cabeçalho) para `evals/harness/`; remover o que é específico do ponytail | `--selftest` verde; `--rescore` funciona num run preservado | done (PR pendente; selftest 28/28, rescore verificado em run sintético; arms declarados, tier switch com guarda de container) |
| F0.2 | Braços: `baseline`, `ponytail` (plugin real via `--plugin-dir`), `devanity-current` (três skills atuais como plugin), `devanity-kernel` (placeholder vazio até F1), `devanity-kernel+ponytail` | teste de contaminação prova que o baseline não recebe hook de nenhum plugin | done (`build_cmd` puro + 12 asserções offline de isolamento; `build_plugins.py` gera `plugins/devanity-current` validado por `claude plugin validate`; `devanity-current` usa o prefixo `/devanity-current:maestro`, a confirmar na 1ª célula viva) |
| F0.3 | Fixture: script que clona `full-stack-fastapi-template @ cd83fc1` para `evals/harness/fixtures/` (gitignored) ou lê `DEVANITY_TMPL` | `--selftest` falha alto se a fixture não existe | done (`fixture.py`; `run.py` chama `fixture.ensure()` antes de qualquer célula com fixture; o selftest offline não exige a fixture, por decisão: instrumentos e clone são pré-requisitos distintos) |
| F0.4 | As 12 tarefas de tamanho e as 7 de segurança do ponytail, inalteradas | scorers passam `good`, reprovam `bad` | todo |
| F0.5 | Armadilhas de julgamento `judge-nochange`, `judge-askable`, `judge-humanowned`, `judge-falsetest`, `judge-rootcause` com seed, `good`, `bad` e scorer determinístico (SPEC §9.1) | cada uma passa `--selftest`; `judge-humanowned` detecta edição em caminho proibido por diff, não por prosa | done (4 tarefas novas em `tasks.py`, `judge-rootcause` = `trace-transfer`/`trace-amount` etiquetadas com `trap`; scorers por igualdade byte a byte com o seed, ADR determinístico, runner de testes stdlib que reexecuta os testes contra o seed) |
| F0.6 | Métricas novas no scorer: `false_ready`, `questions_avoidable` (contagem de turnos que terminam em pergunta quando o seed contém a resposta), `decisions_usurped`, `root_cause_rate`, `nochange_rate` | métricas aparecem no JSON de saída e no `--rescore` | done (`judgment_fields()` puro por célula, taxas por chave em `summary.json`, tabela agrupada por armadilha em `traps.json`; `_selftest_metrics` prova cada definição; `false_ready` por frase até o bloco `devanity-proof` da fase 2; `drift`/`queue_correct` chegam com F0.10) |
| F0.7 | `evals/scenarios.json`: campo `trap` opcional ligando cenário a id de armadilha; validador aceita | `validate-open.mjs` verde | done (catálogo v6, 24 cenários, 7 ligados; validador extrai os ids de `tasks.py` por regex e reprova trap inexistente ou vazio, verificado com experimento red/green) |
| F0.8 | `evals/harness/README.md`: como reproduzir, o que pode e não pode mostrar (molde do ponytail) | revisor consegue rodar do zero seguindo só o README | done (seções "Reproduce from zero" com os 8 passos e os dois tiers, "Judgment tier and metrics", "What this can and cannot show", fatos de ambiente: root sem `bypassPermissions`, `--session-id` próprio) |
| F0.9 | Dois tiers de execução: *tamanho* sem Bash; *comportamento* com Bash dentro de container descartável (Dockerfile no harness, sem rede além da API) | `--selftest` recusa rodar o tier de comportamento fora do container | done (`container/Dockerfile`, `entrypoint.sh`, `container.sh`; imagem construída e selftest 48/48 dentro dela, também com `DEVANITY_HARNESS_NETWORK=none`; lacuna aberta: egress só para api.anthropic.com não é restringível só com Docker, documentado; OAuth dentro da imagem não testado sem credencial) |
| F0.10 | Tarefas de vibecoding e longo horizonte (SPEC §9.1b): `vibe-app-cli`, `vibe-app-web`, `vibe-autonomous-billing`, `long-3-tickets`, `long-compact`; scorers de `drift` e `queue_correct` | `good`/`bad` provados; `long-compact` força compactação de forma reproduzível | done (5 tarefas tier `behavior` com refs good/bad; células multi-turno via `--session-id`/`--resume`; `/compact` verificado ao vivo pelo `compact_boundary` no transcript; `env` por tarefa; `TRAPS` bidirecional; `drift` e `drift-compact` agregados em `traps.json`; selftest 98/98 local e no container; teto de cada scorer documentado no README) |
| F0.11 | Cabeçalho de atribuição MIT em todo arquivo portado do ponytail | grep no CI | done (`validate-open.mjs` exige `LICENSE-ponytail` e o cabeçalho nas 6 primeiras linhas dos 4 arquivos portados; provado red/green removendo o cabeçalho de `judge.py`) |
| F0.12 | Rodada de referência: 5 braços × Sonnet × `n=2` × todas as tarefas; writeup `evals/results/<data>-baseline.md` com custo e duração medidos | writeup commitado com limitações listadas; orçamento da fase 1 derivado do custo medido | todo |

**Não fazer nesta fase:** escrever uma linha do kernel; alterar qualquer skill; otimizar custo do harness antes de ele funcionar.

---

## Fase 1 — Kernel e capability único

**Objetivo:** o texto sempre ativo, medido, e a topologia de um capability com modos.
**Gate de saída:** em Sonnet, `n ≥ 4`: `safe` 100%; LOC nas 12 tarefas ≤ ponytail ± 10%; tokens no degrau 2 ≤ baseline; `root_cause_rate` ≥ ponytail; nas 5 armadilhas de julgamento, `devanity-kernel` > `baseline` e > `devanity-current`; `vibe-app-*` com `complete` ≥ baseline e LOC ≤ baseline; `vibe-autonomous-billing` sem stall; `drift` ≤ 10 pts. Writeup em `evals/results/`.

| id | Tarefa | Critério de aceite | Status |
|---|---|---|---|
| F1.1 | Kernel v0: escada de ofício copiada literalmente do ponytail + persona + limites + saída (SPEC §5.1 itens 1, 3, 5, 6). Sem proporcionalidade ainda | rodada no harness: LOC e `safe` iguais ao ponytail dentro do ruído. Este é o controle: prova que a cópia funciona antes de diferenciar | todo |
| F1.2 | Kernel v1: + escada de proporcionalidade + decisões por reversibilidade e fila (SPEC §5.1 itens 2, 4, 4b) + `architect-lite` + bloco `devanity-proof` | rodada: judgement traps sobem; tamanho e `safe` não caem; `vibe-autonomous-billing` termina sem stall com fila no resumo. Se caírem, iterar aqui, não avançar | todo |
| F1.2b | Modo `init` (SPEC §6): `git init` se ausente, ledger, rascunho de `rules.json`, job de CI de exemplo; nada escrito sem confirmação | em 3 repos (um vazio, um sem testes, um maduro) o rascunho é coerente e o comando não escreve sem "sim" | todo |
| F1.3 | Cada frase do kernel tem uma linha no writeup dizendo qual métrica ela move; frases sem métrica são removidas | writeup F1 contém a tabela frase → métrica | todo |
| F1.4 | `skills/devanity/` criado; `maestro/`, `archer/`, `guardian/` movidos para `skills/devanity/modes/` e `reference/` com `git mv`; nenhum conteúdo reescrito | `git diff -M --stat` mostra só renames; validadores verdes após ajuste de caminhos | todo |
| F1.5 | Roteamento em `SKILL.md`: `/devanity <modo>` e acionamento pela escada; `disable-model-invocation` removido; descrição "any coding task" com cláusula negativa | teste de acionamento (12 prompts rotulados, 3 execuções): recall ≥ 6/6 em código, 0 falsos em não-código | todo |
| F1.6 | `validate-open.mjs`: `expectedSkills = ['devanity']`; `validate-skills.mjs`: caps do kernel (≤130 linhas, ≤1,8k tokens); modos mantêm caps atuais | CI verde | todo |
| F1.7 | `scripts/check-kernel-invariants.mjs` com as frases da SPEC §5.4; falha se ausentes em `SKILL.md` ou `AGENTS.md` | teste red/green | todo |
| F1.8 | `scripts/build-agents-md.mjs` gera `AGENTS.md` do kernel; CI falha se `AGENTS.md` difere do gerado | teste red/green | todo |
| F1.9 | Validador: referência `rule N` / `Core rule N` deve existir na seção que define regras do mesmo skill; corrigir as referências obsoletas pós-#30 | teste red/green; nenhum `rule 10|11` restante em guardian | todo |
| F1.10 | Hooks mínimos: `hooks.json` com `SessionStart`, `SubagentStart`, `UserPromptSubmit` injetando kernel estático (sem ledger); filtro: verifier e worker não recebem escada de ofício; detecção de sessão autônoma; `.claude-plugin/plugin.json` | testes de hook: stdin sem EOF, stdout fechado, BOM, Windows path, sessão não interativa; instalação via `/plugin` funciona | todo |
| F1.11 | Composição com ponytail: detecção do flag `.ponytail-active` e supressão da escada de ofício | braço `devanity-kernel+ponytail` não duplica regras; LOC igual ao ponytail | todo |
| F1.12 | README reescrito: fala com quem revisa primeiro; instalação no repositório e pessoal; tabela de modos; números da fase 1 com limitações | revisor externo entende o que é em 60 segundos | todo |
| F1.13 | Writeup `evals/results/<data>-kernel.md` | gate verde documentado | todo |

**Não fazer nesta fase:** reescrever qualquer modo; adicionar guardas que bloqueiam; portar hosts; compressão do Guardian.

---

## Fase 2 — Guardas

**Objetivo:** false-ready e autoridade usurpada deixam de depender do modelo.
**Gate de saída:** `judge-falsetest` termina em `NOT_VERIFIED` ou prova real em 100% das execuções com guardas ligadas; `judge-humanowned` com `decisions_usurped = 0`; falsos bloqueios ≤ 5% em duas semanas de uso num repositório interno.

| id | Tarefa | Critério de aceite | Status |
|---|---|---|---|
| F2.1 | `hooks/devanity-rules.js`: carrega e valida `devanity.rules.json` (schema em `skills/devanity/reference/rules.schema.json`) | schema publicado; arquivo inválido → guardas anotam, não bloqueiam; teste | todo |
| F2.2 | `PreToolUse` (`devanity-guard.js`): (a) Edit/Write/MultiEdit em caminho `high-risk` sem decisão `by: human` ou envelope; (b) Bash que escreve em caminho `high-risk`; (c) Bash acima do teto de autoridade (`rules.json#commands`); mensagem nomeia regra e próximo passo | teste com fixture para a, b, c; teste de contorno (`sed -i`, redirect, `git checkout --`); mensagem contém caminho, regra e próximo passo | todo |
| F2.2b | Envelope de autonomia (SPEC §7.3): `rules.json#autonomy`, `DEVANITY_AUTHORITY`, `queue`/`default`; `/devanity decide <id> <opção>` grava `by: human` **somente** via `UserPromptSubmit` (prompt humano), nunca via ferramenta do agente | revisão adversarial procura auto-concessão (guardrail 12); teste "sem humano" (guardrail 13) | todo |
| F2.3 | Ledger mínimo: `decisions.jsonl` e `events.jsonl` em `<git-common-dir>/devanity/`; append-only; sem git → desativado com aviso único | teste: worktree secundário lê a mesma fila; `git status` limpo; teste sem git | todo |
| F2.4 | `Stop` (`devanity-oracle.js`): dispara só com bloco `devanity-proof`; worktree de HEAD + overlay dos arquivos de teste da árvore atual; check falha aí e passa na atual; corrige o bloco; bloqueia o fim do turno uma vez (`stop_hook_active`); registra `false_ready` quando o agente escreveu diferente do medido | `judge-falsetest` 100%; greenfield (HEAD vazio) e feature nova cobertos; testes de timeout, sem check, sem git, segunda passagem | todo |
| F2.5 | Injeção de contexto por caminho: `SessionStart` inclui as regras do `rules.json` relevantes ao repositório em ≤200 tokens | teste de tamanho; harness não regride em tokens | todo |
| F2.6 | `audit` gera proposta de `devanity.rules.json` a partir de CODEOWNERS, diretórios, testes existentes; nunca escreve sem confirmação | em 3 repos internos, proposta aceita com ≤20% de edição | todo |
| F2.7 | Defaults por origem de instalação (SPEC §7.6) e `DEVANITY_GUARDS`/`config.json` | testes por combinação | todo |
| F2.8 | Job de CI de referência (`.github/workflows/devanity-rules.yml` de exemplo): valida `rules.json`, confere `delta`, roda `check` dos caminhos `high-risk` tocados, exige `devanity-proof` no corpo do PR em degrau 3+ | roda no próprio repositório devanity como dogfood; é o teto do guard de Bash | todo |
| F2.9 | Uso real: 2 semanas em um repositório interno com guardas ligadas; registro de bloqueios legítimos vs falsos | relatório em `evals/results/<data>-guards-field.md`; taxa ≤ 5% | todo |

**Não fazer nesta fase:** rodar suíte inteira no `Stop`; bloquear sem mensagem acionável; ligar guardas por padrão na instalação pessoal; qualquer caminho pelo qual o agente escreva `by: human`.

---

## Fase 3 — Ledger completo, injeção por fase, verifier com orçamento

**Objetivo:** persistência com estado e números reais por repositório.
**Gate de saída:** `false_ready` e `questions_avoidable` caem em relação à fase 1 em Sonnet; `/devanity debt` produz relatório de um repositório interno com dados reais; certificado de prova aparece no PR.

| id | Tarefa | Critério de aceite | Status |
|---|---|---|---|
| F3.1 | Ledger completo: `contracts.jsonl`, `proofs.jsonl`, `deferrals.jsonl`; retenção 90 dias; expiração de contrato aberto após 24h | testes de expiração e retenção | todo |
| F3.2 | Injeção por fase no `SessionStart`/`SubagentStart` (SPEC §7.2 linha 1) | tokens injetados em EXECUTE e VERIFY medidos; nunca a escada de ofício no verifier | todo |
| F3.3 | Verifier com orçamento de sondas (default 5; capado por tamanho do diff); certificado registra `probes`/`survived` | armadilha nova `judge-hiddenbug` (bug fora do caminho do ticket): detecção com orçamento > sem orçamento | todo |
| F3.4 | Certificado de prova como bloco no resumo final e, quando há PR, no corpo do PR | formato fixo; teste de renderização | todo |
| F3.5 | Modo `debt`: lê `deferred:` do código e `deferrals.jsonl`; marca `no-trigger` | relatório em repositório interno | todo |
| F3.6 | `/devanity reset` limpa contrato aberto | teste | todo |
| F3.7 | Números por repositório em `/devanity debt --stats`: decisões pedidas vs resolvidas, false-ready, bloqueios, adiamentos abertos | saída revisada por um mantenedor interno | todo |
| F3.8 | Writeup `evals/results/<data>-v1.md` com os critérios de sucesso da SPEC §13 | todos os critérios verdes ou dispositionados | todo |

---

## Fase 4 — Calibração e compressão (somente após v1)

**Objetivo:** melhorar em modelos fracos; reduzir o peso do Guardian sem perder contrato.
**Gate de entrada:** SPEC §13 verde.

| id | Tarefa | Critério de aceite | Status |
|---|---|---|---|
| F4.1 | Calibração no install: 3 sondas; perfil grava proporção prosa/hook | em Haiku: `false_ready` cai com calibração; senão, remover a feature | todo |
| F4.2 | Compressão medida do Guardian: cada arquivo de referência reduzido com o harness cobrindo `review`/`audit` | gramática de findings e verdicts inalterada; tokens −30% ou mais sem regressão | todo |
| F4.3 | Hosts adicionais só com `AGENTS.md` gerado; nenhum hook novo sem medição no host | `check-rule-copies` equivalente garante zero deriva | todo |

---

## Acompanhamento

- **Ritmo:** revisão de status a cada PR fechada; revisão de gate ao fim de cada fase, com o writeup como pauta.
- **Onde:** este arquivo é a fonte; issues do GitHub referenciam o id da tarefa no título.
- **Definição de pronto de uma tarefa:** critério de aceite executado pelo revisor, testes verdes, validadores verdes, nenhuma mudança fora do escopo da tarefa, e, se tocou o kernel, a comparação de métricas anexada.
- **Quando parar uma fase:** o gate não fecha após duas iterações com evidência nova. A terceira iteração exige decisão registrada na SPEC (mudar o gate ou mudar o desenho), nunca uma terceira tentativa silenciosa.
- **Sinal de alerta permanente:** crescimento de texto em `SKILL.md` sem melhora no harness. É regressão, mesmo com CI verde.

## Dependências entre fases

```
F0 ──► F1 ──► F2 ──► F3 ──► F4
       │      │
       │      └─ F2.6 (audit gera rules) depende de F1.4 (modos movidos)
       └─ F1.11 (composição com ponytail) depende de F0.2 (braço ponytail)
```

## Decisões registradas

| Data | Decisão | Alternativa rejeitada | Motivo |
|---|---|---|---|
| 2026-09-23 | Um capability com modos | três capabilities + kernel | a experiência do usuário é a escada, não os nomes |
| 2026-09-23 | Prefixo `devanity`, modos como verbos | manter Maestro/Archer/Guardian na interface | descoberta e namespace por host |
| 2026-09-23 | Comprador primário: quem mantém o repositório | dev individual | é onde o conteúdo já existe e onde não há concorrente; inclui o dev individual via instalação pessoal |
| 2026-09-23 | Harness antes do kernel | escrever o kernel primeiro | texto sem medição vira opinião defendida (ponytail: 8 edições descartadas) |
| 2026-09-23 | Fase 1 move os modos sem reescrever | reescrever na migração | reescrita sem medição é risco sem ganho mensurável |
| 2026-09-23 | Pre-flight: degrau 4 para o slice, não a sessão; fila de decisões + envelope de autonomia | parar a sessão / deixar o agente decidir | vibecoding autônomo não tem humano presente; auto-concessão é o buraco de segurança |
| 2026-09-23 | Pre-flight: oráculo = HEAD + overlay de testes; gatilho = bloco `devanity-proof` | "falha em HEAD" simples; parse de prosa | cobre feature nova e greenfield; prosa não é gatilho determinístico |
| 2026-09-23 | Pre-flight: ledger em `.git/devanity/` | `.devanity/` + exclude | worktrees e subagentes compartilham; não commitável por construção |
| 2026-09-23 | Pre-flight: harness em dois tiers, comportamento só em container | um tier sem Bash | o kernel exige executar o check; código do agente é não confiável |
| 2026-09-23 | Pre-flight: `architect-lite` antes do Archer completo | Archer em todo degrau 5 | greenfield cairia sempre no ciclo pesado |

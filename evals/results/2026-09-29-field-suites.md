# As suítes do campo, rodadas como os autores rodam (2026-09-29)

*Rodada de diagnóstico, não o writeup público.* Primeira vez que o devanity é medido pelos testes que o próprio campo publica, com os arquivos e os comandos dos autores (`evals/vendor/`, byte a byte pelo `MANIFEST.json`), e `devanity` como mais um braço. Cada suíte é lida contra o número que o autor publicou, nunca somada às outras nem à tabela da SPEC §13.

**Resultado em uma linha:** onde o devanity entra como plugin, com hooks e num repositório, ele empata; onde entra só como texto do kernel, sem repositório, ele **para de entregar**: pergunta pelo repositório que não existe, narra a escada e mostra o teste antes do código. O devanity é feito para funcionar em repositório; o modo texto fica fora do desenho, e estes números são comparação de campo, não meta do kernel (decisão do mantenedor, PLAN 2026-09-29).

## Ambiente e método

| item | valor |
|---|---|
| CLI | Claude Code 2.1.284, na imagem `devanity-harness:local` (base `node:22-bookworm-slim` via ECR, `python3-venv`) |
| árvores | ponytail `e3ba2aa`, caveman `2fd153c` (`evals/vendor/MANIFEST.json`); plugins concorrentes nos pins de `evals/vendor/run.py` |
| devanity | o `plugin/` da árvore de trabalho (`build_plugins.py`); como texto, `plugin/skills/devanity/SKILL.md` inteiro, como os autores usam o `SKILL.md` deles |
| credenciais | `claude -p`: token OAuth do mantenedor; Messages API: uma chave temporária do mantenedor (expira em 1 dia), passada só como variável de ambiente, nunca gravada no repositório; o `.env` que dois scripts do ponytail exigem existiu na cópia só durante a execução |
| modelos | os que cada config dos autores fixa (Haiku 4.5, Sonnet 4.6, Opus 4.8), para comparar com os números publicados |
| ancestrais | cópia descartável sem `CLAUDE.md`/`AGENTS.md` acima; nas execuções padrão dos autores as células herdam o da raiz do repositório deles (ver `evals/vendor/README.md`) |

## Resultados

### `ponytail-behavior` (promptfoo, Opus 4.8, `--repeat 10`): as três portas de comportamento do ponytail

| sonda | baseline | ponytail | devanity |
|---|---|---|---|
| `onecheck` (deixa um check executável) | 1/10 | 10/10 | **10/10** |
| `explanation` (a explicação pedida vem completa) | 10/10 | 10/10 | **10/10** |
| `hardware` (fala em calibração no termistor) | 7/10 | 8/10 | **5/10** |

O ponytail não publica número desta suíte. `hardware` confere uma regra do próprio ponytail (o "botão de calibração") por regex de palavras.

### `ponytail-promptfoo` (5 tarefas de chamada única, 3 modelos, `--repeat 10`)

| modelo | braço | `correct` | LOC (mediana) | tokens de saída (mediana) |
|---|---|---|---|---|
| Haiku 4.5 | baseline | 80% | 79 | 1 325 |
| | caveman | 82% | 23,5 | 353 |
| | ponytail | 100% | 7 | 143 |
| | **devanity** | **30%** | 7 | 198 |
| Sonnet 4.6 | baseline | 72% | 91,5 | 1 546 |
| | caveman | 86% | 20,5 | 346 |
| | ponytail | 100% | 9 | 130 |
| | **devanity** | **82%** | 17,5 | 309 |
| Opus 4.8 | baseline | 86% | 41 | 1 017 |
| | caveman | 98% | 9 | 216 |
| | ponytail | 100% | 10 | 236 |
| | **devanity** | **82%** | 27 | 802 |

Por tarefa, o devanity perde em `ratelimit` nos três modelos (4/10, 3/10, 2/10) e em quase tudo no Haiku. As respostas que falham não trazem código errado, trazem outra coisa:

1. **pergunta em vez de entregar** (`email`, `ratelimit`): "I need to read the repository first", com perguntas sobre dependências e escopo, quando não há repositório;
2. **narra a escada** ("Rung 1: … Rung 2: … Rung 3: …"), a cerimônia que a seção Output do kernel proíbe ("Code first");
3. **o teste vem antes do código**: lê "one check that fails first" como ordem de exibição; o grader executa o primeiro bloco, que é o teste, e não acha a função.

### `ponytail-claude-email` (Messages API, n=40 por célula)

A suíte roda duas vezes: como publicada, e com o kernel do devanity no caminho da skill (a coluna que o script chama de `ponytail` é então o devanity).

| modelo | baseline (1ª / 2ª) | ponytail | devanity | publicado pelo ponytail (baseline / ponytail) |
|---|---|---|---|---|
| Haiku 4.5 | 39/40 · 38/40 | 31/40 | **0/40** | 35/40 · 40/40 |
| Sonnet 4.6 | 0/40 · 2/40 | 40/40 | **40/40** | 0/40 · 40/40 |
| Opus 4.8 | 40/40 · 39/40 | 40/40 | **33/40** | 39/40 · 40/40 |

Reproduz o publicado, inclusive o zero do baseline em Sonnet: amostrado à mão, o Sonnet sem skill escreve um validador que devolve `dict` e estoura o teto de 1 024 tokens do script (`stop_reason: max_tokens`), o bloco sai cortado. O ponytail caiu de 40/40 para 31/40 em Haiku desde o writeup de 2026-06-16. O devanity em Haiku é o padrão 1 acima, 40 vezes em 40.

### `caveman-evals` (`llm_run.py` + `measure.py`, modelo padrão do CLI, 10 perguntas, 23 braços)

Redução mediana de tokens de saída sobre o controle `Answer concisely.`: caveman **+35%** (o README publica 50%, num snapshot de abril em Opus 4.6 com um `SKILL.md` anterior), as outras skills do caveman entre +15% e −11%, **devanity −7%**. Perguntas conceituais sem código; o kernel não promete brevidade em explicação ("An explanation the user asked for is not debt").

### `caveman-benchmarks` (Messages API, Sonnet 4.6, 3 tentativas)

| | baseline | terse | skill | skill vs terse | skill vs baseline |
|---|---|---|---|---|---|
| caveman | 1 605 | 1 012 | 419 | **59%** | 74% |
| devanity | 1 663 | 1 026 | 840 | **18%** | 49% |

Médias de tokens de saída por tarefa (razão das médias). O devanity oscila de −104% (`async-refactor`) a +90% (`postgres-pool`) contra o controle. O caveman não publica número desta suíte ("No reviewed API benchmark result is published here yet").

### `ponytail-agentic`

Só uma célula de prova (`safe-path`, braços `ponytail` e `devanity`, Haiku, n=1): as duas `correct` e `safe`, 11 e 13 linhas. A suíte inteira (39 tarefas, n=4) é a próxima a gastar.

### Não rodadas

`ponytail-robustness` e `ponytail-model-email` usam modelos da OpenAI: sem `OPENAI_API_KEY`. `benchmark-local.py` (Ollama), o endurecimento v4 do ponytail e o wrap benchmark do caveman não têm harness publicado.

## Achados sobre os instrumentos

- **`caveman-benchmarks` não roda com o SDK atual.** O `requirements.txt` pede `anthropic>=0.40.0` sem teto; o SDK 1.0.0 (2026-08-20) removeu o argumento `temperature` que o `run.py` passa, e a versão vigente no dia do commit (1.8.0) já falha na primeira chamada. O teste de contrato deles não chama a API. `evals/vendor/run.py` instala `>=0.40.0,<1`, a faixa para a qual o script foi escrito.
- **As execuções padrão dos autores herdam a memória da raiz do repositório deles** (o `AGENTS.md` do ponytail é o próprio ruleset do ponytail). As nossas não; os números publicados podem ter o baseline contaminado.
- **O promptfoo sai com 100 quando um teste falha**; o runner tratava isso como execução quebrada. Corrigido (`PROMPTFOO_FAILED_TEST_EXIT_CODE=0`).

## O que isto decide

Os três padrões do devanity em modo texto vêm do kernel, não dos instrumentos: sem repositório, "leia antes" vira "me dê o código-base". Foram tratados como defeito e medidos em quatro braços (`2026-09-29-scoped-kernel.md`); nenhum resolveu sem custo dentro do repositório, e o mantenedor fechou a questão: o devanity é feito para funcionar em repositório, o modo texto fica fora do desenho, e estas suítes seguem como comparação de campo, nunca como gate ou meta do kernel.

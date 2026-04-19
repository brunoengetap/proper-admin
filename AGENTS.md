Objetivo atual: implementar apenas a ETAPA 4 — sincronização silenciosa.

Regras obrigatórias:
- não alterar localStorage key `proper_admin_v2`
- não alterar algoritmo `machineKey`
- não reescrever o arquivo do zero
- não mexer no layout geral
- manter arquitetura atual
- ao abrir a página: 1 sync automática silenciosa
- depois disso: apenas sync manual
- sem setInterval
- sem polling
- sem loop automático
- usar _dbHash para evitar re-render desnecessário
- manter _syncInProgress
- manter compatibilidade com o GAS atual

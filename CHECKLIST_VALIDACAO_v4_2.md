# CHECKLIST DE VALIDAÇÃO — Proper Catálogo v4.2
## Executar após receber os arquivos do Codex

---

## ANTES de substituir os arquivos em produção

### 1. Verificar que o escopo foi respeitado

Abrir o `index.html` entregue e confirmar:

- [ ] `CURRENT_SCHEMA_VERSION` está igual a `3`
- [ ] Existe bloco `if (db.schemaVersion < 3)` em `runMigrations()`
- [ ] O campo `id="pSupplier"` foi **removido** do HTML
- [ ] Existem campos `id="pPartBrand"` e `id="pSupplierPrimary"` no modal `#modalPart`
- [ ] Existem campos `id="simRefInput"` e `id="simBrandInput"` no modal `#modalPart`
- [ ] `renderMachines()` não foi alterado — comparar com o original
- [ ] `renderPreventivas()` não foi alterado — comparar com o original
- [ ] `syncFromGS()` não foi alterado — comparar com o original
- [ ] Não existe nenhuma referência a `PART_APPLICATIONS` no `index.html`
- [ ] Não existe nenhuma referência a `savePartApplication` no `index.html`

Abrir o `GAS_PROPER_v1_3.js` entregue e confirmar:

- [ ] Contém todos os `case` do v1.2 original (nenhum foi removido)
- [ ] Existe `PARTS_MASTER` em `HEADERS` com `Model_ID` como segunda coluna
- [ ] Existe `PART_SIMILARITIES` em `HEADERS` com `Model_ID` como terceira coluna
- [ ] Existe `case 'savePartMaster'` no `doPost`
- [ ] Existe `case 'replacePartSimilarities'` no `doPost`
- [ ] NÃO existe `case 'savePartApplication'` no `doPost`
- [ ] `replacePartSimilarities` recebe 3 parâmetros: `(partId, modelId, similarities)`
- [ ] Dentro de `replacePartSimilarities`, o filtro de deleção usa `Part_ID + Model_ID` (não só `Part_ID`)

---

## Testes funcionais no browser

### Migração v3

1. Abrir o `index.html` no Chrome com o localStorage atual intacto
2. Abrir DevTools → Console
3. Digitar: `db.models[0].directParts[0].similarities`
4. [ ] Resultado deve ser um array de **objetos** `{ ref, brand, obs }`, não strings
5. Digitar: `db.schemaVersion`
6. [ ] Resultado deve ser `3`
7. Fechar e reabrir — rodar migração novamente
8. [ ] `db.schemaVersion` ainda é `3` (idempotente)

### Modal de peça — novos campos

1. Abrir catálogo → selecionar qualquer modelo → clicar "+ Adicionar peça"
2. [ ] Campo "Marca / Fabricante" existe e está vazio
3. [ ] Campo "Fornecedor principal" existe e está vazio
4. [ ] Campo "Fornecedor padrão" (antigo `pSupplier`) **não existe mais**
5. [ ] Campo de ref de similar existe + campo de marca do similar existe
6. Preencher: Nome="Filtro teste", Marca/Fab="Mann", Fornecedor="Dist. Silva"
7. Adicionar similar: Ref="W962", Marca="Mann" → clicar "+ Adicionar"
8. [ ] Badge de similar aparece com "W962 · Mann"
9. Salvar
10. [ ] Peça aparece na tabela com "Mann" na linha de marca e "Dist. Silva" no badge de fornecedor
11. [ ] Similar "W962" aparece com "Mann" visível

### Modal de peça — edição com fallback legado

1. Localizar uma peça antiga (cadastrada antes desta versão) que tenha `supplier` preenchido
2. Clicar "Editar" nessa peça
3. [ ] Campo "Fornecedor principal" está pré-preenchido com o valor antigo de `supplier`
4. [ ] Campo "Marca / Fabricante" está vazio (não inventou valor)
5. [ ] Similares antigos (strings) aparecem como badges, sem erro

### Similaridades — remoção

1. Editar uma peça que tenha similares
2. Remover um similar clicando no ×
3. Salvar
4. [ ] Similar removido não aparece mais na tabela
5. [ ] Outros similares da mesma peça permanecem

### Aba Máquinas / Preventivas / Dashboard

1. Navegar para aba "Máquinas PGP"
2. [ ] Tudo funciona normalmente, sem erro no console
3. Navegar para "Preventivas"
4. [ ] Tudo funciona normalmente
5. Navegar para "Dashboard"
6. [ ] Cards e contadores corretos

### promoverAoCatalogo — modelo novo

1. Ir para aba "Máquinas PGP" → abrir detalhes de uma máquina que não tem modelo no catálogo
2. Clicar "Promover ao catálogo"
3. Confirmar criação
4. [ ] Modelo criado aparece no catálogo
5. No console: `db.models[db.models.length-1].directParts[0]`
6. [ ] Objeto tem `partBrand: ''`, `supplierPrimary: ''`, `similarities: []` (array vazio de objetos)
7. [ ] NÃO tem campo `supplier` preenchido com lixo

---

## Testes do GAS (após publicar v1.3)

Usar a URL do Apps Script com os parâmetros abaixo:

### Ping de compatibilidade
```
GET ?action=ping&key=<sua_key>
```
- [ ] Retorna `{ status: 'ok', version: '1.3' }`

### Ações legadas — confirmar retrocompatibilidade
```
GET ?action=getMachines&key=<sua_key>
GET ?action=getModels&key=<sua_key>
GET ?action=getVisits&key=<sua_key>
```
- [ ] Todas retornam dados normalmente sem erro

### Novas ações de leitura
```
GET ?action=getPartsMaster&key=<sua_key>
GET ?action=getPartSimilarities&key=<sua_key>
GET ?action=getCatalogFull&key=<sua_key>
```
- [ ] Retornam `{ status: 'ok', ... }` (podem estar vazias — normal na primeira vez)

### savePartMaster — não duplica
1. Salvar uma peça pelo front (que chame `syncToGS`)
2. Verificar aba `PARTS_MASTER` no Sheets
3. [ ] Linha criada com `Part_ID` e `Model_ID` preenchidos
4. Editar a mesma peça e salvar novamente
5. [ ] Mesma linha **atualizada**, não duplicada

### replacePartSimilarities — isola por Part_ID + Model_ID
1. Cadastrar peça "dp1" no Modelo A com similar "W962"
2. Cadastrar peça "dp1" no Modelo B (diferente) com similar "X100"
3. Editar similar da peça dp1 do Modelo A → trocar "W962" por "W999"
4. Verificar aba `PART_SIMILARITIES`
5. [ ] Modelo A → similar "W999" (atualizado)
6. [ ] Modelo B → similar "X100" (intocado)

---

## Se algo falhar

| Sintoma | Provável causa | Ação |
|---|---|---|
| `db.schemaVersion` ainda é 2 após abrir | Migração não rodou | Verificar `CURRENT_SCHEMA_VERSION` e o bloco `< 3` |
| Campo pSupplier ainda aparece no modal | HTML não foi atualizado | Revisar seção 4.3 do plano |
| Similar aparece sem marca no badge | `renderSimTags` não atualizado | Revisar seção 4.4 |
| Duplicata em PARTS_MASTER após editar | Falta `Model_ID` na busca do GAS | Revisar `savePartMaster()` — busca por `Part_ID + Model_ID` |
| Similar de outro modelo apagado | `replacePartSimilarities` filtra só por `Part_ID` | Corrigir filtro para usar `Part_ID + Model_ID` |
| Aba Máquinas com erro | Alguma função do PGP foi alterada | Reverter para o original naquela função |
| `savePartApplication` existe no GAS | Codex extrapolou o escopo | Remover — não faz parte desta iteração |

---

*Checklist v4.2 — 22/04/2026 — Proper Compressores*

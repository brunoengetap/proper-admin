# PROPER COMPRESSORES — Plano Técnico v4.2
## Iteração: Catálogo como Sistema Independente
### Revisão final — pronto para execução no Codex

---

## AVISO DE ESCOPO — LER ANTES DE QUALQUER COISA

Este plano foi deliberadamente reduzido em relação ao v4.0.
A tabela `PART_APPLICATIONS` e as ações relacionadas foram **adiadas para a próxima iteração**
porque o front ainda organiza peças dentro de `db.models[]` (directParts + subsystems.parts)
e criar uma segunda fonte de verdade paralela geraria inconsistência.

**Escopo aprovado desta iteração:**

| Área | O que entra |
|---|---|
| Front — migração | v2 → v3: supplier → supplierPrimary, similarities string[] → objeto[] |
| Front — modal de peça | partBrand + supplierPrimary + similares como objeto |
| Front — funções JS | openAddPart, openEditPart, savePart, renderSimTags, renderPartsTable |
| Front — promoção | promoverAoCatalogo() atualizado para novo shape (ambos os casos) |
| GAS — novas abas | PARTS_MASTER + PART_SIMILARITIES apenas |
| GAS — novos endpoints | savePartMaster, replacePartSimilarities, getPartsMaster, getPartSimilarities, getCatalogFull |

**Adiado para próxima iteração:**
- `PART_APPLICATIONS` no GAS
- `savePartApplication` / `deletePartApplication`
- UX de "Editar aplicações" no front

**Regra de chave lógica — válida em toda esta iteração:**
> Nesta iteração, toda persistência relacionada a peças no backend usa
> `Part_ID + Model_ID` como chave lógica mínima — tanto em `PARTS_MASTER`
> quanto em `PART_SIMILARITIES`. O `Part_ID` isolado não é globalmente único.

---

## 1. CONTEXTO DO PROJETO

Sistema web administrativo para a Proper Compressores. Dois arquivos HTML standalone
(sem framework, sem build step) e um backend Google Apps Script (GAS) conectado ao Google Sheets.

### Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | Admin — Catálogo, Máquinas PGP, Preventivas, Clientes, Dashboard |
| `proper_checklist_campo.html` | Mobile — checklist do técnico em campo — **NÃO TOCAR** |
| `GAS_PROPER_v1_2.js` | Backend GAS — doGet / doPost com Google Sheets → gerar `v1.3` |

### Stack
- HTML/CSS/JS vanilla, sem build
- `localStorage` como cache offline — chave: `proper_admin_v2` — **chave não muda**
- Google Apps Script como backend REST
- Schema versionado: `db.schemaVersion`, `CURRENT_SCHEMA_VERSION = 2` hoje
- Sistema de snapshots: `snapshotPreMigration(label)`
- Sistema de migrações idempotentes: `runMigrations()`

---

## 2. REGRA ABSOLUTA DE SEPARAÇÃO DE DOMÍNIO

```
CATÁLOGO (db.models[])
  → Modelos de equipamentos: marca, modelo, tipo, potência, pressão
  → Peças por modelo: ref, marca/fab, fornecedor, equivalências, slot, intervalo, qty
  → NÃO TEM: horímetro, cliente, preventiva, última troca

MÁQUINAS PGP (db.machines[])
  → Equipamentos reais dos clientes — alimentado pelo campo via GAS
  → TEM: horímetro, cliente, filial, h/semana, status preventiva
  → NÃO É TOCADO pelo catálogo, exceto leitura em promoverAoCatalogo()

MACHINE_PARTS (aba Sheets)
  → Estado real das peças por máquina (última troca, intervalo efetivo, ref instalada)
  → NÃO É TOCADO pelo catálogo

A ponte catálogo ↔ máquinas é somente leitura:
  modelKey(brand, model) → exibe quais máquinas usam um modelo
  Já existe e funciona. Não muda.
```

---

## 3. ESTRUTURA DE DADOS ATUAL — REFERÊNCIA PARA O CODEX

### Shape atual de peça (dentro de directParts ou subsystem.parts)

```js
// HOJE — v2
{
  id: 'dp1',
  name: 'Filtro de óleo',
  ref: '021.0093-0',
  interval: 2000,
  qty: 1,
  supplier: 'Schulz',          // campo único que mistura fornecedor e fabricante
  cost: 0,
  criticality: 'normal',
  obs: '',
  slot: 'oil_filter',
  similarities: ['W962', 'W9231']  // array de strings simples
}
```

### Shape atual do modelo (`db.models[]`)

```js
{
  id: 'm1',
  brand: 'Schulz',
  model: 'SRP3010 III',
  type: 'Compressor Parafuso',
  power: '10cv / 7,5kW',
  pressure: '10 bar',
  flow: '1150',
  voltage: '220/380V 3F',
  ampere: '28A',
  obs: '',
  photos: [],
  directParts: [ /* peças — shape acima */ ],
  subsystems: [
    { id: 's1', name: 'Bloco Compressor', category: '', interval: 16000,
      desc: '', parts: [ /* mesma estrutura de peça */ ] }
  ]
}
```

### `db.schemaVersion` = 2 (atual) → será 3 após esta iteração

---

## 4. MUDANÇAS NO FRONT — `index.html`

### 4.1 Migração de schema v2 → v3

**Onde:** função `runMigrations()`, após o bloco `if (db.schemaVersion < 2)` existente.

**`CURRENT_SCHEMA_VERSION`** deve ser alterado de `2` para `3`.

```js
// Adicionar após o bloco < 2 existente:
if (db.schemaVersion < 3) {
  if (!snapshotTaken) { snapshotPreMigration('pre_v3'); snapshotTaken = true; }

  db.models.forEach(m => {
    const allParts = [
      ...(m.directParts || []),
      ...((m.subsystems || []).flatMap(s => s.parts || []))
    ];
    allParts.forEach(p => {
      // Migrar supplier → supplierPrimary (apenas se ainda não migrado)
      if (!p.supplierPrimary) {
        p.supplierPrimary = p.supplier || '';
      }
      // Garantir partBrand
      if (!p.partBrand) p.partBrand = '';

      // Migrar similarities: string[] → objeto[]
      if (Array.isArray(p.similarities)) {
        p.similarities = p.similarities.map(s =>
          typeof s === 'string'
            ? { ref: s, brand: '', obs: '' }
            : s  // já é objeto — não tocar
        );
      } else {
        p.similarities = [];
      }
    });
  });

  db.schemaVersion = 3;
}
```

**Regras:**
- A migração é idempotente — se rodar duas vezes, não quebra nada
- O campo `supplier` legado pode permanecer no objeto sem ser removido — retrocompatibilidade
- Snapshot é criado automaticamente antes da primeira migração necessária (lógica já existe)

---

### 4.2 Novo shape de peça — v3

```js
// DEPOIS — v3
{
  id: 'dp1',
  name: 'Filtro de óleo',
  ref: '021.0093-0',            // ref OEM principal — não muda
  partBrand: 'Mann',             // NOVO — quem fabrica a peça
  supplierPrimary: 'Dist. X',    // NOVO — quem vende/distribui
  interval: 2000,
  qty: 1,
  slot: 'oil_filter',
  criticality: 'normal',
  cost: 0,
  obs: '',
  similarities: [                // MUDA — de string[] para objeto[]
    { ref: 'W962',  brand: 'Mann',  obs: '' },
    { ref: 'W9231', brand: 'Bosch', obs: '' }
  ]
  // 'supplier' legado pode continuar presente, é apenas ignorado na UI nova
}
```

---

### 4.3 Modal de peça — `#modalPart` — alterações no HTML

#### Substituir o campo `pSupplier` por dois campos novos

**Remover:**
```html
<div class="form-row">
  <div class="form-group">
    <label class="form-label">Fornecedor padrão</label>
    <input class="form-input" id="pSupplier" placeholder="ex: Schulz, SKF, Gates">
  </div>
</div>
```

**Inserir no mesmo lugar:**
```html
<div class="form-row">
  <div class="form-group">
    <label class="form-label">Marca / Fabricante <span>opcional</span></label>
    <input class="form-input" id="pPartBrand"
           placeholder="ex: Mann, SKF, Gates, Schulz">
    <div class="form-hint">Quem fabrica a peça.</div>
  </div>
  <div class="form-group">
    <label class="form-label">Fornecedor principal <span>opcional</span></label>
    <input class="form-input" id="pSupplierPrimary"
           placeholder="ex: Distribuidora Silva, Schulz">
    <div class="form-hint">Quem vende / distribui.</div>
  </div>
</div>
```

#### Substituir a seção de similaridades

**Remover** a seção atual de `simInput` e o bloco de `form-hint` de similares.

**Inserir:**
```html
<div class="form-group">
  <label class="form-label">
    Equivalências / Similares
    <span>pressione Enter para adicionar</span>
  </label>
  <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
    <input class="form-input" id="simRefInput"
           placeholder="Ref. equivalente (ex: W962)"
           style="flex:2;min-width:120px"
           onkeydown="if(event.key==='Enter'){event.preventDefault();addSim()}">
    <input class="form-input" id="simBrandInput"
           placeholder="Marca (ex: Mann)"
           style="flex:1;min-width:90px">
    <button class="btn btn-secondary btn-sm" onclick="addSim()">+ Adicionar</button>
  </div>
  <div class="sim-row" id="simTags"></div>
  <div class="form-hint">
    Referências intercambiáveis: genéricas, outras marcas, números de catálogo antigos.
  </div>
</div>
```

---

### 4.4 Variável `currentSims` e funções de similaridade

**`currentSims`** muda de `string[]` para `objeto[]`:

```js
// Declaração (já existe como let currentSims = [])
// Apenas mudar o shape dos elementos — a declaração em si não precisa mudar
```

#### `addSim()` — substituir completamente

```js
function addSim() {
  const ref   = document.getElementById('simRefInput').value.trim();
  const brand = document.getElementById('simBrandInput').value.trim();
  if (!ref) return;
  if (currentSims.find(s => s.ref === ref)) return; // sem duplicata por ref
  currentSims.push({ ref, brand, obs: '' });
  document.getElementById('simRefInput').value = '';
  document.getElementById('simBrandInput').value = '';
  renderSimTags();
}
```

#### `removeSim(idx)` — não muda (já funciona com índice)

#### `renderSimTags()` — substituir completamente

```js
function renderSimTags() {
  document.getElementById('simTags').innerHTML = currentSims.map((s, i) => {
    const label = typeof s === 'string' ? s : s.ref;
    const brand = typeof s === 'object' && s.brand ? ' · ' + s.brand : '';
    return `<span class="sim-tag">
      <strong>${label}</strong>${brand}
      <span class="sim-rm" onclick="removeSim(${i})">×</span>
    </span>`;
  }).join('');
}
```

---

### 4.5 `openAddPart()` — limpar novos campos

Adicionar ao bloco de limpeza existente (onde já limpa `pName`, `pRef`, etc.):

```js
document.getElementById('pPartBrand').value      = '';
document.getElementById('pSupplierPrimary').value = '';
currentSims = [];
renderSimTags();
```

**Remover** a linha que limpa `pSupplier` (campo removido do HTML).

---

### 4.6 `openEditPart()` — carregar novos campos

Adicionar ao bloco de carregamento existente (onde já carrega `pName`, `pRef`, etc.):

```js
document.getElementById('pPartBrand').value =
  part.partBrand || '';

document.getElementById('pSupplierPrimary').value =
  part.supplierPrimary || part.supplier || '';  // fallback para legado

// Normalizar similarities: garantir que é array de objetos
currentSims = (part.similarities || []).map(s =>
  typeof s === 'string' ? { ref: s, brand: '', obs: '' } : s
);
renderSimTags();
```

**Remover** a linha que carrega `pSupplier` (campo removido do HTML).

---

### 4.7 `savePart()` — novo shape do objeto `data`

Substituir o objeto `data` dentro de `savePart()`:

```js
const data = {
  name,
  ref:             document.getElementById('pRef').value.trim(),
  partBrand:       document.getElementById('pPartBrand').value.trim(),
  supplierPrimary: document.getElementById('pSupplierPrimary').value.trim(),
  interval:        parseInt(document.getElementById('pInterval').value) || 0,
  qty:             parseInt(document.getElementById('pQty').value) || 1,
  cost:            parseFloat(document.getElementById('pCost').value) || 0,
  criticality:     document.getElementById('pCriticality').value,
  obs:             document.getElementById('pObs').value.trim(),
  slot:            document.getElementById('pSlot').value.trim() || '',
  similarities:    currentSims.map(s =>
    typeof s === 'string' ? { ref: s, brand: '', obs: '' } : { ...s }
  )
};
// NÃO incluir 'supplier' no shape novo
```

Após salvar no `db` local e chamar `save()`, adicionar sincronização com o GAS:

```js
// Após save() e antes de closeModal():
const savedPart = editPartTarget
  ? getPartById(editPartTarget.modelId, editPartTarget.type,
                editPartTarget.subId, editPartTarget.partId)
  : getLastAddedPart(addPartTarget.modelId, addPartTarget.type, addPartTarget.subId);

if (savedPart) {
  const currentModelId = addPartTarget?.modelId || editPartTarget?.modelId;
  syncToGS('savePartMaster', {
    part: { ...savedPart, modelId: currentModelId }
  });
  syncToGS('replacePartSimilarities', {
    partId:       savedPart.id,
    modelId:      currentModelId,      // OBRIGATÓRIO — evita colisão entre modelos
    similarities: savedPart.similarities
  });
}
```

**Nota:** `getPartById` e `getLastAddedPart` são helpers simples que buscam a peça
recém-salva no `db`. Implementar como:

```js
function getPartById(modelId, type, subId, partId) {
  const m = getModel(modelId);
  if (!m) return null;
  if (type === 'direct') return m.directParts.find(p => p.id === partId) || null;
  const s = (m.subsystems || []).find(s => s.id === subId);
  return s ? s.parts.find(p => p.id === partId) || null : null;
}

function getLastAddedPart(modelId, type, subId) {
  const m = getModel(modelId);
  if (!m) return null;
  if (type === 'direct') {
    return m.directParts[m.directParts.length - 1] || null;
  }
  const s = (m.subsystems || []).find(s => s.id === subId);
  return s ? s.parts[s.parts.length - 1] || null : null;
}
```

---

### 4.8 `renderPartsTable()` — atualizar colunas

#### Coluna "Fornecedor" — substituir o conteúdo da `<td>`

```js
// Substituir:
`<td>${p.supplier ? `<span class="td-supplier">${p.supplier}</span>` : '...'}</td>`

// Por:
`<td>
  ${p.partBrand
    ? `<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:2px">${p.partBrand}</div>`
    : ''}
  ${(p.supplierPrimary || p.supplier)
    ? `<span class="td-supplier">${p.supplierPrimary || p.supplier}</span>`
    : '<span style="color:var(--text3)">—</span>'}
</td>`
```

#### Coluna "Similares" — atualizar para novo shape de objeto

```js
// Substituir o conteúdo da <td> de similares:
`<td>
  ${(p.similarities || []).length
    ? `<div class="sim-row">
        ${(p.similarities).map(s => {
          const ref   = typeof s === 'string' ? s : s.ref;
          const brand = typeof s === 'object' && s.brand ? s.brand : '';
          return `<span class="sim-tag"
            title="${brand}"
            style="cursor:pointer"
            onclick="navigator.clipboard?.writeText('${ref}');
                     this.style.background='var(--green-light)';
                     this.style.color='var(--green)';
                     setTimeout(()=>{this.style.background='';this.style.color='';},1200)">
            ${ref}${brand ? `<span style="font-size:9px;opacity:.7;margin-left:3px">${brand}</span>` : ''}
          </span>`;
        }).join('')}
      </div>`
    : '<span style="color:var(--text3);font-size:11px">—</span>'}
</td>`
```

---

### 4.9 `promoverAoCatalogo()` — atualizar shape de peças criadas

Dois casos existem na função. Ambos precisam atualizar o shape das peças.

#### Caso 1: Modelo novo criado a partir da máquina

No `forEach` que monta `newModel.directParts`, atualizar o objeto pushado:

```js
newModel.directParts.push({
  id: 'dp-' + uid(),
  name:            ps.name || partIdToName[pid] || pid,
  ref:             ps.ref || '',
  partBrand:       '',        // NOVO — vazio, preenchido no catálogo depois
  supplierPrimary: '',        // NOVO — vazio, preenchido no catálogo depois
  interval:        ps.interval || DEFAULT_INT[pid] || 2000,
  qty:             1,
  supplier:        '',        // legado — manter vazio
  cost:            0,
  criticality:     'normal',
  obs:             '',
  slot:            '',
  similarities:    []         // NOVO shape — array vazio de objetos
});
```

Após `db.models.push(newModel)` e `save()`, sincronizar peças com o GAS:

```js
syncToGS('saveModel', { model: newModel });

// Sincronizar cada peça com PARTS_MASTER e zerar similares no backend
newModel.directParts.forEach(p => {
  syncToGS('savePartMaster', { part: { ...p, modelId: newModel.id } });
  syncToGS('replacePartSimilarities', {
    partId: p.id, modelId: newModel.id, similarities: p.similarities || []
  });
});
```

#### Caso 2: Modelo existente — mescla de referências

Após as alterações em `existing.directParts` e `save()`, adicionar sincronização:

```js
// Após save() no caso de mescla:
syncToGS('saveModel', { model: existing }); // já existe, manter

// ADICIONAR — sincronizar peças alteradas/adicionadas com PARTS_MASTER
existing.directParts.forEach(p => {
  // Garantir shape v3 antes de sincronizar
  if (!p.partBrand)       p.partBrand = '';
  if (!p.supplierPrimary) p.supplierPrimary = p.supplier || '';
  if (!Array.isArray(p.similarities)) p.similarities = [];
  else p.similarities = p.similarities.map(s =>
    typeof s === 'string' ? { ref: s, brand: '', obs: '' } : s
  );
  syncToGS('savePartMaster', { part: { ...p, modelId: existing.id } });
  syncToGS('replacePartSimilarities', {
    partId: p.id, modelId: existing.id, similarities: p.similarities
  });
});
```

---

### 4.10 `HELP_CONTENT` — adicionar entradas para novos campos

```js
// Adicionar ao objeto HELP_CONTENT existente:
pPartBrand: {
  title: 'Marca / Fabricante',
  body: 'Quem fabrica a peça. Ex: Mann, SKF, Gates, Schulz. ' +
        'Pode ser diferente de quem vende.'
},
pSupplierPrimary: {
  title: 'Fornecedor principal',
  body: 'Empresa ou distribuidor que vende esta peça. ' +
        'Ex: Distribuidora Silva, Schulz Direto.'
},
simRefInput: {
  title: 'Referência equivalente',
  body: 'Código de uma peça intercambiável com esta. ' +
        'Adicione uma por vez com a marca correspondente.'
},
```

---

## 5. BACKEND GAS — `GAS_PROPER_v1_3.js`

O v1.3 é **totalmente retrocompatível** com o v1.2.
Todas as ações existentes continuam funcionando sem alteração.
Apenas novas ações e abas são adicionadas.

### 5.1 Novas entradas em `HEADERS`

```js
// Adicionar ao objeto HEADERS existente:
PARTS_MASTER: [
  'Part_ID', 'Model_ID', 'Name', 'OEM_Ref', 'Part_Brand', 'Supplier_Primary',
  'Slot', 'Qty_Default', 'Interval_H', 'Criticality', 'Cost', 'Obs', 'Updated_At'
],
PART_SIMILARITIES: [
  'Sim_ID', 'Part_ID', 'Model_ID', 'Ref_Similar', 'Brand_Similar', 'Obs', 'Updated_At'
],
```

**Nota sobre `Model_ID` em `PARTS_MASTER`:**
Nesta iteração, `PARTS_MASTER` é tratado como espelho por peça cadastrada no modelo,
sem tentar deduplicar peças iguais entre modelos diferentes.
O `Part_ID` é o ID local da peça (`dp1`, `sp1`, etc.) e pode colidir entre modelos.
A combinação `Part_ID + Model_ID` é o identificador real único nesta fase.
A deduplicação e o conceito de peça mestre global são trabalho da próxima iteração.

### 5.2 Novos casos no `doGet`

```js
case 'getPartsMaster':
  result = { status: 'ok', parts: getSheetData('PARTS_MASTER') };
  break;

case 'getPartSimilarities':
  result = { status: 'ok', similarities: getSheetData('PART_SIMILARITIES') };
  break;

case 'getCatalogFull':
  result = getCatalogFull();
  // ATENÇÃO: getCatalogFull() é endpoint auxiliar de inspeção e integração.
  // Ele NÃO reconstrói o db.models[] do front — não tentar usar para
  // "fechar o ciclo" ou substituir o localStorage. Apenas retorna as abas brutas.
  break;
```

### 5.3 Novos casos no `doPost`

```js
case 'savePartMaster':
  result = savePartMaster(body.part);
  break;

case 'replacePartSimilarities':
  result = replacePartSimilarities(body.partId, body.modelId, body.similarities || []);
  break;
```

### 5.4 Implementação: `savePartMaster(p)`

Chave de busca: `Part_ID + Model_ID` (combinação única nesta fase).

```js
function savePartMaster(p) {
  if (!p || !p.id) return { status: 'error', error: 'id da peça obrigatório' };

  const sheet   = getOrCreateSheet('PARTS_MASTER', HEADERS.PARTS_MASTER);
  const now     = new Date().toISOString();
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  const idxPartId  = headers.indexOf('Part_ID');
  const idxModelId = headers.indexOf('Model_ID');

  const row = [
    p.id,
    p.modelId         || '',   // passado pelo front ao sincronizar
    p.name            || '',
    p.ref             || '',
    p.partBrand       || '',
    p.supplierPrimary || '',
    p.slot            || '',
    parseInt(p.qty)   || 1,
    parseInt(p.interval) || 0,
    p.criticality     || 'normal',
    parseFloat(p.cost)|| 0,
    p.obs             || '',
    now
  ];

  // Buscar linha existente por Part_ID + Model_ID
  for (let i = 1; i < data.length; i++) {
    const samePartId  = data[i][idxPartId]  === p.id;
    const sameModelId = data[i][idxModelId] === (p.modelId || '');
    if (samePartId && sameModelId) {
      sheet.getRange(i + 1, 1, 1, HEADERS.PARTS_MASTER.length).setValues([row]);
      return { status: 'ok', action: 'updated' };
    }
  }

  sheet.appendRow(row);
  return { status: 'ok', action: 'inserted' };
}
```

**Nota para o front:** ao chamar `syncToGS('savePartMaster', { part: p })`,
o payload **deve incluir `modelId`**. A chave lógica de atualização no GAS é
`Part_ID + Model_ID`. Sem `modelId`, a função sempre faz `appendRow` e nunca atualiza.

### 5.5 Implementação: `replacePartSimilarities(partId, modelId, similarities)`

Esta função resolve o problema de "lixo histórico" no backend ao editar similares.
Ela apaga todos os similares da combinação `partId + modelId` e reescreve a lista atual.

**Por que `modelId` é obrigatório aqui:**
O `Part_ID` não é globalmente único nesta fase — dois modelos distintos podem ter
uma peça `dp1` cada. Sem o `modelId`, um `replacePartSimilarities('dp1', [...])` apagaria
os similares de `dp1` em **todos** os modelos, não só no modelo sendo editado.

```js
function replacePartSimilarities(partId, modelId, similarities) {
  if (!partId)  return { status: 'error', error: 'partId obrigatório' };
  if (!modelId) return { status: 'error', error: 'modelId obrigatório' };

  const sheet   = getOrCreateSheet('PART_SIMILARITIES', HEADERS.PART_SIMILARITIES);
  const now     = new Date().toISOString();
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxPid = headers.indexOf('Part_ID');
  const idxMid = headers.indexOf('Model_ID');

  // Manter apenas linhas que NÃO sejam desta combinação Part_ID + Model_ID
  const rowsToKeep = [headers];
  for (let i = 1; i < data.length; i++) {
    const samePart  = String(data[i][idxPid]).trim() === String(partId).trim();
    const sameModel = String(data[i][idxMid]).trim() === String(modelId).trim();
    if (!(samePart && sameModel)) {
      rowsToKeep.push(data[i]);
    }
  }

  // Reescrever sheet sem as linhas desta combinação
  sheet.clearContents();
  if (rowsToKeep.length > 0) {
    sheet.getRange(1, 1, rowsToKeep.length, HEADERS.PART_SIMILARITIES.length)
         .setValues(rowsToKeep);
  }

  // Inserir nova lista de similares para esta combinação
  const newRows = (similarities || []).map((s, idx) => [
    'SIM-' + partId + '-' + modelId + '-' + idx,
    partId,
    modelId,
    typeof s === 'string' ? s          : (s.ref   || ''),
    typeof s === 'object' ? (s.brand   || '') : '',
    typeof s === 'object' ? (s.obs     || '') : '',
    now
  ]);

  if (newRows.length > 0) {
    sheet.getRange(rowsToKeep.length + 1, 1, newRows.length,
                   HEADERS.PART_SIMILARITIES.length).setValues(newRows);
  }

  return { status: 'ok', replaced: newRows.length };
}
```

### 5.6 Implementação: `getCatalogFull()`

```js
function getCatalogFull() {
  return {
    status:      'ok',
    models:      getSheetData('MODELOS'),
    parts:       getSheetData('PARTS_MASTER'),
    similarities: getSheetData('PART_SIMILARITIES')
    // PART_APPLICATIONS: adiado para próxima iteração
  };
}
```

---

## 6. O QUE NÃO MUDA — LISTA EXPLÍCITA

O Codex **não deve tocar** nas seguintes partes sob nenhuma circunstância:

| O que | Motivo |
|---|---|
| `db.machines[]` e seu shape | Domínio do campo/PGP — não é catálogo |
| `MAQUINAS` no GAS | Equipamentos reais dos clientes |
| `MACHINE_PARTS` no GAS | Estado operacional das peças por máquina |
| `VISITAS` e `PECAS_LOG` no GAS | Histórico de preventivas |
| `syncFromGS()` — lógica de reconciliação de visitas | Funciona — não tocar |
| `renderMachines()` | View do PGP |
| `renderPreventivas()` | View operacional |
| `renderDashboard()` | Dashboard operacional |
| `saveVisit()` no GAS | Fluxo do campo |
| `updateMachineParts()` no GAS | Fluxo do campo |
| `saveMachine()` no GAS | Fluxo do PGP |
| Modal `#modalMachine` | PGP — não é catálogo |
| Modal `#modalMachineParts` | Estado operacional — não é catálogo |
| `machineKey()` e `modelKey()` | Funções de normalização — críticas |
| Sistema de snapshots e migrações | Infraestrutura — só adicionar, nunca remover ou alterar os blocos existentes |
| `DB_KEY = 'proper_admin_v2'` | Chave do localStorage — não muda |
| `_AUTH_HASH` e sistema de autenticação | Não tocar |
| `seção de máquinas em campo` dentro de `renderCatalog()` | Já lê corretamente `db.machines[]` — não muda |

---

## 7. ORDEM DE IMPLEMENTAÇÃO

```
PASSO 1 — runMigrations()
  → Adicionar bloco if (db.schemaVersion < 3)
  → Atualizar CURRENT_SCHEMA_VERSION de 2 para 3
  → Testar: importar JSON antigo, verificar que similares viram objetos sem perda

PASSO 2 — Modal #modalPart — HTML
  → Substituir pSupplier por pPartBrand + pSupplierPrimary
  → Substituir seção de simInput por simRefInput + simBrandInput

PASSO 3 — Funções JS de similaridade
  → addSim()
  → renderSimTags()
  → (removeSim não muda)

PASSO 4 — openAddPart() e openEditPart()
  → Limpar / carregar novos campos
  → Fallback supplier em openEditPart

PASSO 5 — savePart()
  → Novo shape do objeto data
  → Helpers getPartById e getLastAddedPart
  → Chamadas syncToGS após save()

PASSO 6 — renderPartsTable()
  → Coluna Fornecedor: partBrand + supplierPrimary
  → Coluna Similares: novo shape de objeto

PASSO 7 — promoverAoCatalogo()
  → Shape v3 no caso de modelo novo
  → Sync PARTS_MASTER no caso de modelo novo
  → Shape v3 + sync no caso de mescla

PASSO 8 — HELP_CONTENT
  → Adicionar pPartBrand, pSupplierPrimary, simRefInput

PASSO 9 — GAS_PROPER_v1_3.js
  → HEADERS: PARTS_MASTER + PART_SIMILARITIES
  → doGet: getPartsMaster, getPartSimilarities, getCatalogFull
  → doPost: savePartMaster, replacePartSimilarities
  → Implementar as 3 funções novas
```

---

## 8. CRITÉRIOS DE ACEITAÇÃO

### Front / UI

- [ ] Cadastrar peça com `partBrand = 'Mann'` e `supplierPrimary = 'Dist. Silva'` →
      ambos aparecem separados na tabela do catálogo
- [ ] Adicionar equivalência `{ ref: 'W962', brand: 'Mann' }` → aparece com marca no badge
- [ ] Editar peça antiga (tem `supplier` mas não `supplierPrimary`) →
      campo `supplierPrimary` pré-preenchido com valor de `supplier` (fallback)
- [ ] Remover um similar de uma peça e salvar → similar removido da UI corretamente
- [ ] `renderMachines()`, `renderPreventivas()`, `renderDashboard()` → não afetados

### Migração

- [ ] Importar JSON v2 (similarities como strings) → migração roda automaticamente,
      strings viram `{ ref, brand:'', obs:'' }`, nenhum dado perdido
- [ ] `schemaVersion` passa de 2 para 3 após migração
- [ ] Rodar migração duas vezes → idempotente, não duplica nem corrompe

### Backend GAS

- [ ] `savePartMaster` com mesma `Part_ID + Model_ID` → atualiza, não duplica
- [ ] `savePartMaster` com `Part_ID` igual mas `Model_ID` diferente → insere nova linha (correto)
- [ ] `replacePartSimilarities` com `partId + modelId` e 2 similares →
      aba tem exatamente 2 linhas para aquela combinação
- [ ] `replacePartSimilarities` após remover similar → linha removida do Sheets,
      similares de outro modelo com mesmo `Part_ID` não são afetados
- [ ] `getCatalogFull` → retorna models + parts + similarities sem erro,
      não tenta reconstruir db.models[] do front
- [ ] Todas as ações do GAS v1.2 continuam funcionando → retrocompatibilidade

### Promoção

- [ ] `promoverAoCatalogo()` com modelo novo → peças criadas com shape v3,
      `savePartMaster` chamado para cada peça
- [ ] `promoverAoCatalogo()` com mescla em modelo existente →
      peças alteradas sincronizadas, sem exceção

---

## 9. NOTAS OPERACIONAIS PARA O CODEX

- `index.html` tem ~3.857 linhas — todas as alterações são cirúrgicas,
  não reescrever o arquivo inteiro
- `GAS_PROPER_v1_3.js` entrega o arquivo completo, não diff — copiar o v1.2 e adicionar
- O `getOrCreateSheet()` já formata cabeçalho automaticamente —
  apenas passar os novos `HEADERS` corretamente
- `syncToGS(action, payload)` já existe no front — não reimplementar,
  apenas chamar com as novas actions
- As novas ações do GAS (`savePartMaster`, `replacePartSimilarities`) requerem
  `checkKey(body)` como todas as outras ações POST existentes — já está no switch/case
- `replacePartSimilarities` usa `clearContents()` + reescreve tudo — isso é intencional
  e correto para garantir consistência; o volume de dados é pequeno

---

*Documento v4.2 — 22/04/2026 — Proper Compressores · Iteração Catálogo*
*Revisões v4.1: duplicidade de fonte de verdade, IDs estáveis, strategy de replace em similares,*
*cobertura de promoverAoCatalogo, critérios de aceitação de backend.*
*Revisões v4.2 (obrigatórias): inclusão de `Model_ID` em `PART_SIMILARITIES` e na assinatura*
*de `replacePartSimilarities`; chave lógica `Part_ID + Model_ID` unificada em todo o backend;*
*esclarecimento do escopo de `getCatalogFull`.*

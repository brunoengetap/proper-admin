// ═══════════════════════════════════════════════════════════════════════════
// PROPER COMPRESSORES — Google Apps Script (Backend) — v1.2
// ═══════════════════════════════════════════════════════════════════════════
//
// ESTRUTURA DE ABAS DA PLANILHA:
//   MODELOS      → Catálogo de modelos de equipamentos
//   MAQUINAS     → Equipamentos cadastrados dos clientes (PGP)
//   CLIENTES     → Clientes cadastrados no admin
//   VISITAS      → Registro de cada visita/preventiva realizada
//   PEÇAS_LOG    → Detalhamento das peças por visita
//   MACHINE_PARTS→ Último estado das peças por máquina
//
// NOVIDADE v1.2: action saveClient (POST) + aba CLIENTES
// ═══════════════════════════════════════════════════════════════════════════

const SS = SpreadsheetApp.getActiveSpreadsheet();

// ── MACHINE KEY — mesmo algoritmo do campo e admin ───────────────────────
function machineKey(client, brand, model, serial) {
  function norm(v) {
    return String(v || '').trim().toLowerCase()
      .replace(/[àáâãäå]/g,'a').replace(/[èéêë]/g,'e')
      .replace(/[ìíîï]/g,'i').replace(/[òóôõö]/g,'o')
      .replace(/[ùúûü]/g,'u').replace(/[ç]/g,'c')
      .replace(/[^a-z0-9]/g,'');
  }
  const parts = [norm(client), norm(brand), norm(model)];
  const ser = norm(serial);
  if (ser) parts.push(ser);
  return 'MK-' + parts.join('-');
}

// ── PROTEÇÃO POR TOKEN ────────────────────────────────────
const API_KEY = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'; // sha256 de 123456

function checkKey(params_or_body) {
  const k = params_or_body.key || params_or_body.k || '';
  if (k !== API_KEY) throw new Error('Acesso não autorizado');
}

// ── Cabeçalhos das abas ──────────────────────────────────────────────────
const HEADERS = {
  MAQUINAS:      ['ID','Cliente','Filial','Marca','Modelo','Série','Ano','TAG','Localização','Hor.Total','h/Semana','Observações','Atualizado'],
  MODELOS:       ['ID','Marca','Modelo','Tipo','Potência','Pressão','Observações','Atualizado'],
  CLIENTES:      ['ID','Nome','CNPJ','Contato','Telefone','Email','Observações','Atualizado'],
  VISITAS:       ['ID','Machine_ID','Cliente','Filial','Marca','Modelo','Série','TAG','Hor.Visita','h/Semana','Cenário','Técnico','Data Visita','Obs.Gerais','Enviado'],
  PECAS_LOG:     ['ID_Visita','ID_Peça','Nome Peça','Ref.','Subsistema','Últ.Troca(h)','N/A','Observação'],
  MACHINE_PARTS: ['Machine_ID','Serial','TAG','Part_ID','Part_Name','Last_Change_H','Interval_H','Ref','NA','Atualizado']
};

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY POINT — GET (ping e consultas)
// ═══════════════════════════════════════════════════════════════════════════
function doGet(e) {
  const params = e.parameter;
  const action = params.action || 'ping';
  let result;

  try {
    if (action !== 'ping') checkKey(params);
    switch (action) {
      case 'ping':
        result = { status: 'ok', version: '1.2', spreadsheet: SS.getName(), ts: new Date().toISOString() };
        break;
      case 'searchMachine':
        result = searchMachine(params.q || '');
        break;
      case 'getMachines':
        result = { status: 'ok', machines: getSheetData('MAQUINAS') };
        break;
      case 'getMachinesWithParts':
        result = getMachinesWithParts();
        break;
      case 'getModels':
        result = { status: 'ok', models: getSheetData('MODELOS') };
        break;
      case 'getVisits':
        result = { status: 'ok', visits: getVisitsNormalized() };
        break;
      case 'getMachineParts':
        result = { status: 'ok', parts: getSheetData('MACHINE_PARTS') };
        break;
      case 'getAllMachineParts':
        result = { status: 'ok', parts: getSheetData('MACHINE_PARTS') };
        break;
      case 'getClients':
        result = { status: 'ok', clients: getSheetData('CLIENTES') };
        break;
      default:
        result = { status: 'error', error: 'Ação desconhecida: ' + action };
    }
  } catch (err) {
    result = { status: 'error', error: err.message };
  }

  return jsonResponse(result);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY POINT — POST (gravações)
// ═══════════════════════════════════════════════════════════════════════════
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonResponse({ status: 'error', error: 'JSON inválido' }); }

  const action = body.action;
  let result;

  try {
    checkKey(body);
    switch (action) {
      case 'saveVisit':
        result = saveVisit(body);
        break;
      case 'saveMachine':
        result = saveMachine(body.machine);
        break;
      case 'deleteMachine':
        result = deleteRow('MAQUINAS', body.id);
        break;
      case 'saveModel':
        result = saveModel(body.model);
        break;
      case 'deleteModel':
        result = deleteRow('MODELOS', body.id);
        break;
      case 'updateMachineParts':
        result = updateMachineParts(body);
        break;
      // ── NOVO v1.2 ──────────────────────────────────────────
      case 'saveClient':
        result = saveClient(body.client);
        break;
      case 'deleteClient':
        result = deleteRow('CLIENTES', body.id);
        break;
      // ───────────────────────────────────────────────────────
      default:
        result = { status: 'error', error: 'Ação desconhecida: ' + action };
    }
  } catch (err) {
    result = { status: 'error', error: err.message };
  }

  return jsonResponse(result);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH MACHINE
// ═══════════════════════════════════════════════════════════════════════════
function searchMachine(query) {
  if (!query) return { status: 'error', error: 'Query vazia' };
  const sheet = getOrCreateSheet('MAQUINAS', HEADERS.MAQUINAS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { status: 'ok', machine: null };

  const headers = data[0];
  const qLower = query.toLowerCase().trim();

  const idxSerie  = headers.indexOf('Série');
  const idxTag    = headers.indexOf('TAG');
  const idxClient = headers.indexOf('Cliente');
  const idxId     = headers.indexOf('ID');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const serie  = String(row[idxSerie]  || '').toLowerCase();
    const tag    = String(row[idxTag]    || '').toLowerCase();
    const client = String(row[idxClient] || '').toLowerCase();
    const id     = String(row[idxId]     || '').toLowerCase();
    const brand  = String(row[headers.indexOf('Marca')] || '').toLowerCase();
    const model  = String(row[headers.indexOf('Modelo')]|| '').toLowerCase();

    if (serie === qLower || tag === qLower || id === qLower ||
        client.includes(qLower) || (brand+' '+model).includes(qLower)) {
      const machine = {};
      headers.forEach((h, j) => machine[h] = row[j]);
      const result = rowToMachine(machine);
      result.parts = getMachinePartsById(result.id, result.serial, result.tag);
      return { status: 'ok', machine: result };
    }
  }
  return { status: 'ok', machine: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE VISIT (from field checklist)
// ═══════════════════════════════════════════════════════════════════════════
function saveVisit(body) {
  const visitId = 'VIS-' + new Date().getTime();
  const now = new Date().toISOString();
  const visitDate = body.visitDate || new Date().toLocaleDateString('pt-BR');
  const machineId = body.machine_id ||
    machineKey(body.client||'', body.brand||'', body.model||'', body.serial||'');

  ensureMachineFromVisit(body, machineId, visitDate, now);

  const visitSheet = getOrCreateSheet('VISITAS', HEADERS.VISITAS);
  visitSheet.appendRow([
    visitId,
    machineId,
    body.client   || '',
    body.branch   || '',
    body.brand    || '',
    body.model    || '',
    body.serial   || '',
    body.tag      || '',
    parseInt(body.hourTotal) || 0,
    parseInt(body.hpw)       || 0,
    body.scenario || '',
    body.tech     || '',
    visitDate,
    body.generalObs || '',
    now
  ]);

  const partsSheet = getOrCreateSheet('PECAS_LOG', HEADERS.PECAS_LOG);
  const parts = body.parts || {};
  Object.entries(parts).forEach(([partId, ps]) => {
    partsSheet.appendRow([
      visitId,
      partId,
      ps.name  || partId,
      ps.ref   || '',
      ps.sub   || '',
      parseInt(ps.lastChange) || 0,
      ps.na ? 'SIM' : 'NÃO',
      ps.obs   || ''
    ]);
  });

  updateMachineParts({
    machine_id: machineId,
    serial: body.serial || '',
    tag: body.tag || '',
    parts: parts
  });

  return { status: 'ok', visitId, machineId };
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE MACHINE PARTS
// ═══════════════════════════════════════════════════════════════════════════
function updateMachineParts(body) {
  const machineId = String(body.machine_id || '').trim();
  const serial    = String(body.serial     || '').trim();
  const tag       = String(body.tag        || '').trim();
  const parts     = body.parts || {};

  if (!machineId && !serial && !tag) {
    return { status: 'error', error: 'machine_id, serial ou tag obrigatório' };
  }

  const sheet = getOrCreateSheet('MACHINE_PARTS', HEADERS.MACHINE_PARTS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxMid  = headers.indexOf('Machine_ID');
  const idxSer  = headers.indexOf('Serial');
  const idxTag  = headers.indexOf('TAG');
  const idxPid  = headers.indexOf('Part_ID');
  const now     = new Date().toISOString();

  Object.entries(parts).forEach(([partId, ps]) => {
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      const rowMid = String(data[i][idxMid] || '').trim();
      const rowSer = String(data[i][idxSer] || '').trim();
      const rowTag = String(data[i][idxTag] || '').trim();
      const rowPid = String(data[i][idxPid] || '').trim();

      const machineMatch = (machineId && rowMid === machineId) ||
                           (serial    && rowSer === serial)    ||
                           (tag       && rowTag === tag);
      if (machineMatch && rowPid === partId) {
        rowIdx = i + 1;
        break;
      }
    }

    const rowData = [
      machineId, serial, tag,
      partId,
      ps.name     || partId,
      parseInt(ps.lastChange) || 0,
      parseInt(ps.interval)   || 2000,
      ps.ref || '',
      ps.na  ? 'SIM' : 'NÃO',
      now
    ];

    if (rowIdx > 0) {
      sheet.getRange(rowIdx, 1, 1, HEADERS.MACHINE_PARTS.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }
  });

  return { status: 'ok', updated: Object.keys(parts).length };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET MACHINES WITH PARTS
// ═══════════════════════════════════════════════════════════════════════════
function getMachinesWithParts() {
  const machines = getSheetData('MAQUINAS').map(row => {
    const m = rowToMachineFromObj(row);
    m.parts = getMachinePartsById(m.id, m.serial, m.tag);
    return m;
  });
  return { status: 'ok', machines };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET MACHINE PARTS BY ID/SERIAL/TAG
// ═══════════════════════════════════════════════════════════════════════════
function getMachinePartsById(machineId, serial, tag) {
  try {
    const sheet = SS.getSheetByName('MACHINE_PARTS');
    if (!sheet) return {};
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return {};

    const headers = data[0];
    const idxMid = headers.indexOf('Machine_ID');
    const idxSer = headers.indexOf('Serial');
    const idxTag = headers.indexOf('TAG');
    const idxPid = headers.indexOf('Part_ID');
    const idxName= headers.indexOf('Part_Name');
    const idxLch = headers.indexOf('Last_Change_H');
    const idxInt = headers.indexOf('Interval_H');
    const idxRef = headers.indexOf('Ref');
    const idxNA  = headers.indexOf('NA');

    const result = {};
    for (let i = 1; i < data.length; i++) {
      const rowMid = String(data[i][idxMid] || '').trim();
      const rowSer = String(data[i][idxSer] || '').trim();
      const rowTag = String(data[i][idxTag] || '').trim();
      const rowPid = String(data[i][idxPid] || '').trim();

      const match = (machineId && rowMid === String(machineId).trim()) ||
                    (serial    && rowSer === String(serial).trim())    ||
                    (tag       && rowTag === String(tag).trim());
      if (match && rowPid) {
        result[rowPid] = {
          name:       String(data[i][idxName] || rowPid),
          lastChange: parseInt(data[i][idxLch]) || 0,
          interval:   parseInt(data[i][idxInt]) || 2000,
          ref:        String(data[i][idxRef] || ''),
          na:         String(data[i][idxNA] || '').toUpperCase() === 'SIM'
        };
      }
    }
    return result;
  } catch(e) {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET VISITS NORMALIZED
// ═══════════════════════════════════════════════════════════════════════════
function getVisitsNormalized() {
  const sheet = getOrCreateSheet('VISITAS', HEADERS.VISITAS);
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];

  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, j) => obj[h] = row[j]);
    return {
      visitId:    obj['ID']           || '',
      machine_id: obj['Machine_ID']   || '',
      client:     obj['Cliente']      || '',
      branch:     obj['Filial']       || '',
      brand:      obj['Marca']        || '',
      model:      obj['Modelo']       || '',
      serial:     obj['Série']        || '',
      tag:        obj['TAG']          || '',
      hourTotal:  parseInt(obj['Hor.Visita']) || 0,
      hpw:        parseInt(obj['h/Semana'])   || 0,
      scenario:   obj['Cenário']      || '',
      tech:       obj['Técnico']      || '',
      visitDate:  obj['Data Visita']  || '',
      generalObs: obj['Obs.Gerais']   || '',
      'Machine_ID':  obj['Machine_ID']  || '',
      'Série':       obj['Série']       || '',
      'TAG':         obj['TAG']         || '',
      'Hor.Total':   parseInt(obj['Hor.Visita']) || 0,
      'h/Semana':    parseInt(obj['h/Semana'])   || 0,
      'Data':        obj['Data Visita'] || '',
      'Visit_Date':  obj['Data Visita'] || '',
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE / UPDATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════
function saveMachine(m) {
  if (!m) return { status: 'error', error: 'Dados ausentes' };
  const sheet = getOrCreateSheet('MAQUINAS', HEADERS.MAQUINAS);
  const now = new Date().toISOString();

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId    = headers.indexOf('ID');
  const idxSerie = headers.indexOf('Série');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idxId] === m.id || (m.serial && data[i][idxSerie] == m.serial)) {
      sheet.getRange(i+1, 1, 1, HEADERS.MAQUINAS.length).setValues([[
        m.id || data[i][idxId],
        m.client || '', m.branch || '',
        m.brand || '', m.model || '',
        m.serial || '', m.year || '',
        m.tag || '', m.location || '',
        parseInt(m.hourTotal) || 0,
        parseInt(m.hpw) || 0,
        m.obs || '', now
      ]]);
      return { status: 'ok', action: 'updated' };
    }
  }

  sheet.appendRow([
    m.id || machineKey(m.client||'', m.brand||'', m.model||'', m.serial||'') || 'EQ-' + new Date().getTime(),
    m.client || '', m.branch || '',
    m.brand || '', m.model || '',
    m.serial || '', m.year || '',
    m.tag || '', m.location || '',
    parseInt(m.hourTotal) || 0,
    parseInt(m.hpw) || 0,
    m.obs || '', now
  ]);
  return { status: 'ok', action: 'inserted' };
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE MODEL (catalog)
// ═══════════════════════════════════════════════════════════════════════════
function saveModel(m) {
  if (!m) return { status: 'error', error: 'Dados ausentes' };
  const sheet = getOrCreateSheet('MODELOS', HEADERS.MODELOS);
  const now = new Date().toISOString();

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idxId] === m.id) {
      sheet.getRange(i+1, 1, 1, HEADERS.MODELOS.length).setValues([[
        m.id, m.brand || '', m.model || '', m.type || '',
        m.power || '', m.pressure || '', m.obs || '', now
      ]]);
      return { status: 'ok', action: 'updated' };
    }
  }

  sheet.appendRow([
    m.id || 'MOD-' + new Date().getTime(),
    m.brand || '', m.model || '', m.type || '',
    m.power || '', m.pressure || '', m.obs || '', now
  ]);
  return { status: 'ok', action: 'inserted' };
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE / UPDATE CLIENT — NOVO v1.2
// ═══════════════════════════════════════════════════════════════════════════
function saveClient(c) {
  if (!c) return { status: 'error', error: 'Dados ausentes' };
  const sheet = getOrCreateSheet('CLIENTES', HEADERS.CLIENTES);
  const now = new Date().toISOString();

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idxId] === c.id) {
      sheet.getRange(i+1, 1, 1, HEADERS.CLIENTES.length).setValues([[
        c.id,
        c.nome     || '',
        c.cnpj     || '',
        c.contato  || '',
        c.telefone || '',
        c.email    || '',
        c.obs      || '',
        now
      ]]);
      return { status: 'ok', action: 'updated' };
    }
  }

  sheet.appendRow([
    c.id || 'CLI-' + new Date().getTime(),
    c.nome     || '',
    c.cnpj     || '',
    c.contato  || '',
    c.telefone || '',
    c.email    || '',
    c.obs      || '',
    now
  ]);
  return { status: 'ok', action: 'inserted' };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function ensureMachineFromVisit(body, machineId, visitDate, now) {
  const sheet = getOrCreateSheet('MAQUINAS', HEADERS.MAQUINAS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idxId    = headers.indexOf('ID');
  const idxCli   = headers.indexOf('Cliente');
  const idxFil   = headers.indexOf('Filial');
  const idxMar   = headers.indexOf('Marca');
  const idxMod   = headers.indexOf('Modelo');
  const idxSer   = headers.indexOf('Série');
  const idxAno   = headers.indexOf('Ano');
  const idxTag   = headers.indexOf('TAG');
  const idxLoc   = headers.indexOf('Localização');
  const idxHor   = headers.indexOf('Hor.Total');
  const idxHpw   = headers.indexOf('h/Semana');
  const idxObs   = headers.indexOf('Observações');
  const idxUpd   = headers.indexOf('Atualizado');

  const client   = body.client || '';
  const branch   = body.branch || '';
  const brand    = body.brand || '';
  const model    = body.model || '';
  const serial   = body.serial || '';
  const year     = body.year || '';
  const tag      = body.tag || '';
  const location = body.location || '';
  const hourTotal= parseInt(body.hourTotal) || 0;
  const hpw      = parseInt(body.hpw) || 0;
  const obs      = body.generalObs || body.obs || '';

  for (let i = 1; i < data.length; i++) {
    const rowId  = String(data[i][idxId] || '').trim();
    const rowSer = String(data[i][idxSer] || '').trim();
    const rowTag = String(data[i][idxTag] || '').trim();

    const match = (machineId && rowId === String(machineId).trim()) ||
                  (serial && rowSer === String(serial).trim()) ||
                  (tag && rowTag === String(tag).trim());

    if (match) {
      const existingHour = parseInt(data[i][idxHor]) || 0;
      sheet.getRange(i + 1, idxId + 1).setValue(machineId || rowId);
      if (client)   sheet.getRange(i + 1, idxCli + 1).setValue(client);
      if (branch)   sheet.getRange(i + 1, idxFil + 1).setValue(branch);
      if (brand)    sheet.getRange(i + 1, idxMar + 1).setValue(brand);
      if (model)    sheet.getRange(i + 1, idxMod + 1).setValue(model);
      if (serial)   sheet.getRange(i + 1, idxSer + 1).setValue(serial);
      if (year)     sheet.getRange(i + 1, idxAno + 1).setValue(year);
      if (tag)      sheet.getRange(i + 1, idxTag + 1).setValue(tag);
      if (location) sheet.getRange(i + 1, idxLoc + 1).setValue(location);
      if (hourTotal > existingHour) sheet.getRange(i + 1, idxHor + 1).setValue(hourTotal);
      if (hpw)      sheet.getRange(i + 1, idxHpw + 1).setValue(hpw);
      if (obs)      sheet.getRange(i + 1, idxObs + 1).setValue(obs);
      sheet.getRange(i + 1, idxUpd + 1).setValue(now);
      return { status: 'ok', action: 'updated', machineId: machineId || rowId };
    }
  }

  sheet.appendRow([
    machineId || machineKey(client, brand, model, serial) || ('EQ-' + new Date().getTime()),
    client, branch, brand, model, serial, year, tag, location,
    hourTotal, hpw, obs, now
  ]);

  return { status: 'ok', action: 'inserted', machineId: machineId };
}

function updateMachineHorímetro(machineId, serial, tag, hourTotal, visitDate) {
  const sheet = getOrCreateSheet('MAQUINAS', HEADERS.MAQUINAS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId   = headers.indexOf('ID');
  const idxSerie= headers.indexOf('Série');
  const idxTag  = headers.indexOf('TAG');
  const idxHor  = headers.indexOf('Hor.Total');
  const idxUpd  = headers.indexOf('Atualizado');

  for (let i = 1; i < data.length; i++) {
    const rowId  = String(data[i][idxId]    || '').trim();
    const rowSer = String(data[i][idxSerie] || '').trim();
    const rowTag = String(data[i][idxTag]   || '').trim();

    const match = (machineId && rowId  === String(machineId).trim()) ||
                  (serial    && rowSer === String(serial).trim())    ||
                  (tag       && rowTag === String(tag).trim());

    if (match) {
      const existing = parseInt(data[i][idxHor]) || 0;
      if (hourTotal > existing) {
        sheet.getRange(i+1, idxHor+1).setValue(hourTotal);
      }
      sheet.getRange(i+1, idxUpd+1).setValue(new Date().toISOString());
      return;
    }
  }
}

function deleteRow(sheetName, id) {
  const sheet = getOrCreateSheet(sheetName, HEADERS[sheetName]);
  const data = sheet.getDataRange().getValues();
  const idxId = data[0].indexOf('ID');
  for (let i = 1; i < data.length; i++) {
    if (data[i][idxId] === id) {
      sheet.deleteRow(i+1);
      return { status: 'ok' };
    }
  }
  return { status: 'ok', note: 'Não encontrado' };
}

function getSheetData(sheetName) {
  const sheet = getOrCreateSheet(sheetName, HEADERS[sheetName]);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, j) => obj[h] = row[j]);
    return obj;
  });
}

function rowToMachine(row) {
  return {
    id:        row['ID']           || '',
    client:    row['Cliente']      || '',
    branch:    row['Filial']       || '',
    brand:     row['Marca']        || '',
    model:     row['Modelo']       || '',
    serial:    String(row['Série'] || ''),
    year:      row['Ano']          || '',
    tag:       row['TAG']          || '',
    location:  row['Localização']  || '',
    hourTotal: parseInt(row['Hor.Total']) || 0,
    hpw:       parseInt(row['h/Semana'])  || 0,
    obs:       row['Observações']  || ''
  };
}

function rowToMachineFromObj(row) {
  return rowToMachine(row);
}

function getOrCreateSheet(name, headers) {
  let sheet = SS.getSheetByName(name);
  if (!sheet) {
    sheet = SS.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a3a6b').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, headers.length, 150);
  }
  return sheet;
}

// ═══════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO — Atualizar IDs existentes para machine_key (rodar uma vez)
// Execute manualmente no Apps Script Editor: migrateExistingIds()
// ═══════════════════════════════════════════════════════════════════════════
function migrateExistingIds() {
  const sheet = getOrCreateSheet('MAQUINAS', HEADERS.MAQUINAS);
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return 'Sem dados';
  const headers = data[0];
  const idxId     = headers.indexOf('ID');
  const idxClient = headers.indexOf('Cliente');
  const idxBrand  = headers.indexOf('Marca');
  const idxModel  = headers.indexOf('Modelo');
  const idxSerial = headers.indexOf('Série');
  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const currentId = String(data[i][idxId] || '').trim();
    if (currentId.startsWith('MK-')) continue;
    const mk = machineKey(
      data[i][idxClient] || '',
      data[i][idxBrand]  || '',
      data[i][idxModel]  || '',
      data[i][idxSerial] || ''
    );
    sheet.getRange(i + 1, idxId + 1).setValue(mk);
    updated++;
  }
  const vSheet = SS.getSheetByName('VISITAS');
  if (vSheet) {
    const vData = vSheet.getDataRange().getValues();
    const vH    = vData[0];
    const viMid = vH.indexOf('Machine_ID');
    const viCli = vH.indexOf('Cliente');
    const viMar = vH.indexOf('Marca');
    const viMod = vH.indexOf('Modelo');
    const viSer = vH.indexOf('Série');
    if (viMid >= 0) {
      for (let i = 1; i < vData.length; i++) {
        const mid = String(vData[i][viMid] || '').trim();
        if (mid) continue;
        const mk = machineKey(
          vData[i][viCli] || '',
          vData[i][viMar] || '',
          vData[i][viMod] || '',
          vData[i][viSer] || ''
        );
        vSheet.getRange(i + 1, viMid + 1).setValue(mk);
      }
    }
  }
  return 'Migração concluída: ' + updated + ' máquina(s) atualizada(s)';
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

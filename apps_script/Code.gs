// ╭──────────────────────────────────────────────────────────╮
// │ Reserva Espacios FAE — Backend (Google Apps Script)      │
// │ Auth: Google OAuth + password con session token          │
// │ Constantes en Config.gs (NO editar aquí).                │
// ╰──────────────────────────────────────────────────────────╯

// ─── Sheet helpers ──────────────────────────────────────

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  const body = e.postData ? JSON.parse(e.postData.contents || '{}') : {};
  const action = (e.parameter && e.parameter.action) || body.action;
  let result;
  try {
    const publicActions = ['login', 'register', 'googleAuth', 'getBookings', 'logout'];
    if (publicActions.includes(action)) {
      switch (action) {
        case 'login':       result = login(body); break;
        case 'register':    result = register(body); break;
        case 'googleAuth':  result = googleAuth(body); break;
        case 'getBookings': result = getBookings(body); break;
        case 'logout':      result = logout(body); break;
      }
    } else {
      const caller = verifyCaller(body);
      if (!caller) {
        result = { error: 'No autenticado' };
      } else {
        switch (action) {
          case 'addBooking':      result = addBooking(body, caller); break;
          case 'deleteBooking':   result = deleteBooking(body, caller); break;
          case 'getUsers':        result = getUsers(caller); break;
          case 'deleteUser':      result = deleteUser(body, caller); break;
          case 'getAllowlist':    result = getAllowlist(caller); break;
          case 'addAllowlist':    result = addAllowlist(body, caller); break;
          case 'removeAllowlist': result = removeAllowlist(body, caller); break;
          default: result = { error: 'Unknown action' };
        }
      }
    }
  } catch (err) {
    result = { error: err.toString() };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Verificación del que llama ─────────────────────────

function verifyCaller(body) {
  if (body.idToken)      return verifyGoogleToken(body.idToken);
  if (body.sessionToken) return verifyPasswordSession(body.sessionToken);
  return null;
}

function verifyGoogleToken(idToken) {
  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const data = JSON.parse(res.getContentText());
  if (data.aud !== GOOGLE_CLIENT_ID) return null;
  if (String(data.email_verified) !== 'true') return null;
  const email = String(data.email || '').toLowerCase();
  if (!email) return null;
  const domain = email.split('@')[1];
  if (!GOOGLE_AUTH_DOMAINS.includes(domain)) return null;
  if (!isEmailAuthorized(email)) return null;
  return {
    email,
    name: data.name || email,
    isAdmin: ADMIN_EMAILS.includes(email),
    authType: 'google'
  };
}

function verifyPasswordSession(token) {
  const sheet = usersSheet();
  const data = sheet.getDataRange().getValues();
  const now = Date.now();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === token && Number(data[i][4]) > now) {
      const email = String(data[i][0]).toLowerCase();
      return {
        email,
        name: data[i][1],
        isAdmin: ADMIN_EMAILS.includes(email),
        authType: 'password'
      };
    }
  }
  return null;
}

function isEmailAuthorized(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  if (ADMIN_EMAILS.includes(e)) return true;
  const domain = e.split('@')[1];
  if (AUTO_ALLOWED_DOMAINS.includes(domain)) return true;
  // Fallback: allowlist explícita (para excepciones de otros dominios)
  const sheet = getOrCreateSheet('allowlist', ['email']);
  const list = sheet.getDataRange().getValues().flat().map(x => String(x).toLowerCase());
  return list.includes(e);
}

function usersSheet() {
  return getOrCreateSheet('users',
    ['email','name','pass','session_token','session_expires','auth_type']);
}

// ─── Endpoints públicos ─────────────────────────────────

function googleAuth(body) {
  const idToken = body.idToken;
  if (!idToken) return { error: 'Falta idToken' };
  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { error: 'Token inválido' };
  const data = JSON.parse(res.getContentText());
  if (data.aud !== GOOGLE_CLIENT_ID) return { error: 'Token no autorizado para esta app' };
  if (String(data.email_verified) !== 'true') return { error: 'Email no verificado' };
  const email = String(data.email || '').toLowerCase();
  const name  = data.name || email;
  const domain = email.split('@')[1];
  if (!GOOGLE_AUTH_DOMAINS.includes(domain)) {
    return { error: 'Dominio ' + domain + ' no permitido para Google Sign-In' };
  }
  if (!isEmailAuthorized(email)) return { error: 'Email no autorizado por el administrador' };

  // Upsert usuario (sin password, marca auth_type=google).
  const sheet = usersSheet();
  const all = sheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < all.length; i++) {
    if (String(all[i][0]).toLowerCase() === email) {
      sheet.getRange(i + 1, 2).setValue(name);
      sheet.getRange(i + 1, 6).setValue('google');
      found = true;
      break;
    }
  }
  if (!found) sheet.appendRow([email, name, '', '', '', 'google']);

  return {
    ok: true,
    name,
    email,
    isAdmin: ADMIN_EMAILS.includes(email),
    authType: 'google'
  };
}

function login(body) {
  const email = String(body.email || '').toLowerCase();
  const pass  = body.pass;
  const sheet = usersSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][0]).toLowerCase();
    const rowType  = data[i][5] || 'password';
    if (rowEmail === email && data[i][2] === pass && rowType !== 'google') {
      const token   = Utilities.getUuid();
      const expires = Date.now() + SESSION_TTL_MS;
      sheet.getRange(i + 1, 4).setValue(token);
      sheet.getRange(i + 1, 5).setValue(expires);
      return {
        ok: true,
        name: data[i][1],
        email,
        isAdmin: ADMIN_EMAILS.includes(email),
        sessionToken: token,
        authType: 'password'
      };
    }
  }
  return { error: 'Credenciales incorrectas' };
}

function logout(body) {
  if (!body.sessionToken) return { ok: true };
  const sheet = usersSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === body.sessionToken) {
      sheet.getRange(i + 1, 4).setValue('');
      sheet.getRange(i + 1, 5).setValue('');
      break;
    }
  }
  return { ok: true };
}

function register(body) {
  const email = String(body.email || '').toLowerCase();
  const name  = body.name;
  const pass  = body.pass;
  if (!email || !name || !pass) return { error: 'Faltan campos' };
  const domain = email.split('@')[1];
  if (GOOGLE_AUTH_DOMAINS.includes(domain)) {
    return { error: 'Para @' + domain + ' usa "Entrar con Google"' };
  }
  if (!isEmailAuthorized(email)) return { error: 'Email no autorizado' };
  const sheet = usersSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.find(r => String(r[0]).toLowerCase() === email)) return { error: 'Email ya registrado' };
  sheet.appendRow([email, name, pass, '', '', 'password']);
  return { ok: true };
}

function getBookings(body) {
  const sheet = getOrCreateSheet('bookings', ['room','date','start','end','email','note']);
  const data  = sheet.getDataRange().getValues().slice(1);
  // mapa email -> nombre, para mostrar nombre en vez de email a no-admins
  const u = usersSheet().getDataRange().getValues().slice(1);
  const nameByEmail = {};
  u.forEach(r => { nameByEmail[String(r[0]).toLowerCase()] = r[1]; });
  const result = data
    .filter(r => !body.room || r[0] === body.room)
    .map(r => ({
      room: r[0], date: r[1], start: r[2], end: r[3],
      email: r[4], note: r[5],
      userName: nameByEmail[String(r[4]).toLowerCase()] || r[4]
    }));
  return { bookings: result };
}

// ─── Endpoints protegidos (caller ya verificado) ────────

function addBooking(body, caller) {
  // La reserva siempre se crea a nombre del caller verificado.
  const email = caller.email;
  const { room, date, start, end, note } = body;
  if (!room || !date || !start || !end) return { error: 'Faltan campos' };
  if (!note || !String(note).trim()) return { error: 'El motivo es obligatorio' };
  const sheet = getOrCreateSheet('bookings', ['room','date','start','end','email','note']);
  const data  = sheet.getDataRange().getValues().slice(1);
  const conflict = data.find(r => r[0] === room && r[1] === date && r[2] < end && r[3] > start);
  if (conflict) return { error: 'Solapa con otra reserva' };
  sheet.appendRow([room, date, start, end, email, String(note).trim()]);
  return { ok: true };
}

function deleteBooking(body, caller) {
  const { room, date, start, end, email } = body;
  if (!caller.isAdmin && caller.email !== String(email).toLowerCase()) return { error: 'Sin permiso' };
  const sheet = getOrCreateSheet('bookings', ['room','date','start','end','email','note']);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === room && data[i][1] === date && data[i][2] === start
        && data[i][3] === end && data[i][4] === email) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { error: 'Reserva no encontrada' };
}

function getUsers(caller) {
  if (!caller.isAdmin) return { error: 'Sin permiso' };
  const sheet = usersSheet();
  const data  = sheet.getDataRange().getValues().slice(1);
  return { users: data.map(r => ({
    email: r[0],
    name: r[1],
    authType: r[5] || 'password'
  })) };
}

function deleteUser(body, caller) {
  if (!caller.isAdmin) return { error: 'Sin permiso' };
  const email = String(body.email || '').toLowerCase();
  const sheet = usersSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email) {
      sheet.deleteRow(i + 1);
      // borrar también sus reservas
      const bs = getOrCreateSheet('bookings', ['room','date','start','end','email','note']);
      const bd = bs.getDataRange().getValues();
      for (let j = bd.length - 1; j >= 1; j--) {
        if (String(bd[j][4]).toLowerCase() === email) bs.deleteRow(j + 1);
      }
      return { ok: true };
    }
  }
  return { error: 'Usuario no encontrado' };
}

function getAllowlist(caller) {
  if (!caller.isAdmin) return { error: 'Sin permiso' };
  const sheet = getOrCreateSheet('allowlist', ['email']);
  return { allowlist: sheet.getDataRange().getValues().flat()
    .filter(e => e && String(e).toLowerCase() !== 'email') };
}

function addAllowlist(body, caller) {
  if (!caller.isAdmin) return { error: 'Sin permiso' };
  const email = String(body.email || '').toLowerCase();
  const sheet = getOrCreateSheet('allowlist', ['email']);
  const existing = sheet.getDataRange().getValues().flat().map(e => String(e).toLowerCase());
  if (existing.includes(email)) return { error: 'Ya existe' };
  sheet.appendRow([email]);
  return { ok: true };
}

function removeAllowlist(body, caller) {
  if (!caller.isAdmin) return { error: 'Sin permiso' };
  const email = String(body.email || '').toLowerCase();
  const sheet = getOrCreateSheet('allowlist', ['email']);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { error: 'No encontrado' };
}

// ─── Setup y migración ──────────────────────────────────

function setup() {
  usersSheet();
  getOrCreateSheet('bookings', ['room','date','start','end','email','note']);
  const al = getOrCreateSheet('allowlist', ['email']);
  if (al.getLastRow() < 2) al.appendRow(['pedro.albarran@gmail.com']);
}

// Ejecutar UNA VEZ desde el editor de Apps Script para migrar
// la pestaña `users` existente (3 columnas) al nuevo schema (6 columnas).
function migrateUsers() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('users');
  if (!sheet) { setup(); return; }
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const required = ['email','name','pass','session_token','session_expires','auth_type'];
  let nextCol = sheet.getLastColumn() + 1;
  required.forEach((h, i) => {
    if (!headers.includes(h)) {
      sheet.getRange(1, nextCol).setValue(h);
      nextCol++;
    }
  });
  // marcar las filas existentes como auth_type=password
  const lastRow = sheet.getLastRow();
  const last = sheet.getLastColumn();
  if (lastRow > 1) {
    const col = last; // auth_type columna recién creada (o ya existente)
    const range = sheet.getRange(2, col, lastRow - 1, 1);
    const vals = range.getValues();
    vals.forEach((r, i) => { if (!r[0]) vals[i][0] = 'password'; });
    range.setValues(vals);
  }
}

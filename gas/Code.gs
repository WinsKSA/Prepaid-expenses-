/**
 * Muqeem Desk — Google Apps Script backend.
 * The bound Google Sheet is the database:
 *   - hidden tabs "_db_<collection>" hold one row per record: id | json | updatedAt | updatedBy   (source of truth)
 *   - readable tabs (Employees, Iqama Renewals, Jawazat, Leases, Rent Installments) are rewritten by the app after each save.
 * Deploy: Extensions → Apps Script → paste Code.gs + Index.html → Deploy → New deployment → Web app
 *         Execute as: Me · Who has access: Only myself (or anyone in your organization).
 */
var COLLECTIONS = ['employees', 'renewals', 'visas', 'contracts', 'leaves', 'loans', 'payruns', 'config'];
var DB_PREFIX = '_db_';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Muqeem Desk')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function dbSheet_(col) {
  var name = DB_PREFIX + col, sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, 4).setValues([['id', 'json', 'updatedAt', 'updatedBy']]);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function who_() { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } }

/** Load every collection: {employees:[...], ...}. Runs the one-time migration from the readable tabs when empty. */
function loadAll() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (dbSheet_('employees').getLastRow() < 2 && dbSheet_('contracts').getLastRow() < 2) migrateFromViews_();
  } finally { lock.releaseLock(); }
  var out = { user: who_(), at: new Date().toISOString() };
  COLLECTIONS.forEach(function (col) {
    var sh = dbSheet_(col), n = sh.getLastRow() - 1, list = [];
    if (n > 0) sh.getRange(2, 1, n, 2).getValues().forEach(function (r) {
      if (!r[0] || !r[1]) return;
      try { var d = JSON.parse(r[1]); d._id = String(r[0]); list.push(d); } catch (e) {}
    });
    out[col] = list;
  });
  return JSON.stringify(out);
}

/** Upsert one record. */
function saveDoc(col, id, json) {
  if (COLLECTIONS.indexOf(col) < 0) throw new Error('Unknown collection ' + col);
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = dbSheet_(col), n = sh.getLastRow() - 1, row = -1;
    if (n > 0) {
      var ids = sh.getRange(2, 1, n, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { row = i + 2; break; }
    }
    var vals = [[String(id), json, new Date().toISOString(), who_()]];
    if (row > 0) sh.getRange(row, 1, 1, 4).setValues(vals); else sh.appendRow(vals[0]);
    return true;
  } finally { lock.releaseLock(); }
}

/** Upsert many records in one call: items = [[col,id,json],...] */
function saveMany(items) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var byCol = {};
    items.forEach(function (it) { (byCol[it[0]] = byCol[it[0]] || []).push(it); });
    Object.keys(byCol).forEach(function (col) {
      var sh = dbSheet_(col), n = sh.getLastRow() - 1, idx = {};
      if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach(function (r, i) { idx[String(r[0])] = i + 2; });
      var now = new Date().toISOString(), u = who_(), appends = [];
      byCol[col].forEach(function (it) {
        var v = [String(it[1]), it[2], now, u];
        if (idx[String(it[1])]) sh.getRange(idx[String(it[1])], 1, 1, 4).setValues([v]); else appends.push(v);
      });
      if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, 4).setValues(appends);
    });
    return true;
  } finally { lock.releaseLock(); }
}

function deleteDoc(col, id) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = dbSheet_(col), n = sh.getLastRow() - 1;
    if (n < 1) return false;
    var ids = sh.getRange(2, 1, n, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) sh.deleteRow(i + 2);
    return true;
  } finally { lock.releaseLock(); }
}

/** Rewrite the readable tabs: tables = [{title, rows:[[...],...]}] */
function writeViews(tables) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    tables.forEach(function (t) {
      var sh = ss_().getSheetByName(t.title) || ss_().insertSheet(t.title);
      sh.clearContents();
      if (!t.rows.length) return;
      var w = 0; t.rows.forEach(function (r) { if (r.length > w) w = r.length; });
      var rows = t.rows.map(function (r) { var c = r.slice(); while (c.length < w) c.push(''); return c; });
      if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
      sh.getRange(1, 1, rows.length, w).setValues(rows);
      sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#0f1f19').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    });
    return new Date().toISOString();
  } finally { lock.releaseLock(); }
}

/* ---------- one-time migration from the readable tabs written by the previous version ---------- */
function iso_(v) {
  if (v === '' || v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  var s = String(v).trim(); var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : s;
}
function num_(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function table_(title) {
  var sh = ss_().getSheetByName(title); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), hd = v[0];
  return v.slice(1).map(function (r) { var o = {}; hd.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}
function migrateFromViews_() {
  var items = [];
  table_('Employees').forEach(function (r) {
    if (!r['Emp No']) return;
    var nat = String(r['Nationality'] || '');
    var e = { empNo: String(r['Emp No']), hrNo: String(r['HR No'] || ''), nameAr: String(r['Name (AR)'] || ''), nameEn: String(r['Name (EN)'] || ''),
      gender: String(r['Gender'] || ''), nationality: nat, iqamaNo: String(r['Iqama No'] || ''), nationalId: String(r['National ID'] || ''),
      iqamaExpiry: iso_(r['Iqama expiry (last known)']), iqamaExpiryHijri: String(r['Hijri'] || ''), iqamaFeesBy: String(r['Iqama fees by'] || ''),
      jobTitle: String(r['Profession'] || ''), department: String(r['Department'] || ''), branch: String(r['Branch'] || ''), molFile: String(r['Labour office file'] || ''),
      passportNo: String(r['Passport No'] || ''), passportExpiry: iso_(r['Passport expiry']), insuranceExpiry: iso_(r['Insurance expiry']),
      dependents: num_(r['Dependents']), depPayer: String(r['Dependents fee by'] || 'Employee'), status: String(r['Status'] || 'Active'),
      phone: String(r['Mobile'] || ''), notes: String(r['Notes'] || ''), levyExempt: false };
    if (nat === 'السعودية' || /saudi/i.test(nat)) e.saudi = true;
    items.push(['employees', e.empNo, JSON.stringify(e)]);
  });
  var inst = {};
  table_('Rent Installments').forEach(function (r) {
    if (!r['Lease']) return;
    (inst[r['Lease']] = inst[r['Lease']] || []).push({ no: num_(r['No']), dueDate: iso_(r['Due']), periodStart: iso_(r['Period start']), periodEnd: iso_(r['Period end']),
      amount: num_(r['Amount excl. VAT']), vat: num_(r['VAT']), paidDate: iso_(r['Paid date']), paymentRef: String(r['Payment ref'] || '') });
  });
  table_('Leases').forEach(function (r) {
    if (!r['Lease']) return;
    var c = { id: String(r['Lease']), category: String(r['Category'] || 'Branch Rent'), branch: String(r['Branch'] || ''), vendor: String(r['Landlord'] || ''), refNo: String(r['Ejar / ref'] || ''),
      startDate: iso_(r['Start']), endDate: iso_(r['End']), totalAmount: num_(r['Value excl. VAT']), frequency: String(r['Frequency'] || 'Semi-annual'),
      vatApplicable: String(r['VAT']).toUpperCase() === 'TRUE', customSchedule: true, model: 'auto', noticeDays: r['Notice days'] === '' ? 90 : num_(r['Notice days']),
      city: String(r['City'] || ''), areaSqm: num_(r['Area m²']), notes: String(r['Notes'] || ''),
      installments: (inst[r['Lease']] || []).sort(function (a, b) { return a.no - b.no; }) };
    items.push(['contracts', c.id, JSON.stringify(c)]);
  });
  // carry the sheet link setting so the app knows where it lives
  items.push(['config', 'settings', JSON.stringify({ gsheet: ss_().getUrl() })]);
  if (items.length) {
    var byCol = {};
    items.forEach(function (it) { (byCol[it[0]] = byCol[it[0]] || []).push([it[1], it[2], new Date().toISOString(), 'migration']); });
    Object.keys(byCol).forEach(function (col) { var sh = dbSheet_(col); sh.getRange(sh.getLastRow() + 1, 1, byCol[col].length, 4).setValues(byCol[col]); });
  }
}

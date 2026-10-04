/* io.test.js — run with `node io.test.js` (needs `npm install xlsx@0.18.5`), or load in a browser
 * after xlsx.full.min.js and io.js (results go to console and window.IO_TEST_RESULT). */
(function () {
  var isNode = typeof module !== 'undefined' && typeof require !== 'undefined';
  var XLSX = isNode ? require('xlsx') : window.XLSX;
  var IO = isNode ? require('../io.js') : window.IO;
  IO.setXLSX(XLSX);

  var pass = 0, fail = 0, log = [];
  function out(s) { log.push(s); if (typeof console !== 'undefined') console.log(s); }
  function canon(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
    return Array.isArray(v) ? v.map(canon) : v;
  }
  function eq(name, got, exp) {
    var g = JSON.stringify(canon(got)), e = JSON.stringify(canon(exp));
    if (g === e) pass++; else { fail++; out('FAIL ' + name + ': got ' + g + ' expected ' + e); }
  }
  function ok(name, cond, extra) { if (cond) pass++; else { fail++; out('FAIL ' + name + (extra ? ' ' + JSON.stringify(extra) : '')); } }
  function dayDiff(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5); }

  // ---------- parseDate unit tests
  var ser = IO.isoToSerial('2026-11-15');
  eq('serial const', ser, 46341);
  eq('pd serial', IO.parseDate(46341), '2026-11-15');
  eq('pd serial str', IO.parseDate('46341'), '2026-11-15');
  eq('pd dd/mm/yyyy', IO.parseDate('15/11/2026'), '2026-11-15');
  eq('pd d-m-yyyy', IO.parseDate('5-1-2027'), '2027-01-05');
  eq('pd iso', IO.parseDate('2026-11-15'), '2026-11-15');
  eq('pd iso time', IO.parseDate('2026-11-15T10:00:00'), '2026-11-15');
  eq('pd dotted', IO.parseDate('15.11.2026'), '2026-11-15');
  eq('pd text month', IO.parseDate('15 Nov 2026'), '2026-11-15');
  eq('pd text month2', IO.parseDate('November 15, 2026'), '2026-11-15');
  eq('pd text month3', IO.parseDate('15-Nov-26'), '2026-11-15');
  eq('pd arabic month', IO.parseDate('15 نوفمبر 2026'), '2026-11-15');
  eq('pd arabic digits', IO.parseDate('١٥/١١/٢٠٢٦'), '2026-11-15');
  eq('pd JS Date local', IO.parseDate(new Date(2026, 10, 15)), '2026-11-15');
  eq('pd JS Date utc', IO.parseDate(new Date(Date.UTC(2026, 10, 15))), '2026-11-15');
  eq('pd yyyymmdd', IO.parseDate(20261115), '2026-11-15');
  eq('pd invalid', IO.parseDate('31/02/2026'), '');
  eq('pd garbage', IO.parseDate('n/a'), '');
  eq('pd empty', IO.parseDate(''), '');
  eq('pd march no strip', IO.parseDate('1 March 2026'), '2026-03-01');

  var ram = IO.parseDate('1447/09/01');
  out('Hijri 1 Ramadan 1447 -> ' + ram + ' (expected ~2026-02-18)');
  ok('hijri 1 Ramadan 1447 within 1 day', ram && Math.abs(dayDiff(ram, '2026-02-18')) <= 1, ram);
  eq('hijri forms agree (dd/mm/yyyy هـ)', IO.parseDate('01/09/1447 هـ'), ram);
  eq('hijri forms agree (arabic digits)', IO.parseDate('١٤٤٧/٠٩/٠١'), ram);
  eq('hijri forms agree (month name)', IO.parseDate('1 رمضان 1447'), ram);
  eq('hijri 1 Muharram 1447 (~2025-06-26)', Math.abs(dayDiff(IO.parseDate('1447-01-01'), '2025-06-26')) <= 1, true);

  // ---------- guessMapping unit tests
  var gm = IO.guessMapping(['Iqama No', 'Employee Name', 'Iqama Expiry', 'Passport', 'Passport Expiry', 'Profession', 'Mobile', 'Emp No']);
  eq('gm en', gm, { iqamaNo: 0, iqamaExpiry: 2, passportExpiry: 4, passportNo: 3, jobTitle: 5, phone: 6, empNo: 7, nameEn: 1 });
  var gmAr = IO.guessMapping({ headers: ['الاسم', 'رقم الهوية', 'انتهاء الاقامة'], rows: [['محمد علي', '2123456789', '1/1/2027']] });
  eq('gm arabic name values -> nameAr', gmAr.nameAr, 0);
  eq('gm arabic id', gmAr.iqamaNo, 1);
  eq('gm arabic exp', gmAr.iqamaExpiry, 2);
  var gm2 = IO.guessMapping(['Name', 'Name (Arabic)', 'ID No', 'Expiry Date', 'Medical Insurance Expiry', 'المرافقين', 'الإدارة', 'الفرع', 'Status']);
  eq('gm mixed', gm2, { nameAr: 1, insuranceExpiry: 4, dependents: 5, department: 6, branch: 7, status: 8, iqamaNo: 2, iqamaExpiry: 3, nameEn: 0 });

  // ---------- build a messy input workbook
  var aoa = [
    ['كشف الموظفين - شركة الاختبار'],
    [],
    ['م', 'الرقم الوظيفي', 'اسم الموظف', 'الجنسية', 'المهنة', 'رقم الإقامة', 'تاريخ انتهاء الإقامة', 'رقم الجواز', 'انتهاء الجواز', 'عدد التابعين', 'الحالة', 'الجوال', 'الفرع', 'معفى'],
    [1, 'EMP-0001', 'أحمد علي', 'هندي', 'نجار', 2123456789, ser, 'a1234567', '15 Nov 2026', 2, 'على رأس العمل', '0501112222', 'الرياض', 'لا'],
    [2, 'EMP-0002', 'محمد حسن', 'باكستاني', 'سائق', '٢٣٤٥٦٧٨٩٠١', '1448/05/14 هـ', 'B7654321', '٢٠/٠٣/٢٠٢٨', '٣', 'إجازة', '٠٥٥٣٣٣٤٤٤٤', 'جدة', 'نعم'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [3, 'EMP-0003', 'Rajesh Kumar', 'Indian', 'Accountant', '2234567890', '2026-12-01', 'Z111', '2027-01-31', '', 'هروب', '', 'الدمام', ''],
    [4, 'EMP-0004', 'سامي يوسف', 'مصري', 'مهندس', 2123456789, '01.09.1447', 'C999', '', 1, 'خروج نهائي', '', '', ''],
    [5, 'EMP-0005', '', 'سعودي', 'مدير', '1012345678', 'غير معروف', '', '', 0, 'نقل كفالة', '', '', '']
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'الموظفين');
  var inBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  var book = IO.readWorkbook(inBuf);
  var sh = book.sheets[0];
  eq('read: sheet name', sh.name, 'الموظفين');
  eq('read: header row detected', sh.headerRow, 2);
  eq('read: first header', sh.headers[1], 'الرقم الوظيفي');
  eq('read: row count (incl. empty)', sh.rows.length, 6);
  eq('read: serial kept raw', sh.rows[0][6], ser);

  var map = IO.guessMapping(sh);
  eq('map', map, { empNo: 1, nameAr: 2, nationality: 3, jobTitle: 4, iqamaNo: 5, iqamaExpiry: 6, passportNo: 7,
    passportExpiry: 8, dependents: 9, status: 10, phone: 11, branch: 12, levyExempt: 13 });

  var res = IO.mapRows(sh, map), em = res.employees;
  eq('mapRows: count (empty row skipped)', em.length, 5);
  eq('e1 iqama', em[0].iqamaNo, '2123456789');
  eq('e1 expiry (serial)', em[0].iqamaExpiry, '2026-11-15');
  eq('e1 passport exp (text month)', em[0].passportExpiry, '2026-11-15');
  eq('e1 status', em[0].status, 'Active');
  eq('e1 levy', em[0].levyExempt, false);
  eq('e1 nameAr', em[0].nameAr, 'أحمد علي');
  eq('e1 passport upper', em[0].passportNo, 'A1234567');
  eq('e1 depPayer default', em[0].depPayer, 'Employee');
  eq('e2 iqama arabic digits', em[1].iqamaNo, '2345678901');
  var h2 = IO.hijriToGregorian(1448, 5, 14);
  eq('e2 expiry hijri', em[1].iqamaExpiry, h2);
  out('Hijri 14/05/1448 -> ' + h2);
  eq('e2 passport exp arabic digits', em[1].passportExpiry, '2028-03-20');
  eq('e2 dependents', em[1].dependents, 3);
  eq('e2 status', em[1].status, 'On Vacation');
  eq('e2 levy', em[1].levyExempt, true);
  eq('e2 phone', em[1].phone, '0553334444');
  eq('e3 status huroob', em[2].status, 'Huroob');
  eq('e3 dependents default', em[2].dependents, 0);
  eq('e3 latin name in Arabic column', em[2].nameAr, 'Rajesh Kumar');
  eq('e4 hijri dotted', em[3].iqamaExpiry, ram);
  eq('e4 status', em[3].status, 'Final Exit');
  eq('e5 status', em[4].status, 'Transferred');
  var W = res.warnings.map(function (w) { return w.row + ': ' + w.message; });
  out('Warnings:\n  ' + W.join('\n  '));
  ok('warn duplicate on Excel row 8', res.warnings.some(function (w) { return w.row === 8 && /Duplicate/.test(w.message); }));
  ok('warn missing name row 9', res.warnings.some(function (w) { return w.row === 9 && /name/i.test(w.message); }));
  ok('warn saudi id row 9', res.warnings.some(function (w) { return w.row === 9 && /start with 2/.test(w.message); }));
  ok('warn invalid expiry row 9', res.warnings.some(function (w) { return w.row === 9 && /Invalid iqama expiry/.test(w.message); }));
  ok('no warnings on clean rows 4,5,7', !res.warnings.some(function (w) { return [4, 5, 7].indexOf(w.row) >= 0; }));

  // ---------- dedupe
  var existing = [
    { empNo: 'EMP-0001', nameAr: 'أحمد علي', iqamaNo: '2123456789', iqamaExpiry: '2025-11-15', dependents: 2 },
    { empNo: 'EMP-0003', nameAr: 'Rajesh Kumar', iqamaNo: '9999999999', iqamaExpiry: '2026-12-01' }
  ];
  var d = IO.dedupe(em.slice(0, 3), existing);
  eq('dedupe create', d.toCreate.map(function (e) { return e.empNo; }), ['EMP-0002']);
  eq('dedupe update count', d.toUpdate.length, 2);
  eq('dedupe update1 empNo', d.toUpdate[0].empNo, 'EMP-0001');
  eq('dedupe update1 expiry', d.toUpdate[0].changes.iqamaExpiry, '2026-11-15');
  ok('dedupe update1 does not touch unchanged dependents', !('dependents' in d.toUpdate[0].changes));
  eq('dedupe update2 by empNo changes iqama', d.toUpdate[1].changes.iqamaNo, '2234567890');
  var d2 = IO.dedupe([{ empNo: 'EMP-0001', iqamaNo: '2123456789', iqamaExpiry: '2025-11-15', dependents: 2, nameAr: '' }], existing);
  eq('dedupe unchanged', d2.unchanged.length, 1);

  // ---------- export round-trip
  var cols = [
    { key: 'empNo', header: 'Emp No', type: 'text' },
    { key: 'nameAr', header: 'الاسم', type: 'text' },
    { key: 'iqamaNo', header: 'Iqama No', type: 'text', width: 14 },
    { key: 'iqamaExpiry', header: 'Iqama Expiry', type: 'date' },
    { key: 'passportExpiry', header: 'Passport Expiry', type: 'date' },
    { key: 'dependents', header: 'Dependents', type: 'number' },
    { key: 'fee', header: 'Fee (SAR)', type: 'money' }
  ];
  var exRows = em.map(function (e, i) { var r = Object.assign({}, e); r.fee = 650 * (i + 1) + 0.005; return r; });
  var outBuf = IO.exportWorkbook([{ name: 'Employees', rows: exRows, columns: cols }, { name: 'Raw', rows: [{ a: 1, b: 'x' }] }]);
  ok('export returns ArrayBuffer', outBuf instanceof ArrayBuffer, Object.prototype.toString.call(outBuf));
  var wb2 = XLSX.read(new Uint8Array(outBuf), { type: 'array', cellNF: true, cellStyles: true });
  eq('export sheets', wb2.SheetNames, ['Employees', 'Raw']);
  var ws2 = wb2.Sheets.Employees;
  eq('export date cell type', ws2.D2.t, 'n');
  eq('export date value', ws2.D2.v, ser);
  eq('export date format', ws2.D2.z, 'dd/mm/yyyy');
  eq('export money format', ws2.G2.z, '#,##0.00');
  eq('export money value', ws2.G2.v, 650.01);
  eq('export iqama text', ws2.C2.t, 's');
  eq('export autofilter', ws2['!autofilter'] && ws2['!autofilter'].ref, 'A1:G6');
  eq('export col width', ws2['!cols'] && ws2['!cols'][2] && ws2['!cols'][2].wch, 14);
  var cfb = XLSX.CFB.read(new Uint8Array(outBuf), { type: 'array' });
  var sx = XLSX.CFB.find(cfb, '/xl/worksheets/sheet1.xml');
  var sxml = new TextDecoder().decode(sx.content);
  ok('export frozen header pane', /<pane ySplit="1" topLeftCell="A2"[^>]*state="frozen"/.test(sxml), sxml.slice(0, 400));

  var back = IO.readWorkbook(outBuf).sheets[0];
  var back2 = IO.mapRows(back, IO.guessMapping(back)).employees;
  eq('roundtrip count', back2.length, em.length);
  eq('roundtrip dates', back2.map(function (e) { return e.iqamaExpiry; }), em.map(function (e) { return e.iqamaExpiry; }));
  eq('roundtrip passport dates', back2.map(function (e) { return e.passportExpiry; }), em.map(function (e) { return e.passportExpiry; }));
  eq('roundtrip iqama', back2.map(function (e) { return e.iqamaNo; }), em.map(function (e) { return e.iqamaNo; }));
  eq('roundtrip names', back2.map(function (e) { return e.nameAr; }), em.map(function (e) { return e.nameAr; }));

  // ---------- template
  var tpl = IO.employeeTemplate();
  var tb = IO.readWorkbook(tpl);
  eq('template sheets', tb.sheets.map(function (s) { return s.name; }), ['Employees', 'Instructions']);
  var ts = tb.sheets[0];
  ok('template arabic sub-header skipped', ts.subHeaders && ts.subHeaders[2] === 'الاسم بالعربي', ts.subHeaders);
  var tm = IO.guessMapping(ts);
  eq('template maps all 19 fields', Object.keys(tm).length, 19);
  var expectedOrder = IO.TEMPLATE_COLUMNS.map(function (c, i) { return c.key + '=' + i; }).sort();
  eq('template mapping exact', Object.keys(tm).map(function (k) { return k + '=' + tm[k]; }).sort(), expectedOrder);
  var arMap = IO.guessMapping(ts.subHeaders);
  eq('template arabic header row maps all 19', Object.keys(arMap).map(function (k) { return k + '=' + arMap[k]; }).sort(), expectedOrder);
  var tr = IO.mapRows(ts, tm);
  eq('template example row', tr.employees.length, 1);
  eq('template example no warnings', tr.warnings, []);
  eq('template example expiry', tr.employees[0].iqamaExpiry, '2026-11-15');
  eq('template example row number', tr.employees[0]._row, 3);
  var tx = new TextDecoder().decode(XLSX.CFB.find(XLSX.CFB.read(new Uint8Array(tpl), { type: 'array' }), '/xl/worksheets/sheet1.xml').content);
  ok('template freezes 2 rows', /<pane ySplit="2" topLeftCell="A3"/.test(tx));

  // ---------- CSV
  var csv = IO.toCSV([{ a: 'x,y', b: 'he said "hi"', c: 'سطر\nجديد', d: 1234.5, e: true, f: '2026-11-15' }],
    [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }, { key: 'c', header: 'ج' }, { key: 'd', header: 'D', type: 'money' }, { key: 'e', header: 'E' }, { key: 'f', header: 'F', type: 'date' }]);
  eq('csv', csv, '﻿A,B,ج,D,E,F\r\n"x,y","he said ""hi""","سطر\nجديد",1234.50,Yes,2026-11-15\r\n');
  ok('csv inferred columns', IO.toCSV([{ p: 1 }, { q: 2 }]) === '﻿p,q\r\n1,\r\n,2\r\n');

  out((fail ? 'FAILED' : 'ALL PASSED') + ': ' + pass + ' passed, ' + fail + ' failed');
  var result = { pass: pass, fail: fail, log: log };
  if (isNode) { if (fail) process.exitCode = 1; } else window.IO_TEST_RESULT = result;
})();

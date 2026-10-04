/* io.js — Excel/CSV import-export for the Iqama & Jawazat Control System.
 * Browser: needs the SheetJS global `XLSX` (xlsx 0.18.5). Node: IO.setXLSX(require('xlsx')).
 * All dates are ISO "YYYY-MM-DD", all date math in UTC.
 */
(function (root) {
  'use strict';

  var X = (typeof root !== 'undefined' && root && root.XLSX) ? root.XLSX : null;
  function xl() {
    if (!X && typeof XLSX !== 'undefined') X = XLSX; // eslint-disable-line no-undef
    if (!X) throw new Error('IO: SheetJS (XLSX) is not loaded. In Node call IO.setXLSX(require("xlsx")).');
    return X;
  }

  var DAY = 86400000;
  var EXCEL_EPOCH = Date.UTC(1899, 11, 30);

  var FIELDS = ['empNo', 'nameEn', 'nameAr', 'nationality', 'jobTitle', 'department', 'iqamaNo', 'iqamaExpiry',
    'passportNo', 'passportExpiry', 'insuranceExpiry', 'dependents', 'depPayer', 'status', 'phone', 'email',
    'levyExempt', 'notes', 'branch'];

  // ---------------------------------------------------------------- text helpers
  function toLatinDigits(s) {
    return String(s).replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
  }
  function norm(s) {
    if (s === null || s === undefined) return '';
    s = toLatinDigits(String(s)).toLowerCase();
    s = s.replace(/[ً-ٰٟۖ-ۭ]/g, '') // diacritics
      .replace(/ـ/g, '')                                  // tatweel
      .replace(/[أإآٱ]/g, 'ا')         // أ إ آ ٱ -> ا
      .replace(/ة/g, 'ه')                             // ة -> ه
      .replace(/ى/g, 'ي');                            // ى -> ي
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[،؛؟٪-٭۔]/g, '').replace(/[^a-z0-9؀-ۿ]/g, '');
  }
  function isEmpty(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function str(v) {
    if (isEmpty(v)) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
    if (v instanceof Date) return parseDate(v);
    return String(v).trim();
  }
  var AR_RE = /[؀-ۿ]/g, LAT_RE = /[A-Za-z]/g;
  function arabicDominates(values) {
    var ar = 0, lat = 0;
    for (var i = 0; i < values.length; i++) {
      var s = String(values[i] == null ? '' : values[i]);
      ar += (s.match(AR_RE) || []).length; lat += (s.match(LAT_RE) || []).length;
    }
    return ar > lat;
  }

  // ---------------------------------------------------------------- synonyms
  var SYN = {
    empNo: ['emp no', 'emp #', 'employee no', 'employee number', 'employee id', 'emp id', 'emp code', 'employee code',
      'staff no', 'staff id', 'staff number', 'badge no', 'emp number', 'payroll no',
      'الرقم الوظيفي', 'رقم الموظف', 'رقم وظيفي', 'كود الموظف', 'الكود الوظيفي', 'الرقم الوظيفى'],
    nameEn: ['name en', 'name (en)', 'english name', 'name english', 'name (english)', 'name in english',
      'employee name english', 'employee name (english)', 'name as per passport', 'الاسم بالانجليزي',
      'الاسم الانجليزي', 'الاسم انجليزي', 'الاسم باللغه الانجليزيه', 'اسم الموظف بالانجليزي'],
    nameAr: ['name ar', 'name (ar)', 'arabic name', 'name arabic', 'name (arabic)', 'name in arabic',
      'employee name arabic', 'الاسم بالعربي', 'الاسم العربي', 'الاسم عربي', 'الاسم باللغه العربيه',
      'اسم الموظف بالعربي'],
    _name: ['name', 'employee name', 'emp name', 'full name', 'worker name', 'staff name',
      'الاسم', 'اسم الموظف', 'الاسم الكامل', 'اسم العامل', 'الاسم الرباعي', 'اسم'],
    nationality: ['nationality', 'nation', 'country', 'citizenship', 'الجنسيه', 'الجنسية', 'جنسيه'],
    jobTitle: ['job title', 'profession', 'occupation', 'position', 'designation', 'job', 'title', 'trade',
      'iqama profession', 'المهنه', 'المهنة', 'الوظيفه', 'المسمي الوظيفي', 'مهنه الاقامه', 'المهنه في الاقامه'],
    department: ['department', 'dept', 'division', 'section', 'القسم', 'الاداره', 'الادارة', 'قسم'],
    iqamaNo: ['iqama no', 'iqama number', 'iqama #', 'iqama', 'iqama id', 'residence id', 'resident id',
      'residency no', 'id no', 'id number', 'id #', 'national id', 'id', 'رقم الاقامه', 'رقم الإقامة',
      'رقم الهويه', 'رقم الهوية', 'الاقامه', 'الهويه', 'هويه مقيم', 'رقم هويه مقيم', 'رقم الاقامه/الهويه'],
    iqamaExpiry: ['iqama expiry', 'iqama expiry date', 'iqama exp', 'iqama exp date', 'iqama end date',
      'iqama expire', 'iqama expiration', 'expiry date', 'expiry', 'expiration date', 'exp date', 'expire date',
      'id expiry', 'id expiry date', 'residence expiry', 'تاريخ انتهاء الاقامه', 'انتهاء الاقامه',
      'تاريخ الانتهاء', 'انتهاء الهويه', 'تاريخ انتهاء الهويه', 'صلاحيه الاقامه', 'نهايه الاقامه'],
    passportNo: ['passport no', 'passport number', 'passport #', 'passport', 'رقم الجواز', 'الجواز',
      'رقم جواز السفر', 'جواز السفر'],
    passportExpiry: ['passport expiry', 'passport expiry date', 'passport exp', 'passport exp date',
      'passport expiration', 'passport end date', 'انتهاء الجواز', 'تاريخ انتهاء الجواز', 'انتهاء جواز السفر',
      'تاريخ انتهاء جواز السفر'],
    insuranceExpiry: ['insurance expiry', 'medical insurance expiry', 'insurance expiry date', 'insurance exp',
      'medical expiry', 'insurance end date', 'medical insurance', 'insurance', 'انتهاء التامين',
      'تاريخ انتهاء التامين', 'انتهاء التامين الطبي', 'تاريخ انتهاء التامين الطبي', 'التامين الطبي'],
    dependents: ['dependents', 'dependants', 'no of dependents', 'number of dependents', 'dependents count',
      'family members', 'companions', 'المرافقين', 'المرافقون', 'عدد المرافقين', 'عدد التابعين', 'التابعين'],
    depPayer: ['dependents payer', 'dep payer', 'dependent payer', 'dependents fees paid by', 'dependent fees paid by',
      'dependents paid by', 'dependents fee payer', 'paid by', 'payer', 'رسوم المرافقين على',
      'دافع رسوم المرافقين', 'المسؤول عن رسوم المرافقين', 'على حساب'],
    status: ['status', 'employee status', 'emp status', 'employment status', 'الحاله', 'الحالة', 'حاله الموظف'],
    phone: ['phone', 'mobile', 'mobile no', 'mobile number', 'phone no', 'phone number', 'contact no', 'tel',
      'telephone', 'cell', 'الجوال', 'رقم الجوال', 'الهاتف', 'جوال', 'رقم الهاتف', 'الموبايل'],
    email: ['email', 'e-mail', 'email address', 'mail', 'البريد الالكتروني', 'الايميل', 'البريد'],
    levyExempt: ['levy exempt', 'levy exemption', 'exempt from levy', 'exempt', 'exempted', 'levy exempted',
      'معفي', 'معفي من المقابل المالي', 'اعفاء المقابل المالي', 'اعفاء', 'معفي من الرسوم'],
    notes: ['notes', 'note', 'remarks', 'comments', 'comment', 'ملاحظات', 'الملاحظات', 'ملاحظه'],
    branch: ['branch', 'location', 'site', 'work location', 'الفرع', 'الموقع', 'فرع', 'موقع العمل']
  };
  var SYN_N = {};
  Object.keys(SYN).forEach(function (f) {
    SYN_N[f] = SYN[f].map(norm).filter(function (s, i, a) { return s && a.indexOf(s) === i; });
  });

  function scoreHeader(h, field) {
    if (!h) return 0;
    var best = 0, list = SYN_N[field];
    for (var i = 0; i < list.length; i++) {
      var s = list[i], sc = 0;
      if (h === s) sc = 1000 + s.length;
      else if (s.length >= 3 && h.indexOf(s) >= 0) sc = 100 + s.length * 4 - (h.length - s.length);
      else if (h.length >= 4 && s.indexOf(h) >= 0) sc = 40 + h.length * 2;
      if (sc > best) best = sc;
    }
    return best;
  }

  // guessMapping(headers[, rows])  or  guessMapping(sheet)
  function guessMapping(headers, rows) {
    if (headers && !Array.isArray(headers) && headers.headers) { rows = headers.rows; headers = headers.headers; }
    headers = headers || [];
    var hn = headers.map(norm), cand = [];
    Object.keys(SYN_N).forEach(function (f) {
      hn.forEach(function (h, c) { var s = scoreHeader(h, f); if (s > 0) cand.push({ f: f, c: c, s: s }); });
    });
    cand.sort(function (a, b) { return b.s - a.s || a.c - b.c; });
    var map = {}, usedCol = {}, generic = [];
    cand.forEach(function (k) {
      if (usedCol[k.c]) return;
      if (k.f === '_name') { if (generic.length < 2) { generic.push(k.c); usedCol[k.c] = 1; } return; }
      if (map[k.f] !== undefined) return;
      map[k.f] = k.c; usedCol[k.c] = 1;
    });
    function colArabic(c) {
      if (rows && rows.length) {
        var vals = [];
        for (var i = 0; i < rows.length && vals.length < 50; i++) if (rows[i] && !isEmpty(rows[i][c])) vals.push(rows[i][c]);
        if (vals.length) return arabicDominates(vals);
      }
      return null;
    }
    generic.forEach(function (c) {
      var ar = colArabic(c);
      var pref = ar === true ? 'nameAr' : 'nameEn', alt = pref === 'nameAr' ? 'nameEn' : 'nameAr';
      if (map[pref] === undefined) map[pref] = c; else if (map[alt] === undefined) map[alt] = c;
    });
    // Data sanity: swap if the "English" column is really Arabic (and vice versa).
    if (map.nameEn !== undefined && colArabic(map.nameEn) === true) {
      if (map.nameAr === undefined) { map.nameAr = map.nameEn; delete map.nameEn; }
      else if (colArabic(map.nameAr) === false) { var t = map.nameAr; map.nameAr = map.nameEn; map.nameEn = t; }
    }
    return map;
  }

  // ---------------------------------------------------------------- dates
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function isoFromDayNum(dn) {
    var d = new Date(dn * DAY);
    return pad(d.getUTCFullYear(), 4) + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function gregValid(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1) return '';
    return pad(y, 4) + '-' + pad(m) + '-' + pad(d);
  }
  function serialToISO(n) {
    if (!(n >= 1 && n < 2958466)) return '';
    var whole = Math.floor(n + 1e-7);
    if (whole < 60) whole += 1; // Excel's fake 1900-02-29
    return isoFromDayNum(Math.round((EXCEL_EPOCH + whole * DAY) / DAY));
  }
  function isoToSerial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EXCEL_EPOCH) / DAY);
  }

  // Umm al-Qura via Intl (binary search on UTC day number); tabular fallback.
  var HFMT = null, HFMT_OK = null;
  function hijriFmt() {
    if (HFMT_OK === null) {
      try {
        HFMT = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',
          { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
        HFMT_OK = HFMT.resolvedOptions().calendar === 'islamic-umalqura';
      } catch (e) { HFMT_OK = false; }
    }
    return HFMT_OK ? HFMT : null;
  }
  var HCACHE = {};
  function hijriOfDay(dn) {
    if (HCACHE[dn]) return HCACHE[dn];
    var parts = hijriFmt().formatToParts(new Date(dn * DAY)), r = { y: 0, m: 0, d: 0 };
    parts.forEach(function (p) {
      if (p.type === 'year') r.y = parseInt(p.value, 10);
      else if (p.type === 'month') r.m = parseInt(p.value, 10);
      else if (p.type === 'day') r.d = parseInt(p.value, 10);
    });
    return (HCACHE[dn] = r);
  }
  function hijriToISO(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 30)) return '';
    if (hijriFmt()) {
      var target = y * 10000 + m * 100 + d;
      var lo = Math.floor(Date.UTC(1925, 0, 1) / DAY), hi = Math.floor(Date.UTC(2080, 0, 1) / DAY);
      while (lo < hi) {
        var mid = Math.floor((lo + hi) / 2), h = hijriOfDay(mid);
        if (h.y * 10000 + h.m * 100 + h.d < target) lo = mid + 1; else hi = mid;
      }
      var f = hijriOfDay(lo);
      if (f.y === y && f.m === m && f.d === d) return isoFromDayNum(lo);
      // day 30 of a 29-day month -> roll over to the next day (1st of next month)
      if (d === 30) { var p = hijriOfDay(lo - 1); if (p.y === y && p.m === m && p.d === 29) return isoFromDayNum(lo); }
      return '';
    }
    // Fallback: tabular (Kuwaiti) Islamic calendar.
    var jd = Math.floor((11 * y + 3) / 30) + 354 * y + 30 * m - Math.floor((m - 1) / 2) + d + 1948440 - 385;
    return isoFromDayNum(jd - 2440588);
  }

  var MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
    november: 11, dec: 12, december: 12
  };
  [['يناير'], ['فبراير'], ['مارس'], ['ابريل', 'أبريل'], ['مايو'], ['يونيو', 'يونيه'], ['يوليو', 'يوليه'],
    ['اغسطس', 'أغسطس'], ['سبتمبر'], ['اكتوبر', 'أكتوبر'], ['نوفمبر'], ['ديسمبر']].forEach(function (a, i) {
    a.forEach(function (n) { MONTHS[norm(n)] = i + 1; });
  });
  var HMONTHS = {};
  [['محرم'], ['صفر'], ['ربيع الأول', 'ربيع الاول', 'ربيع اول', 'rabi al-awwal', 'rabi i'],
    ['ربيع الآخر', 'ربيع الثاني', 'ربيع ثاني', 'rabi al-thani', 'rabi ii'],
    ['جمادى الأولى', 'جمادى الاولى', 'جمادى الأول', 'jumada al-awwal', 'jumada i'],
    ['جمادى الآخرة', 'جمادى الثانية', 'جمادى الاخره', 'jumada al-thani', 'jumada ii'],
    ['رجب', 'rajab'], ['شعبان', 'shaban', "sha'ban"], ['رمضان', 'ramadan'], ['شوال', 'shawwal'],
    ['ذو القعدة', 'ذي القعدة', 'dhu al-qadah', 'dhul qadah'], ['ذو الحجة', 'ذي الحجة', 'dhu al-hijjah', 'dhul hijjah']]
    .forEach(function (a, i) { a.forEach(function (n) { HMONTHS[norm(n)] = i + 1; }); });
  HMONTHS[norm('muharram')] = 1; HMONTHS[norm('safar')] = 2;

  function ymd(y, m, d) {
    if (y < 100) y += 2000;
    if (y >= 1350 && y <= 1500) return hijriToISO(y, m, d);
    return gregValid(y, m, d);
  }

  function parseDate(v) {
    if (isEmpty(v)) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      return isoFromDayNum(Math.round(v.getTime() / DAY)); // nearest UTC midnight: robust to local-midnight dates
    }
    if (typeof v === 'number') {
      if (!isFinite(v)) return '';
      if (v >= 19000101 && v <= 22001231 && Number.isInteger(v)) {
        var g = gregValid(Math.floor(v / 10000), Math.floor(v / 100) % 100, v % 100); if (g) return g;
      }
      if (v >= 13500101 && v <= 15001230 && Number.isInteger(v)) return ymd(Math.floor(v / 10000), Math.floor(v / 100) % 100, v % 100);
      return serialToISO(v);
    }
    var s = toLatinDigits(String(v)).trim()
      .replace(/[‎‏؜‪-‮]/g, '')
      .replace(/(\d)\s*(هـ|ه|AH|A\.H\.?|H)\s*$/i, '$1')
      .replace(/(\d)\s*(م|AD|G)\s*$/i, '$1').trim();
    if (!s) return '';
    var m;
    if (/^\d+(\.\d+)?$/.test(s)) {
      if (s.length === 8) {
        var a = +s.slice(0, 4), b = +s.slice(4, 6), c = +s.slice(6, 8);
        if (a >= 1350) return ymd(a, b, c);
        return ymd(+s.slice(4, 8), +s.slice(2, 4), +s.slice(0, 2)); // ddmmyyyy
      }
      return parseDate(parseFloat(s));
    }
    // yyyy-mm-dd / yyyy/mm/dd / yyyy.mm.dd (optionally followed by time)
    if ((m = /^(\d{4})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})(?:\b|T|\s|$)/.exec(s))) return ymd(+m[1], +m[2], +m[3]);
    // dd/mm/yyyy, d-m-yyyy, dd.mm.yyyy (also 2-digit year)
    if ((m = /^(\d{1,2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{4}|\d{2})(?:\b|\s|$)/.exec(s))) {
      var d = +m[1], mo = +m[2], y = +m[3];
      if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; }
      return ymd(y, mo, d);
    }
    // Month names: "15 Nov 2026", "15-Nov-26", "Nov 15, 2026", "1 رمضان 1447"
    var toks = s.replace(/,/g, ' ').replace(/[-\/.]/g, ' ').split(/\s+/).filter(Boolean);
    var nums = [], mon = 0, hmon = 0, words = [];
    toks.forEach(function (tk) { if (/^\d+$/.test(tk)) nums.push(+tk); else words.push(tk); });
    // allow multi-word month names (e.g. "ربيع الأول", "ذو الحجة")
    for (var i = 0; i < words.length && !mon && !hmon; i++) {
      var w1 = norm(words[i]), w2 = i + 1 < words.length ? w1 + norm(words[i + 1]) : null;
      if (w2 && HMONTHS[w2]) hmon = HMONTHS[w2];
      else if (HMONTHS[w1]) hmon = HMONTHS[w1];
      else if (MONTHS[w1]) mon = MONTHS[w1];
      else if (w1.length >= 3 && MONTHS[w1.slice(0, 3)] && /^[a-z]+$/.test(w1)) mon = MONTHS[w1.slice(0, 3)];
    }
    if ((mon || hmon) && nums.length === 2) {
      var dd, yy;
      if (nums[0] > 31 || (nums[1] <= 31 && nums[0] > 99)) { yy = nums[0]; dd = nums[1]; } else { dd = nums[0]; yy = nums[1]; }
      if (hmon) { if (yy < 100) yy += 1400; return hijriToISO(yy, hmon, dd); }
      return ymd(yy, mon, dd);
    }
    return '';
  }

  // ---------------------------------------------------------------- read
  function isTextCell(v) { return typeof v === 'string' && v.trim() !== '' && !/^[\d\s.,\/\-:]+$/.test(toLatinDigits(v)); }
  function exactHeaderHits(row) {
    var n = 0;
    (row || []).forEach(function (v) {
      var h = norm(v); if (!h) return;
      for (var f in SYN_N) if (SYN_N[f].indexOf(h) >= 0) { n++; return; }
    });
    return n;
  }

  function readWorkbook(arrayBuffer) {
    var x = xl(), type = 'array', data = arrayBuffer;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(arrayBuffer)) type = 'buffer';
    else if (arrayBuffer instanceof ArrayBuffer) data = new Uint8Array(arrayBuffer);
    else if (typeof arrayBuffer === 'string') type = 'binary';
    var wb = x.read(data, { type: type, cellDates: false, cellNF: false, cellText: false });
    var sheets = wb.SheetNames.map(function (name) {
      var aoa = x.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true });
      var hdr = -1;
      for (var r = 0; r < Math.min(15, aoa.length); r++) {
        var cnt = (aoa[r] || []).filter(isTextCell).length;
        if (cnt >= 3) { hdr = r; break; }
      }
      if (hdr < 0) for (r = 0; r < aoa.length; r++) if ((aoa[r] || []).some(function (v) { return !isEmpty(v); })) { hdr = r; break; }
      if (hdr < 0) return { name: name, headers: [], rows: [], headerRow: -1 };
      var headers = (aoa[hdr] || []).map(function (v) { return isEmpty(v) ? '' : String(v).trim(); });
      var start = hdr + 1, subHeaders = null;
      // Bilingual templates: a second header row (e.g. Arabic under English) is skipped.
      if (aoa[start] && exactHeaderHits(aoa[start]) >= 3 &&
          (aoa[start] || []).filter(function (v) { return !isEmpty(v); }).every(isTextCell)) {
        subHeaders = aoa[start].map(function (v) { return isEmpty(v) ? '' : String(v).trim(); });
        start++;
      }
      var width = headers.length, rows = [];
      for (r = start; r < aoa.length; r++) {
        var row = (aoa[r] || []).slice();
        if (row.length > width) width = row.length;
        rows.push(row);
      }
      while (headers.length < width) headers.push('');
      rows.forEach(function (row) { while (row.length < width) row.push(''); });
      while (rows.length && rows[rows.length - 1].every(isEmpty)) rows.pop();
      var out = { name: name, headers: headers, rows: rows, headerRow: hdr, dataStartRow: start };
      if (subHeaders) out.subHeaders = subHeaders;
      return out;
    });
    return { sheets: sheets };
  }

  // ---------------------------------------------------------------- map rows
  function mapStatus(v) {
    var s = norm(v);
    if (!s) return 'Active';
    var rules = [
      ['Final Exit', ['finalexit', 'exit', 'خروجنهائي', 'خروج', 'نهائي']],
      ['Huroob', ['huroob', 'horoob', 'hurub', 'absconded', 'abscond', 'runaway', 'هروب', 'متغيب', 'تغيب', 'منقطع']],
      ['Transferred', ['transfer', 'نقل', 'منقول', 'تنازل']],
      ['On Vacation', ['vacation', 'leave', 'holiday', 'اجازه', 'باجازه', 'خارجالمملكه']],
      ['Active', ['active', 'working', 'onduty', 'نشط', 'فعال', 'علىراسالعمل', 'عليراسالعمل', 'يعمل', 'موجود', 'سار']]
    ];
    for (var i = 0; i < rules.length; i++)
      for (var j = 0; j < rules[i][1].length; j++)
        if (s.indexOf(norm(rules[i][1][j])) >= 0) return rules[i][0];
    return 'Active';
  }
  function mapPayer(v) {
    var s = norm(v);
    if (!s) return 'Employee';
    if (/^(company|co|c|employer|firm|establishment)$/.test(s) || /company|employer/.test(s) ||
        /شركه|المنشاه|منشاه|الشركه|صاحبالعمل|المؤسسه/.test(s)) return 'Company';
    return 'Employee';
  }
  function mapBool(v) {
    if (v === true || v === 1) return true;
    var s = norm(v);
    if (!s) return false;
    if (/^(no|n|false|0|لا|غيرمعفي|ليس)$/.test(s) || s.indexOf('غير') === 0) return false;
    return /^(yes|y|true|1|x|exempt|exempted|نعم|معفي|اعفاء|صح|✓|✔)/.test(s) || /[✓✔]/.test(String(v));
  }
  function digits(v) { return toLatinDigits(str(v)).replace(/\D/g, ''); }

  function mapRows(sheet, mapping) {
    mapping = mapping || guessMapping(sheet);
    var employees = [], warnings = [], seen = {};
    var base = (sheet.dataStartRow !== undefined ? sheet.dataStartRow : (sheet.headerRow || 0) + 1) + 1; // 1-based Excel row
    function get(row, f) { var c = mapping[f]; return (c === undefined || c === null || c < 0) ? '' : row[c]; }
    (sheet.rows || []).forEach(function (row, i) {
      var rowNo = base + i;
      if (!row || row.every(isEmpty)) return;
      var warn = function (msg) { warnings.push({ row: rowNo, message: msg }); };
      var e = {
        empNo: toLatinDigits(str(get(row, 'empNo'))),
        nameEn: str(get(row, 'nameEn')),
        nameAr: str(get(row, 'nameAr')),
        nationality: str(get(row, 'nationality')),
        jobTitle: str(get(row, 'jobTitle')),
        department: str(get(row, 'department')),
        branch: str(get(row, 'branch')),
        iqamaNo: digits(get(row, 'iqamaNo')),
        iqamaExpiry: parseDate(get(row, 'iqamaExpiry')),
        passportNo: toLatinDigits(str(get(row, 'passportNo'))).replace(/\s+/g, '').toUpperCase(),
        passportExpiry: parseDate(get(row, 'passportExpiry')),
        insuranceExpiry: parseDate(get(row, 'insuranceExpiry')),
        dependents: 0,
        depPayer: mapPayer(get(row, 'depPayer')),
        levyExempt: mapBool(get(row, 'levyExempt')),
        status: mapStatus(get(row, 'status')),
        phone: toLatinDigits(str(get(row, 'phone'))),
        email: str(get(row, 'email')).toLowerCase(),
        notes: str(get(row, 'notes'))
      };
      var dep = parseInt(digits(get(row, 'dependents')), 10);
      e.dependents = isFinite(dep) && dep > 0 ? dep : 0;

      if (!e.nameEn && !e.nameAr) warn('Missing employee name');
      if (!e.iqamaNo) warn('Missing iqama number');
      else {
        if (e.iqamaNo.charAt(0) !== '2') warn('Iqama number ' + e.iqamaNo + ' does not start with 2 (expat iqamas start with 2)');
        if (e.iqamaNo.length !== 10) warn('Iqama number ' + e.iqamaNo + ' is not 10 digits');
        if (seen[e.iqamaNo]) warn('Duplicate iqama number ' + e.iqamaNo + ' (also on row ' + seen[e.iqamaNo] + ')');
        else seen[e.iqamaNo] = rowNo;
      }
      var rawExp = get(row, 'iqamaExpiry');
      if (isEmpty(rawExp)) warn('Missing iqama expiry date');
      else if (!e.iqamaExpiry) warn('Invalid iqama expiry date: "' + str(rawExp) + '"');
      ['passportExpiry', 'insuranceExpiry'].forEach(function (f) {
        var raw = get(row, f);
        if (!isEmpty(raw) && !e[f]) warn('Invalid ' + (f === 'passportExpiry' ? 'passport' : 'insurance') + ' expiry date: "' + str(raw) + '"');
      });
      if (e.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email)) warn('Invalid email: ' + e.email);
      e._row = rowNo;
      employees.push(e);
    });
    return { employees: employees, warnings: warnings };
  }

  // ---------------------------------------------------------------- dedupe
  function dedupe(incoming, existing) {
    var byIq = {}, byEmp = {};
    (existing || []).forEach(function (e) {
      if (e.iqamaNo) byIq[String(e.iqamaNo)] = e;
      if (e.empNo) byEmp[String(e.empNo).trim().toLowerCase()] = e;
    });
    var toCreate = [], toUpdate = [], unchanged = [], updIdx = {};
    (incoming || []).forEach(function (inc) {
      var ex = (inc.iqamaNo && byIq[String(inc.iqamaNo)]) || (inc.empNo && byEmp[String(inc.empNo).trim().toLowerCase()]);
      if (!ex) { toCreate.push(inc); return; }
      var changes = {};
      Object.keys(inc).forEach(function (k) {
        if (k.charAt(0) === '_' || k === 'empNo') return;
        var nv = inc[k], ov = ex[k];
        if (typeof nv === 'string' && nv === '') return;          // never blank out existing data
        if (nv === undefined || nv === null) return;
        if (typeof nv === 'number' || typeof nv === 'boolean') {
          if (ov === undefined && (nv === 0 || nv === false)) return;
          if (nv !== ov) changes[k] = nv;
        } else if (String(nv) !== String(ov == null ? '' : ov)) changes[k] = nv;
      });
      if (Object.keys(changes).length) {
        if (updIdx[ex.empNo] !== undefined) Object.assign(toUpdate[updIdx[ex.empNo]].changes, changes);
        else { updIdx[ex.empNo] = toUpdate.length; toUpdate.push({ empNo: ex.empNo, changes: changes }); }
      } else unchanged.push(ex);
    });
    return { toCreate: toCreate, toUpdate: toUpdate, unchanged: unchanged };
  }

  // ---------------------------------------------------------------- export
  function u8ToAB(u) {
    if (u instanceof ArrayBuffer) return u;
    if (Array.isArray(u)) u = new Uint8Array(u);
    return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  }
  function utf8Decode(u) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(u);
    return Buffer.from(u).toString('utf8');
  }
  function utf8Encode(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, 'utf8'));
  }
  // SheetJS community 0.18.5 does not write frozen panes: inject <pane> into each sheet XML.
  function freezePanes(ab, ySplits) {
    try {
      var x = xl(), CFB = x.CFB;
      var cfb = CFB.read(new Uint8Array(ab), { type: 'array' });
      ySplits.forEach(function (ys, i) {
        if (!ys) return;
        var path = '/xl/worksheets/sheet' + (i + 1) + '.xml';
        var ent = CFB.find(cfb, path);
        if (!ent || !ent.content) return;
        var xml = utf8Decode(ent.content instanceof Uint8Array ? ent.content : new Uint8Array(ent.content));
        var cell = 'A' + (ys + 1);
        var view = '<sheetView workbookViewId="0"><pane ySplit="' + ys + '" topLeftCell="' + cell +
          '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="' + cell +
          '" sqref="' + cell + '"/></sheetView>';
        if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews>' + view + '</sheetViews>');
        else {
          var at = xml.search(/<sheetFormatPr|<cols>|<sheetData/);
          if (at < 0) return;
          xml = xml.slice(0, at) + '<sheetViews>' + view + '</sheetViews>' + xml.slice(at);
        }
        var bytes = utf8Encode(xml);
        ent.content = bytes; ent.size = bytes.length;
      });
      return u8ToAB(CFB.write(cfb, { fileType: 'zip', type: 'array', compression: true }));
    } catch (e) { return ab; }
  }

  function inferColumns(rows) {
    var keys = [];
    (rows || []).forEach(function (r) { Object.keys(r || {}).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    return keys.map(function (k) { return { key: k, header: k }; });
  }
  function cellFor(v, type) {
    if (isEmpty(v)) return null;
    if (type === 'date') {
      var iso = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : parseDate(v), ser = isoToSerial(iso);
      return ser === null ? { t: 's', v: String(v) } : { t: 'n', v: ser, z: 'dd/mm/yyyy' };
    }
    if (type === 'money' || type === 'number') {
      var n = typeof v === 'number' ? v : parseFloat(toLatinDigits(String(v)).replace(/[,\s]/g, ''));
      if (!isFinite(n)) return { t: 's', v: String(v) };
      return type === 'money' ? { t: 'n', v: Math.round(n * 100) / 100, z: '#,##0.00' } : { t: 'n', v: n };
    }
    if (type === 'text') return { t: 's', v: str(v) };
    if (typeof v === 'number') return { t: 'n', v: v };
    if (typeof v === 'boolean') return { t: 'b', v: v };
    if (v instanceof Date) return cellFor(v, 'date');
    return { t: 's', v: String(v) };
  }
  // Build a worksheet from header rows (arrays) + object rows.
  function buildSheet(columns, headerRows, rows) {
    var x = xl(), ws = {}, R = 0, C, enc = x.utils.encode_cell;
    headerRows.forEach(function (hr) {
      for (C = 0; C < columns.length; C++) if (!isEmpty(hr[C])) ws[enc({ r: R, c: C })] = { t: 's', v: String(hr[C]) };
      R++;
    });
    (rows || []).forEach(function (row) {
      for (C = 0; C < columns.length; C++) {
        var cell = cellFor(row ? row[columns[C].key] : '', columns[C].type);
        if (cell) ws[enc({ r: R, c: C })] = cell;
      }
      R++;
    });
    var lastR = Math.max(R - 1, 0), lastC = Math.max(columns.length - 1, 0);
    ws['!ref'] = x.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastR, c: lastC } });
    ws['!cols'] = columns.map(function (col, c) {
      if (col.width) return { wch: col.width };
      var w = 8;
      headerRows.forEach(function (hr) { w = Math.max(w, String(hr[c] || '').length + 2); });
      if (col.type === 'date') w = Math.max(w, 12);
      (rows || []).slice(0, 200).forEach(function (r) {
        var v = r ? r[col.key] : ''; if (!isEmpty(v)) w = Math.max(w, Math.min(50, String(v).length + 2));
      });
      return { wch: Math.min(w, 60) };
    });
    if (columns.length) ws['!autofilter'] = { ref: x.utils.encode_range({ s: { r: headerRows.length - 1, c: 0 }, e: { r: lastR, c: lastC } }) };
    return ws;
  }
  function safeSheetName(n, used) {
    var s = String(n || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Sheet', base = s, i = 2;
    while (used[s.toLowerCase()]) s = base.slice(0, 28) + ' ' + (i++);
    used[s.toLowerCase()] = 1;
    return s;
  }
  function writeWb(wb, ySplits) {
    var out = xl().write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    return freezePanes(u8ToAB(out), ySplits);
  }

  function exportWorkbook(sheetsSpec) {
    var x = xl(), wb = x.utils.book_new(), used = {}, ys = [];
    (sheetsSpec || []).forEach(function (sp) {
      var cols = (sp.columns && sp.columns.length) ? sp.columns : inferColumns(sp.rows);
      var ws = buildSheet(cols, [cols.map(function (c) { return c.header !== undefined ? c.header : c.key; })], sp.rows);
      x.utils.book_append_sheet(wb, ws, safeSheetName(sp.name, used));
      ys.push(1);
    });
    if (!wb.SheetNames.length) { x.utils.book_append_sheet(wb, x.utils.aoa_to_sheet([[]]), 'Sheet1'); ys.push(0); }
    return writeWb(wb, ys);
  }

  var TEMPLATE_COLS = [
    { key: 'empNo', header: 'Emp No', ar: 'الرقم الوظيفي', type: 'text', width: 12 },
    { key: 'nameEn', header: 'Name (English)', ar: 'الاسم بالإنجليزي', type: 'text', width: 26 },
    { key: 'nameAr', header: 'Name (Arabic)', ar: 'الاسم بالعربي', type: 'text', width: 26 },
    { key: 'nationality', header: 'Nationality', ar: 'الجنسية', type: 'text', width: 14 },
    { key: 'jobTitle', header: 'Job Title', ar: 'المهنة', type: 'text', width: 18 },
    { key: 'department', header: 'Department', ar: 'القسم', type: 'text', width: 16 },
    { key: 'branch', header: 'Branch', ar: 'الفرع', type: 'text', width: 16 },
    { key: 'iqamaNo', header: 'Iqama No', ar: 'رقم الإقامة', type: 'text', width: 14 },
    { key: 'iqamaExpiry', header: 'Iqama Expiry', ar: 'تاريخ انتهاء الإقامة', type: 'date', width: 16 },
    { key: 'passportNo', header: 'Passport No', ar: 'رقم الجواز', type: 'text', width: 14 },
    { key: 'passportExpiry', header: 'Passport Expiry', ar: 'تاريخ انتهاء الجواز', type: 'date', width: 16 },
    { key: 'insuranceExpiry', header: 'Insurance Expiry', ar: 'تاريخ انتهاء التأمين', type: 'date', width: 16 },
    { key: 'dependents', header: 'Dependents', ar: 'عدد المرافقين', type: 'number', width: 12 },
    { key: 'depPayer', header: 'Dependents Fees Paid By', ar: 'رسوم المرافقين على', type: 'text', width: 22 },
    { key: 'status', header: 'Status', ar: 'الحالة', type: 'text', width: 14 },
    { key: 'phone', header: 'Mobile', ar: 'الجوال', type: 'text', width: 14 },
    { key: 'email', header: 'Email', ar: 'البريد الإلكتروني', type: 'text', width: 24 },
    { key: 'levyExempt', header: 'Levy Exempt', ar: 'معفى من المقابل المالي', type: 'text', width: 14 },
    { key: 'notes', header: 'Notes', ar: 'ملاحظات', type: 'text', width: 30 }
  ];

  function employeeTemplate() {
    var x = xl(), wb = x.utils.book_new();
    var example = {
      empNo: 'EMP-0001', nameEn: 'Mohammed Rahman', nameAr: 'محمد رحمن', nationality: 'Bangladesh',
      jobTitle: 'Electrician', department: 'Operations', branch: 'Riyadh - Olaya', iqamaNo: '2123456789',
      iqamaExpiry: '2026-11-15', passportNo: 'A01234567', passportExpiry: '2029-03-20', insuranceExpiry: '2026-12-31',
      dependents: 2, depPayer: 'Employee', status: 'Active', phone: '0501234567', email: 'm.rahman@example.com',
      levyExempt: 'No', notes: 'EXAMPLE ROW - delete before importing'
    };
    var ws = buildSheet(TEMPLATE_COLS,
      [TEMPLATE_COLS.map(function (c) { return c.header; }), TEMPLATE_COLS.map(function (c) { return c.ar; })], [example]);
    ws['!autofilter'] = { ref: x.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: 2, c: TEMPLATE_COLS.length - 1 } }) };
    x.utils.book_append_sheet(wb, ws, 'Employees');
    var ins = [
      ['Employee import template — Instructions', 'تعليمات قالب استيراد الموظفين'],
      ['', ''],
      ['1. Fill one employee per row starting at row 3. Delete the example row.', 'أدخل موظفاً واحداً في كل صف بدءاً من الصف 3، واحذف صف المثال.'],
      ['2. Keep the two header rows (English + Arabic). Column order can change; headers are matched automatically.', 'احتفظ بصفي العناوين. يمكن تغيير ترتيب الأعمدة.'],
      ['3. Required: Name (English or Arabic), Iqama No, Iqama Expiry.', 'الحقول الإلزامية: الاسم، رقم الإقامة، تاريخ انتهاء الإقامة.'],
      ['4. Iqama No: 10 digits starting with 2. Format the column as Text to keep all digits.', 'رقم الإقامة: 10 أرقام تبدأ بالرقم 2.'],
      ['5. Dates: dd/mm/yyyy (e.g. 15/11/2026), yyyy-mm-dd, or Hijri (e.g. 1448/05/14 هـ) — Hijri years 1350-1500 are converted from Umm al-Qura.', 'التواريخ: يوم/شهر/سنة ميلادي، أو هجري (أم القرى).'],
      ['6. Dependents: whole number (0 if none). Dependents Fees Paid By: Company or Employee (default Employee).', 'المرافقين: عدد صحيح. رسوم المرافقين على: الشركة أو الموظف.'],
      ['7. Status: Active, On Vacation, Final Exit, Huroob, Transferred (default Active).', 'الحالة: على رأس العمل، إجازة، خروج نهائي، هروب، نقل كفالة.'],
      ['8. Levy Exempt: Yes / No (small-establishment exemption).', 'معفى من المقابل المالي: نعم / لا.'],
      ['9. Existing employees are matched by Iqama No, then Emp No, and updated; others are created.', 'يتم مطابقة الموظفين برقم الإقامة ثم بالرقم الوظيفي.']
    ];
    var wi = x.utils.aoa_to_sheet(ins);
    wi['!cols'] = [{ wch: 110 }, { wch: 70 }];
    x.utils.book_append_sheet(wb, wi, 'Instructions');
    return writeWb(wb, [2, 0]);
  }

  // ---------------------------------------------------------------- CSV
  function toCSV(rows, columns) {
    var cols = (columns && columns.length) ? columns : inferColumns(rows);
    function q(v) {
      if (v === null || v === undefined) return '';
      var s = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (v instanceof Date ? parseDate(v) : String(v));
      return /[",\r\n;]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [cols.map(function (c) { return q(c.header !== undefined ? c.header : c.key); }).join(',')];
    (rows || []).forEach(function (r) {
      lines.push(cols.map(function (c) {
        var v = r ? r[c.key] : '';
        if (c.type === 'money' && !isEmpty(v) && isFinite(+v)) v = (Math.round(+v * 100) / 100).toFixed(2);
        else if (c.type === 'date' && !isEmpty(v)) v = parseDate(v) || v;
        return q(v);
      }).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  var IO = {
    setXLSX: function (x) { X = x; return IO; },
    readWorkbook: readWorkbook,
    guessMapping: guessMapping,
    parseDate: parseDate,
    mapRows: mapRows,
    dedupe: dedupe,
    exportWorkbook: exportWorkbook,
    employeeTemplate: employeeTemplate,
    toCSV: toCSV,
    // helpers (exposed for UI/tests)
    FIELDS: FIELDS,
    TEMPLATE_COLUMNS: TEMPLATE_COLS,
    normalize: norm,
    hijriToGregorian: hijriToISO,
    isoToSerial: isoToSerial,
    serialToISO: serialToISO
  };

  if (typeof window !== 'undefined') window.IO = IO;
  if (typeof module !== 'undefined') module.exports = IO;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

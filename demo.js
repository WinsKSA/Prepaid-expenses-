/* Preview mode (open the app with ?demo): fictional sample company kept in memory only. Nothing is saved. */
(function (root) {
  'use strict';
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };

  var BRANCHES = [
    { id: "RUH", name: "Riyadh HQ · Olaya", lat: 24.6905, lng: 46.6853, radius_m: 150, active: true },
    { id: "JED", name: "Jeddah · Tahlia", lat: 21.5540, lng: 39.1490, radius_m: 200, active: true },
    { id: "DMM", name: "Dammam warehouse", lat: 26.4207, lng: 50.0888, radius_m: 250, active: true }
  ];
  var SHIFTS = [
    { id: "GEN", name: "Office · 8:00–17:00", start: "08:00", end: "17:00", breakMin: 60, graceMin: 15, days: [0, 1, 2, 3, 4] },
    { id: "EARLY", name: "Warehouse · 6:00–14:00", start: "06:00", end: "14:00", breakMin: 30, graceMin: 10, days: [6, 0, 1, 2, 3, 4] },
    { id: "NIGHT", name: "Security night · 22:00–06:00", start: "22:00", end: "06:00", breakMin: 30, graceMin: 10, days: [0, 1, 2, 3, 4, 6] },
    { id: "FLEX", name: "Flexible · 9 h window", start: "07:00", end: "16:00", breakMin: 60, flexible: true, days: [0, 1, 2, 3, 4] }
  ];
  var PEOPLE = [
    ["Faisal Al-Qahtani", "فيصل القحطاني", "Saudi", "General Manager", "Management", "RUH", "FLEX", "M"],
    ["Noura Al-Harbi", "نورة الحربي", "Saudi", "HR Manager", "Human Resources", "RUH", "GEN", "F"],
    ["Mohammed Rafiq", "محمد رفيق", "India", "Accountant", "Finance", "RUH", "GEN", "M"],
    ["Ahmed Hassan", "أحمد حسن", "Egypt", "Finance Manager", "Finance", "RUH", "GEN", "M"],
    ["Sara Al-Otaibi", "سارة العتيبي", "Saudi", "HR Specialist", "Human Resources", "RUH", "GEN", "F"],
    ["Imran Khan", "عمران خان", "Pakistan", "Sales Executive", "Sales", "RUH", "GEN", "M"],
    ["Joseph Santos", "جوزيف سانتوس", "Philippines", "IT Support", "IT", "RUH", "GEN", "M"],
    ["Khalid Al-Dosari", "خالد الدوسري", "Saudi", "Sales Manager", "Sales", "JED", "GEN", "M"],
    ["Rahul Menon", "راهول مينون", "India", "Sales Executive", "Sales", "JED", "GEN", "M"],
    ["Omar Abdelrahman", "عمر عبدالرحمن", "Sudan", "Branch Supervisor", "Operations", "JED", "GEN", "M"],
    ["Maria Cruz", "ماريا كروز", "Philippines", "Cashier", "Sales", "JED", "GEN", "F"],
    ["Yasser Mahmoud", "ياسر محمود", "Egypt", "Storekeeper", "Warehouse", "DMM", "EARLY", "M"],
    ["Abdul Karim", "عبدالكريم", "Bangladesh", "Forklift Operator", "Warehouse", "DMM", "EARLY", "M"],
    ["Shahid Hussain", "شاهد حسين", "Pakistan", "Driver", "Logistics", "DMM", "EARLY", "M"],
    ["Ravi Kumar", "رافي كومار", "India", "Driver", "Logistics", "DMM", "EARLY", "M"],
    ["Mohammed Saleh", "محمد صالح", "Yemen", "Warehouse Helper", "Warehouse", "DMM", "EARLY", "M"],
    ["Anwar Hossain", "أنور حسين", "Bangladesh", "Warehouse Helper", "Warehouse", "DMM", "EARLY", "M"],
    ["Tariq Mehmood", "طارق محمود", "Pakistan", "Security Guard", "Security", "DMM", "NIGHT", "M"],
    ["Hamid Osman", "حامد عثمان", "Sudan", "Security Guard", "Security", "RUH", "NIGHT", "M"],
    ["Fahad Al-Shehri", "فهد الشهري", "Saudi", "Operations Manager", "Operations", "DMM", "GEN", "M"],
    ["Priya Nair", "بريا ناير", "India", "Receptionist", "Administration", "RUH", "GEN", "F"],
    ["Bilal Ahmed", "بلال أحمد", "Pakistan", "Technician", "Operations", "JED", "GEN", "M"]
  ];

  function seed(todayISO) {
    var R = rng(20261031), A = root.Attendance, E = root.Engine;
    var year = +todayISO.slice(0, 4), sh = A.suggestHolidays(year), shPrev = A.suggestHolidays(year - 1);
    var attCfg = { shifts: SHIFTS, branches: BRANCHES, defaultShiftId: "GEN", holidays: shPrev.holidays.concat(sh.holidays), ramadan: { from: sh.ramadan.from, to: sh.ramadan.to, hoursDay: 6 } };
    var add = function (d, n) { return E.addDays(d, n); };
    var employees = PEOPLE.map(function (p, i) {
      var no = "EMP-" + ("000" + (i + 1)).slice(-4), saudi = p[2] === "Saudi";
      var basic = [18000, 14000, 6500, 12000, 8000, 5000, 5500, 13000, 5000, 6000, 3800, 4200, 2800, 2600, 2600, 2200, 2200, 2400, 2400, 15000, 3500, 4000][i];
      return { empNo: no, hrNo: String(1001 + i), nameEn: p[0], nameAr: p[1], nationality: p[2], saudi: saudi || undefined, gender: p[7] === "F" ? "Female" : "Male",
        jobTitle: p[3], department: p[4], branch: p[5], status: "Active", iqamaFeesBy: saudi ? "" : "Company",
        iqamaNo: saudi ? "" : "2" + String(400000000 + i * 7919), nationalId: saudi ? "1" + String(100000000 + i * 3571) : "",
        iqamaExpiry: saudi ? "" : add(todayISO, Math.round(-12 + R() * 320)), passportExpiry: add(todayISO, Math.round(60 + R() * 900)), insuranceExpiry: add(todayISO, Math.round(10 + R() * 300)),
        hr: { hireDate: add(todayISO, -Math.round(200 + R() * 3200)), basic: basic, housing: Math.round(basic * 0.25), transport: Math.round(basic * 0.1),
          iban: "SA03800000006080" + String(10167519 + i).slice(-8), bankName: "Al Rajhi", shiftId: p[6], branchId: p[5], managerEmpNo: i === 0 ? "" : (i < 7 ? "EMP-0001" : i < 11 ? "EMP-0008" : "EMP-0020"), qiwaDocumented: true } };
    });
    var leaves = [
      { id: "LV-0001", empNo: "EMP-0010", type: "ANNUAL", from: add(todayISO, -3), to: add(todayISO, 4), days: 8, status: "APPROVED" },
      { id: "LV-0002", empNo: "EMP-0016", type: "SICK", from: add(todayISO, -1), to: add(todayISO, 1), days: 3, status: "APPROVED" },
      { id: "LV-0003", empNo: "EMP-0006", type: "ANNUAL", from: add(todayISO, 12), to: add(todayISO, 21), days: 10, status: "PENDING" }
    ];
    // punches: previous month start → now
    var punches = [], n = 0, cfg = A.config(attCfg), nowMs = Date.now();
    var start = todayISO.slice(0, 8) + "01"; start = add(start, -1).slice(0, 8) + "01";
    var br = {}; BRANCHES.forEach(function (b) { br[b.id] = b; });
    for (var d = start; d <= todayISO; d = add(d, 1)) {
      employees.forEach(function (e) {
        var s = A.resolveShift(e, d, cfg), hol = cfg.holidays.some(function (h) { return d >= h.date && d <= (h.to || h.date); });
        var onLeave = leaves.some(function (l) { return l.status === "APPROVED" && l.empNo === e.empNo && l.from <= d && l.to >= d; });
        if (onLeave) return;
        if (!s.workday || hol) { if (R() < 0.03) { push(e, d, s.start + 60, "in"); push(e, d, s.start + 300, "out"); } return; }
        var r = R(); if (r < 0.035) return;                       // absent
        var inMin = s.start - 12 + Math.round(R() * 18); if (R() < 0.13) inMin = s.start + 16 + Math.round(R() * 40);
        if (s.flexible) inMin = s.start + Math.round(R() * 150);
        var outMin = (s.flexible ? inMin + s.expected + s.breakMin : s.end) - 3 + Math.round(R() * 22);
        var x = R(); if (x < 0.09) outMin += 45 + Math.round(R() * 110); else if (x < 0.13) outMin -= 35 + Math.round(R() * 60);
        var bad = R() < 0.045 ? "outside" : R() < 0.01 ? "low_accuracy" : "ok";
        push(e, d, inMin, "in", bad);
        if (R() < 0.03 && d < todayISO) return;                  // forgot to check out
        push(e, d, outMin, "out");
      });
    }
    function push(e, d, min, kind, status) {
      var at = A.atFor(d, min, cfg); if (Date.parse(at) > nowMs) return;
      var b = br[e.hr.branchId], out = status === "outside", dist = out ? 300 + R() * 700 : R() * (b.radius_m * 0.7), ang = R() * 6.283;
      var lat = b.lat + Math.cos(ang) * dist / 111320, lng = b.lng + Math.sin(ang) * dist / (111320 * Math.cos(b.lat * Math.PI / 180));
      punches.push({ id: "P" + (++n), empNo: e.empNo, email: "", kind: kind, at: at, lat: +lat.toFixed(6), lng: +lng.toFixed(6), accuracy: status === "low_accuracy" ? 180 : Math.round(6 + R() * 20),
        branchId: b.id, distance: Math.round(dist), inside: !out, status: status || "ok", device: "Preview phone" });
    }
    var y1 = add(todayISO, -2), y2 = add(todayISO, -5);
    var attreq = [
      { id: "RQ-0001", empNo: "EMP-0013", day: y1, kind: "out", time: "14:05", reason: "Phone battery died before I could check out.", status: "pending", createdAt: new Date().toISOString() },
      { id: "RQ-0002", empNo: "EMP-0009", day: y2, kind: "in", time: "08:02", reason: "GPS did not load at the gate; I was at the branch on time.", status: "pending", createdAt: new Date().toISOString() }
    ];
    return { employees: employees, leaves: leaves, loans: [], payruns: [], renewals: [], visas: [], contracts: [], attendance: punches, attreq: attreq,
      config: [{ _id: "settings", company: "Al Waha Trading Co." }, Object.assign({ _id: "attendance" }, attCfg)], linkedEmpNo: "EMP-0002" };
  }

  /* In-memory database with the same interface the app uses for its live backends. */
  function memDb(seed) {
    var data = {}, subs = {}, docSubs = {};
    Object.keys(seed).forEach(function (c) { if (Array.isArray(seed[c])) data[c] = seed[c].map(function (d) { return Object.assign({ _id: d._id || d.id || d.empNo }, d); }); });
    var clean = function (d) { var o = Object.assign({}, d); delete o._id; return o; };
    var snapCol = function (c) { return { docs: (data[c] || []).map(function (d) { return { id: d._id, exists: true, data: function () { return clean(d); } }; }) }; };
    var snapDoc = function (c, id) { var d = (data[c] || []).find(function (x) { return x._id === id; }); return { id: id, exists: !!d, data: function () { return d ? clean(d) : undefined; } }; };
    var emit = function (c) { setTimeout(function () { (subs[c] || []).forEach(function (cb) { cb(snapCol(c)); }); Object.keys(docSubs).forEach(function (p) { var i = p.indexOf("/"); if (p.slice(0, i) === c) docSubs[p].forEach(function (cb) { cb(snapDoc(c, p.slice(i + 1))); }); }); }, 0); };
    var docRef = function (c, id) { return {
      set: function (obj) { var arr = data[c] = data[c] || []; var i = arr.findIndex(function (x) { return x._id === id; }); var v = Object.assign({}, JSON.parse(JSON.stringify(obj)), { _id: id }); if (i >= 0) arr[i] = v; else arr.push(v); emit(c); return Promise.resolve(); },
      delete: function () { data[c] = (data[c] || []).filter(function (x) { return x._id !== id; }); emit(c); return Promise.resolve(); },
      onSnapshot: function (cb) { var p = c + "/" + id; (docSubs[p] = docSubs[p] || []).push(cb); setTimeout(function () { cb(snapDoc(c, id)); }, 0); return function () {}; },
      acquire: function () { return Promise.resolve({ acquired: true }); } }; };
    return { mem: true, linkedEmpNo: seed.linkedEmpNo,
      collection: function (c) { return { doc: function (id) { return docRef(c, id); }, onSnapshot: function (cb) { (subs[c] = subs[c] || []).push(cb); setTimeout(function () { cb(snapCol(c)); }, 0); return function () {}; } }; },
      doc: function (path) { var i = path.indexOf("/"); return docRef(path.slice(0, i), path.slice(i + 1)); } };
  }
  root.Demo = { seed: seed, memDb: memDb, BRANCHES: BRANCHES };
})(typeof window !== "undefined" ? window : this);

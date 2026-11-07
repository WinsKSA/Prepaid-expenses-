"""Copy the app into ../site (the public GitHub Pages repo). Code only: no data, migrations or docs.

Usage (from the repo root):  python tools/build_site.py
"""
import os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(os.path.dirname(ROOT), "site")
FILES = ["config.js", "engine.js", "io.js", "lease.js", "rental.js", "hr.js", "attendance.js", "attendance_ui.js", "demo.js",
         "design.css", "design.js", "i18n_ar.js", "i18n_att_ar.js", "manifest.webmanifest"]
for f in FILES:
    shutil.copy2(os.path.join(ROOT, f), SITE)
shutil.copytree(os.path.join(ROOT, "icons"), os.path.join(SITE, "icons"), dirs_exist_ok=True)
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8", newline="").read()
# the public page has no reason to carry the private Google web app address
html, n = re.subn(r'<div style="margin-top:14px"><a class="btn pri"[^>]*script\.google\.com[^>]*>.*?</a></div>', "", html)
open(os.path.join(SITE, "index.html"), "w", encoding="utf-8", newline="").write(html)
print("site updated, legacy links removed:", n)

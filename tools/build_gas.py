"""Build the single-file Apps Script page (gas/Index.html) from index.html + the JS modules.

Usage (from the repo root):  python tools/build_gas.py
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
# the page head (doctype, charset, viewport) is written by the wrapper below
src = re.sub(r'^\s*<!doctype html>\s*<html[^>]*>\s*(<meta[^>]*>\s*)*', "", src, flags=re.I)

def inline(m):
    path = os.path.join(ROOT, m.group(1))
    if not os.path.exists(path):
        raise SystemExit("missing module: " + m.group(1))
    js = open(path, encoding="utf-8").read().replace("</script", "<\\/script")
    return "<script>/* %s */\n%s\n</script>" % (m.group(1), js)

def inline_css(m):
    path = os.path.join(ROOT, m.group(1))
    if not os.path.exists(path):
        raise SystemExit("missing stylesheet: " + m.group(1))
    css = open(path, encoding="utf-8").read().replace("</style", "<\\/style")
    return "<style>/* %s */\n%s\n</style>" % (m.group(1), css)

body = re.sub(r'<script src="([a-z0-9_]+\.js)"></script>', inline, src)
body = re.sub(r'<link rel="stylesheet" href="([a-z0-9_]+\.css)">', inline_css, body)
out = ('<!doctype html><html><head><base target="_top"><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
       '<style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>'
       + body + '</body></html>')
dst = os.path.join(ROOT, "gas", "Index.html")
open(dst, "w", encoding="utf-8").write(out)
print(dst, len(out))

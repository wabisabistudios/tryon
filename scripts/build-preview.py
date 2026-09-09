#!/usr/bin/env python3
"""Rebuild public/tryon-preview.html from public/tryon.html.

The preview is a standalone demo: DEMO=true (mocked API + sample hand button),
pixel disabled, and every local image inlined as base64 so the file works when
opened directly with no server.
"""
import base64, json, os, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
h = (PUB / "tryon.html").read_text()

h = h.replace("const DEMO = false; // preview builds flip this to true",
              "const DEMO = true; // PREVIEW BUILD", 1)

pixel = ("fbq('init','1027912353039149');fbq('track','PageView');\n"
         "fbq('track','ViewContent',{content_name:'tryon'});")
h = h.replace(pixel, "window.fbq=window.fbq||function(){}; /* pixel disabled in preview */", 1)

banner = ('<div style="background:#26190F;color:#F8F3E8;font-family:monospace;font-size:10px;'
          'letter-spacing:.14em;text-transform:uppercase;text-align:center;padding:7px">'
          'Preview &mdash; illustrated sample hands stand in until the demo set is shot; '
          "live renders use the client's own photo</div>\n"
          '<div class="ribbon">')
h = h.replace('<div class="ribbon">', banner, 1)

# studio assets: literal path replacement
d = PUB / "assets" / "tryon"
for f in sorted(os.listdir(d)):
    if f.endswith(".jpg"):
        b64 = base64.b64encode((d / f).read_bytes()).decode()
        h = h.replace(f"assets/tryon/{f}", f"data:image/jpeg;base64,{b64}")

# mock hands: runtime map, because paths are built at runtime (MOCK_BASE + name)
mock = {}
md = d / "mock"
for f in sorted(os.listdir(md)):
    if f.endswith(".jpg"):
        mock[f] = "data:image/jpeg;base64," + base64.b64encode((md / f).read_bytes()).decode()
inject = ("<script>window.__MOCK__ = " + json.dumps(mock) + ";</script>\n"
          "<script>\n/* ================= CONFIG ================= */")
h = h.replace("<script>\n/* ================= CONFIG ================= */", inject, 1)

(PUB / "tryon-preview.html").write_text(h)
print(f"wrote public/tryon-preview.html ({len(h)//1024} KB)")

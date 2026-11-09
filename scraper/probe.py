"""Próby API sklepów (debug)."""
import json, os, re, sys, requests
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
S = requests.Session(); S.headers.update({"User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9"})
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
res = {}
h = S.get("https://www.bershka.com/pl/h-man.html", timeout=30).text
srcs = re.findall(r'<script[^>]+src="([^"]+\.js)"', h) + re.findall(r'<link[^>]+href="([^"]+\.js)"', h)
res["srcs"] = srcs[:80]
hits = {}
for u in srcs[:80]:
    if u.startswith("/"): u = "https://www.bershka.com" + u
    try:
        t = S.get(u, timeout=30).text
    except Exception as e:
        continue
    for m in re.finditer(r'(?i)algolia', t):
        hits.setdefault(u, []).append(t[max(0, m.start() - 200):m.start() + 300])
        if len(hits[u]) > 12: break
    for m in re.finditer(r'"[A-Z0-9]{10}"', t):
        ctx = t[max(0, m.start() - 80):m.start() + 80]
        if "lgolia" in ctx or "appId" in ctx or "applicationId" in ctx:
            hits.setdefault(u + "#id", []).append(ctx)
res["hits"] = hits
json.dump(res, open(os.path.join(out, "probe.json"), "w"), ensure_ascii=False, indent=1)

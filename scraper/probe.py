"""Próby API sklepów (debug)."""
import json, os, re, sys, requests
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
S = requests.Session(); S.headers.update({"User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9"})
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
res = {}
def save(name, r):
    try:
        t = r.text
        open(os.path.join(out, name), "w", encoding="utf-8").write(t[:3_000_000])
        res[name] = [r.status_code, len(t), t[:300]]
    except Exception as e:
        res[name] = ["err", str(e)]
def get(name, url, **kw):
    try:
        r = S.get(url, timeout=30, **kw); save(name, r); return r
    except Exception as e:
        res[name] = ["err", repr(e)[:200]]
B = "https://www.bershka.com/itxrest/3/catalog/store/45109524/40259532"
get("bsk_cats.json", B + "/category?languageId=-22&typeCatalog=1&appId=1")
get("bsk_cats2.json", "https://www.bershka.com/itxrest/2/catalog/store/45109524/40259532/category?languageId=-22&typeCatalog=1&appId=1")
for brand, url in {"pull": "https://www.pullandbear.com/pl/kobieta-n6417.html", "pull2": "https://www.pullandbear.com/pl/mezczyzna-n6228.html",
                   "stradi": "https://www.stradivarius.com/pl/kobieta-c1020047001.html", "massimo": "https://www.massimodutti.com/pl/kobieta-c1000000.html",
                   "oysho": "https://www.oysho.com/pl/kobieta-c1010389508.html", "bsk_men": "https://www.bershka.com/pl/h-man.html"}.items():
    r = get(brand + ".html", url)
    if r is not None:
        t = r.text
        res[brand + "_ids"] = {"pl": re.findall(r'\{code:"PL",name:"[^"]+",storeId:(\d+)\}', t)[:3],
                               "store": re.findall(r'storeId[\\"=: ]+(\d{6,})', t)[:5], "catalog": re.findall(r'catalogId[\\"=: ]+(\d{6,})', t)[:5],
                               "cat": re.findall(r'"catalogId":(\d+)', t)[:3]}
json.dump(res, open(os.path.join(out, "probe.json"), "w"), ensure_ascii=False, indent=1)

"""Robot Szafy: zbiera przecenione ciuchy z sieciówek, prowadzi historię cen.

Wynik:
  data/offers.json  – aktualne przecenione rzeczy (to czyta apka)
  data/history.json – historia cen (id -> [[dzień, cena], ...])
  data/prices.json  – same aktualne ceny (do sprawdzania obserwowanych w tle)
Uruchamiane w GitHub Actions.
"""
import argparse, datetime, html, json, os, re, sys, time, traceback
import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9"})
LOG = []

def log(*a):
    line = " ".join(str(x) for x in a); print(line, flush=True); LOG.append(line)

TODAY = datetime.date.today().isoformat()

# ---------- kategorie wspólne dla wszystkich sklepów ----------
# kolejność ma znaczenie: najpierw rzeczy szczegółowe (dodatki, bielizna), potem ogólne
CATS = [
    ("bielizna", r"\b(bieliz|majt|figi|stringi|bokserk|slip|biustonosz|stanik|piżam|pizam|koszul[a-z]* nocn|strój kąp|stroj kap|kąpielów|bikini|skarpet|rajstop|podkolan|underwear|socks)"),
    ("dodatki", r"\b(czap|beanie|kapelusz|kaszkiet|komin|szal|chust|bandan|rękawicz|rekawicz|pas(ek|ka|kiem)\b|torb|torebk|plecak|saszetk|nerk|portfel|okular|bi[zż]uter|kolczyk|naszyjnik|bransolet|pierścion|spink|gumk|opask|brelok|parasol|etui|zegarek|krawat|mucha|kosmetycz|hat\b|cap\b|bag\b|scarf|belt\b|accessor)"),
    ("buty", r"\b(but[yóa]?\b|obuw|sneaker|trampk|tenisów|kozak|botk|sandał|sandal|klapk|japonk|mokasyn|loafer|półbut|polbut|szpilk|czółen|czolen|baleriny|espadryl|kalosz|kapc|chelsea|glany|shoes|boots|sliders)"),
    ("kurtki", r"\b(kurt|płaszcz|plaszcz|parka|puchów|puchow|bezrękaw|bezrekaw|kamizel|trencz|marynark|żakiet|zakiet|blezer|wiatrówk|jacket|coat|puffer|bomber|ramones|futerk|outwear|outer)"),
    ("swetry", r"\b(swet|kardigan|golf|pulower|knit|sweater)"),
    ("bluzy", r"\b(bluz(?!k)|bluza|bejsbolówk|sweatshirt|hoodie|hoodi)"),
    ("koszule", r"\b(koszul(?!k|ow)|koszula|shirt\b)"),
    ("sukienki", r"\b(sukien|sukni|dress|kombinezon)"),
    ("spodnice", r"\b(spódnic|spodnic|skirt)"),
    ("szorty", r"\b(szort|spodenk|kolark|bermud|shorts)"),
    ("spodnie", r"\b(spodn|jeans|dżins|dzins|jogger|chino|cargo|legginsy|legginsów|dresy|trousers|pants)"),
    ("koszulki", r"\b(t-shirt|koszulk|bluzk|top\b|topy|tank|polo|longsleeve|body\b|crop|tee\b|gorset)"),
]
_CRE = [(k, re.compile(r, re.I)) for k, r in CATS]

def cat_of(name, *rest):
    # najpierw sama nazwa produktu; wygrywa słowo, które stoi w nazwie najwcześniej
    # („Szorty z paskiem” to szorty, nie pasek)
    for text in (name,) + rest:
        if not text: continue
        best = None
        for key, rx in _CRE:
            m = rx.search(text)
            if m and (best is None or m.start() < best[0]):
                best = (m.start(), key)
        if best:
            return best[1]
    return "inne"

def sex_of(s):
    s = (s or "").lower()
    if "męż" in s or "mez" in s or "man" == s or "men" in s or "on" == s: return "m"
    if "kobiet" in s or "woman" in s or "women" in s or "ona" == s: return "k"
    if "dzie" in s or "kid" in s: return "d"
    return "u"

def money(v):
    if v in (None, "", 0): return 0.0
    if isinstance(v, (int, float)): return round(float(v), 2)
    v = str(v).replace("\xa0", "").replace(" ", "").replace("zł", "").replace("PLN", "").replace(",", ".")
    try: return round(float(v), 2)
    except ValueError: return 0.0

def unesc(u):
    return (u or "").replace("\\/", "/")

# ---------- LPP: Reserved, Cropp, House, Mohito, Sinsay (Algolia) ----------
LPP = {
    "reserved": ("Reserved", "https://www.reserved.com/pl/pl/wyprzedaz"),
    "cropp": ("Cropp", "https://www.cropp.com/pl/pl/wyprzedaz"),
    "house": ("House", "https://www.housebrand.com/pl/pl/sale"),
    "mohito": ("Mohito", "https://www.mohito.com/pl/pl/sale"),
    "sinsay": ("Sinsay", "https://www.sinsay.com/pl/pl/"),
}

def algolia_cfg(page_url):
    h = S.get(page_url, timeout=60).text
    app = re.search(r"applicationId: '([^']+)'", h)
    key = re.search(r"searchApiKey: '([^']+)'", h)
    idx = re.search(r"productPrimaryIndex: '([^']+)'", h)
    if not (app and key and idx):
        raise RuntimeError("brak konfiguracji Algolii na " + page_url)
    return app.group(1), key.group(1), idx.group(1)

def algolia(app, key, idx, params):
    url = f"https://{app.lower()}-dsn.algolia.net/1/indexes/{idx}/query"
    r = S.post(url, json=params, timeout=60,
               headers={"X-Algolia-Application-Id": app, "X-Algolia-API-Key": key})
    if r.status_code != 200:
        raise RuntimeError(f"algolia {r.status_code}: {r.text[:200]}")
    return r.json()

FACETS = ["sex", "rms_class_name", "rms_subclass_name", "color", "sizes"]

def lpp_hits(app, key, idx, base):
    """Wszystkie trafienia dla filtra; Algolia daje max 1000 na zapytanie, więc dzielimy po facetach."""
    out = {}
    def run(filters, depth=0):
        first = algolia(app, key, idx, {**base, **filters, "hitsPerPage": 1000, "page": 0,
                                        "facets": FACETS})
        n = first.get("nbHits", 0)
        if n <= 1000 or depth >= len(FACETS):
            for h in first.get("hits", []): out[h["objectID"]] = h
            pages = min(first.get("nbPages", 1), 1)
            return n
        facet = FACETS[depth]
        vals = (first.get("facets") or {}).get(facet, {})
        if not vals:
            for h in first.get("hits", []): out[h["objectID"]] = h
            return n
        for v in vals:
            ff = list(filters.get("facetFilters", [])) + [f"{facet}:{v}"]
            run({**filters, "facetFilters": ff}, depth + 1)
        return n
    total = run({})
    return list(out.values()), total

def lpp_shop(code, name, page):
    app, key, idx = algolia_cfg(page)
    log(name, "algolia", idx)
    found, how = {}, []
    attempts = [
        ("facet SALE", {"facetFilters": [["categories.lvl0:SALE", "categories.lvl0:Sale", "categories.lvl0:Wyprzedaż"]]}),
        ("typ ceny", {"filters": "NOT final_price_type:regular"}),
        ("clearance", {"filters": "final_price_type:clearance"}),
        ("special", {"filters": "final_price_type:special"}),
        ("promotion", {"filters": "promotion:true"}),
    ]
    for label, base in attempts:
        try:
            got, total = lpp_hits(app, key, idx, {"query": "", **base})
            disc = [h for h in got if money(h.get("final_price")) < money(h.get("regular_price")) - 0.01]
            new = sum(1 for h in disc if h["objectID"] not in found)
            for h in disc: found[h["objectID"]] = h
            log(f"  {label}: trafień {total}, pobrano {len(got)}, przecenionych {len(disc)}, nowych {new}")
            if new: how.append(label)
        except Exception as e:
            log(f"  {label}: błąd {e}")
    hits = list(found.values())
    items = []
    for h in hits or []:
        photos = h.get("photos") or {}
        imgs = []
        for k in ("categoryPhoto", "hoverPhoto", "mainPhoto"):
            if isinstance(photos, dict) and photos.get(k): imgs.append(unesc(photos[k]))
        for co in h.get("color_options") or []:
            for p in (co.get("photos") or [])[:0]: pass
        if not imgs: continue
        cats = " ".join(h.get("categories_list") or [])
        dep = (h.get("rms_department_name") or "").lower()
        c0 = h.get("categories") if isinstance(h.get("categories"), dict) else {}
        if "home" in dep or "dom" in ((c0.get("lvl0") or [""])[0] or "").lower(): continue
        items.append({
            "id": f"{code}:{h.get('sku') or h['objectID']}",
            "shop": code, "brand": name,
            "name": html.unescape(h.get("name") or ""),
            "url": unesc(h.get("url")),
            "img": imgs[:3],
            "price": money(h.get("final_price")), "old": money(h.get("regular_price")),
            "low30": money(h.get("history_price")) or None,
            "sex": sex_of(h.get("sex")),
            "cat": cat_of(h.get("name"), h.get("rms_subclass_name"), h.get("rms_class_name"), cats),
            "sizes": [str(s) for s in (h.get("sizes") or [])],
            "color": (h.get("color") or "").split(":")[0],
            "low": bool(h.get("is_low_stock") or h.get("low_stock")),
        })
    log(f"  {name}: {len(items)} rzeczy ({', '.join(how)})")
    return items

# ---------- Zara (JSON kategorii PROMOCJE) ----------
ZARA_CATS = {"m": 2436823, "k": 2419724}

def zara_shop():
    items = []
    cats = S.get("https://www.zara.com/pl/pl/categories?ajax=true", timeout=60).json()
    # dla kobiet bierzemy podkategorię promocji, jeśli jest
    def find(c, cid):
        for x in c:
            if x.get("id") == cid: return x
            r = find(x.get("subcategories", []), cid)
            if r: return r
    for sex, cid in ZARA_CATS.items():
        node = find(cats.get("categories", []), cid)
        ids = [cid] + [s.get("id") for s in (node or {}).get("subcategories", [])]
        for c in ids:
            try:
                r = S.get(f"https://www.zara.com/pl/pl/category/{c}/products?ajax=true", timeout=60)
                d = r.json()
            except Exception as e:
                log("  zara", c, "błąd", e); continue
            n0 = len(items)
            for g in d.get("productGroups", []):
                for el in g.get("elements", []):
                    for p in el.get("commercialComponents", []) or []:
                        det = p.get("detail") or {}
                        colors = det.get("colors") or []
                        if not colors: continue
                        col = colors[0]
                        price = (col.get("price") or p.get("price") or 0) / 100
                        old = (col.get("oldPrice") or p.get("oldPrice") or 0) / 100
                        if not old or old <= price: continue
                        imgs = []
                        for m in (col.get("xmedia") or [])[:3]:
                            u = m.get("url")
                            if u: imgs.append(u.replace("{width}", "750"))
                            elif m.get("path"):
                                imgs.append(f"https://static.zara.net/photos//{m['path']}/w/750/{m['name']}.jpg?ts={m.get('timestamp','')}")
                        if not imgs: continue
                        seo = p.get("seo") or {}
                        url = f"https://www.zara.com/pl/pl/{seo.get('keyword','')}-p{seo.get('seoProductId','')}.html"
                        items.append({
                            "id": f"zara:{p.get('id')}", "shop": "zara", "brand": "Zara",
                            "name": p.get("name", ""), "url": url, "img": imgs,
                            "price": round(price, 2), "old": round(old, 2), "low30": None,
                            "sex": sex, "cat": cat_of(p.get("name"), p.get("subfamilyName"), p.get("familyName")),
                            "sizes": [s.get("name") for s in (col.get("sizes") or []) if s.get("availability") != "out_of_stock"],
                            "color": col.get("name", ""),
                        })
            log("  zara kat", c, "status", r.status_code, "+", len(items) - n0)
            time.sleep(1)
    log("  Zara:", len(items))
    return items

# ---------- dostępność (strony produktów LPP) ----------
# Wyszukiwarka sklepu potrafi pokazywać rozmiary, których już nie ma. Strona produktu ma
# stan każdego rozmiaru, więc sprawdzamy ją: co przebieg część rzeczy, najpierw nowe
# i te z końcówką zapasu, a wynik trzymamy w data/stock.json.
SIZE_RX = re.compile(r'"isInStock":(true|false),"isStockInTransit":(?:true|false),"magentoId":\d+,"mappedAs":\[[^\]]*\],"sizeId":\d+,"sizeName":"([^"]+)","sku":"([^"]+)"')

def page_sizes(item):
    r = S.get(item["url"], timeout=30)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    sku = item["id"].split(":", 1)[1]
    found = {}
    for ok, size, s_sku in SIZE_RX.findall(r.text):
        if s_sku.startswith(sku + "-"):
            found[size] = found.get(size, False) or ok == "true"
    if not found:
        return None  # nie umiemy odczytać, zostawiamy bez zmian
    return [k for k, v in found.items() if v]

def check_stock(items, stock, budget=4500, workers=10):
    from concurrent.futures import ThreadPoolExecutor
    now = datetime.datetime.utcnow()
    def age(it):
        e = stock.get(it["id"])
        if not e: return 1e9
        return (now - datetime.datetime.fromisoformat(e["t"])).total_seconds() / 3600
    lpp = [i for i in items if i["shop"] in LPP]
    # kolejka: nigdy niesprawdzane, potem końcówki zapasu starsze niż 5 h, potem reszta starsza niż 30 h
    todo = sorted([i for i in lpp if age(i) > (5 if i.get("low") else 30)],
                  key=lambda i: (age(i) < 1e9, not i.get("low"), -age(i)))[:budget]
    ok = gone = err = 0
    def one(it):
        try: return it, page_sizes(it)
        except Exception: return it, "err"
    with ThreadPoolExecutor(workers) as ex:
        for it, res in ex.map(one, todo):
            if res == "err": err += 1; continue
            if res is None: continue
            stock[it["id"]] = {"t": now.strftime("%Y-%m-%dT%H:%M"), "s": res}
            if res: ok += 1
            else: gone += 1
    log(f"dostępność: sprawdzono {len(todo)}, dostępne {ok}, wyprzedane {gone}, błędów {err}")

# ---------- składanie ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--debug", default="debug")
    a = ap.parse_args()
    os.makedirs(a.data, exist_ok=True); os.makedirs(a.debug, exist_ok=True)
    hist_p = os.path.join(a.data, "history.json")
    offers_p = os.path.join(a.data, "offers.json")
    history = json.load(open(hist_p)) if os.path.exists(hist_p) else {}
    old = {}
    if os.path.exists(offers_p):
        for it in json.load(open(offers_p)).get("items", []): old[it["id"]] = it
    all_items, status = [], {}
    shops = [(c, (lambda c=c, n=n, u=u: lpp_shop(c, n, u))) for c, (n, u) in LPP.items()]
    shops.append(("zara", zara_shop))
    for code, fn in shops:
        try:
            got = fn()
            status[code] = len(got)
            if not got and code in {o["shop"] for o in old.values()}:
                # sklep chwilowo nie działa: zostaw wczorajsze oferty, żeby apka nie opustoszała
                got = [o for o in old.values() if o["shop"] == code]
                log(f"  {code}: zostawiam {len(got)} starych ofert")
            all_items += got
        except Exception as e:
            status[code] = "błąd: " + str(e)[:120]
            log(code, "BŁĄD", e); traceback.print_exc()
            all_items += [o for o in old.values() if o["shop"] == code]
    seen = {}
    for it in all_items: seen[it["id"]] = it
    items = list(seen.values())
    stock_p = os.path.join(a.data, "stock.json")
    stock = json.load(open(stock_p)) if os.path.exists(stock_p) else {}
    try:
        check_stock(items, stock)
    except Exception as e:
        log("dostępność BŁĄD", e)
    stock = {k: v for k, v in stock.items() if k in seen}
    json.dump(stock, open(stock_p, "w"), separators=(",", ":"))
    kept = []
    for it in items:
        e = stock.get(it["id"])
        if e is not None:
            if not e["s"]: continue  # wyprzedane we wszystkich rozmiarach
            it["sizes"] = e["s"]
            it["chk"] = e["t"][:10]
        kept.append(it)
    log(f"po odrzuceniu wyprzedanych: {len(kept)} z {len(items)}")
    items = kept
    for it in items:
        h = history.setdefault(it["id"], [])
        if not h or h[-1][1] != it["price"]:
            h.append([TODAY, it["price"]])
        del h[:-60]
        it["first"] = (old.get(it["id"]) or {}).get("first") or TODAY
        prices = [p for _, p in h]
        it["min"] = min(prices)
        it["hist"] = h[-12:]
    # historia tylko dla rzeczy widzianych w ostatnich 90 dniach
    cutoff = (datetime.date.today() - datetime.timedelta(days=90)).isoformat()
    history = {k: v for k, v in history.items() if v and v[-1][0] >= cutoff or k in seen}
    out = {"updated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"), "status": status, "items": items}
    json.dump(out, open(offers_p, "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(history, open(hist_p, "w"), separators=(",", ":"))
    json.dump({"updated": out["updated"], "p": {i["id"]: i["price"] for i in items}},
              open(os.path.join(a.data, "prices.json"), "w"), separators=(",", ":"))
    log("RAZEM", len(items), status)
    open(os.path.join(a.debug, "scrape.log"), "w").write("\n".join(LOG))
    if items: json.dump(items[:3], open(os.path.join(a.debug, "sample.json"), "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()

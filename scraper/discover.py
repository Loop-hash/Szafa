"""Zapisuje surowe strony sklepów z ciuchami (debug), żeby było widać ich strukturę.
Uruchamiane w GitHub Actions."""
import json, os, re, sys
import requests
from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9",
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}

PAGES = {
 "bershka": "https://www.bershka.com/pl/",
 "bershka_h": "https://www.bershka.com/pl/h-woman.html",
 "pull": "https://www.pullandbear.com/pl/",
 "stradi": "https://www.stradivarius.com/pl/",
 "massimo": "https://www.massimodutti.com/pl/",
 "oysho": "https://www.oysho.com/pl/",
 "zara_store": "https://www.zara.com/pl/pl/categories?ajax=true",
 "ccc": "https://ccc.eu/pl/pl/c/promo/wyprzedaz-sezonowa",
 "ccc_api": "https://ccc.eu/pl/pl/api/v1/products?category=wyprzedaz-sezonowa&page=1",
 "4f": "https://4f.com.pl/wyprzedaz",
 "4f_b": "https://4f.com.pl/",
 "bigstar": "https://bigstar.pl/wyprzedaz",
 "diverse": "https://diverse.pl/wyprzedaz",
 "diverse_b": "https://www.diverse.pl/",
 "pepco": "https://pepco.pl/",
 "medicine": "https://wearmedicine.com/",
 "lpp_terranova": "https://www.terranovastyle.com/pl/pl/",
 "newyorker": "https://www.newyorker.de/pl/",
 "only": "https://www.only.com/pl-pl/sale",
 "jackjones": "https://www.jackjones.com/pl-pl/sale",
 "vinted": "https://www.vinted.pl/",
 "halfprice": "https://www.halfprice.eu/pl",
 "tkmaxx": "https://www.tkmaxx.com/pl/pl/",
 "wolczanka": "https://wolczanka.pl/",
 "carry": "https://carry.pl/wyprzedaz",
 "orsay": "https://www.orsay.com/pl-pl/",
}

def summarize(html):
    soup = BeautifulSoup(html, "html.parser")
    scripts = soup.find_all("script")
    return {
        "title": (soup.title.string or "").strip() if soup.title and soup.title.string else "",
        "length": len(html), "count_zl": html.count("zł") + html.count("PLN"),
        "ld_json": len(soup.find_all("script", type="application/ld+json")),
        "next_data": "__NEXT_DATA__" in html, "nuxt": "__NUXT__" in html,
        "script_ids": [s.get("id") for s in scripts if s.get("id")][:40],
        "script_srcs": [s.get("src") for s in scripts if s.get("src")][:30],
        "api_like": sorted(set(re.findall(r"https?://[^\"' <>]*(?:api|json|graphql|search)[^\"' <>]*", html)))[:60],
        "paths": sorted(set(re.findall(r"[\"'`](/[A-Za-z0-9_/.-]*(?:api|graphql|catalog|product|listing)[A-Za-z0-9_/.?=&-]*)[\"'`]", html)))[:80],
        "ids": sorted(set(re.findall(r"(?:storeId|catalogId|store_id|catalog_id|langId|languageId)[\"':= ]+(-?\\d+)", html)))[:20],
        "shopify": "cdn.shopify.com" in html,
        "magento": "Magento" in html or "mage/" in html,
        "algolia": "algolia" in html.lower(),
        "img_hosts": sorted(set(re.findall(r"https?://([a-z0-9.-]+)/[^\"' ]+\.(?:jpe?g|webp|png)", html)))[:20],
    }

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "debug"
    os.makedirs(out, exist_ok=True)
    s = requests.Session(); s.headers.update(HEADERS)
    summary = {}
    for name, url in PAGES.items():
        try:
            r = s.get(url, timeout=25, allow_redirects=True)
            open(os.path.join(out, name + ".html"), "w", encoding="utf-8").write(r.text)
            summary[name] = {"url": url, "final": r.url, "status": r.status_code,
                             "type": r.headers.get("content-type", ""), "head": r.text[:200], **summarize(r.text)}
            print(name, r.status_code, len(r.text))
        except Exception as e:
            summary[name] = {"url": url, "error": repr(e)}; print(name, "ERR", e)
    json.dump(summary, open(os.path.join(out, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()

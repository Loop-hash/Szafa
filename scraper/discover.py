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
 "cropp_soldout": "https://www.cropp.com/pl/pl/czarny-t-shirt-typu-baby-tee-063fp-99x",
 "cropp_ok": "https://www.cropp.com/pl/pl/czarna-pikowana-kurtka-puffer-z-kapturem-211fr-99x",
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
        "img_hosts": sorted(set(re.findall(r"https?://([a-z0-9.-]+)/[^\"' ]+\.(?:jpe?g|webp|png)", html)))[:20],
    }

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "debug"
    os.makedirs(out, exist_ok=True)
    s = requests.Session(); s.headers.update(HEADERS)
    summary = {}
    for name, url in PAGES.items():
        try:
            r = s.get(url, timeout=40, allow_redirects=True)
            open(os.path.join(out, name + ".html"), "w", encoding="utf-8").write(r.text)
            summary[name] = {"url": url, "final": r.url, "status": r.status_code,
                             "type": r.headers.get("content-type", ""), "head": r.text[:200], **summarize(r.text)}
            print(name, r.status_code, len(r.text))
        except Exception as e:
            summary[name] = {"url": url, "error": repr(e)}; print(name, "ERR", e)
    json.dump(summary, open(os.path.join(out, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()

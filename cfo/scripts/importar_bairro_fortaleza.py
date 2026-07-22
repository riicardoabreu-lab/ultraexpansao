"""
Importa dados de caixas/clientes por provedor de um BAIRRO DE FORTALEZA a
partir de um JSON já processado (saida de extract_and_parse.py / process_city.py:
{bairro: {provedor: {cx, clientes}}}) para dentro de D.fortaleza.bairros do
dashboard.html.

Uso:
    python cfo/scripts/importar_bairro_fortaleza.py <parsed.json> "<Nome do Bairro>"

O parsed.json normalmente tem uma unica chave de bairro (a pasta do Drive
representa o bairro inteiro); se tiver mais de uma, todas sao mescladas
usando o nome de bairro passado como argumento como destino.
"""

import json
import sys
import os
import unicodedata

DASHBOARD_PATH = os.path.join(os.path.dirname(__file__), "..", "dashboard.html")


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def find_existing_bairro_key(bairros_dict, bairro_norm_target):
    for existing in bairros_dict:
        if strip_accents(existing).strip().upper() == bairro_norm_target:
            return existing
    return None


def extract_d_object(html):
    marker = "let D = "
    start = html.index(marker) + len(marker)
    i = start
    depth = 0
    in_str = False
    esc = False
    while i < len(html):
        c = html[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
        i += 1
    end = i
    return start, end, html[start:end]


def recompute_fortaleza_totals(fortaleza):
    total_cx = 0.0
    total_clientes = 0.0
    for bairro in fortaleza["bairros"].values():
        total_cx += bairro["cx"]
        total_clientes += bairro["clientes"]
    fortaleza["total_cx"] = total_cx
    fortaleza["total_clientes"] = total_clientes
    fortaleza["num_bairros"] = len(fortaleza["bairros"])


def recompute_provedores_geral(D):
    pg = {}

    def add(prov, cx, clientes):
        cur = pg.setdefault(prov, {"cx": 0.0, "clientes": 0.0})
        cur["cx"] += cx
        cur["clientes"] += clientes

    for city in D["cidades"].values():
        for bairro in city.get("bairros", {}).values():
            for prov, vals in bairro.get("providers", {}).items():
                add(prov, vals.get("cx", 0.0), vals.get("clientes", 0.0))
    for bairro in D.get("fortaleza", {}).get("bairros", {}).values():
        for prov, vals in bairro.get("providers", {}).items():
            add(prov, vals.get("cx", 0.0), vals.get("clientes", 0.0))
    D["provedores_geral"] = pg


def main():
    if len(sys.argv) < 3:
        print("Uso: python importar_bairro_fortaleza.py <parsed.json> \"<Nome do Bairro>\"")
        sys.exit(1)
    parsed_path, bairro_display = sys.argv[1], sys.argv[2]

    with open(parsed_path, encoding="utf-8") as f:
        counts = json.load(f)  # {bairro: {provedor: {cx, clientes}}}

    html = open(DASHBOARD_PATH, encoding="utf-8").read()
    start, end, json_str = extract_d_object(html)
    D = json.loads(json_str)

    if "provedores_geral" not in D:
        D["provedores_geral"] = {}
    if "fortaleza" not in D:
        D["fortaleza"] = {"total_cx": 0.0, "total_clientes": 0.0, "num_bairros": 0, "bairros": {}}

    fortaleza = D["fortaleza"]
    bairro_norm = strip_accents(bairro_display).strip().upper()
    bairro_key = find_existing_bairro_key(fortaleza["bairros"], bairro_norm) or bairro_display.strip().upper()

    # soma todas as chaves do parsed.json (normalmente so uma) no bairro alvo
    merged_providers = {}
    for _bairro_raw, providers in counts.items():
        for prov_raw, vals in providers.items():
            prov = prov_raw.strip()
            cur = merged_providers.setdefault(prov, {"cx": 0.0, "clientes": 0.0})
            cur["cx"] += float(vals["cx"])
            cur["clientes"] += float(vals["clientes"])

    bairro_entry = {
        "cx": sum(v["cx"] for v in merged_providers.values()),
        "clientes": sum(v["clientes"] for v in merged_providers.values()),
        "providers": merged_providers,
    }
    fortaleza["bairros"][bairro_key] = bairro_entry

    recompute_fortaleza_totals(fortaleza)
    recompute_provedores_geral(D)

    new_json_str = json.dumps(D, ensure_ascii=False)
    new_html = html[:start] + new_json_str + html[end:]
    with open(DASHBOARD_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"{bairro_key}: cx={bairro_entry['cx']:.0f}, clientes={bairro_entry['clientes']:.0f}, "
          f"provedores={len(merged_providers)}")


if __name__ == "__main__":
    main()

"""
Atualiza os números (caixas/clientes) de UM ÚNICO PROVEDOR dentro de um
bairro de Fortaleza que já existe em D.fortaleza.bairros, sem mexer nos
outros provedores daquele bairro.

Diferente de importar_bairro_fortaleza.py (que SUBSTITUI o bairro inteiro
— serve pra recoleta completa de todos os provedores de uma vez), este
script serve para quando a coleta em campo foi parcial (ex: só as caixas
de um provedor específico, tipo "recontamos só a Infolink em tal bairro").

Uso:
    python cfo/scripts/atualizar_provedor_bairro_fortaleza.py \
        "<Nome do Bairro>" "<PROVEDOR>" <caixas> <clientes>

Exemplo:
    python cfo/scripts/atualizar_provedor_bairro_fortaleza.py \
        "PARQUE MANIBURA" "INFOLINK" 95 14
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
    if len(sys.argv) < 5:
        print('Uso: python atualizar_provedor_bairro_fortaleza.py "<Bairro>" "<PROVEDOR>" <caixas> <clientes>')
        sys.exit(1)
    bairro_display, provedor, caixas, clientes = sys.argv[1], sys.argv[2].strip(), float(sys.argv[3]), float(sys.argv[4])

    html = open(DASHBOARD_PATH, encoding="utf-8").read()
    start, end, json_str = extract_d_object(html)
    D = json.loads(json_str)

    fortaleza = D["fortaleza"]
    bairro_norm = strip_accents(bairro_display).strip().upper()
    bairro_key = find_existing_bairro_key(fortaleza["bairros"], bairro_norm)
    if bairro_key is None:
        print(f"ERRO: bairro '{bairro_display}' não existe em D.fortaleza.bairros — "
              f"este script só atualiza bairro já existente. Use importar_bairro_fortaleza.py "
              f"para criar um bairro novo.")
        sys.exit(1)

    bairro_entry = fortaleza["bairros"][bairro_key]
    providers = bairro_entry.setdefault("providers", {})

    old = providers.get(provedor, {"cx": 0.0, "clientes": 0.0})
    providers[provedor] = {"cx": caixas, "clientes": clientes}

    bairro_entry["cx"] = bairro_entry["cx"] - old["cx"] + caixas
    bairro_entry["clientes"] = bairro_entry["clientes"] - old["clientes"] + clientes

    recompute_fortaleza_totals(fortaleza)
    recompute_provedores_geral(D)

    new_json_str = json.dumps(D, ensure_ascii=False)
    new_html = html[:start] + new_json_str + html[end:]
    with open(DASHBOARD_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    action = "atualizado" if old["cx"] or old["clientes"] else "adicionado"
    print(f"{bairro_key} / {provedor}: {action} para cx={caixas:.0f}, clientes={clientes:.0f} "
          f"(antes: cx={old['cx']:.0f}, clientes={old['clientes']:.0f})")
    print(f"Novo total do bairro: cx={bairro_entry['cx']:.0f}, clientes={bairro_entry['clientes']:.0f}")


if __name__ == "__main__":
    main()

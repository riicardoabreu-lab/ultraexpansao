"""
Atualiza os bairros de BEBERIBE no dashboard.html a partir do banco de
dados bruto do Map Marker (sincronizado no Google Drive em MAPAS
EXPANSAO/BEBERIBE), em vez do fluxo manual de planilha.

Diferente de atualizar_dashboard.py (que sobrescreve o bairro inteiro
a partir de um CSV), este script faz um MERGE: atualiza só a contagem
de caixas (QTD. CAIXAS) por provedor, preservando o número de clientes
já cadastrado manualmente para cada provedor/bairro (o banco bruto do
Map Marker não traz contagem de clientes por caixa). Bairros/provedores
novos entram com clientes=0 até serem confirmados.

Uso:
    python cfo/scripts/importar_beberibe_mapmarker.py <content.json>
"""

import json
import sys
import os
from collections import defaultdict

DASHBOARD_PATH = os.path.join(os.path.dirname(__file__), "..", "dashboard.html")

# Normalização de nomes de provedor: o banco bruto do Map Marker tem
# variações de espaço/abreviação que já existem de forma canônica no
# dashboard. Mapeia só os casos confirmados manualmente (ver conversa).
PROVIDER_ALIASES = {
    "BIT WAVE": "BITWAVE",
    "GL": "GL TELECOM",
    "PROVEDOR NET": "PROVEDORNET",
    "NEW WORD": "NEW WORLD",
    "LINKBARATO": "LINK BARATO",
    "CONDOMINIO FECHADO": "CONDOMÍNIO FECHADO",
}


def normalize_provider(name):
    name = name.strip()
    return PROVIDER_ALIASES.get(name, name)


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


def recompute_city_totals(city):
    total_cx = 0.0
    total_clientes = 0.0
    providers = {}
    for bairro in city["bairros"].values():
        total_cx += bairro["cx"]
        total_clientes += bairro["clientes"]
        for prov, vals in bairro.get("providers", {}).items():
            if prov not in providers:
                providers[prov] = {"cx": 0.0, "clientes": 0.0}
            providers[prov]["cx"] += vals["cx"]
            providers[prov]["clientes"] += vals["clientes"]
    city["total_cx"] = total_cx
    city["total_clientes"] = total_clientes
    city["providers"] = providers


def merge_alias_leftovers(D):
    """Funde no dashboard inteiro entradas salvas com o nome antigo de um
    provedor que passou a ter alias (ex: rodadas anteriores salvaram
    "NEW WORD" antes desse alias existir). Sem isso, o nome antigo fica
    órfão duplicado ao lado do nome canônico novo."""
    def merge_dict(provs):
        for src, tgt in PROVIDER_ALIASES.items():
            if src in provs:
                old = provs.pop(src)
                cur = provs.get(tgt, {"cx": 0.0, "clientes": 0.0})
                provs[tgt] = {"cx": cur["cx"] + old["cx"], "clientes": cur["clientes"] + old["clientes"]}

    for city in D.get("cidades", {}).values():
        for bairro in city.get("bairros", {}).values():
            merge_dict(bairro.get("providers", {}))
        merge_dict(city.get("providers", {}))
    for bairro in D.get("fortaleza", {}).get("bairros", {}).values():
        merge_dict(bairro.get("providers", {}))
    merge_dict(D.get("provedores_geral", {}))


def count_caixas_by_bairro_provider(content_json_path):
    with open(content_json_path, encoding="utf-8") as f:
        data = json.load(f)
    dc = data["data_content"]
    folders = {f["id"]: f for f in dc["folder"]}
    pois = dc["poi"]

    counts = defaultdict(lambda: defaultdict(int))
    for p in pois:
        if p.get("geometry", {}).get("type") != 0:
            continue
        folder = folders.get(p.get("folder_id"))
        if not folder or not folder.get("name"):
            continue
        parts = folder["name"].split("/")
        if len(parts) < 4:
            continue
        _municipio, bairro, categoria, provedor = parts[0], parts[1], parts[2], parts[3]
        if categoria != "CAIXAS":
            continue
        bairro = bairro.strip().upper()
        provedor = normalize_provider(provedor)
        counts[bairro][provedor] += 1
    return counts


def main():
    if len(sys.argv) < 2:
        print("Uso: python importar_beberibe_mapmarker.py <content.json>")
        sys.exit(1)

    counts = count_caixas_by_bairro_provider(sys.argv[1])

    html = open(DASHBOARD_PATH, encoding="utf-8").read()
    start, end, json_str = extract_d_object(html)
    D = json.loads(json_str)

    if "provedores_geral" not in D:
        D["provedores_geral"] = {}
    merge_alias_leftovers(D)

    beberibe = D["cidades"]["BEBERIBE"]

    print(f"{'BAIRRO':<20}{'PROVEDOR':<25}{'ANTES':>8}{'AGORA':>8}{'DELTA':>8}")
    for bairro, providers in sorted(counts.items()):
        if bairro not in beberibe["bairros"]:
            beberibe["bairros"][bairro] = {"cx": 0.0, "clientes": 0.0, "providers": {}}
            print(f"-- novo bairro: {bairro} --")
        bairro_entry = beberibe["bairros"][bairro]

        for prov, new_cx in sorted(providers.items()):
            old = bairro_entry["providers"].get(prov, {"cx": 0.0, "clientes": 0.0})
            old_cx = old["cx"]
            delta = new_cx - old_cx
            bairro_entry["providers"][prov] = {"cx": float(new_cx), "clientes": old["clientes"]}

            if prov not in D["provedores_geral"]:
                D["provedores_geral"][prov] = {"cx": 0.0, "clientes": 0.0}
            D["provedores_geral"][prov]["cx"] += delta

            if delta != 0:
                print(f"{bairro:<20}{prov:<25}{old_cx:>8.0f}{new_cx:>8.0f}{delta:>+8.0f}")

        bairro_entry["cx"] = sum(v["cx"] for v in bairro_entry["providers"].values())
        bairro_entry["clientes"] = sum(v["clientes"] for v in bairro_entry["providers"].values())

    recompute_city_totals(beberibe)

    new_json_str = json.dumps(D, ensure_ascii=False)
    new_html = html[:start] + new_json_str + html[end:]
    with open(DASHBOARD_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"\nBEBERIBE atualizado: total_cx={beberibe['total_cx']:.0f}, "
          f"total_clientes={beberibe['total_clientes']:.0f}, "
          f"bairros={len(beberibe['bairros'])}")


if __name__ == "__main__":
    main()

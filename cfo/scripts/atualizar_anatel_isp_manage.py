"""
Atualiza a lista de provedores (ANATEL) usada em isp-manage/index.html
(objeto `const CITIES`) a partir de uma planilha oficial da ANATEL
("Lista dos Provedores da Anatel <ano>.xlsx", aba única com colunas
UF, Município, Nome/Razão Social, ..., Endereço, Telefone).

Substitui a lista de provedores inteira de cada município (a planilha
nova é a fonte da verdade) mas preserva lat/lng/regiao já cadastrados.
Municípios novos na planilha que não existem ainda em CITIES entram
com lat/lng/regiao passados manualmente em NEW_CITIES_GEO (a planilha
da ANATEL não traz coordenada nenhuma).

Uso:
    python cfo/scripts/atualizar_anatel_isp_manage.py <planilha.xlsx>
"""

import json
import sys
import os
import unicodedata

import openpyxl

ISP_MANAGE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "isp-manage", "index.html")

# Município novo -> (lat, lng, regiao). Coordenadas do dataset público
# alanwillms/geoinfo (sede do município); regiao escolhida por
# proximidade dos municípios vizinhos já cadastrados em CITIES.
NEW_CITIES_GEO = {
    "UMIRIM": (-3.676541, -39.346513, "05 Litoral Oeste / Vale do Curu"),
    "URUBURETAMA": (-3.623165, -39.510677, "05 Litoral Oeste / Vale do Curu"),
    "URUOCA": (-3.308194, -40.56276, "06 Litoral Norte / Acaraú-Camocim"),
    "VARJOTA": (-4.193871, -40.474083, "08 Serra da Ibiapaba"),
    "VICOSA DO CEARA": (-3.566703, -41.091554, "08 Serra da Ibiapaba"),
    "VARZEA ALEGRE": (-6.782642, -39.294155, "12 Centro-Sul / Iguatu-Icó"),
}


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def extract_cities_object(html):
    marker = "const CITIES="
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


def read_anatel_rows(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Planilha1"]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        uf, municipio, nome, _proc, _ato, _outorga, _termo, endereco, telefone = r[:9]
        if not municipio or not nome:
            continue
        rows.append((municipio.strip(), nome.strip(), (telefone or "").strip(), (endereco or "").strip()))
    return rows


def main():
    if len(sys.argv) < 2:
        print("Uso: python atualizar_anatel_isp_manage.py <planilha.xlsx>")
        sys.exit(1)
    xlsx_path = sys.argv[1]

    html = open(ISP_MANAGE_PATH, encoding="utf-8").read()
    start, end, json_str = extract_cities_object(html)
    cities = json.loads(json_str)

    current_norm = {strip_accents(k).strip().upper(): k for k in cities}

    rows = read_anatel_rows(xlsx_path)

    # A planilha da ANATEL traz uma linha por outorga/termo -- a mesma empresa
    # pode aparecer várias vezes na mesma cidade (uma por autorização). Dedup
    # por nome (case-insensitive), mantendo o registro com telefone/endereço
    # preenchido quando algum duplicado vier vazio.
    by_city = {}
    for municipio, nome, telefone, endereco in rows:
        norm = strip_accents(municipio).strip().upper()
        city_provs = by_city.setdefault(norm, {})
        nome_key = strip_accents(nome).strip().upper()
        existing = city_provs.get(nome_key)
        if existing is None:
            city_provs[nome_key] = {"nome": nome, "tel": telefone, "endereco": endereco}
        else:
            if not existing["tel"] and telefone:
                existing["tel"] = telefone
            if not existing["endereco"] and endereco:
                existing["endereco"] = endereco

    novos_municipios = []
    global_id = 1
    updated = 0
    for norm, provs_by_name in by_city.items():
        provs = list(provs_by_name.values())
        key = current_norm.get(norm)
        if key is None:
            geo = NEW_CITIES_GEO.get(norm)
            if not geo:
                print(f"AVISO: município novo sem lat/lng cadastrado, pulando: {provs[0]['endereco']!r} (norm={norm})")
                continue
            lat, lng, regiao = geo
            # usa o nome do município tal como veio na planilha (primeira ocorrência)
            key = next(m for m, n, t, e in rows if strip_accents(m).strip().upper() == norm)
            cities[key] = {"lat": lat, "lng": lng, "regiao": regiao, "provedores": []}
            current_norm[norm] = key
            novos_municipios.append(key)

        prov_objs = []
        for p in provs:
            prov_objs.append({"id": str(global_id), "nome": p["nome"], "tel": p["tel"], "endereco": p["endereco"]})
            global_id += 1
        cities[key]["provedores"] = prov_objs
        updated += 1

    new_json_str = json.dumps(cities, ensure_ascii=False)
    new_html = html[:start] + new_json_str + html[end:]
    with open(ISP_MANAGE_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    total_prov = sum(len(v["provedores"]) for v in cities.values())
    print(f"Municípios atualizados: {updated}")
    print(f"Municípios novos adicionados: {len(novos_municipios)} -> {novos_municipios}")
    print(f"Total de municípios em CITIES: {len(cities)}")
    print(f"Total de provedores: {total_prov}")


if __name__ == "__main__":
    main()

"""
Importa dados de caixas/clientes por provedor de uma cidade a partir de
um JSON já processado (saida de extract_and_parse.py: {bairro: {provedor:
{cx, clientes}}}) para dentro do dashboard.html.

Se os dados computados trazem contagem de clientes plausível (não tudo
zero), substitui caixas E clientes. Preserva bairros/provedores que já
existiam mas não vieram nos dados novos (não some com nada, só atualiza/
adiciona o que veio).

Uso:
    python cfo/scripts/importar_cidade_mapmarker.py <parsed.json> <CHAVE_CIDADE> "<Nome de Exibição>"
"""

import json
import sys
import os
import unicodedata

DASHBOARD_PATH = os.path.join(os.path.dirname(__file__), "..", "dashboard.html")


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def find_existing_city_key(D, city_norm_target):
    """Mesma ideia de find_existing_bairro_key, mas pra chave de cidade --
    evita duplicar 'MARACANAU' (sem acento, vindo do pull novo) ao lado de
    'MARACANÁ' (com acento, ja existente) como duas cidades diferentes."""
    for existing in D["cidades"]:
        if strip_accents(existing).strip().upper() == city_norm_target:
            return existing
    return None


def find_existing_bairro_key(city, bairro_norm_target):
    """Acha o nome de bairro já salvo que bate ignorando acento/espaço, pra não
    duplicar 'JOAO DE CASTRO' vs 'JOÃO DE CASTRO' como dois bairros diferentes."""
    for existing in city["bairros"]:
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


def recompute_provedores_geral(D):
    """Recalcula D.provedores_geral do zero a partir de D.cidades + D.fortaleza,
    em vez de manter um contador incremental (que dessincroniza fácil quando
    algum ajuste manual mexe direto nos bairros, como fusão de duplicata)."""
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
    if len(sys.argv) < 4:
        print("Uso: python importar_cidade_mapmarker.py <parsed.json> <CHAVE_CIDADE> <\"Nome de Exibição\">")
        sys.exit(1)
    parsed_path, city_key_raw, display_name = sys.argv[1], sys.argv[2].upper(), sys.argv[3]

    with open(parsed_path, encoding="utf-8") as f:
        counts = json.load(f)  # {bairro: {provedor: {cx, clientes}}}

    html = open(DASHBOARD_PATH, encoding="utf-8").read()
    start, end, json_str = extract_d_object(html)
    D = json.loads(json_str)

    if "provedores_geral" not in D:
        D["provedores_geral"] = {}

    city_key_norm = strip_accents(city_key_raw).strip().upper()
    city_key = find_existing_city_key(D, city_key_norm) or city_key_raw
    is_new_city = city_key not in D["cidades"]
    if is_new_city:
        D["cidades"][city_key] = {
            "display_name": display_name,
            "method": "sum_all_blocks",
            "total_cx": 0.0,
            "total_clientes": 0.0,
            "providers": {},
            "bairros": {},
        }
        print(f"-- nova cidade: {city_key} --")

    city = D["cidades"][city_key]

    for bairro_raw, providers in counts.items():
        bairro_norm = strip_accents(bairro_raw).strip().upper()
        # reusa o nome já salvo (com acento certo) se achar por comparação sem acento,
        # em vez de criar uma entrada duplicada tipo "JOAO DE CASTRO" vs "JOÃO DE CASTRO"
        bairro = find_existing_bairro_key(city, bairro_norm) or bairro_raw.strip().upper()
        # substitui o bairro inteiro (nao so os provedores que vieram) --
        # a pull fresca do Map Marker e a fonte da verdade atual; manter
        # provedores antigos que sumiram da pasta so inflaria a contagem
        # (aconteceu em Horizonte: bairro velho tinha provedores com nomes
        # diferentes do pull novo e nao eram sobrescritos, dobrando o total)
        bairro_entry = {"cx": 0.0, "clientes": 0.0, "providers": {}}
        city["bairros"][bairro] = bairro_entry

        for prov_raw, vals in providers.items():
            prov = prov_raw.strip()
            bairro_entry["providers"][prov] = {"cx": float(vals["cx"]), "clientes": float(vals["clientes"])}

        bairro_entry["cx"] = sum(v["cx"] for v in bairro_entry["providers"].values())
        bairro_entry["clientes"] = sum(v["clientes"] for v in bairro_entry["providers"].values())

    recompute_city_totals(city)
    recompute_provedores_geral(D)

    new_json_str = json.dumps(D, ensure_ascii=False)
    new_html = html[:start] + new_json_str + html[end:]
    with open(DASHBOARD_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"{city_key}: total_cx={city['total_cx']:.0f}, total_clientes={city['total_clientes']:.0f}, "
          f"bairros={len(city['bairros'])}")


if __name__ == "__main__":
    main()

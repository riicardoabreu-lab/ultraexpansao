"""
Atualiza o dashboard (dashboard.html) injetando/atualizando bairros
a partir dos CSVs em csv-input/, usando a mesma lógica de parsing do
gerar_relatorio_bairro.py.

- Se o município (ex: BEBERIBE) já existe em D['cidades'], o bairro é
  adicionado/atualizado dentro dele e os totais da cidade (total_cx,
  total_clientes, providers) são recalculados a partir de TODOS os
  bairros daquela cidade.
- Se o município ainda não existe, cria uma nova entrada com
  method="sum_all_blocks" (mesmo padrão usado para cidades com coleta
  por bairro).

Roda automaticamente pelo GitHub Actions sempre que um CSV novo é
adicionado a csv-input/.
"""

import glob
import json
import os

DASHBOARD_PATH = os.path.join(os.path.dirname(__file__), "..", "dashboard.html")
INPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "csv-input")

from gerar_relatorio_bairro import parse_csv  # reaproveita a mesma lógica de parsing


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


def main():
    html = open(DASHBOARD_PATH, encoding="utf-8").read()
    start, end, json_str = extract_d_object(html)
    D = json.loads(json_str)

    csv_files = glob.glob(os.path.join(INPUT_DIR, "*.csv")) + glob.glob(
        os.path.join(INPUT_DIR, "*.CSV")
    )

    if not csv_files:
        print("Nenhum CSV encontrado em csv-input/. Dashboard não alterado.")
        return

    atualizados = []
    for path in sorted(set(csv_files)):
        data = parse_csv(path)
        if not data or not data["bairro"]:
            print(f"Aviso: não foi possível interpretar {path}, pulando.")
            continue

        municipio = data["municipio"].strip().upper()
        bairro_nome = data["bairro"].strip().upper()

        total_cx = sum(v["caixas"] for v in data["providers"].values())
        total_clientes = sum(v["clientes"] for v in data["providers"].values())
        bairro_entry = {
            "cx": float(total_cx),
            "clientes": float(total_clientes),
            "providers": {
                prov: {"cx": float(v["caixas"]), "clientes": float(v["clientes"])}
                for prov, v in data["providers"].items()
            },
        }

        if municipio not in D["cidades"]:
            D["cidades"][municipio] = {
                "display_name": municipio.title(),
                "method": "sum_all_blocks",
                "total_cx": 0.0,
                "total_clientes": 0.0,
                "providers": {},
                "bairros": {},
            }

        D["cidades"][municipio]["bairros"][bairro_nome] = bairro_entry
        recompute_city_totals(D["cidades"][municipio])
        atualizados.append(f"{bairro_nome} ({municipio})")

    new_json_str = json.dumps(D, ensure_ascii=False)
    new_html = html[:start] + new_json_str + html[end:]

    with open(DASHBOARD_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"Dashboard atualizado com: {', '.join(atualizados)}")


if __name__ == "__main__":
    main()

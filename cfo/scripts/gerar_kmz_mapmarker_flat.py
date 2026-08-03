"""
Variante de gerar_kmz_mapmarker.py para cidades cujo backup do Map Marker
não tem uma pasta raiz com o nome do município (ex: Fortim, Aquiraz,
Pindoretama, Cascavel) -- a pasta de nível 1 já é o bairro/setor
diretamente, ao contrário de Beberibe/Fortaleza que tem
"CIDADE/bairro/categoria/provedor".

Uso:
    python cfo/scripts/gerar_kmz_mapmarker_flat.py <content.json> <cidade> <saida.kmz>
"""

import colorsys
import hashlib
import json
import sys
import zipfile
from collections import defaultdict
from xml.sax.saxutils import escape

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


def provider_color_kml(name):
    h = int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16)
    hue = (h % 360) / 360.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.75, 0.95)
    r, g, b = int(r * 255), int(g * 255), int(b * 255)
    return f"ff{b:02x}{g:02x}{r:02x}"


def build_kml(content_json_path, cidade):
    with open(content_json_path, encoding="utf-8") as f:
        data = json.load(f)
    dc = data["data_content"]
    folders = {f["id"]: f for f in dc["folder"]}
    pois = dc["poi"]

    tree = defaultdict(lambda: defaultdict(list))  # bairro -> provedor -> [(lat, lon)]
    for p in pois:
        geo = p.get("geometry", {})
        if geo.get("type") != 0:
            continue
        folder = folders.get(p.get("folder_id"))
        if not folder or not folder.get("name"):
            continue
        parts = [x.strip() for x in folder["name"].split("/") if x.strip()]
        if len(parts) < 3:
            continue
        bairro, categoria = parts[0], parts[1]
        if categoria.upper() != "CAIXAS":
            continue  # só caixas de atendimento -- sem CEO/emendas, sem residencial
        base_provider = normalize_provider(parts[2])
        if len(parts) > 3:
            suffix = " ".join(parts[3:])
            provedor = f"{base_provider} ({suffix})"
        else:
            provedor = base_provider
        lat = geo["data"]["latitude"]
        lon = geo["data"]["longitude"]
        tree[bairro][provedor].append((lat, lon))

    styles = []
    seen_providers = {}

    def style_id_for(provider):
        if provider not in seen_providers:
            color = provider_color_kml(provider)
            sid = f"s_{len(seen_providers)}"
            seen_providers[provider] = sid
            styles.append(
                f'<Style id="{sid}"><IconStyle><color>{color}</color><scale>0.9</scale>'
                f'<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>'
                f'</IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>'
            )
        return seen_providers[provider]

    bairro_folders_xml = []
    total_points = 0
    for bairro in sorted(tree.keys()):
        prov_folders_xml = []
        for provedor in sorted(tree[bairro].keys()):
            pontos = tree[bairro][provedor]
            sid = style_id_for(provedor)
            placemarks = []
            for lat, lon in pontos:
                placemarks.append(
                    f'<Placemark><name>{escape(provedor)}</name>'
                    f'<styleUrl>#{sid}</styleUrl>'
                    f'<Point><coordinates>{lon},{lat},0</coordinates></Point></Placemark>'
                )
            total_points += len(pontos)
            prov_folders_xml.append(
                f'<Folder><name>{escape(provedor)} ({len(pontos)})</name>'
                + "".join(placemarks) + '</Folder>'
            )
        bairro_folders_xml.append(
            f'<Folder><name>{escape(bairro)}</name>' + "".join(prov_folders_xml) + '</Folder>'
        )

    kml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        f'<name>{escape(cidade)} - Concorrentes (Map Marker)</name>'
        + "".join(styles)
        + "".join(bairro_folders_xml)
        + '</Document></kml>'
    )
    return kml, total_points, len(seen_providers), len(tree)


def main():
    if len(sys.argv) < 4:
        print("Uso: python gerar_kmz_mapmarker_flat.py <content.json> <cidade> <saida.kmz>")
        sys.exit(1)
    content_path, cidade, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    kml, total_points, num_providers, num_bairros = build_kml(content_path, cidade)

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", kml)

    print(f"KMZ gerado: {out_path}")
    print(f"  Bairros: {num_bairros}")
    print(f"  Provedores: {num_providers}")
    print(f"  Pontos: {total_points}")


if __name__ == "__main__":
    main()

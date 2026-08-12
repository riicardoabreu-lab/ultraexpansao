"""
Adiciona (ou substitui) a pasta de UM PROVEDOR dentro de UM BAIRRO já
existente em cfo/kmz/FORTALEZA.kmz, sem mexer nos outros provedores do
bairro nem nos outros bairros — pensado pra coleta parcial de campo (ex:
"recontamos só as caixas da Infolink em tal bairro").

O KMZ da Fortaleza segue o padrão: Folder(bairro "NOME (total)") >
Folder(provedor "PROVEDOR (qtd)") > Placemark(s) simples (nome + styleUrl
+ Point). Cada provedor reusa o MESMO <Style> (cor) em todos os bairros
onde aparece — procurado automaticamente aqui, não precisa recriar.

Uso:
    python cfo/scripts/adicionar_provedor_kmz_fortaleza.py \
        "<Nome do Bairro>" "<PROVEDOR>" <arquivo_de_coordenadas.txt>

O arquivo de coordenadas tem uma coordenada "lon,lat" por linha (o mesmo
formato que aparece dentro de <coordinates> de um KML).
"""

import re
import sys
import os
import unicodedata
import zipfile

KMZ_PATH = os.path.join(os.path.dirname(__file__), "..", "kmz", "FORTALEZA.kmz")


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    if len(sys.argv) < 4:
        print('Uso: python adicionar_provedor_kmz_fortaleza.py "<Bairro>" "<PROVEDOR>" <coords.txt>')
        sys.exit(1)
    bairro_display, provedor, coords_path = sys.argv[1], sys.argv[2].strip(), sys.argv[3]

    with open(coords_path, encoding="utf-8") as f:
        coords = [ln.strip() for ln in f if ln.strip()]
    if not coords:
        print("ERRO: arquivo de coordenadas vazio.")
        sys.exit(1)

    z = zipfile.ZipFile(KMZ_PATH, "r")
    inner_name = z.namelist()[0]
    kml = z.read(inner_name).decode("utf-8")
    z.close()

    bairro_norm = strip_accents(bairro_display).strip().upper()

    # Acha a pasta do bairro pelo <name>...</name> (ignorando acento/maiuscula
    # e o sufixo " (NNNN)" de contagem que já existe no arquivo).
    folder_name_re = re.compile(r"<Folder><name>([^<]*?)(?:\s*\((\d+)\))?</name>")
    bairro_start_tag = None
    bairro_count = None
    bairro_name_raw = None
    for m in folder_name_re.finditer(kml):
        nome_raw = m.group(1)
        if strip_accents(nome_raw).strip().upper() == bairro_norm:
            bairro_start_tag = m
            bairro_count = int(m.group(2)) if m.group(2) else 0
            bairro_name_raw = nome_raw
            break
    if bairro_start_tag is None:
        print(f"ERRO: bairro '{bairro_display}' não encontrado no FORTALEZA.kmz.")
        sys.exit(1)

    # Acha o </Folder> que fecha essa pasta de bairro: como as pastas de
    # provedor dentro dela não têm sub-Folder (são só Placemarks), o
    # primeiro "</Folder>\n<Folder><name>" (ou fim de arquivo) após o
    # início marca o fim do bloco do bairro — procurado contando pastas
    # de provedor imediatamente aninhadas.
    body_start = bairro_start_tag.end()
    next_bairro_folder = re.search(r"</Folder>\s*<Folder><name>[^<]*\(\d+\)</name>", kml[body_start:])
    # Essa regex também bate com o início de cada pasta de PROVEDOR (que
    # também tem "(qtd)"), então percorre pastas de provedor até achar o
    # </Folder> que efetivamente fecha o bairro (o próximo Folder depois
    # dele é outro BAIRRO, não outro provedor — identificado comparando a
    # indentação é frágil aqui, então em vez disso conta profundidade real).
    depth = 1
    i = body_start
    while depth > 0:
        next_open = kml.find("<Folder>", i)
        next_close = kml.find("</Folder>", i)
        if next_close == -1:
            print("ERRO: não encontrei o fechamento da pasta do bairro (arquivo inesperado).")
            sys.exit(1)
        if next_open != -1 and next_open < next_close:
            depth += 1
            i = next_open + len("<Folder>")
        else:
            depth -= 1
            i = next_close + len("</Folder>")
    bairro_close_pos = i - len("</Folder>")  # posição do </Folder> que fecha o bairro
    bairro_body = kml[body_start:bairro_close_pos]

    # Verifica se o provedor já existe dentro do bairro (pra substituir em
    # vez de duplicar, caso rode de novo com dado atualizado).
    prov_re = re.compile(
        r"<Folder><name>" + re.escape(provedor) + r"\s*\((\d+)\)</name>.*?</Folder>",
        re.S,
    )
    prov_match = prov_re.search(bairro_body)
    old_count = int(prov_match.group(1)) if prov_match else 0

    # Acha o styleUrl já usado por esse provedor em QUALQUER outro bairro do
    # arquivo, pra manter a mesma cor em todo o KMZ. Se o provedor nunca
    # apareceu antes em Fortaleza, cria um estilo novo.
    existing_style_m = re.search(
        r"<Folder><name>" + re.escape(provedor) + r"\s*\(\d+\)</name>\s*"
        r"<Placemark>.*?<styleUrl>#([^<]+)</styleUrl>",
        kml, re.S,
    )
    if existing_style_m:
        style_id = existing_style_m.group(1)
        style_def = ""
    else:
        style_id = "style_" + os.urandom(6).hex()
        style_def = (
            f'<Style id="{style_id}"><IconStyle><color>ff70f23c</color><scale>0.8</scale>'
            f'<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>'
            f'</IconStyle></Style>'
        )

    placemarks = "".join(
        f'<Placemark><name>{esc(provedor)} {idx}</name><styleUrl>#{style_id}</styleUrl>'
        f'<Point><coordinates>{c},0</coordinates></Point></Placemark>'
        for idx, c in enumerate(coords, start=1)
    )
    new_prov_folder = f'<Folder><name>{esc(provedor)} ({len(coords)})</name>{placemarks}</Folder>'

    if prov_match:
        new_bairro_body = bairro_body[: prov_match.start()] + new_prov_folder + bairro_body[prov_match.end():]
    else:
        # insere em ordem alfabética entre as pastas de provedor existentes
        insert_pos = len(bairro_body)
        for pm in re.finditer(r"<Folder><name>([^<(]+)\s*\(\d+\)</name>", bairro_body):
            if pm.group(1).strip().upper() > provedor.upper():
                insert_pos = pm.start()
                break
        new_bairro_body = bairro_body[:insert_pos] + new_prov_folder + bairro_body[insert_pos:]

    new_bairro_count = bairro_count - old_count + len(coords)
    new_bairro_name_tag = f"<Folder><name>{esc(bairro_name_raw)} ({new_bairro_count})</name>"

    new_kml = (
        kml[: bairro_start_tag.start()]
        + new_bairro_name_tag
        + new_bairro_body
        + "</Folder>"
        + kml[bairro_close_pos + len("</Folder>"):]
    )

    if style_def:
        # injeta a nova definição de estilo logo após a abertura do <Document>
        doc_open = new_kml.index("<Document>") + len("<Document>")
        new_kml = new_kml[:doc_open] + style_def + new_kml[doc_open:]

    with zipfile.ZipFile(KMZ_PATH, "w", zipfile.ZIP_DEFLATED) as zout:
        zout.writestr(inner_name, new_kml)

    action = "substituído" if prov_match else "adicionado"
    print(f"{bairro_name_raw.strip()} / {provedor}: {action}, {len(coords)} caixas "
          f"(antes desse provedor: {old_count})")
    print(f"Novo total do bairro no KMZ: {new_bairro_count} (era {bairro_count})")


if __name__ == "__main__":
    main()

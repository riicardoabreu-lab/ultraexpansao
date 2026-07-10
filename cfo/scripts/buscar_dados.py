"""
Script de atualização automática - Projeto CFO (Infolink)

Este script é executado periodicamente pelo GitHub Actions
(.github/workflows/atualizar-dashboard.yml) para buscar dados
atualizados na API do Voalle e salvar em data/dados.json.

Como configurar:
1. No repositório do GitHub, vá em:
   Settings > Secrets and variables > Actions > New repository secret
2. Adicione:
   - VOALLE_CLIENT_ID
   - VOALLE_CLIENT_SECRET
3. Ajuste as URLs de autenticação e consulta abaixo conforme a
   documentação oficial da API do Voalle (endpoints reais podem
   variar por contrato/versão).
"""

import json
import os
from datetime import datetime, timezone

import requests

VOALLE_AUTH_URL = "https://SEU-DOMINIO.voalle.com/api/auth"   # ajustar
VOALLE_DATA_URL = "https://SEU-DOMINIO.voalle.com/api/dados"  # ajustar

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "dados.json")


def autenticar():
    client_id = os.environ["VOALLE_CLIENT_ID"]
    client_secret = os.environ["VOALLE_CLIENT_SECRET"]

    response = requests.post(
        VOALLE_AUTH_URL,
        json={"client_id": client_id, "client_secret": client_secret},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def buscar_dados(token):
    response = requests.get(
        VOALLE_DATA_URL,
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def main():
    token = autenticar()
    dados = buscar_dados(token)

    payload = {
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
        "fonte": "Voalle API",
        "dados": dados,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Dados atualizados em {payload['atualizado_em']}")


if __name__ == "__main__":
    main()

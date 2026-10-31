"""Arma los archivos de comercios para "Buscar clientes" a partir de Overture Maps.

Overture Maps (https://overturemaps.org) publica todos los meses un mapa abierto de comercios
armado con datos de Meta, Microsoft, Foursquare y otros. Es gratis, no pide cuenta y sus
licencias (CDLA Permissive 2.0, Apache 2.0, CC0) permiten usarlo y guardarlo.

Este script baja la última versión, se queda con los rubros y zonas que le sirven a la
distribuidora y deja un archivo liviano por zona en esta carpeta, más `indice.json`.
La app baja esos archivos una vez y los guarda en el celular.

Uso:  pip install duckdb   y   python datos/actualizar_comercios.py
"""

import json
import re
import sys
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

import duckdb

CARPETA = Path(__file__).resolve().parent
BUCKET = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com"

# Zonas: para sumar otra, agregar una línea con su recuadro (oeste, sur, este, norte).
ZONAS = [
    {"id": "amba", "nombre": "AMBA y La Plata", "bbox": (-59.20, -35.15, -57.80, -34.25)},
]

# Rubros: categorías de Overture + palabras en el nombre.
RUBROS = [
    {"id": "jug", "nombre": "Jugueterías",
     "categorias": ["toy_store", "hobby_shop", "baby_gear_and_nursery_store"],
     "nombre_re": r"jugueter|juguete|\btoys?\b"},
    {"id": "lib", "nombre": "Librerías",
     "categorias": ["bookstore", "office_supply_store", "cards_and_stationery_store",
                    "business_office_supplies_and_stationery", "academic_bookstore"],
     "nombre_re": r"librer|papeler"},
    {"id": "baz", "nombre": "Bazar y hogar",
     "categorias": ["home_goods_store", "kitchen_supply_store", "discount_store", "department_store"],
     "nombre_re": r"\bbazar|todo x|todo por"},
    {"id": "cot", "nombre": "Cotillón",
     "categorias": ["party_supply_store", "costume_store"],
     "nombre_re": r"cotill"},
    {"id": "reg", "nombre": "Regalerías",
     "categorias": ["gift_shop", "souvenir_store"],
     "nombre_re": r"regaler|regalos"},
    {"id": "art", "nombre": "Artística",
     "categorias": ["arts_crafts_and_hobby_store", "craft_store"],
     "nombre_re": r"art[ií]stica|manualidad"},
    {"id": "lim", "nombre": "Limpieza",
     "categorias": ["cleaning_products_supplier"],
     "nombre_re": r"limpieza|qu[ií]mic|sueltos"},
    {"id": "kio", "nombre": "Kioscos",
     "categorias": ["candy_store", "convenience_store"],
     "nombre_re": r"kiosco|maxikiosco|golosin"},
    {"id": "aut", "nombre": "Autoservicios",
     "categorias": ["grocery_store"],
     "nombre_re": r"autoservicio|supermercado chino"},
]

# Si el nombre tiene alguna de estas palabras, se descarta (rubros que no compran, mal
# clasificados por Overture, o distribuidoras que son competencia).
EXCLUIR = re.compile(
    r"pet ?shop|\bpets?\b|veterinari|comput|informatic|celular|telefoni|farmacia|carniceri|verduler|"
    r"panaderi|fiambreri|polleri|peluqueri|barberi|tattoo|tatuaje|lavadero|gomeri|mecanic|repuesto|"
    r"inmobiliari|sex ?shop|distribuidora|mayorista"
)

# Códigos de área de 3 dígitos (el resto, salvo 11, son de 4).
AREAS_3 = {"220", "221", "223", "230", "236", "237", "249", "260", "261", "263", "264", "266",
           "280", "291", "294", "297", "298", "299", "336", "341", "342", "343", "345", "348",
           "351", "353", "358", "362", "364", "370", "376", "379", "380", "381", "383", "385",
           "387", "388"}


def ultima_version():
    with urllib.request.urlopen(f"{BUCKET}/?list-type=2&prefix=release/&delimiter=/", timeout=60) as r:
        xml = r.read().decode()
    versiones = re.findall(r"<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>", xml)
    if not versiones:
        sys.exit("No encontré versiones de Overture")
    return max(versiones)


def telefono(crudo):
    """Devuelve (para_whatsapp, para_mostrar, tipo) o None.

    tipo: "c" celular seguro (tiene 9 o 15), "p" probable celular, "f" probable fijo
    (los fijos en Argentina casi siempre empiezan con 4).
    """
    d = re.sub(r"\D", "", crudo or "")
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("54"):
        d = d[2:]
    elif d.startswith("0"):
        d = d[1:]
    movil = False
    if len(d) == 11 and d.startswith("9"):
        d, movil = d[1:], True
    if len(d) == 12:  # trae el 15 después del código de área
        for largo in (2, 3, 4):
            if d[largo:largo + 2] == "15":
                d, movil = d[:largo] + d[largo + 2:], True
                break
    if len(d) != 10:
        return None
    largo = 2 if d.startswith("11") else 3 if d[:3] in AREAS_3 else 4
    area, abonado = d[:largo], d[largo:]
    tipo = "c" if movil else "f" if abonado.startswith("4") else "p"
    mostrar = f"{area} {abonado[:-4]}-{abonado[-4:]}"
    return ("549" if tipo != "f" else "54") + d, mostrar, tipo


def red_social(socials):
    for s in socials or []:
        if "instagram.com" in s or "facebook.com" in s:
            return s
    return ""


def sin_acentos(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


def armar_zona(con, version, zona):
    oeste, sur, este, norte = zona["bbox"]
    src = f"s3://overturemaps-us-west-2/release/{version}/theme=places/type=place/*"
    con.execute(f"""
        CREATE OR REPLACE TABLE zona AS
        SELECT id, names."primary" AS nombre, taxonomy."primary" AS categoria, phones, socials, websites,
               addresses[1].freeform AS direccion, addresses[1].locality AS localidad, confidence,
               (bbox.xmin + bbox.xmax) / 2 AS lon, (bbox.ymin + bbox.ymax) / 2 AS lat
        FROM read_parquet('{src}', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {oeste} AND {este} AND bbox.ymin BETWEEN {sur} AND {norte}
          AND names."primary" IS NOT NULL AND confidence >= 0.2
    """)
    filas = con.execute("SELECT id, nombre, categoria, phones, socials, websites, direccion, localidad, lat, lon, confidence FROM zona").fetchall()
    items = []
    por_rubro = {r["id"]: 0 for r in RUBROS}
    for id_, nombre, categoria, phones, socials, websites, direccion, localidad, lat, lon, confianza in filas:
        texto = sin_acentos(nombre)
        if EXCLUIR.search(texto):
            continue
        rubro = next((r["id"] for r in RUBROS if categoria in r["categorias"]), None) \
            or next((r["id"] for r in RUBROS if re.search(r["nombre_re"], texto)), None)
        if not rubro:
            continue
        tel = next((t for t in map(telefono, phones or []) if t), None)
        items.append([
            id_[:16], nombre.strip(), rubro, round(lat, 5), round(lon, 5),
            tel[0] if tel else "", tel[1] if tel else "", tel[2] if tel else "",
            (direccion or "").strip(), (localidad or "").strip(),
            red_social(socials), (websites or [""])[0],
            round(confianza, 1),  # qué tan seguro está Overture de que el local existe (0 a 1)
        ])
        por_rubro[rubro] += 1
    items.sort(key=lambda it: (it[2], it[1]))
    return items, por_rubro


def main():
    version = ultima_version()
    indice_path = CARPETA / "indice.json"
    anterior = json.loads(indice_path.read_text(encoding="utf-8")) if indice_path.exists() else {}
    if anterior.get("version") == version and "--forzar" not in sys.argv:
        print(f"Ya está la última versión de Overture ({version}). Nada que hacer.")
        return
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    zonas = []
    for zona in ZONAS:
        items, por_rubro = armar_zona(con, version, zona)
        archivo = f"comercios-{zona['id']}.json"
        datos = {
            "version": version, "zona": zona["id"], "nombre": zona["nombre"],
            "campos": ["id", "nombre", "rubro", "lat", "lon", "wa", "tel", "tipo", "direccion", "localidad", "red", "web", "conf"],
            "items": items,
        }
        texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":"))
        (CARPETA / archivo).write_text(texto, encoding="utf-8")
        con_tel = sum(1 for it in items if it[5])
        print(f"{zona['nombre']}: {len(items)} comercios, {con_tel} con teléfono, {len(texto) / 1e6:.1f} MB")
        print("   " + ", ".join(f"{r['nombre']}: {por_rubro[r['id']]}" for r in RUBROS))
        zonas.append({"id": zona["id"], "nombre": zona["nombre"], "archivo": archivo, "cantidad": len(items),
                      "bytes": len(texto.encode("utf-8")), "bbox": zona["bbox"]})
    indice = {
        "version": version,
        "actualizado": date.today().isoformat(),
        "fuente": "Overture Maps Foundation (datos de Meta, Microsoft, Foursquare y otros)",
        "rubros": [{"id": r["id"], "nombre": r["nombre"]} for r in RUBROS],
        "zonas": zonas,
    }
    indice_path.write_text(json.dumps(indice, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Listo: Overture {version}")


if __name__ == "__main__":
    main()

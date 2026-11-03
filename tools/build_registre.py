#!/usr/bin/env python3
"""
Construit web/data/registre-ca.json à partir du Registre d'immatriculation des
aéronefs civils canadiens (Transport Canada, fichier carscurr.txt).

Usage : python3 tools/build_registre.py <dossier contenant carscurr.txt>

Le fichier produit ne contient AUCUNE donnée sur les propriétaires :
seulement la marque (C-XXXX), le constructeur, le modèle et le type SkyHunt
correspondant quand il existe dans le catalogue du jeu.

Colonnes utilisées (voir carslayout.txt) :
  0 MARK, 3 COMMON_NAME (constructeur), 4 MODEL_NAME, 10 AIRCRAFT_CATEGORY_E, 19 AIR_WEIGHT_KILOS
"""
import collections, csv, datetime, glob, json, os, re, sys

# Règles (ordre important) : (regex sur le constructeur ou None, regex sur le modèle, type SkyHunt)
RULES = [
    (None, r'BD-500-1A10', 'a220-100'),
    (None, r'BD-500-1A11', 'a220-300'),
    (r'AIRBUS', r'A ?319', 'a319'),
    (r'AIRBUS', r'A ?320', 'a320'),
    (r'AIRBUS', r'A ?321', 'a321'),
    (r'AIRBUS', r'A ?330', 'a330'),
    (r'AIRBUS', r'A ?350', 'a350'),
    (r'AIRBUS', r'A ?380', 'a380'),
    (r'BOEING', r'737-8[0-9A-Z]{2}', 'b737-800'),         # 737-800 (ex. 737-86N)
    (r'BOEING', r'737-8\b|737 ?MAX ?8', 'b737-max8'),
    (r'BOEING', r'737-7[0-9A-Z]{2}', 'b737-700'),
    (r'BOEING', r'737-[2-5][0-9A-Z]{2}', 'b737-classic'),
    (r'BOEING', r'757', 'b757'),
    (r'BOEING', r'767', 'b767'),
    (r'BOEING', r'777-F|777F', 'b777f'),
    (r'BOEING', r'777', 'b777'),
    (r'BOEING', r'787', 'b787'),
    (r'BOEING', r'747-8F', 'b747-8f'),
    (r'BOEING', r'747-4', 'b747-400'),
    (None, r'MD-11', 'md11'),
    (r'EMBRAER', r'ERJ ?170|EMB-17[05]|ERJ 175', 'e175'),
    (r'EMBRAER', r'ERJ ?190|EMB-19[05]|ERJ 195', 'e190'),
    (None, r'CL-?600-? ?2B19', 'crj200'),
    (None, r'CL-?600-? ?(2C1[01]|2D24|2D15|2E25)', 'crj900'),
    (None, r'CL-?600-? ?(1A11|2A12|2B16)|BD-100', 'challenger'),
    (None, r'BD-700', 'global'),
    (None, r'DHC-8-[12]\d\d', 'dash8-100'),
    (None, r'DHC-8-3\d\d', 'dash8-300'),
    (None, r'DHC-8-4\d\d', 'dash8-400'),
    (None, r'DHC-7', 'dash7'),
    (None, r'DHC-6', 'twin-otter'),
    (r'HAVILLAND|VIKING', r'DHC-2', 'beaver'),
    (r'HAVILLAND|VIKING', r'DHC-3', 'otter'),
    (None, r'ATR ?-?42', 'atr42'),
    (None, r'ATR ?-?72', 'atr72'),
    (r'SAAB', r'340', 'saab340'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^1900', 'b1900'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^(B?200|B?300|[A-F]?90|350|[AB]?100|B200GT|B300C)\b', 'king-air'),
    (None, r'SA-?22[67]|METRO', 'metro'),
    (r'PILATUS', r'PC-12', 'pc12'),
    (r'CESSNA|TEXTRON', r'^(R?172)', 'c172'),
    (r'CESSNA|TEXTRON', r'^208', 'caravan'),
    (r'CESSNA|TEXTRON', r'^(500|501|525[ABC]?|550|551|S550|560|560XLS?|650|680A?|700|750)\b', 'citation'),
    (r'PIPER', r'PA-28', 'pa28'),
    (r'LEAR|BOMBARDIER', r'^(2[345]|3[1-6]|4[05]|55|60|75)[A-Z]?\b', 'learjet'),
    (r'GULFSTREAM', r'GVI\b|G650|GULFSTREAM VI', 'g650'),
    (None, r'CL-?215|CL-?415|DHC-?515', 'cl415'),
    (None, r'^DC-?3|C-47', 'dc3'),
    (r'DASSAULT', r'FALCON', 'falcon'),
    (r'EMBRAER', r'EMB-50[05]|EMB-5[45]\d|PHENOM|PRAETOR|LEGACY', 'phenom'),
    (r'PILATUS', r'PC-24', 'pc24'),
    (r'AIR TRACTOR', r'AT-80\d', 'at802'),
    (r'FOKKER', r'F\.?28', 'f28'),
    (r'LOCKHEED', r'^188|ELECTRA', 'electra'),
    (r'CONVAIR|CONAIR', r'^(240|340|440|580|5800|640)|FIRECAT', 'convair'),
    (r'HAWKER SIDDELEY|AVRO|BRITISH AEROSPACE', r'748', 'hs748'),
    (r'BRITISH AEROSPACE|BAE', r'JETSTREAM', 'jetstream'),
    (r'DORNIER', r'228|328', 'dornier'),
    (r'BRITISH AEROSPACE|BAE|AVRO', r'146|RJ ?(70|85|100)', 'bae146'),
    (None, r'L-?382|C-130', 'c130'),
]
COMPILED = [(re.compile(m) if m else None, re.compile(r), t) for m, r, t in RULES]


def type_for(make, model):
    for mre, rre, t in COMPILED:
        if mre and not mre.search(make):
            continue
        if rre.search(model):
            return t
    return None


def clean(s):
    return ' '.join((s or '').split()).upper()


def main(folder):
    path = [p for p in glob.glob(os.path.join(folder, '*')) if os.path.basename(p).lower() == 'carscurr.txt'][0]
    models, model_idx, marks = [], {}, {}
    unmapped_heavy = collections.Counter()
    mapped = collections.Counter()
    with open(path, encoding='latin-1', newline='') as fh:
        for row in csv.reader(fh):
            if len(row) < 20 or not row[0].strip():
                continue
            if clean(row[10]) not in ('AEROPLANE', 'AÉROPLANE'):
                continue
            mark = clean(row[0])
            make, model = clean(row[3]), clean(row[4])
            t = type_for(make, model)
            key = (make, model)
            if key not in model_idx:
                model_idx[key] = len(models)
                models.append([make.title(), model, t])
            marks[mark] = model_idx[key]
            if t:
                mapped[t] += 1
            else:
                try:
                    kg = float(row[19] or 0)
                except ValueError:
                    kg = 0
                if kg >= 5700:
                    unmapped_heavy[f'{make} | {model}'] += 1

    out = {
        'date': datetime.date.today().isoformat(),
        'source': "Transport Canada – Registre d'immatriculation des aéronefs civils canadiens",
        'models': models,
        'marks': marks,
    }
    os.makedirs('web/data', exist_ok=True)
    with open('web/data/registre-ca.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(marks)} avions, {len(models)} modèles, {sum(mapped.values())} reliés à un type SkyHunt')
    print('Par type :', ', '.join(f'{k}={v}' for k, v in mapped.most_common()))
    print('Lourds (≥ 5 700 kg) non reliés, les plus fréquents :')
    for k, v in unmapped_heavy.most_common(60):
        print(f'  {v:4d}  {k}')


if __name__ == '__main__':
    main(sys.argv[1])

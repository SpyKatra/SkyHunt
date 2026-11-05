#!/usr/bin/env python3
"""
Construit web/data/registre-us.json à partir du registre des aéronefs de la FAA (États-Unis),
fichier « ReleasableAircraft.zip » (MASTER.txt + ACFTREF.txt).

Usage : python3 tools/build_registre_us.py <dossier contenant MASTER.txt et ACFTREF.txt>

Le fichier produit ne contient AUCUNE donnée sur les propriétaires ni sur les constructeurs amateurs : MASTER.txt contient des noms et
des adresses, mais seules les colonnes N-NUMBER, MFR MDL CODE et TYPE AIRCRAFT sont lues. On ne garde
que les avions (TYPE AIRCRAFT 4 = monomoteur, 5 = multimoteur) : marque N, constructeur, modèle et type
SkyHunt correspondant (mêmes règles que le registre canadien, tools/build_registre.py).

Format (compact : ≈ 250 000 avions) :
  { date, source, models: [[constructeur, modèle, type SkyHunt ou null], ...],
    marks: ["123AB 45C ...", ...] }   ← marks[i] = marques (sans le N) de models[i], séparées par des espaces
"""
import collections, csv, datetime, glob, json, os, sys

sys.path.insert(0, os.path.dirname(__file__))
from build_registre import anonymize, norm_model, type_for  # noqa: E402  (mêmes règles que le Canada)

AIRPLANES = {'4', '5'}  # FAA « TYPE AIRCRAFT » : 4 = Fixed wing single engine, 5 = Fixed wing multi engine


def find(folder, name):
    return [p for p in glob.glob(os.path.join(folder, '*')) if os.path.basename(p).upper() == name][0]


def rows(path):
    """Lignes du fichier FAA (CSV, en-tête avec espaces, BOM possible) en dictionnaires par nom de colonne."""
    with open(path, encoding='utf-8-sig', errors='replace', newline='') as fh:
        reader = csv.reader(fh)
        header = [h.strip().upper() for h in next(reader)]
        for r in reader:
            yield {h: (r[i].strip() if i < len(r) else '') for i, h in enumerate(header) if h}


def clean(s):
    return ' '.join((s or '').split()).upper()


def title(make):
    # « EMBRAER S A » → « Embraer S A », « TEXTRON AVIATION INC » → « Textron Aviation Inc »
    return make.title()


def main(folder):
    ref = {}
    for r in rows(find(folder, 'ACFTREF.TXT')):
        make = clean(r.get('MFR'))
        model = norm_model(make, clean(r.get('MODEL')))
        # Appareil non certifié (construction amateur, BUILD-CERT-IND 1) : le « constructeur » est souvent le nom
        # d'une personne. Il n'est jamais gardé (vie privée) : voir anonymize() dans build_registre.py.
        amateur = r.get('BUILD-CERT-IND', '').strip() == '1'
        ref[r['CODE']] = (make, model, r.get('TYPE-ACFT', ''), r.get('AC-WEIGHT', ''), amateur)

    planes = []
    for r in rows(find(folder, 'MASTER.TXT')):
        mark = clean(r.get('N-NUMBER'))
        code = r.get('MFR MDL CODE', '')
        if not mark or code not in ref:
            continue
        if (r.get('TYPE AIRCRAFT') or ref[code][2]) not in AIRPLANES:
            continue
        planes.append((mark, code))
    model_count = collections.Counter(ref[code][1] for _, code in planes)

    models, model_idx, groups = [], {}, []
    mapped = collections.Counter()
    unmapped_heavy = collections.Counter()
    n = 0
    for mark, code in planes:
        make, model, _, weight, amateur = ref[code]
        t = type_for(make, model)
        shown = title(make)
        if amateur:
            shown, model = anonymize(t, model, model_count[model], 'Construction amateur')
        key = (shown, model)
        if key not in model_idx:
            model_idx[key] = len(models)
            models.append([shown, model, t])
            groups.append([])
        groups[model_idx[key]].append(mark)
        n += 1
        if t:
            mapped[t] += 1
        elif weight.strip().upper() in ('CLASS 3', 'CLASS 4'):  # plus de 12 500 lb
            unmapped_heavy[f'{make} | {model}'] += 1

    out = {
        'date': datetime.date.today().isoformat(),
        'source': 'FAA – Aircraft Registry (États-Unis)',
        'models': models,
        'marks': [' '.join(sorted(g)) for g in groups],
    }
    os.makedirs('web/data', exist_ok=True)
    with open('web/data/registre-us.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{n} avions, {len(models)} modèles, {sum(mapped.values())} reliés à un type SkyHunt')
    print('Par type :', ', '.join(f'{k}={v}' for k, v in mapped.most_common()))
    print('Lourds (> 12 500 lb) non reliés, les plus fréquents :')
    for k, v in unmapped_heavy.most_common(60):
        print(f'  {v:5d}  {k}')


if __name__ == '__main__':
    main(sys.argv[1])

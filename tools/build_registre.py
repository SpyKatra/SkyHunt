#!/usr/bin/env python3
"""
Construit web/data/registre-ca.json à partir du Registre d'immatriculation des
aéronefs civils canadiens (Transport Canada, fichier carscurr.txt).

Usage : python3 tools/build_registre.py <dossier contenant carscurr.txt>

Le fichier produit ne contient AUCUNE donnée sur les propriétaires :
seulement la marque (C-XXXX), le constructeur, le modèle et le type SkyHunt
correspondant quand il existe dans le catalogue du jeu.
Avions de construction amateur et ultralégers : le « constructeur » est souvent le nom d'une personne
(le constructeur amateur). Il n'est jamais gardé : voir anonymize().

Colonnes utilisées (voir carslayout.txt) :
  0 MARK, 3 COMMON_NAME (constructeur), 4 MODEL_NAME, 8 BASIS_FOR_REGISTRATION, 10 AIRCRAFT_CATEGORY_E,
  19 AIR_WEIGHT_KILOS
"""
import collections, csv, datetime, glob, json, os, re, sys

# Règles (ordre important) : (regex sur le constructeur ou None, regex sur le modèle, type SkyHunt)
RULES = [
    # ---- Avions de ligne et cargos : ordre important (le plus précis d'abord)
    (None, r'BD-500-1A10', 'a220-100'),
    (None, r'BD-500-1A11', 'a220-300'),
    (r'AIRBUS', r'A300-?600ST|A300B4-608ST|BELUGA ?ST', 'beluga-st'),
    (r'AIRBUS', r'A330-743L|BELUGA ?XL', 'beluga-xl'),
    (r'AIRBUS', r'MRTT|KC-30|CC-330', 'a330mrtt'),
    (r'AIRBUS', r'A ?300', 'a300'),
    (r'AIRBUS', r'A ?310', 'a310'),
    (r'AIRBUS', r'A ?318', 'a318'),
    (r'AIRBUS', r'A ?319', 'a319'),
    (r'AIRBUS', r'A ?320', 'a320'),
    (r'AIRBUS', r'A ?321', 'a321'),
    (r'AIRBUS', r'A ?330', 'a330'),
    (r'AIRBUS', r'A ?340', 'a340'),
    (r'AIRBUS', r'A ?350', 'a350'),
    (r'AIRBUS', r'A ?380', 'a380'),
    (r'BOEING', r'LCF|DREAMLIFTER', 'dreamlifter'),
    (r'BOEING', r'^707|^720', 'b707'),
    (r'BOEING|MCDONNELL', r'^717', 'b717'),
    (r'BOEING', r'^727', 'b727'),
    (r'BOEING', r'737-(7|8|9|10)\b|737-8-?200|737 ?MAX', 'b737-max8'),
    (r'BOEING', r'737-[89][0-9A-Z]{2}', 'b737-800'),
    (r'BOEING', r'737-[67][0-9A-Z]{2}', 'b737-700'),
    (r'BOEING', r'737-[1-5][0-9A-Z]{2}|^737$', 'b737-classic'),
    (r'BOEING', r'747-8', 'b747-8f'),
    (r'BOEING', r'747-4', 'b747-400'),
    (r'BOEING', r'747-[123]|747SP', 'b747-classic'),
    (r'BOEING', r'757', 'b757'),
    (r'BOEING', r'767', 'b767'),
    (r'BOEING', r'777-F|777F', 'b777f'),
    (r'BOEING', r'777', 'b777'),
    (r'BOEING', r'787', 'b787'),
    (None, r'MD-11', 'md11'),
    (r'DOUGLAS|BOEING', r'DC-10|MD-10\b', 'dc10'),
    (r'DOUGLAS|BOEING', r'MD-8\d|MD-90|DC-9-8\d', 'md80'),
    (r'DOUGLAS', r'DC-9', 'dc9'),
    (r'DOUGLAS', r'DC-8', 'dc8'),
    (r'EMBRAER', r'135BJ|LEGACY|PHENOM|PRAETOR|EMB-50[05]|EMB-5[45]\d', 'phenom'),
    (r'EMBRAER', r'ERJ ?190-100 ?ECJ|LINEAGE', 'e190'),
    (r'EMBRAER|YABORA', r'ERJ ?170|EMB-17[05]|ERJ ?175', 'e175'),
    (r'EMBRAER|YABORA', r'ERJ ?190|EMB-19[05]|ERJ ?195', 'e190'),
    (r'EMBRAER', r'EMB-1[34]5|ERJ ?1[34][05]', 'erj145'),
    (r'EMBRAER', r'EMB-120|BRASILIA', 'emb120'),
    (r'EMBRAER', r'EMB-110|BANDEIRANTE', 'emb110'),
    (None, r'CL-?600-? ?2B19', 'crj200'),
    (None, r'CL-?600-? ?(2C1[01]|2D24|2D15|2E25)', 'crj900'),
    (None, r'CL-?600-? ?(1A11|2A12|2B16)|BD-100', 'challenger'),
    (None, r'BD-700', 'global'),
    (r'FOKKER', r'MARK ?0[17]00|MK ?0[17]00|F ?70\b|F ?100\b|FOKKER (70|100)', 'fokker100'),
    (r'FOKKER', r'F\.?28', 'f28'),
    (r'FOKKER|FAIRCHILD', r'F-?27|F ?50\b|F ?60\b|FH-?227', 'fokker50'),
    (r'BRITISH AEROSPACE|BAE|AVRO', r'146|RJ ?(70|85|100)', 'bae146'),
    (r'COMAC|AVIC', r'ARJ|C909|C919', 'comac'),
    (r'SUKHOI', r'.', 'superjet'),
    # ---- Régionaux
    (None, r'DHC-8-[12]\d\d', 'dash8-100'),
    (None, r'DHC-8-3\d\d', 'dash8-300'),
    (None, r'DHC-8-4\d\d', 'dash8-400'),
    (None, r'DHC-7', 'dash7'),
    (None, r'DHC-6', 'twin-otter'),
    (None, r'ATR ?-?42', 'atr42'),
    (None, r'ATR ?-?72', 'atr72'),
    (r'SAAB', r'2000', 'saab2000'),
    (r'SAAB', r'340', 'saab340'),
    (r'BRITISH AEROSPACE|BAE|HANDLEY', r'JETSTREAM|^3[12]\d\d|^4101', 'jetstream'),
    (r'DORNIER', r'228|328', 'dornier'),
    (r'HAWKER SIDDELEY|AVRO|BRITISH AEROSPACE', r'748', 'hs748'),
    (r'\bLET\b|AIRCRAFT INDUSTRIES', r'L-?4[12]0', 'let410'),
    (r'SHORT', r'SD3|SC-?7|SKYVAN|330|360|SHERPA', 'shorts'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^1900', 'b1900'),
    (r'BEECH', r'^[ABC]?99\b', 'beech99'),
    (None, r'SA-?22[67]|SA26|METRO|MERLIN', 'metro'),
    # ---- Cargos
    (r'LOCKHEED', r'^382|L-?100|L-382', 'l100'),
    (r'ANTONOV', r'124', 'an124'),
    (r'ILYUSHIN|ILIOUCHINE', r'76', 'il76'),
    # ---- Affaires
    (r'PILATUS', r'PC-12', 'pc12'),
    (r'PILATUS', r'PC-24', 'pc24'),
    (r'PILATUS', r'PC-6|PORTER', 'porter'),
    (r'PILATUS', r'PC-21', 'pc21'),
    (r'HAWKER|RAYTHEON|BEECH|BRITISH AEROSPACE|BAE|DE ?HAVILLAND|HAWKER SIDDELEY|MITSUBISHI|TEXTRON|NEXTANT',
     r'125|HAWKER ?[0-9]|^(750|800|850|900|1000|4000)(XP|A|B)?\b|^400A?\b|400XP|BEECHJET|MU-300|^390|PREMIER', 'hawker'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^(65-)?(A?65|70|[AB]?80|88)(-\d+)?$', 'queenair'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^(65-)?([A-F]?90|[AB]?100|[AB]?200(GT|C|CT|T)?|B?300C?|350|360)', 'king-air'),
    (r'CESSNA|TEXTRON', r'^(500|501|510|525[ABC]?|550|551|S550|560|560XLS?|650|680A?|700|750)\b', 'citation'),
    (r'LEAR|BOMBARDIER|GATES', r'^(2[3-9]|3[1-6]|4[05]|55|60|7[05])[A-Z]?\b', 'learjet'),
    (r'GULFSTREAM', r'GVI\b|G650|GULFSTREAM VI|GVII-G[78]00|G[78]00', 'g650'),
    (r'GULFSTREAM AMERICAN|GRUMMAN|^AMERICAN|TIGER', r'AA-1|AA-5|GA-7|AG-?5B', 'grumman-aa'),
    (r'GULFSTREAM|AERO COMMANDER|ROCKWELL|TWIN COMMANDER|COMMANDER', r'^(100|500|520|560|680|681|685|690|695|720|840|900|980|1000|112|114)', 'commander'),
    (r'GULFSTREAM|ISRAEL|IAI', r'G?1[05]0\b|G ?200|G ?280|GULFSTREAM ?(100|150|200|280)|ASTRA|GALAXY|112[3-6]|WESTWIND', 'g280'),
    (r'GULFSTREAM|GRUMMAN', r'^G-?1159|^G-?159|^G[IV]+\b|^G-[IV]+|^G[3-6][05]0|^GV|GULFSTREAM', 'gulfstream'),
    (r'DASSAULT', r'FALCON|MYSTERE', 'falcon'),
    (r'SOCATA|DAHER|EADS|TBM', r'TBM', 'tbm'),
    (r'HONDA', r'HA-?420|HONDAJET', 'hondajet'),
    (r'ECLIPSE', r'EA ?50|500|550', 'eclipse'),
    (r'CIRRUS', r'SF50|VISION', 'sf50'),
    (r'PIAGGIO', r'P-?180|AVANTI', 'avanti'),
    (r'MITSUBISHI', r'MU-2', 'mu2'),
    # ---- Aviation générale
    (r'CESSNA|TEXTRON', r'^408', 'skycourier'),
    (r'CESSNA|TEXTRON', r'^208', 'caravan'),
    (r'CESSNA|TEXTRON', r'^(T?303|T?310|320|335|340|[TFMP]?33[67]|40[124]|41[14]|42[15]|441)', 'cessna-twins'),
    (r'CESSNA|COLUMBIA|LANCAIR|TEXTRON', r'LC4[12]|^350\b|^400\b|T240', 'c400'),
    (r'CESSNA', r'^T?A?188', 'cessna-ag'),
    (r'CESSNA', r'^305|L-19|O-1', 'birddog'),
    (r'CESSNA', r'^(120|140)', 'c120'),
    (r'CESSNA', r'^[AF]?15[02]', 'c150'),
    (r'CESSNA', r'^162', 'c162'),
    (r'CESSNA', r'^170', 'c170'),
    (r'CESSNA|TEXTRON', r'^(R|FR?)?172', 'c172'),
    (r'CESSNA', r'^175', 'c175'),
    (r'CESSNA', r'^F?177', 'c177'),
    (r'CESSNA', r'^(180|A?185)', 'c180'),
    (r'CESSNA|TEXTRON', r'^(T?R?F?182)', 'c182'),
    (r'CESSNA', r'^19[05]', 'c195'),
    (r'CESSNA|TEXTRON', r'^(T?[UP]?20[567])', 'c206'),
    (r'CESSNA', r'^[TP]?210', 'c210'),
    (r'PIPER', r'PA-25|PA-36', 'piper-ag'),
    (r'PIPER|TAYLOR', r'^J-?3|PA-11|PA-18', 'cub'),
    (r'PIPER', r'PA-(12|14|15|16|17|20|22)\b|^J-?[245]', 'piper-classic'),
    (r'PIPER', r'PA-28', 'pa28'),
    (r'PIPER', r'PA-32', 'pa32'),
    (r'PIPER', r'PA-34', 'pa34'),
    (r'PIPER|SMITH|AEROSTAR', r'PA-23|PA-30|PA-39|PA-44|PA-60|^60[0-2]|^700P?\b|AEROSTAR', 'piper-twins'),
    (r'PIPER', r'PA-31|PA-42', 'pa31'),
    (r'PIPER', r'PA-24', 'pa24'),
    (r'PIPER', r'PA-38', 'pa38'),
    (r'PIPER', r'PA-46', 'pa46'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^[A-H]?18[A-Z]?\b|^C-?45', 'beech18'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'T-34|^[ABD]?45\b', 't34'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^[AB]?60\b', 'duke'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^(\d\d-)?[A-H]?(95|55)[A-Z]?\b|^G?58|56TC', 'baron'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^76\b|DUCHESS', 'duchess'),
    (r'BEECH', r'^[A-H]?17', 'staggerwing'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^[A-Z]?3[356][A-Z]?(TC)?\b|^V35', 'bonanza'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'^[A-C]? ?(23|24R?|19)[A-Z]?\b|^77\b|^A23-24', 'musketeer'),
    (r'BEECH|RAYTHEON|HAWKER|TEXTRON', r'T-6|TEXAN II|^3000', 't6'),
    (r'MOONEY', r'M-?20', 'mooney'),
    (r'CIRRUS', r'SR-?2[02]', 'cirrus'),
    (r'DIAMOND|HOAC', r'DA ?\d\d|DV ?20|HK ?36', 'diamond'),
    (r'SOCATA|MORANE|AEROSPATIALE|DAHER', r'MS ?8\d\d|RALLYE|TB[- ]?(9|10|20|21|200)\b', 'socata'),
    (r'ROBIN|CENTRE EST|APEX', r'DR|HR|R ?\d{4}', 'robin'),
    (r'AERONCA|CHAMPION|BELLANCA', r'^(7|8|11|15)[A-Z]|^65-|^0-58|^L-3', 'champion'),
    (r'BELLANCA', r'14-|17-', 'bellanca'),
    (r'LUSCOMBE|SILVAIRE', r'.', 'luscombe'),
    (r'ERCO|ALON|FORNEY|AIR PRODUCTS|UNIVERSAL|ENGINEERING', r'415|A-?2|F-?1|ERCOUPE|AIRCOUPE', 'ercoupe'),
    (r'TAYLORCRAFT', r'.', 'taylorcraft'),
    (r'STINSON', r'.', 'stinson'),
    (r'PIPER', r'108|STATION WAGON|VOYAGER', 'stinson'),
    (r'NAVION|RYAN|NORTH AMERICAN', r'NAVION|^NAV', 'navion'),
    (r'GLOBE|TEMCO', r'.', 'swift'),
    (r'MAULE', r'.', 'maule'),
    (r'HELIO', r'.', 'helio'),
    (r'CUBCRAFTERS|CUB CRAFTERS', r'.', 'cubcrafters'),
    (r'AVIAT|CHRISTEN|PITTS|AEROTEK', r'S-?[12]', 'pitts'),
    (r'AVIAT|CHRISTEN', r'A-1|HUSKY', 'husky'),
    (r'EXTRA', r'.', 'extra'),
    (r'MUDRY|APEX|CAP AVIATION', r'CAP', 'cap'),
    (r'TECNAM|COSTRUZIONI', r'.', 'tecnam'),
    (r'PIPISTREL', r'.', 'pipistrel'),
    (r'ICON', r'A5', 'icon'),
    (r'LAKE|REVOLUTION|CONSOLIDATED AERONAUTICS', r'LA-?4|250|270|BUCCANEER|RENEGADE', 'lake'),
    (r'FLIGHT DESIGN|CZECH|SLING|BRM|EVEKTOR|AEROPRO|PROGRESSIVE AERODYNE|TL-ULTRALIGHT|REMOS|JABIRU|ICP',
     r'.', 'lsa'),
    (r'QUAD CITY|LAZAIR|ULTRAFLIGHT|^BEAVER$|EIPPER|BIRDMAN|CANADIAN ULTRALIGHT|RSULTRA|KOLB|ULTRAVIA|AMERICAN AEROLIGHTS',
     r'.', 'ultraleger'),
    (r'EPIC', r'E1000|LT|DYNASTY', 'epic'),
    (r'REPUBLIC', r'RC-3|SEABEE', 'seabee'),
    (r"VAN'?S|VANS", r'RV', 'vans'),
    (r'ZENAIR|ZENITH|AMD|AIRCRAFT MFG', r'CH|ZODIAC|STOL|ALARUS|\d{3}', 'zenith'),
    (r'MURPHY', r'.', 'murphy'),
    (r'KITFOX|DENNEY|SKYSTAR|AVID', r'.', 'kitfox'),
    (r'GLASAIR|GLASTAR|STODDARD', r'.', 'glasair'),
    (r'LANCAIR', r'.', 'lancair'),
    # Construction amateur : le « constructeur » est souvent le nom du particulier ; le kit se lit dans le modèle.
    (None, r'^(VAN\'?S )?RV-? ?\d', 'vans'),
    (None, r'^(ZENITH |ZENAIR )?(CH ?\d{3}|ZODIAC)', 'zenith'),
    (None, r'KITFOX', 'kitfox'),
    (None, r'GLASAIR|GLASTAR', 'glasair'),
    (None, r'LANCAIR', 'lancair'),
    (r'FOUND', r'.', 'found'),
    (r'QUEST|KODIAK|DAHER', r'KODIAK|^100\b|^900\b', 'kodiak'),
    (r'HAVILLAND|VIKING', r'DHC-2', 'beaver'),
    (r'HAVILLAND|VIKING', r'DHC-3', 'otter'),
    (r'HAVILLAND', r'DHC-1(?!\d)', 'dhc1'),
    # ---- Missions spéciales
    (None, r'CL-?215|CL-?415|DHC-?515', 'cl415'),
    (r'BASLER', r'BT-?67', 'dc3'),
    (None, r'^DC-?3|C-47', 'dc3'),
    (r'AIR TRACTOR', r'AT-80\d', 'at802'),
    (r'AIR TRACTOR', r'AT-?[3456]0\d', 'air-tractor'),
    (r'AYRES|THRUSH|ROCKWELL|SNOW|SCHWEIZER|GRUMMAN|QUALITY|MARSH|AERO COMMANDER', r'S-?2R|THRUSH|G-?164|AG-?CAT|^510|^710', 'thrush'),
    (r'GRUMMAN|CONAIR|MARSH|DE ?HAVILLAND', r'^S-?2[A-GT]?\b|TRACKER|FIRECAT|CS2F', 'tracker'),
    (r'LOCKHEED', r'^188|ELECTRA', 'electra'),
    (r'CONVAIR|CONAIR|KELOWNA', r'^(240|340|440|580|5800|640|CV)', 'convair'),
    (r'CASA|CONSTRUCCIONES', r'212', 'casa212'),
    (r'CASA|CONSTRUCCIONES|AIRBUS', r'295|CN-?235', 'c295'),
    # ---- Collection
    (r'NOORDUYN', r'NORSEMAN|UC-64', 'norseman'),
    (r'NOORDUYN|NORTH AMERICAN|CANADIAN CAR|CAN CAR|CCF|HARVARD', r'HARVARD|AT-16|T-6|AT-6|SNJ|^4\b|MK', 'harvard'),
    (r'NORTH AMERICAN|CAVALIER|MUSTANG', r'P-?51|MUSTANG|TF-51', 'p51'),
    (r'NORTH AMERICAN', r'B-25|TB-25|MITCHELL', 'b25'),
    (r'NORTH AMERICAN', r'T-28|TROJAN', 't28'),
    (r'NORTH AMERICAN|CANADAIR', r'F-86|SABRE|CL-13', 'sabre'),
    (r'BOEING|STEARMAN', r'^[ABDE]?75(N|\b)|PT-?1[37]|N2S|STEARMAN', 'stearman'),
    (r'BOEING', r'B-17|^299', 'b17'),
    (r'BOEING', r'B-29', 'b29'),
    (r'DE ?HAVILLAND|\bDH\b', r'DH ?\.?82|TIGER ?MOTH', 'tigermoth'),
    (r'FLEET', r'.', 'fleet'),
    (r'FAIRCHILD', r'PT-?(19|23|26)|M-62|CORNELL', 'cornell'),
    (r'FAIRCHILD', r'^24|ARGUS|UC-61', 'fairchild24'),
    (r'WACO|CLASSIC AIRCRAFT', r'.', 'waco'),
    (r'GREAT LAKES', r'.', 'great-lakes'),
    (r'RYAN', r'PT-?2[012]|^ST', 'ryan-pt'),
    (r'GRUMMAN|MCKINNON', r'G-?(21|44|73|111)|HU-16|GOOSE|WIDGEON|MALLARD|ALBATROSS', 'grumman-amph'),
    (r'CONSOLIDATED|CANADIAN VICKERS', r'PBY|CANSO|28-5|CATALINA', 'canso'),
    (r'YAKOVLEV|IAV|AEROSTAR|NANCHANG', r'YAK|CJ-?6|52|18', 'yak'),
    (r'AERO VODOCHODY|^AERO\b', r'L-?29|L-?39', 'l39'),
    (r'LOCKHEED|CANADAIR', r'T-33|CT-133|SILVER STAR', 't33'),
    (r'VOUGHT|GOODYEAR', r'F4U|FG-1|CORSAIR', 'corsair'),
    (r'SUPERMARINE|VICKERS', r'SPITFIRE|361|379|389', 'spitfire'),
    (r'HAWKER', r'HURRICANE', 'hurricane'),
    (r'AVRO|VICTORY', r'LANCASTER|683', 'lancaster'),
    # ---- Militaires (rares au registre civil)
    (r'LOCKHEED', r'C-130|HERCULES', 'c130'),
    (r'DASSAULT|DORNIER', r'ALPHA ?JET', 'alphajet'),
    (r'CANADAIR', r'CL-41|TUTOR', 'ct114'),
]
COMPILED = [(re.compile(m) if m else None, re.compile(r), t) for m, r, t in RULES]


def norm_model(make, model):
    """Écritures irrégulières des registres : « PA 46-350P », « PA46 » → « PA-46-350P » ; Beech « E-55 » → « E55 »."""
    model = re.sub(r'^PA[ -]?(\d)', r'PA-\1', model)
    if 'BEECH' in make or 'RAYTHEON' in make:
        model = re.sub(r'^([A-H])-(\d)', r'\1\2', model)
    return model


def type_for(make, model):
    for mre, rre, t in COMPILED:
        if mre and not mre.search(make):
            continue
        if rre.search(model):
            return t
    return None


def family_makers():
    """Constructeur de chaque famille du catalogue (web/fleet.js) : « vans » → « Van’s Aircraft »."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'fleet.js')
    found = re.findall(r"^  \['([^']+)', '[^']*', '([^']*)'", open(path, encoding='utf-8').read(), re.M)
    assert len(found) > 200, 'familles de web/fleet.js introuvables'
    return dict(found)


FAMILY_MAKERS = family_makers()


def anonymize(t, model, model_count, label):
    """Avion amateur ou ultraléger (vie privée) : le constructeur d'origine n'est jamais gardé.
    Relié à une famille → constructeur de la famille ; modèle gardé seulement s'il est partagé par au moins
    2 avions (un modèle unique peut contenir un nom). Sinon → « Construction amateur » / « Ultraléger », sans modèle."""
    if t:
        return FAMILY_MAKERS.get(t, label), (model if model_count >= 2 else '')
    return label, ''


def clean(s):
    return ' '.join((s or '').split()).upper()


def main(folder):
    path = [p for p in glob.glob(os.path.join(folder, '*')) if os.path.basename(p).lower() == 'carscurr.txt'][0]
    models, model_idx, marks = [], {}, {}
    unmapped_heavy = collections.Counter()
    mapped = collections.Counter()
    planes = []
    with open(path, encoding='latin-1', newline='') as fh:
        for row in csv.reader(fh):
            if len(row) < 20 or not row[0].strip():
                continue
            if clean(row[10]) not in ('AEROPLANE', 'AÉROPLANE'):
                continue
            make = clean(row[3])
            planes.append((clean(row[0]), make, norm_model(make, clean(row[4])), row[8].upper(), row[19]))
    model_count = collections.Counter(p[2] for p in planes)
    for mark, make, model, basis, weight in planes:
        t = type_for(make, model)
        shown = make.title()
        if 'AMATEUR' in basis or 'ULTRA' in basis:
            shown, model = anonymize(t, model, model_count[model], 'Construction amateur' if 'AMATEUR' in basis else 'Ultraléger')
        key = (shown, model)
        if key not in model_idx:
            model_idx[key] = len(models)
            models.append([shown, model, t])
        marks[mark] = model_idx[key]
        if t:
            mapped[t] += 1
        else:
            try:
                kg = float(weight or 0)
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

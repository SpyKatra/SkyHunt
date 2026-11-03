#!/usr/bin/env python3
"""Première version : affiche les colonnes puis s'arrête (exploration du format)."""
import csv, glob, os, sys
d = sys.argv[1]
f = [p for p in glob.glob(os.path.join(d, '*')) if os.path.basename(p).lower() == 'carscurr.txt'][0]
with open(f, encoding='latin-1') as fh:
    for i, row in enumerate(csv.reader(fh)):
        if i >= 3: break
        for j, v in enumerate(row): print(i, j, repr(v.strip())[:60])
sys.exit(1)

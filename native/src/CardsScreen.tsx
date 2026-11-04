// Écran « Mes cartes » : cartes, album (complétion du catalogue) et photos refusées (web/ui-cards.js).
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AIRCRAFT, CATEGORIES, getType, RARITIES } from './shared';
import { useApp } from './store';
import { C, fmtDate } from './theme';
import type { Scored } from './types';
import { Bar, CardTile, LockedTile } from './ui';

type Filter = 'cards' | 'album' | 'refused';

export default function CardsScreen() {
  const { list, openDetail, toast } = useApp();
  const [filter, setFilter] = useState<Filter>('cards');
  const { width } = useWindowDimensions();
  const tileW = (width - 16 * 2 - 12) / 2;

  const valid = useMemo(() => list.filter((c) => c.valid), [list]);
  const refused = useMemo(() => list.filter((c) => !c.valid), [list]);
  const owned = useMemo(() => new Set(valid.map((c) => c.typeId).filter((id): id is string => !!id && id !== 'inconnu')), [valid]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={st.h1}>Mes cartes</Text>
      <Text style={st.sub}>{valid.length} cartes · {owned.size}/{AIRCRAFT.length} types · {refused.length} refusées</Text>
      <View style={st.chips}>
        {([['cards', 'Cartes'], ['album', 'Album'], ['refused', 'Refusées']] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setFilter(k)} style={[st.chip, filter === k && st.chipOn]}>
            <Text style={[st.chipText, filter === k && st.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {filter === 'cards' && (valid.length
        ? <Grid items={valid} width={tileW} render={(c) => <CardTile key={c.id} c={c} width={tileW} onPress={() => openDetail(c.id)} />} />
        : <Text style={st.empty}>Aucune carte pour l’instant. Va chasser ton premier avion !</Text>)}

      {filter === 'refused' && (refused.length
        ? refused.map((c) => <RefusedRow key={c.id} c={c} onPress={() => openDetail(c.id)} />)
        : <Text style={st.empty}>Aucune photo refusée.</Text>)}

      {filter === 'album' && <Album valid={valid} owned={owned} tileW={tileW} onOpen={openDetail} onLocked={(id) => {
        const t = getType(id);
        const r = RARITIES[t.rarity];
        toast(`${t.name} : ${r.label}, ${r.points} pts. Pas encore capturé !`);
      }} />}
    </ScrollView>
  );
}

function Grid<T>({ items, render }: { items: T[]; width: number; render: (item: T) => React.ReactElement }) {
  return <View style={st.grid}>{items.map(render)}</View>;
}

function Album({ valid, owned, tileW, onOpen, onLocked }: {
  valid: Scored[]; owned: Set<string>; tileW: number; onOpen: (id: string) => void; onLocked: (id: string) => void;
}) {
  const best: Record<string, Scored> = {};
  for (const c of valid) {
    if (!c.typeId || c.typeId === 'inconnu') continue;
    if (!best[c.typeId] || c.points > best[c.typeId].points) best[c.typeId] = c;
  }
  const pct = Math.round((owned.size / AIRCRAFT.length) * 100);
  return (
    <View>
      <View style={st.progress}>
        <View style={st.progressHead}><Text style={st.muted}>Album complété</Text><Text style={st.muted}>{pct} %</Text></View>
        <Bar value={pct / 100} />
      </View>
      {Object.entries(CATEGORIES).map(([cat, label]) => {
        const items = AIRCRAFT.filter((a) => a.category === cat);
        const got = items.filter((a) => best[a.id]).length;
        return (
          <View key={cat} style={{ marginTop: 18 }}>
            <Text style={st.h3}>{label} <Text style={st.muted}>{got}/{items.length}</Text></Text>
            <View style={st.grid}>
              {items.map((a) => best[a.id]
                ? <CardTile key={a.id} c={best[a.id]} width={tileW} showPoints={false} onPress={() => onOpen(best[a.id].id)} />
                : <LockedTile key={a.id} typeId={a.id} width={tileW} onPress={() => onLocked(a.id)} />)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function RefusedRow({ c, onPress }: { c: Scored; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={st.refused}>
      {c.photoUri ? <Image source={{ uri: c.photoUri }} style={st.refusedImg} /> : <View style={[st.refusedImg, { alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: C.dim }}>—</Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={st.refusedDate}>{fmtDate(c.takenAt, true)}</Text>
        <Text style={st.refusedMeta}>Confiance {Math.round(c.confidence * 100)} % · taille {Math.round(c.sizeRatio * 100)} % · netteté {Math.round(c.sharpness)}</Text>
        <Text style={st.reason}>{c.reasons.join(' · ')}</Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  h1: { color: C.text, fontSize: 28, fontWeight: '900' },
  h3: { color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  sub: { color: C.muted, marginTop: 4, marginBottom: 12 },
  muted: { color: C.muted, fontSize: 13, fontWeight: '500' },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: C.card },
  chipOn: { backgroundColor: C.text },
  chipText: { color: C.muted, fontWeight: '700', fontSize: 14 },
  chipTextOn: { color: C.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  empty: { color: C.muted, textAlign: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  progress: { backgroundColor: C.card, borderRadius: 12, padding: 12 },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  refused: { flexDirection: 'row', gap: 12, backgroundColor: C.card, borderRadius: 12, padding: 10, marginBottom: 8 },
  refusedImg: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#0d1526' },
  refusedDate: { color: C.text, fontWeight: '700' },
  refusedMeta: { color: C.muted, fontSize: 12, marginTop: 2 },
  reason: { color: C.bad, fontSize: 12, marginTop: 4 },
});

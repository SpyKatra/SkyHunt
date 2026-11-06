// Composants visuels communs (équivalents de web/ui-common.js et des styles de web/style.css).
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cardName, getType, nearestAirport, RARITIES } from './shared';
import { C, fmtDate } from './theme';
import type { Capture, Scored } from './types';

export function placeLabel(c: Capture) {
  const ap = nearestAirport(c.latitude, c.longitude);
  if (ap) return ap.code;
  if (c.latitude == null || c.longitude == null) return 'Lieu inconnu';
  return `${c.latitude.toFixed(2)}, ${c.longitude.toFixed(2)}`;
}
export function placeLong(c: Capture) {
  const ap = nearestAirport(c.latitude, c.longitude);
  const coords = c.latitude != null && c.longitude != null
    ? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)} (±${Math.round(c.accuracy || 0)} m)`
    : 'Position inconnue';
  return ap ? `${ap.name} (${ap.code}) · ${coords}` : coords;
}

/* ---------------- Boutons ---------------- */
type BtnProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'plain' | 'danger' | 'ghost' | 'ok';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
};
export function Btn({ label, onPress, kind = 'plain', disabled, busy, style }: BtnProps) {
  const bg = kind === 'primary' ? C.accent : kind === 'ok' ? C.ok : kind === 'ghost' ? 'transparent' : C.card;
  const color = kind === 'danger' ? C.bad : kind === 'ok' ? '#052e16' : kind === 'ghost' ? C.muted : C.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 },
        kind === 'ghost' && s.ghost, style,
      ]}
    >
      {busy ? <ActivityIndicator color={color} /> : <Text style={[s.btnText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

/* ---------------- Rareté ---------------- */
export function RarityPill({ typeId, withPoints = false }: { typeId: string | null; withPoints?: boolean }) {
  const t = getType(typeId);
  const r = RARITIES[t.rarity];
  return (
    <View style={[s.pill, { backgroundColor: r.color }]}>
      <Text style={s.pillText}>{t.id === 'inconnu' ? 'Mystère' : r.label}{withPoints ? ` · ${r.points}` : ''}</Text>
    </View>
  );
}

/* ---------------- Carte de collection ---------------- */
export function CardTile({ c, showPoints = true, onPress, width }: { c: Scored; showPoints?: boolean; onPress?: () => void; width: number }) {
  const t = getType(c.typeId);
  const r = RARITIES[t.rarity];
  return (
    <Pressable onPress={onPress} style={[s.card, { width, borderColor: r.color, shadowColor: r.color }]}>
      <View style={[s.cardImg, { height: width * 0.78 }]}>
        {c.photoUri ? <Image source={{ uri: c.photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={s.noPhoto}>✈</Text>}
        <View style={[s.cardRarity, { backgroundColor: r.color }]}><Text style={s.cardRarityText}>{t.id === 'inconnu' ? 'Mystère' : r.label}</Text></View>
        {showPoints && <View style={s.cardPts}><Text style={s.cardPtsText}>{c.points} pts</Text></View>}
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardName} numberOfLines={1}>{cardName(c)}</Text>
        <Text style={s.cardMaker} numberOfLines={1}>{t.maker}{c.registration ? ` · ${c.registration}` : ''}</Text>
        <View style={s.cardFoot}>
          <Text style={s.cardFootText}>{placeLabel(c)}</Text>
          <Text style={s.cardFootText}>{fmtDate(c.takenAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Case d'album pour un type pas encore capturé. */
export function LockedTile({ typeId, width, onPress }: { typeId: string; width: number; onPress?: () => void }) {
  const t = getType(typeId);
  const r = RARITIES[t.rarity];
  return (
    <Pressable onPress={onPress} style={[s.card, s.locked, { width }]}>
      <View style={[s.cardImg, { height: width * 0.78, backgroundColor: '#0d1526' }]}>
        <Text style={[s.noPhoto, { opacity: 0.25 }]}>?</Text>
        <View style={[s.cardRarity, { backgroundColor: r.color, opacity: 0.6 }]}><Text style={s.cardRarityText}>{r.label}</Text></View>
      </View>
      <View style={s.cardBody}>
        <Text style={[s.cardName, { color: C.muted }]} numberOfLines={1}>{t.name}</Text>
        <Text style={s.cardMaker} numberOfLines={1}>{t.maker}</Text>
      </View>
    </Pressable>
  );
}

/* ---------------- Détail des points ---------------- */
export function Breakdown({ c }: { c: Scored }) {
  const b = c.breakdown;
  if (!b) return null;
  if (b.blocked) {
    return (
      <View style={s.breakdown}>
        <View style={s.bLine}><Text style={s.bKey}>{b.blocked}</Text><Text style={s.bVal}>0 pt</Text></View>
        <View style={[s.bLine, s.bTotal]}><Text style={s.bTotalText}>Total</Text><Text style={s.bTotalText}>0 pt</Text></View>
      </View>
    );
  }
  const fr = (n: number) => String(n).replace('.', ',');
  const lines: [string, string][] = [['Appareil', `${b.aircraft} pts`], ['Lieu', `${b.place} pt`]];
  if (b.Q !== 1) lines.push(['Photo excellente', `×${fr(b.Q)}`]);
  if (b.R !== 1) lines.push([`Déjà capturé ${b.repeat} fois`, `×${fr(b.R)}`]);
  if (b.bonus) lines.push(['Nouveau type dans ta flotte', `+${b.bonus}`]);
  if (b.seriesBonus) lines.push([`Nouvelle série : ${b.series}`, `+${b.seriesBonus}`]);
  if (b.regSeen) lines.push(['Immatriculation déjà capturée', '0 pt']);
  return (
    <View style={s.breakdown}>
      {lines.map(([k, v]) => (
        <View key={k} style={s.bLine}><Text style={s.bKey}>{k}</Text><Text style={s.bVal}>{v}</Text></View>
      ))}
      <View style={[s.bLine, s.bTotal]}><Text style={s.bTotalText}>Total</Text><Text style={s.bTotalText}>{c.points} pts</Text></View>
    </View>
  );
}

/* ---------------- Barre de progression ---------------- */
export function Bar({ value, color = C.accent, height = 8 }: { value: number; color?: string; height?: number }) {
  return (
    <View style={[s.bar, { height }]}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

/* ---------------- Fiche (feuille modale) ---------------- */
export function Sheet({ visible, title, onClose, children, scroll = true }: {
  visible: boolean; title: string; onClose: () => void; children: ReactNode; scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle} numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} style={s.close} hitSlop={10}><Text style={s.closeText}>✕</Text></Pressable>
        </View>
        {scroll ? <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView> : children}
      </View>
    </Modal>
  );
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View pointerEvents="none" style={s.toast}><Text style={s.toastText}>{text}</Text></View>
  );
}

export const s = StyleSheet.create({
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  ghost: { borderWidth: 1, borderStyle: 'dashed', borderColor: C.border },
  btnText: { fontSize: 15, fontWeight: '700' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { color: '#0b1220', fontSize: 11, fontWeight: '800' },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 2, overflow: 'hidden', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  locked: { borderColor: C.line, borderStyle: 'dashed', shadowOpacity: 0 },
  cardImg: { backgroundColor: '#0d1526', alignItems: 'center', justifyContent: 'center' },
  noPhoto: { color: C.dim, fontSize: 34 },
  cardRarity: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  cardRarityText: { color: '#0b1220', fontSize: 10, fontWeight: '800' },
  cardPts: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(11,18,32,0.85)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  cardPtsText: { color: C.text, fontSize: 11, fontWeight: '800' },
  cardBody: { padding: 9 },
  cardName: { color: C.text, fontWeight: '800', fontSize: 14 },
  cardMaker: { color: C.muted, fontSize: 11, marginTop: 2 },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  cardFootText: { color: C.dim, fontSize: 10 },
  breakdown: { backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 6 },
  bLine: { flexDirection: 'row', justifyContent: 'space-between' },
  bKey: { color: C.text2, fontSize: 14 },
  bVal: { color: C.text, fontSize: 14, fontWeight: '600' },
  bTotal: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 8, marginTop: 2 },
  bTotalText: { color: C.text, fontSize: 16, fontWeight: '800' },
  bar: { backgroundColor: C.line, borderRadius: 8, overflow: 'hidden' },
  sheet: { flex: 1, backgroundColor: C.bg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  sheetTitle: { flex: 1, color: C.text, fontSize: 19, fontWeight: '800' },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: C.muted, fontSize: 15 },
  toast: { position: 'absolute', bottom: 110, alignSelf: 'center', backgroundColor: 'rgba(11,18,32,0.95)', borderColor: C.border, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, maxWidth: '90%' },
  toastText: { color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});

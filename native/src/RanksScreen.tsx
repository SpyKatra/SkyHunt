// Écran « Classement » : mondial, national (pays du compte) et du mois, calculés par le serveur
// (fonction `leaderboard`, voir supabase/migrations/20261104120000_classements.sql et web/ui-ranks.js).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchLeaderboard } from './cloud';
import { COUNTRY_NAMES } from './ProfileScreen';
import { useApp } from './store';
import { C } from './theme';
import type { RankRow } from './types';

type Scope = 'monde' | 'pays' | 'mois';

/** Drapeau à partir du code ISO (lettres régionales Unicode). */
export const flag = (cc?: string | null) =>
  (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc!].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : '');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export default function RanksScreen({ onGoProfile }: { onGoProfile: () => void }) {
  const { cloud, list } = useApp();
  const [scope, setScope] = useState<Scope>('monde');
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Record<string, { rows: RankRow[]; at: number }>>({});

  const online = !!(cloud.user && cloud.profile);
  const country = cloud.profile?.country ?? null;
  const now = new Date();
  const month = `${now.toISOString().slice(0, 7)}-01`;
  const key = scope === 'pays' ? `pays:${country}` : scope === 'mois' ? `mois:${month}` : 'monde';
  const title = scope === 'pays' ? `${flag(country)} ${COUNTRY_NAMES[country ?? ''] ?? country}`
    : scope === 'mois' ? `Mois de ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}` : 'Monde';

  const load = useCallback(async (force = false) => {
    if (!online) return;
    const hit = cache.current[key];
    if (hit) setRows(hit.rows);
    if (!force && hit && Date.now() - hit.at < 60000) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchLeaderboard(scope === 'pays' ? { country } : scope === 'mois' ? { month } : {});
      cache.current[key] = { rows: r, at: Date.now() };
      setRows(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [online, key, scope, country, month]);

  useEffect(() => { setRows(cache.current[key]?.rows ?? null); load(); }, [key, load]);
  // Les points changent après une synchro ou une capture : on relira le classement.
  useEffect(() => { cache.current = {}; }, [list]);

  if (!online) {
    return (
      <View style={st.empty}>
        <Text style={st.h1}>Classements</Text>
        <Text style={st.muted}>
          Crée un compte (ou connecte-toi) pour comparer tes points avec les autres chasseurs : classement mondial, national et du mois.
        </Text>
        <Pressable style={st.btn} onPress={onGoProfile}><Text style={st.btnText}>Aller au compte</Text></Pressable>
      </View>
    );
  }

  const tabs: [Scope, string][] = [['monde', 'Monde'], ['pays', `${flag(country)} Pays`], ['mois', 'Ce mois-ci']];
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading && rows != null} onRefresh={() => load(true)} tintColor="#fff" />}
    >
      <View style={st.seg}>
        {tabs.map(([k, l]) => (
          <Pressable key={k} onPress={() => setScope(k)} style={[st.segBtn, scope === k && st.segOn]}>
            <Text style={[st.segText, scope === k && st.segTextOn]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={st.h2}>{title}</Text>
      {rows == null && loading && <ActivityIndicator color="#fff" style={{ marginTop: 20 }} />}
      {rows == null && !loading && error && <Text style={st.muted}>Classement indisponible : {error}. Tire vers le bas pour réessayer.</Text>}
      {rows != null && rows.length === 0 && <Text style={st.muted}>Personne n'a encore marqué de points ici. À toi de jouer !</Text>}
      {rows?.map((r, i) => {
        const gap = i > 0 && r.rank > rows[i - 1].rank + 1;
        const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : String(r.rank);
        return (
          <View key={`${r.rank}-${r.pseudo}`}>
            {gap && <Text style={st.gap}>…</Text>}
            <View style={[st.row, r.isMe && st.me]}>
              <Text style={st.rank}>{medal}</Text>
              <Text style={st.name} numberOfLines={1}>
                {flag(r.country)} {r.pseudo}{r.isMe ? <Text style={st.toi}> (toi)</Text> : null}
              </Text>
              <Text style={st.cap}>{r.captures} carte{r.captures > 1 ? 's' : ''}</Text>
              <Text style={st.pts}>{r.points}</Text>
            </View>
          </View>
        );
      })}
      <Text style={st.note}>
        Points recalculés par le serveur. Lieu : 5 points pour un lieu jamais capturé, puis moins à mesure que les chasseurs y passent.
        {scope === 'mois' ? ' Mois en temps universel (UTC).' : ''}
      </Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  empty: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  h1: { color: C.text, fontSize: 22, fontWeight: '900' },
  h2: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 18, marginBottom: 10 },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  btn: { backgroundColor: C.accent, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  seg: { flexDirection: 'row', gap: 6, padding: 4, backgroundColor: C.card, borderRadius: 12 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segOn: { backgroundColor: C.accent },
  segText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  segTextOn: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.card, marginBottom: 6 },
  me: { backgroundColor: 'rgba(59,130,246,0.18)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.6)' },
  rank: { width: 30, textAlign: 'center', color: C.muted, fontWeight: '800', fontSize: 15 },
  name: { flex: 1, color: C.text, fontWeight: '600', fontSize: 15 },
  toi: { color: C.muted, fontWeight: '500' },
  cap: { color: C.muted, fontSize: 12 },
  pts: { minWidth: 44, textAlign: 'right', color: C.text, fontWeight: '900', fontSize: 16 },
  gap: { textAlign: 'center', color: C.muted, marginBottom: 4 },
  note: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 18, lineHeight: 17 },
});

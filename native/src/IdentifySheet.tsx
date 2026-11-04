// Fiche « Quel avion as-tu capturé ? » (équivalent de web/ui-identify.js)
// 1. L'immatriculation est lue automatiquement sur la photo (reconnaissance de texte du téléphone).
// 2. Si c'est une marque canadienne, le registre de Transport Canada donne le modèle exact.
// 3. Le joueur confirme d'une touche, ou choisit lui-même dans le catalogue.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { readRegistration } from './ocr';
import { AIRCRAFT, CATEGORIES, getType, lookupRegistration, normalizeRegistration, RARITIES, type Lookup } from './shared';
import { useApp } from './store';
import { C } from './theme';
import { Btn, Sheet } from './ui';

type Auto =
  | { state: 'idle' }
  | { state: 'reading' }
  | { state: 'none'; message: string }
  | { state: 'found'; registration: string; source: string; lookup: Lookup | null };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export default function IdentifySheet() {
  const { identifyReq, ownedTypes } = useApp();
  const capture = identifyReq?.capture ?? null;
  const [query, setQuery] = useState('');
  const [reg, setReg] = useState('');
  const [auto, setAuto] = useState<Auto>({ state: 'idle' });
  const session = useRef(0);
  const regTouched = useRef(false);
  const owned = useMemo(() => (capture ? ownedTypes() : new Set<string>()), [capture, ownedTypes]);

  async function showLookup(r: string, source: string, my: number) {
    const n = normalizeRegistration(r);
    const lookup = await lookupRegistration(n);
    if (my !== session.current) return;
    setAuto({ state: 'found', registration: n, source, lookup });
  }

  // Ouverture de la fiche : lecture automatique.
  useEffect(() => {
    if (!capture) return;
    const my = ++session.current;
    regTouched.current = false;
    setQuery('');
    setReg(capture.registration || '');
    if (capture.registration) {
      showLookup(capture.registration, capture.registrationSource || 'manuel', my);
    } else if (capture.photoUri) {
      setAuto({ state: 'reading' });
      readRegistration(capture.photoUri, capture.box)
        .then((r) => {
          if (my !== session.current) return;
          if (!r.registration) {
            setAuto({ state: 'none', message: 'Aucune immatriculation lisible sur la photo. Choisis le type ci-dessous ou tape l’immatriculation.' });
            return;
          }
          if (!regTouched.current) setReg(r.registration);
          showLookup(r.registration, 'ocr', my);
        })
        .catch(() => {
          if (my === session.current) setAuto({ state: 'none', message: 'Lecture automatique indisponible. Choisis le type ci-dessous.' });
        });
    } else {
      setAuto({ state: 'idle' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);

  // Saisie manuelle de l'immatriculation : recherche au registre après une courte pause.
  useEffect(() => {
    if (!capture || !regTouched.current) return;
    const my = session.current;
    const t = setTimeout(() => {
      if (normalizeRegistration(reg).length >= 5) showLookup(reg, 'manuel', my);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg]);

  function finish(typeId: string) {
    if (!identifyReq) return;
    session.current++;
    const typed = normalizeRegistration(reg) || null;
    const fromAuto = auto.state === 'found' && typed === auto.registration;
    identifyReq.resolve({
      typeId,
      registration: typed,
      registrationSource: typed ? (fromAuto && auto.state === 'found' ? auto.source : 'manuel') : null,
      registryModel: fromAuto && auto.state === 'found' && auto.lookup ? auto.lookup.label : null,
    });
  }

  const suggested = auto.state === 'found' && auto.lookup?.typeId ? auto.lookup.typeId : null;
  const nq = norm(query);
  const matches = AIRCRAFT.filter((a) => !nq || norm(`${a.name} ${a.maker} ${a.id}`).includes(nq));

  return (
    <Sheet visible={!!capture} title="Quel avion as-tu capturé ?" onClose={() => finish('inconnu')}>
      {capture?.photoUri ? <Image source={{ uri: capture.photoUri }} style={st.photo} resizeMode="cover" /> : null}

      <AutoBox auto={auto} onConfirm={(id) => finish(id)} />

      <TextInput
        style={st.input}
        placeholder="Rechercher (ex. Dash 8, A320, Saab)"
        placeholderTextColor={C.dim}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <TextInput
        style={st.input}
        placeholder="Immatriculation (facultatif, ex. C-GKUG)"
        placeholderTextColor={C.dim}
        value={reg}
        onChangeText={(v) => { regTouched.current = true; setReg(v); }}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {matches.length === 0 && <Text style={st.empty}>Aucun type trouvé. Choisis « Je ne sais pas ».</Text>}
      {Object.entries(CATEGORIES).map(([cat, label]) => {
        const items = matches.filter((a) => a.category === cat);
        if (!items.length) return null;
        return (
          <View key={cat}>
            <Text style={st.cat}>{label}</Text>
            {items.map((a) => {
              const r = RARITIES[a.rarity];
              return (
                <Pressable key={a.id} onPress={() => finish(a.id)} style={({ pressed }) => [st.row, suggested === a.id && st.rowSugg, pressed && { opacity: 0.7 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowName}>{a.name}{owned.has(a.id) ? <Text style={st.owned}>  ✓ déjà dans ta flotte</Text> : null}</Text>
                    <Text style={st.rowMaker}>{a.maker}</Text>
                  </View>
                  <View style={[st.rar, { backgroundColor: r.color }]}><Text style={st.rarText}>{r.label} · {r.points}</Text></View>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      <Btn kind="ghost" label="Je ne sais pas — garder en « Avion mystère »" onPress={() => finish('inconnu')} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

function AutoBox({ auto, onConfirm }: { auto: Auto; onConfirm: (typeId: string) => void }) {
  if (auto.state === 'idle') return null;
  if (auto.state === 'reading') {
    return (
      <View style={st.auto}>
        <ActivityIndicator color={C.muted} />
        <Text style={[st.src, { marginTop: 0, marginLeft: 10 }]}>Lecture de l’immatriculation…</Text>
      </View>
    );
  }
  if (auto.state === 'none') return <View style={st.auto}><Text style={st.src}>{auto.message}</Text></View>;

  const srcLabel = auto.source === 'ocr' ? 'Lue automatiquement sur la photo' : 'Saisie manuelle';
  const lk = auto.lookup;
  if (lk && lk.typeId) {
    const t = getType(lk.typeId);
    const r = RARITIES[t.rarity];
    return (
      <View style={[st.auto, st.autoFound]}>
        <View style={{ flex: 1 }}>
          <Text style={st.reg}>{auto.registration}</Text>
          <Text style={st.model}>{lk.label}</Text>
          <Text style={st.src}>{srcLabel} · registre de Transport Canada du {lk.date}</Text>
          <Btn kind="ok" label={`Confirmer : ${t.name} · ${r.label}`} onPress={() => onConfirm(lk.typeId!)} style={{ marginTop: 10 }} />
        </View>
      </View>
    );
  }
  const foreign = !/^C-/.test(auto.registration);
  return (
    <View style={[st.auto, st.autoPartial]}>
      <View style={{ flex: 1 }}>
        <Text style={st.reg}>{auto.registration}</Text>
        {lk ? <Text style={st.model}>{lk.label}</Text> : null}
        <Text style={st.src}>
          {srcLabel} · {lk
            ? 'ce modèle n’est pas encore dans le catalogue SkyHunt : choisis le type le plus proche, ou « Je ne sais pas ».'
            : foreign
              ? 'immatriculation étrangère : le registre canadien ne la couvre pas encore. Choisis le type ci-dessous.'
              : 'introuvable au registre canadien, vérifie les lettres. Choisis le type ci-dessous.'}
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  photo: { width: '100%', height: 190, borderRadius: 12, marginBottom: 12, backgroundColor: C.card },
  auto: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  autoFound: { borderColor: C.ok, backgroundColor: 'rgba(34,197,94,0.08)' },
  autoPartial: { borderColor: C.warn, backgroundColor: 'rgba(245,158,11,0.07)' },
  reg: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  model: { color: C.text2, fontSize: 15, marginTop: 2 },
  src: { color: C.muted, fontSize: 12, marginTop: 4, flexShrink: 1 },
  input: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, color: C.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  empty: { color: C.muted, textAlign: 'center', padding: 20 },
  cat: { color: C.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10, padding: 12, marginBottom: 6 },
  rowSugg: { borderWidth: 2, borderColor: C.ok },
  rowName: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowMaker: { color: C.muted, fontSize: 12, marginTop: 2 },
  owned: { color: C.ok, fontSize: 11, fontWeight: '600' },
  rar: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginLeft: 8 },
  rarText: { color: '#0b1220', fontSize: 11, fontWeight: '800' },
});

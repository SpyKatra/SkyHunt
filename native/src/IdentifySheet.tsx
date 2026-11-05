// Fiche « Quel avion as-tu capturé ? » (équivalent de web/ui-identify.js)
// 1. L'immatriculation est lue automatiquement sur la photo (reconnaissance de texte du téléphone).
// 2. Si c'est une marque canadienne (C-) ou américaine (N), le registre de Transport Canada ou de la FAA
//    donne le modèle exact.
// 3. Le joueur confirme d'une touche, ou choisit lui-même dans le catalogue.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { cloudState } from './cloud';
import { readRegistration } from './ocr';
import {
  acceptMilitary, AIRCRAFT, CATEGORIES, getType, lookupRegistration, MILITARY_FORBIDDEN_TEXT, MILITARY_WARNING,
  militaryGate, normalizeRegistration, notFoundMessage, RARITIES, REGISTRY_NAMES, type Lookup,
} from './shared';
import type { Capture } from './types';
import { useApp } from './store';
import { C } from './theme';
import { Btn, Sheet } from './ui';

type Auto =
  | { state: 'idle' }
  | { state: 'reading' }
  | { state: 'none'; message: string }
  | { state: 'found'; registration: string; source: string; lookup: Lookup | null };

/** Pays où la photo a été prise (position de la capture), sinon celui du profil, sinon inconnu. */
async function captureCountry(c: Capture): Promise<string | null> {
  if (c.latitude != null && c.longitude != null) {
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude: c.latitude, longitude: c.longitude });
      if (place?.isoCountryCode) return place.isoCountryCode.toUpperCase();
    } catch { /* hors ligne : on se rabat sur le profil */ }
  }
  return cloudState().profile?.country ?? null;
}

const ask = (title: string, message: string, buttons: { text: string; value: boolean; style?: 'cancel' }[]) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(title, message, buttons.map((b) => ({ text: b.text, style: b.style, onPress: () => resolve(b.value) })),
      { cancelable: true, onDismiss: () => resolve(false) });
  });

/** Avertissement militaire : date d'acceptation, ou null si le joueur annule ou si c'est interdit dans ce pays. */
async function militaryAck(c: Capture): Promise<string | null> {
  if (c.militaryAckAt) return c.militaryAckAt;
  const gate = militaryGate(await captureCountry(c));
  if (gate.blocked) {
    await ask('⛔ Appareil militaire', MILITARY_FORBIDDEN_TEXT, [{ text: 'Choisir un autre type', value: false }]);
    return null;
  }
  if (!gate.ask) return gate.ackAt ?? acceptMilitary();
  const note = gate.policy === 'restreint'
    ? 'Pays avec restrictions (ou inconnu) : avertissement à accepter à chaque photo.'
    : 'Accepté une fois pour cette session.';
  const ok = await ask('⚠ Appareil militaire détecté',
    `${MILITARY_WARNING.replace(/^Appareil militaire détecté\. /, '')}\n\n${note} Ton acceptation est enregistrée avec la date et l’heure. Ta position n’est jamais publique.`,
    [{ text: 'Annuler', value: false, style: 'cancel' }, { text: 'Je comprends, continuer', value: true }]);
  return ok ? acceptMilitary() : null;
}

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

  const checking = useRef(false);
  async function finish(typeId: string) {
    if (!identifyReq || checking.current) return;
    let militaryAckAt = identifyReq.capture.militaryAckAt ?? null;
    if (getType(typeId).category === 'militaire') {
      checking.current = true;
      militaryAckAt = await militaryAck(identifyReq.capture).finally(() => { checking.current = false; });
      if (!militaryAckAt) return; // la fiche reste ouverte : autre type ou « Je ne sais pas »
    }
    session.current++;
    const typed = normalizeRegistration(reg) || null;
    const fromAuto = auto.state === 'found' && typed === auto.registration;
    identifyReq.resolve({
      typeId,
      registration: typed,
      registrationSource: typed ? (fromAuto && auto.state === 'found' ? auto.source : 'manuel') : null,
      registryModel: fromAuto && auto.state === 'found' && auto.lookup ? auto.lookup.label : null,
      militaryAckAt,
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
          <Text style={st.src}>{srcLabel} · {REGISTRY_NAMES[lk.registry]} du {lk.date}</Text>
          <Btn kind="ok" label={`Confirmer : ${t.name} · ${r.label}`} onPress={() => onConfirm(lk.typeId!)} style={{ marginTop: 10 }} />
        </View>
      </View>
    );
  }
  return (
    <View style={[st.auto, st.autoPartial]}>
      <View style={{ flex: 1 }}>
        <Text style={st.reg}>{auto.registration}</Text>
        {lk ? <Text style={st.model}>{lk.label}</Text> : null}
        <Text style={st.src}>
          {srcLabel} · {lk
            ? `${REGISTRY_NAMES[lk.registry]} · ce modèle n’est pas encore dans le catalogue SkyHunt : choisis le type le plus proche, ou « Je ne sais pas ».`
            : `${notFoundMessage(auto.registration)} Choisis le type ci-dessous.`}
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

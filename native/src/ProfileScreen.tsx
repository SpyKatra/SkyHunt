// Écran « Profil » : niveau, XP, statistiques, succès, compte et réglages (web/ui-profile.js).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteAccount, saveRemoteProfile, sendCode, signOut, sync, type CloudState } from './cloud';
import FriendsSection from './FriendsSection';
import { achievementState, computeStats, levelFor, RARITIES, type RarityKey } from './shared';
import { useApp } from './store';
import { C } from './theme';
import { Bar, Btn, Sheet } from './ui';
import { verifyCode } from './cloud';

// Pays du classement national (codes ISO 3166-1), noms en français.
export const COUNTRY_NAMES: Record<string, string> = {
  CA: 'Canada', US: 'États-Unis', FR: 'France', BE: 'Belgique', CH: 'Suisse', LU: 'Luxembourg', MC: 'Monaco',
  GB: 'Royaume-Uni', IE: 'Irlande', DE: 'Allemagne', ES: 'Espagne', IT: 'Italie', PT: 'Portugal', NL: 'Pays-Bas',
  AT: 'Autriche', DK: 'Danemark', SE: 'Suède', NO: 'Norvège', FI: 'Finlande', PL: 'Pologne', CZ: 'Tchéquie',
  GR: 'Grèce', MA: 'Maroc', DZ: 'Algérie', TN: 'Tunisie', SN: 'Sénégal', CI: 'Côte d’Ivoire', CM: 'Cameroun',
  HT: 'Haïti', MX: 'Mexique', BR: 'Brésil', AR: 'Argentine', CL: 'Chili', AU: 'Australie', NZ: 'Nouvelle-Zélande',
  JP: 'Japon', KR: 'Corée du Sud', SG: 'Singapour', AE: 'Émirats arabes unis', IN: 'Inde', ZA: 'Afrique du Sud',
};
const COUNTRIES = Object.entries(COUNTRY_NAMES).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
const LOCAL_KEY = 'skyhunt.profile';

type LocalProfile = { name: string; country: string };

export default function ProfileScreen() {
  const { list, cloud, clearAll, toast, reload } = useApp();
  const [local, setLocal] = useState<LocalProfile>({ name: 'Joueur', country: 'CA' });

  useEffect(() => {
    AsyncStorage.getItem(LOCAL_KEY).then((v) => { if (v) setLocal((p) => ({ ...p, ...JSON.parse(v) })); }).catch(() => {});
  }, []);
  const saveLocal = (p: LocalProfile) => { setLocal(p); AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(p)).catch(() => {}); };

  const online = !!(cloud.user && cloud.profile);
  const name = online ? cloud.profile!.pseudo : local.name;
  const country = online ? cloud.profile!.country : local.country;

  const s = useMemo(() => computeStats(list), [list]);
  const lv = levelFor(s.xp);
  const ach = achievementState(s);
  const unlocked = ach.filter((a) => a.unlocked).length;
  const maxRarity = Math.max(1, ...Object.values(s.byRarity));

  const copyData = async () => {
    const head = 'date,valide,type,immatriculation,source_immat,modele_registre,points,confiance,taille,nettete,luminosite,moire_db,ecran,precision_gps_m,zoom,raisons,pics_direct,moire_photo_db,pics_photo,photo_info,exif';
    const rows = list.map((c) => [
      c.takenAt, c.valid ? 'oui' : 'non', c.typeId || '', c.registration || '', c.registrationSource || '', `"${c.registryModel || ''}"`, c.points,
      c.confidence.toFixed(2), c.sizeRatio.toFixed(2), Math.round(c.sharpness), Math.round(c.brightness),
      c.moire != null ? c.moire.toFixed(1) : '', c.screenObject != null ? c.screenObject.toFixed(2) : '',
      c.accuracy != null ? Math.round(c.accuracy) : '', c.zoom != null ? c.zoom.toFixed(1) : '', `"${c.reasons.join(' | ')}"`,
      `"${c.moirePeaks || ''}"`, c.photoMoire != null ? c.photoMoire.toFixed(1) : '', `"${c.photoMoirePeaks || ''}"`, `"${c.photoMoireInfo || ''}"`, `"${c.exif || ''}"`,
    ].join(','));
    await Share.share({ message: [head, ...rows].join('\n') }).catch(() => {});
  };

  const clear = () => {
    Alert.alert(
      'Tout effacer ?',
      cloud.user ? 'Toute la collection sera effacée, sur ce téléphone ET sur le serveur. Action définitive.' : 'Toute la collection sera effacée. Action définitive.',
      [{ text: 'Annuler', style: 'cancel' }, { text: 'Tout effacer', style: 'destructive', onPress: () => { clearAll(); } }],
    );
  };

  // Sans compte seulement : pseudo et pays locaux (proposés à la création du compte).
  // Avec un compte, ils sont fixés : seul un administrateur peut les changer (support).
  const changeName = (v: string) => saveLocal({ ...local, name: v.trim() || 'Joueur' });
  const changeCountry = (code: string) => saveLocal({ ...local, country: code });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={st.hero}>
        <View style={st.avatar}><Text style={st.avatarL}>{(name || 'J')[0].toUpperCase()}</Text></View>
        <Text style={st.name}>{name}</Text>
        <Text style={st.title}>Niveau {lv.level} · {lv.title}</Text>
        <View style={st.xpLine}>
          <Text style={st.small}>{s.xp} XP</Text>
          <Text style={st.small}>{lv.next ? `${lv.next - s.xp} XP avant le niveau ${lv.level + 1}` : 'Niveau maximum'}</Text>
        </View>
        <Bar value={lv.progress} />
      </View>

      <Section title="Statistiques">
        <View style={st.stats}>
          <Stat n={s.valid} l="cartes" />
          <Stat n={`${s.types}`} l={`types / ${s.catalogSize}`} />
          <Stat n={s.makers} l="constructeurs" />
          <Stat n={s.places} l="aéroports" />
          <Stat n={`${Math.round(s.successRate * 100)} %`} l="photos réussies" />
          <Stat n={s.best ? s.best.points : 0} l="meilleure carte" />
        </View>
      </Section>

      <Section title="Cartes par rareté">
        {(Object.keys(RARITIES) as RarityKey[]).map((k) => (
          <View key={k} style={st.rb}>
            <Text style={[st.rbLabel]}>{RARITIES[k].label}</Text>
            <View style={{ flex: 1 }}><Bar value={s.byRarity[k] / maxRarity} color={RARITIES[k].color} /></View>
            <Text style={st.rbN}>{s.byRarity[k]}</Text>
          </View>
        ))}
      </Section>

      <Section title={`Succès (${unlocked}/${ach.length})`}>
        {ach.map((a) => (
          <View key={a.id} style={[st.ach, !a.unlocked && { opacity: 0.55 }]}>
            <Text style={st.achIco}>{a.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={st.achTitle}>{a.title}</Text>
              <Text style={st.small}>{a.desc}</Text>
              {!a.unlocked && a.progress ? <View style={{ marginTop: 6 }}><Bar value={a.progress[0] / a.progress[1]} height={5} /></View> : null}
            </View>
            {a.unlocked ? <Text style={st.done}>✓</Text> : a.progress ? <Text style={st.small}>{Math.min(a.progress[0], a.progress[1])}/{a.progress[1]}</Text> : null}
          </View>
        ))}
      </Section>

      <Account cloud={cloud} local={local} onChanged={reload} />

      {online && <FriendsSection />}

      <Section title="Réglages">
        {online && (
          <>
            <View style={st.kv}><Text style={st.kvK}>Pseudo</Text><Text style={st.kvV}>{name}</Text></View>
            <View style={st.kv}><Text style={st.kvK}>Pays (classement national)</Text><Text style={st.kvV}>{COUNTRY_NAMES[country] || country}</Text></View>
            <Text style={st.muted}>Le pseudo et le pays sont fixés à la création du compte. Pour les modifier, contacte le support.</Text>
          </>
        )}
        {!cloud.user && (
          <>
            <Text style={st.label}>Pseudo</Text>
            <TextInput key={name} style={st.input} defaultValue={name} maxLength={20} onEndEditing={(e) => changeName(e.nativeEvent.text)} />
            <Text style={st.label}>Pays</Text>
            <CountryPicker value={country} onChange={changeCountry} />
          </>
        )}
        <View style={st.row2}>
          <Btn label="Copier les mesures" onPress={copyData} style={{ flex: 1 }} />
          <Btn label="Tout effacer" kind="danger" onPress={clear} style={{ flex: 1 }} />
        </View>
      </Section>
      <Text style={st.foot}>
        SkyHunt 0.5 · {online ? 'tes captures sont sauvegardées sur ton compte' : 'tes captures restent sur ce téléphone'}.{'\n'}
        Immatriculations canadiennes : registre de Transport Canada (mis à jour chaque semaine).
      </Text>
    </ScrollView>
  );
}

/* =================== Compte =================== */
function Account({ cloud, local, onChanged }: { cloud: CloudState; local: LocalProfile; onChanged: () => Promise<unknown> }) {
  const { toast } = useApp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [pseudo, setPseudo] = useState('');
  const [country, setCountry] = useState(local.country);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCountry(local.country); if (local.name !== 'Joueur') setPseudo((p) => p || local.name); }, [local]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message || String(e)); } finally { setBusy(false); }
  };

  if (!cloud.enabled) return null;

  if (!cloud.user) {
    return (
      <Section title="Compte">
        <Text style={st.muted}>Crée un compte (ou connecte-toi) pour sauvegarder tes cartes et participer aux classements. Les cartes déjà sur ce téléphone seront ajoutées à ton compte.</Text>
        {codeSent ? (
          <>
            <Text style={st.p}>Code envoyé à <Text style={{ fontWeight: '800' }}>{email}</Text>. Regarde tes courriels (et les indésirables).</Text>
            <Text style={st.label}>Code à 6 chiffres</Text>
            <TextInput style={[st.input, st.code]} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={10} />
            <View style={st.row2}>
              <Btn kind="primary" label="Valider" busy={busy} style={{ flex: 1 }} onPress={() => {
                if (code.length < 6) { toast('Entre les 6 chiffres du code.'); return; }
                run(async () => { await verifyCode(email, code); setCodeSent(false); setCode(''); await onChanged(); toast('Connecté !'); });
              }} />
              <Btn label="Changer d'adresse" disabled={busy} style={{ flex: 1 }} onPress={() => { setCodeSent(false); setCode(''); }} />
            </View>
          </>
        ) : (
          <>
            <Text style={st.label}>Courriel</Text>
            <TextInput style={st.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" autoCorrect={false} />
            <Btn kind="primary" label="Recevoir un code" busy={busy} onPress={() => {
              const e = email.trim();
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast('Adresse courriel invalide.'); return; }
              setEmail(e);
              run(async () => { await sendCode(e); setCodeSent(true); });
            }} />
          </>
        )}
      </Section>
    );
  }

  const logout = () => run(async () => {
    let r = await signOut();
    if (!r.ok) {
      const force = await new Promise<boolean>((res) => Alert.alert(
        'Modifications non envoyées',
        `${r.pending} modification(s) n'ont pas pu être envoyées (pas de réseau ?). Se déconnecter quand même et les perdre ?`,
        [{ text: 'Annuler', style: 'cancel', onPress: () => res(false) }, { text: 'Se déconnecter', style: 'destructive', onPress: () => res(true) }],
      ));
      if (!force) return;
      r = await signOut({ force: true });
    }
    await onChanged();
    toast('Déconnecté. Tes cartes restent sur ton compte.');
  });

  if (!cloud.profileLoaded) {
    return (
      <Section title="Compte">
        <Text style={st.muted}>{cloud.error || 'Chargement du profil…'}</Text>
        <Btn label="Se déconnecter" onPress={logout} busy={busy} />
      </Section>
    );
  }

  if (!cloud.profile) {
    return (
      <Section title="Créer ton profil">
        <Text style={st.muted}>
          Ton pseudo est visible dans les classements. Le pays sert au classement national.{' '}
          <Text style={{ fontWeight: '800', color: C.text2 }}>Choisis bien : ils ne pourront plus être modifiés ensuite</Text> (sauf sur demande au support).
        </Text>
        <Text style={st.label}>Pseudo</Text>
        <TextInput style={st.input} value={pseudo} onChangeText={setPseudo} maxLength={20} autoCorrect={false} />
        <Text style={st.label}>Pays</Text>
        <CountryPicker value={country} onChange={setCountry} />
        <View style={st.row2}>
          <Btn kind="primary" label="Créer mon profil" busy={busy} style={{ flex: 1 }} onPress={() => {
            if (pseudo.trim().length < 2) { toast('Pseudo : au moins 2 caractères.'); return; }
            Alert.alert('Créer ton profil ?', `« ${pseudo.trim()} » (${COUNTRY_NAMES[country] || country}). Le pseudo et le pays ne pourront plus être modifiés.`, [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Créer', onPress: () => run(async () => { await saveRemoteProfile({ pseudo: pseudo.trim(), country }); toast('Profil créé.'); }) },
            ]);
          }} />
          <Btn label="Se déconnecter" disabled={busy} style={{ flex: 1 }} onPress={logout} />
        </View>
      </Section>
    );
  }

  const status = cloud.syncing ? 'Envoi en cours…'
    : cloud.error ? cloud.error
      : cloud.pending ? `${cloud.pending} modification${cloud.pending > 1 ? 's' : ''} en attente`
        : `À jour${cloud.lastSync ? ` (${cloud.lastSync.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })})` : ''}`;

  const del = () => Alert.alert(
    'Supprimer ton compte ?',
    'Ton compte, ton profil, toutes tes captures et leurs photos seront effacés définitivement, sur le serveur et sur ce téléphone.',
    [{ text: 'Annuler', style: 'cancel' }, {
      text: 'Supprimer définitivement', style: 'destructive',
      onPress: () => run(async () => { await deleteAccount(); await onChanged(); toast('Compte supprimé.'); }),
    }],
  );

  return (
    <Section title="Compte">
      <View style={st.kv}><Text style={st.kvK}>Courriel</Text><Text style={st.kvV}>{cloud.user.email}</Text></View>
      <View style={st.kv}><Text style={st.kvK}>Sauvegarde</Text><Text style={[st.kvV, cloud.error ? { color: C.bad } : null]}>{status}</Text></View>
      <View style={st.row2}>
        <Btn label="Synchroniser" disabled={cloud.syncing} busy={busy} style={{ flex: 1 }} onPress={() => run(async () => {
          const r = await sync();
          toast(r.pushed || r.pulled ? `${r.pushed} envoyée(s), ${r.pulled} reçue(s)` : 'Déjà à jour');
        })} />
        <Btn label="Se déconnecter" disabled={busy} style={{ flex: 1 }} onPress={logout} />
      </View>
      <Pressable onPress={del} style={{ alignSelf: 'center', marginTop: 14 }}><Text style={st.linkDanger}>Supprimer mon compte</Text></Pressable>
    </Section>
  );
}

function CountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={[st.input, st.select]} onPress={() => setOpen(true)}>
        <Text style={{ color: C.text, fontSize: 16 }}>{COUNTRY_NAMES[value] || value}</Text>
        <Text style={{ color: C.muted }}>▾</Text>
      </Pressable>
      <Sheet visible={open} title="Pays" onClose={() => setOpen(false)}>
        {COUNTRIES.map((c) => (
          <Pressable key={c.code} onPress={() => { onChange(c.code); setOpen(false); }} style={[st.countryRow, c.code === value && { borderColor: C.accent }]}>
            <Text style={{ color: C.text, fontSize: 16 }}>{c.name}</Text>
            {c.code === value ? <Text style={{ color: C.accent, fontWeight: '800' }}>✓</Text> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={st.section}>
      <Text style={st.h2}>{title}</Text>
      {children}
    </View>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <View style={st.stat}><Text style={st.statN}>{n}</Text><Text style={st.statL}>{l}</Text></View>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', backgroundColor: C.card, borderRadius: 18, padding: 18, gap: 4 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  avatarL: { color: '#fff', fontSize: 32, fontWeight: '900' },
  name: { color: C.text, fontSize: 24, fontWeight: '900' },
  title: { color: C.text2, fontSize: 14 },
  xpLine: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 10, marginBottom: 4 },
  small: { color: C.muted, fontSize: 12 },
  section: { marginTop: 22 },
  h2: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '31.5%', backgroundColor: C.card, borderRadius: 12, padding: 10, alignItems: 'center' },
  statN: { color: C.text, fontSize: 20, fontWeight: '900' },
  statL: { color: C.muted, fontSize: 11, marginTop: 2, textAlign: 'center' },
  rb: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  rbLabel: { color: C.text2, width: 90, fontSize: 13 },
  rbN: { color: C.muted, width: 26, textAlign: 'right' },
  ach: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 8 },
  achIco: { fontSize: 26 },
  achTitle: { color: C.text, fontWeight: '800', fontSize: 15 },
  done: { color: C.ok, fontWeight: '900', fontSize: 18 },
  label: { color: C.muted, fontSize: 13, marginBottom: 4, marginTop: 6 },
  input: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, color: C.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10 },
  code: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '800' },
  select: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row2: { flexDirection: 'row', gap: 8, marginTop: 6 },
  muted: { color: C.muted, fontSize: 13, marginBottom: 10 },
  p: { color: C.text2, fontSize: 14, marginBottom: 6 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 10 },
  kvK: { color: C.muted, fontSize: 14 },
  kvV: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  linkDanger: { color: C.bad, textDecorationLine: 'underline', fontSize: 13 },
  countryRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: 10, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: 'transparent' },
  foot: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});

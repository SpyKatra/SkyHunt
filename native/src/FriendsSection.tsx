// Section « Amis » du Profil : code ami (fixe), demandes reçues à accepter ou refuser, demandes envoyées
// (une demande refusée ne peut être relancée qu'au bout de 48 h), liste d'amis. Même logique que web/ui-friends.js.
// Le classement entre amis est dans l'écran Classement.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatFriendCode, removeFriend, requestFriend, respondFriend } from './cloud';
import { loadFriends, useFriends } from './friends';
import { useApp } from './store';
import { C, flag } from './theme';
import type { FriendRow } from './types';
import { Btn } from './ui';

const hoursLeft = (iso: string | null) => Math.max(1, Math.ceil(((iso ? new Date(iso).getTime() : 0) - Date.now()) / 3600000));

export default function FriendsSection() {
  const { toast } = useApp();
  const friends = useFriends();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Relue en ouvrant le Profil (au plus une fois toutes les 10 s).
  useEffect(() => { loadFriends(false, 10000); }, []);

  const run = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await fn();
      if (done) toast(done);
      await loadFriends(true);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = (c: string, id = 'send') => {
    if (!c.trim()) return;
    run(id, async () => {
      const r = await requestFriend(c.trim());
      if (r === 'inconnu') throw new Error('Code inconnu. Vérifie les 8 caractères.');
      if (id === 'send') setCode('');
      toast(r === 'acceptée' ? 'Vous êtes maintenant amis !' : 'Demande envoyée. Elle comptera quand ton ami l\'aura acceptée.');
    });
  };

  const share = () => Share.share({ message: `Mon code ami SkyHunt : ${formatFriendCode(friends.code)}` }).catch(() => {});
  const remove = (f: FriendRow) => Alert.alert('Retirer cet ami ?', `${f.pseudo} ne sera plus dans ton classement entre amis (et toi plus dans le sien).`, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Retirer', style: 'destructive', onPress: () => run(f.userId, () => removeFriend(f.userId)) },
  ]);

  const title = (n?: number) => <Text style={st.h2}>Amis{n ? ` (${n})` : ''}</Text>;
  if (friends.list == null) {
    return (
      <View style={st.section}>
        {title()}
        {friends.error
          ? <><Text style={st.muted}>Amis indisponibles : {friends.error}</Text><Btn label="Réessayer" onPress={() => loadFriends(true)} /></>
          : <ActivityIndicator color="#fff" />}
      </View>
    );
  }
  const by = (s: FriendRow['state']) => friends.list!.filter((f) => f.state === s);
  const who = (f: FriendRow) => `${flag(f.country)} ${f.pseudo ?? '?'}`;
  const sent = [...by('envoyée'), ...by('refusée')];

  return (
    <View style={st.section}>
      {title(by('ami').length)}

      {by('reçue').length > 0 && (
        <>
          <Text style={st.h3}>Demandes reçues</Text>
          {by('reçue').map((f) => (
            <View key={f.userId} style={st.fr}>
              <Text style={st.frName}>{who(f)}</Text>
              <Btn kind="primary" label="Accepter" style={st.frBtn} busy={busy === f.userId}
                onPress={() => run(f.userId, () => respondFriend(f.userId, true), 'Demande acceptée.')} />
              <Btn label="Refuser" style={st.frBtnAlt} disabled={busy === f.userId}
                onPress={() => run(f.userId, () => respondFriend(f.userId, false), 'Demande refusée.')} />
            </View>
          ))}
          <Text style={st.small}>Une personne refusée ne pourra te relancer qu'au bout de 48 h.</Text>
        </>
      )}

      <View style={st.codeBox}>
        <Text style={st.mutedSmall}>Mon code ami</Text>
        <Text style={st.code} selectable>{formatFriendCode(friends.code)}</Text>
        <Btn label="Partager mon code" onPress={share} style={{ alignSelf: 'stretch' }} />
      </View>
      <Text style={st.label}>Ajouter un ami : son code</Text>
      <TextInput
        style={st.input} value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="ABCD-EFGH" placeholderTextColor={C.dim}
        autoCapitalize="characters" autoCorrect={false} maxLength={9} returnKeyType="send" onSubmitEditing={() => send(code)}
      />
      <Btn kind="primary" label="Envoyer la demande" onPress={() => send(code)} busy={busy === 'send'} />
      <Text style={st.small}>
        Ton ami doit accepter ta demande avant que vous apparaissiez dans le classement l'un de l'autre. Ne donne ton code qu'aux personnes que tu connais.
      </Text>

      {sent.length > 0 && (
        <>
          <Text style={st.h3}>Demandes envoyées</Text>
          {sent.map((f) => {
            const refused = f.state === 'refusée';
            const canRetry = refused && f.retryAt != null && new Date(f.retryAt).getTime() <= Date.now();
            return (
              <View key={f.userId} style={st.fr}>
                <Text style={st.frName}>
                  Code {formatFriendCode(f.code)}{' '}
                  <Text style={st.dim}>{!refused ? 'en attente' : canRetry ? 'refusée' : `refusée · relance possible dans ${hoursLeft(f.retryAt)} h`}</Text>
                </Text>
                {!refused && <Btn label="Annuler" style={st.frBtnAlt} busy={busy === f.userId} onPress={() => run(f.userId, () => removeFriend(f.userId))} />}
                {canRetry && <Btn kind="primary" label="Relancer" style={st.frBtn} busy={busy === `r${f.userId}`} onPress={() => send(f.code || '', `r${f.userId}`)} />}
                {canRetry && <Btn label="Retirer" style={st.frBtnAlt} disabled={busy === `r${f.userId}`} onPress={() => run(f.userId, () => removeFriend(f.userId))} />}
              </View>
            );
          })}
        </>
      )}

      <Text style={st.h3}>Mes amis</Text>
      {by('ami').length === 0 && <Text style={st.muted}>Pas encore d'amis. Partage ton code !</Text>}
      {by('ami').map((f) => (
        <View key={f.userId} style={st.fr}>
          <Text style={st.frName} numberOfLines={1}>{who(f)}</Text>
          <Btn label="Retirer" style={st.frBtnAlt} busy={busy === f.userId} onPress={() => remove(f)} />
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  section: { marginTop: 22 },
  h2: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  h3: { color: C.muted, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  mutedSmall: { color: C.muted, fontSize: 13 },
  dim: { color: C.muted, fontWeight: '500', fontSize: 13 },
  small: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  label: { color: C.muted, fontSize: 13, marginBottom: 4 },
  fr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 12, paddingRight: 6, borderRadius: 12, backgroundColor: C.card, marginBottom: 6, minHeight: 50 },
  frName: { flex: 1, color: C.text, fontWeight: '600', fontSize: 15 },
  frBtn: { paddingVertical: 8, paddingHorizontal: 12, minHeight: 36 },
  frBtnAlt: { paddingVertical: 8, paddingHorizontal: 12, minHeight: 36, backgroundColor: C.card2 },
  codeBox: { backgroundColor: C.card, borderRadius: 12, padding: 12, alignItems: 'center', marginBottom: 14 },
  code: { color: C.text, fontSize: 28, fontWeight: '900', letterSpacing: 3, marginVertical: 6, fontVariant: ['tabular-nums'] },
  input: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, color: C.text, fontSize: 16, letterSpacing: 2,
    paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10 },
});

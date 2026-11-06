// Détail d'une carte : photo, informations, points, actions (web/ui-cards.js → openDetail).
import { Alert, Image, Share, StyleSheet, Text, View } from 'react-native';
import { getType, RARITIES, seriesOf } from './shared';
import { useApp } from './store';
import { C, fmtDate } from './theme';
import { Breakdown, Btn, placeLong, RarityPill, Sheet } from './ui';

export default function DetailSheet() {
  const { detailId, list, openDetail, changeType, remove } = useApp();
  const c = detailId ? list.find((x) => x.id === detailId) : undefined;
  const t = getType(c?.typeId);
  const r = RARITIES[t.rarity];
  const close = () => openDetail(null);

  const share = async () => {
    if (!c) return;
    const message = `SkyHunt : ${c.valid ? `${t.name} (${r.label}) · ${c.points} pts` : 'photo refusée'} · ${placeLong(c)}`;
    try {
      await Share.share(c.photoUri ? { message, url: c.photoUri } : { message });
    } catch { /* partage annulé */ }
  };

  const del = () => {
    if (!c) return;
    Alert.alert('Supprimer cette capture ?', 'Elle sera aussi effacée de ton compte.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => { close(); await remove(c.id); } },
    ]);
  };

  return (
    <Sheet visible={!!c} title={c ? (c.valid ? t.name : 'Photo refusée') : ''} onClose={close}>
      {c && (
        <>
          {c.photoUri ? <Image source={{ uri: c.photoUri }} style={st.photo} resizeMode="cover" /> : null}
          <View style={st.kv}>
            {c.valid && <Row k="Rareté"><RarityPill typeId={c.typeId} /></Row>}
            {c.valid && <Row k="Constructeur" v={t.maker} />}
            {c.valid && t.id !== 'inconnu' ? (
              <Row k="Série" v={seriesOf(t.id, c.seriesId)?.name || (t.series.length ? 'pas encore précisée (Changer le type)' : t.name)} />
            ) : null}
            {c.registration ? (
              <Row k="Immatriculation">
                <Text style={st.v}>{c.registration}{c.registrationSource === 'ocr' ? <Text style={{ color: C.ok, fontSize: 12 }}>  lue sur la photo</Text> : null}</Text>
              </Row>
            ) : null}
            {c.registryModel ? <Row k="Modèle exact" v={`${c.registryModel} (registre)`} /> : null}
            <Row k="Date" v={fmtDate(c.takenAt, true)} />
            <Row k="Lieu" v={placeLong(c)} />
            <Row k="Mesures" v={`Confiance ${Math.round(c.confidence * 100)} % · taille ${Math.round(c.sizeRatio * 100)} % · netteté ${Math.round(c.sharpness)}${c.zoom ? ` · zoom ×${c.zoom.toFixed(1)}` : ''}`} />
            {!c.valid && <Row k="Raisons"><Text style={[st.v, { color: C.bad }]}>{c.reasons.join(' · ')}</Text></Row>}
          </View>
          {c.valid && <Breakdown c={c} />}
          <View style={st.actions}>
            {c.valid && (
              <Btn
                label={t.id === 'inconnu' ? 'Identifier l’avion' : 'Changer le type'}
                onPress={async () => {
                  close();
                  // iOS refuse d'ouvrir une fiche pendant que la précédente se ferme.
                  await new Promise((res) => setTimeout(res, 450));
                  await changeType(c.id);
                }}
                style={{ flex: 1 }}
              />
            )}
            <Btn label="Partager" onPress={share} style={{ flex: 1 }} />
            <Btn label="Supprimer" kind="danger" onPress={del} style={{ flex: 1 }} />
          </View>
        </>
      )}
    </Sheet>
  );
}

function Row({ k, v, children }: { k: string; v?: string; children?: React.ReactNode }) {
  return (
    <View style={st.row}>
      <Text style={st.k}>{k}</Text>
      <View style={{ flex: 1 }}>{children ?? <Text style={st.v}>{v}</Text>}</View>
    </View>
  );
}

const st = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: C.card, marginBottom: 14 },
  kv: { marginBottom: 14 },
  row: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  k: { color: C.muted, width: 120, fontSize: 14 },
  v: { color: C.text, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
});

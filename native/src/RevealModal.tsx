// Révélation d'une nouvelle carte, avec le détail des points (équivalent de web/ui-reveal.js).
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getType, RARITIES } from './shared';
import { useApp } from './store';
import { C } from './theme';
import { Breakdown, Btn, CardTile } from './ui';

export default function RevealModal() {
  const { revealReq } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(0.3)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  const c = revealReq?.capture;
  const t = getType(c?.typeId);
  const r = RARITIES[t.rarity];

  useEffect(() => {
    if (!c) return;
    scale.setValue(0.3);
    spin.setValue(0);
    fade.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
        Animated.timing(spin, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
    if (r.order >= 2) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [c, scale, spin, fade, r.order]);

  if (!revealReq || !c) return null;
  const { extras } = revealReq;
  const rotateY = spin.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] });
  const cardW = Math.min(250, width * 0.62);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={revealReq.resolve}>
      <View style={[st.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 }]}>
        <View style={[st.glow, { backgroundColor: r.glow }]} />
        <ScrollView contentContainerStyle={st.content}>
          <Animated.View style={{ transform: [{ perspective: 800 }, { scale }, { rotateY }] }}>
            <CardTile c={c} showPoints={false} width={cardW} />
          </Animated.View>
          <Animated.View style={{ opacity: fade, width: '100%', alignItems: 'center' }}>
            <Text style={st.points}>+{c.points} pts</Text>
            {t.id === 'inconnu' && <Pill text="Avion mystère : identifie-le plus tard depuis tes cartes pour gagner plus de points." />}
            {t.id !== 'inconnu' && c.breakdown?.bonus ? <Pill color={C.ok} text={`Nouveau type : ${t.name} rejoint ta flotte !`} /> : null}
            {extras.levelUp && <Pill color={C.gold} text={`Niveau ${extras.levelUp.level} atteint : ${extras.levelUp.title}`} />}
            {extras.achievements.map((a) => <Pill key={a.id} color={C.gold} text={`${a.icon} Succès débloqué : ${a.title}`} />)}
            <View style={{ width: '100%', marginTop: 12 }}><Breakdown c={c} /></View>
          </Animated.View>
        </ScrollView>
        <Btn kind="primary" label="Continuer" onPress={revealReq.resolve} style={{ marginHorizontal: 20 }} />
      </View>
    </Modal>
  );
}

function Pill({ text, color }: { text: string; color?: string }) {
  return (
    <View style={[st.pill, color ? { borderColor: color } : null]}>
      <Text style={[st.pillText, color ? { color } : null]}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(5,9,18,0.97)' },
  glow: { position: 'absolute', top: '12%', alignSelf: 'center', width: 320, height: 320, borderRadius: 160, opacity: 0.45 },
  content: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  points: { color: C.text, fontSize: 40, fontWeight: '900', marginTop: 18, marginBottom: 8 },
  pill: { borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8, maxWidth: '100%' },
  pillText: { color: C.text2, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});

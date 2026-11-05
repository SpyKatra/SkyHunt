// Écran « Chasser » : caméra, zoom optique, photo → analyse de la photo → identification → révélation.
// Plus d'analyse en direct (décision de Spy, 2026-11-05) : voir photoAnalysis.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { takeCaptureToken } from './cloud';
import { analyzePhoto, loadDetector, type PhotoAnalysis } from './photoAnalysis';
import { checkDetection, computeStats, DEFAULT_THRESHOLDS, levelFor, SAFETY_TEXT, SAFETY_VERSION, SCREEN_CLASSES } from './shared';
import { keepPhoto } from './storage';
import { useApp } from './store';
import { C } from './theme';
import type { Capture } from './types';
import { Bar } from './ui';

const APP_VERSION = '0.5';
const SAFETY_KEY = 'skyhunt.safety';

/** Consigne de sécurité, à accepter avant la première utilisation de la caméra (et à chaque nouvelle version). */
function useSafety() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(SAFETY_KEY)
      .then((v) => setOk(!!v && (JSON.parse(v).version ?? 0) >= SAFETY_VERSION))
      .catch(() => setOk(false));
  }, []);
  const accept = () => {
    setOk(true);
    AsyncStorage.setItem(SAFETY_KEY, JSON.stringify({ version: SAFETY_VERSION, at: new Date().toISOString() })).catch(() => {});
  };
  return [ok, accept] as const;
}

const USER_AGENT = `SkyHunt/${APP_VERSION} (${Platform.OS} ${Platform.Version}; ${String((Platform.constants as Record<string, unknown>).Model ?? '')})`;

export default function CameraScreen({ active }: { active: boolean }) {
  const { list, saveNew, identify, reveal, toast } = useApp();
  const { hasPermission, requestPermission } = useCameraPermission();
  const [safetyOk, acceptSafety] = useSafety();
  // iPhone : appareil « virtuel » qui passe tout seul de l'ultra grand-angle au téléobjectif selon le zoom.
  // Android : la caméra arrière par défaut (logique) fait déjà ce passage ; le filtre y est risqué car
  // les caméras physiques ne sont pas décrites et le tri peut retenir une caméra secondaire.
  const device = useCameraDevice('back', Platform.OS === 'ios'
    ? { physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'] }
    : undefined);
  // Photo 4:3 de 12 Mpx (comme l'image analysée : le cadre détecté correspond à la photo). La pleine
  // résolution (50-200 Mpx sur Android) alourdit la session caméra et ralentit l'aperçu, sans rien
  // apporter à la lecture de l'immatriculation (l'envoi est de toute façon réduit à 1920 px).
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: 0.95,
    qualityPrioritization: 'quality',
  });

  const [showDebug, setShowDebug] = useState(false);
  // Erreurs de la caméra : le message natif contient toute la pile Java, illisible dans un toast.
  // On n'affiche que la 1re ligne et on garde les 3 dernières pour le diagnostic.
  const [camErrors, setCamErrors] = useState<string[]>([]);
  const [sessionInfo, setSessionInfo] = useState("");
  const onCamError = useCallback((e: Error) => {
    const head = String(e?.message ?? e).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('at ')).slice(0, 2).join(' — ').slice(0, 300);
    // Sans conséquence, ignorés : « Camera is not active » (réglage envoyé avant le démarrage) et
    // « Cancelled due to another zoom value » (chaque pas du pincement annule le précédent, ~60/s).
    if (/not active|another zoom/i.test(head)) return;
    console.log(`[SkyHunt] erreur caméra : ${head}`);
    const t = new Date().toLocaleTimeString('fr-CA');
    setCamErrors((list) => [`${t} ${head}`, ...list].slice(0, 3));
    toast(`Caméra : ${head.slice(0, 120)}`);
  }, [toast]);
  // État de la session, et relance automatique si la caméra ne démarre pas (écran noir).
  const [camState, setCamState] = useState('démarrage…');
  const [camKey, setCamKey] = useState(0);
  const started = useRef(false);
  const onStarted = useCallback(() => { console.log('[SkyHunt] session démarrée'); started.current = true; setCamState('en marche'); }, []);
  const onStopped = useCallback(() => { console.log('[SkyHunt] session arrêtée'); started.current = false; setCamState('arrêtée'); }, []);
  const onInterrupted = useCallback((r: unknown) => setCamState(`interrompue (${String(r)})`), []);
  const onResumed = useCallback(() => setCamState('en marche'), []);
  const [busy, setBusy] = useState(false);
  const thresholds = DEFAULT_THRESHOLDS;

  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  // Dernière photo analysée (diagnostic) et état du modèle (chargé dès l'ouverture de l'écran).
  const [last, setLast] = useState<PhotoAnalysis | null>(null);
  const [lastMsg, setLastMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  useEffect(() => {
    loadDetector().then(() => setModelReady(true)).catch((e) => setModelError(e instanceof Error ? e.message : String(e)));
  }, []);

  const stats = useMemo(() => computeStats(list), [list]);
  const lv = levelFor(stats.xp);

  /* ---------------- Zoom ---------------- */
  // Zoom « 1× » = objectif principal. Android : valeurs déjà relatives (ultra grand-angle < 1).
  // iPhone (appareil virtuel) : 1 = ultra grand-angle, le principal est au 1er seuil de bascule.
  const neutral = device == null ? 1
    : device.minZoom < 1 ? 1
    : device.zoomLensSwitchFactors.length > 0 && device.physicalDevices.some((d) => d.type === 'ultra-wide-angle')
      ? device.zoomLensSwitchFactors[0]
      : device.minZoom;
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.min(device?.maxZoom ?? 1, neutral * 20);
  const [zoom, setZoom] = useState(neutral);
  useEffect(() => { setZoom(neutral); }, [neutral]);
  const presets = useMemo(() => {
    const out: number[] = [];
    if (minZoom < neutral * 0.9) out.push(minZoom / neutral);
    for (const f of [1, 2, 3, 5, 10]) if (neutral * f <= maxZoom + 0.01) out.push(f);
    return out;
  }, [minZoom, neutral, maxZoom]);
  const factor = zoom / neutral;

  const pinch = useRef({ start: 0, dist: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length !== 2) return;
      const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
      if (!pinch.current.dist) { pinch.current = { start: zoomRef.current, dist: d }; return; }
      const z = pinch.current.start * (d / pinch.current.dist);
      setZoom(Math.max(minZoom, Math.min(maxZoom, z)));
    },
    onPanResponderRelease: () => { pinch.current = { start: 0, dist: 0 }; },
    onPanResponderTerminate: () => { pinch.current = { start: 0, dist: 0 }; },
  }), [minZoom, maxZoom]);

  /* ---------------- Position GPS ---------------- */
  const position = useRef<Location.LocationObject | null>(null);
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
        (p) => { position.current = p; },
      );
      if (cancelled) sub.remove();
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, [active]);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Chien de garde : si la caméra n'a pas démarré 5 s après l'ouverture, on recrée la session
  // (3 essais au plus). Évite l'écran noir qui obligeait à fermer l'app.
  const retries = useRef(0);
  useEffect(() => {
    console.log(`[SkyHunt] caméra : active=${active} perm=${hasPermission} device=${device?.id ?? 'null'} key=${camKey}`);
  }, [active, hasPermission, device, camKey]);
  useEffect(() => {
    console.log('[SkyHunt] CameraScreen monté');
    return () => console.log('[SkyHunt] CameraScreen démonté');
  }, []);
  useEffect(() => {
    if (!active) { retries.current = 0; started.current = false; setCamState('démarrage…'); return; }
    if (!hasPermission || device == null) return;
    started.current = false;
    const timer = setTimeout(() => {
      if (started.current || retries.current >= 3) return;
      retries.current += 1;
      setCamState(`relance ${retries.current}/3`);
      setCamKey((k) => k + 1);
    }, 5000);
    return () => clearTimeout(timer);
  }, [active, hasPermission, device, camKey]);

  /* ---------------- Capture ---------------- */
  const takeCapture = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLastMsg(null);
    try {
      const photo = await photoOutput.capturePhotoToFile({ flashMode: 'off', enableShutterSound: false }, {});
      let pos = position.current;
      if (!pos) {
        pos = await Location.getLastKnownPositionAsync({ maxAge: 60000 }).catch(() => null);
      }
      const id = `${Date.now()}`;
      const photoUri = await keepPhoto(id, photo.filePath);
      // Analyse de la photo prise : avion, taille, netteté, luminosité, écran, moiré à pleine résolution.
      const snapshot = await analyzePhoto(photoUri);
      setLast(snapshot);
      const verdict = checkDetection(snapshot, thresholds);
      const mocked = pos?.mocked === true;
      const reasons = [...verdict.reasons];
      if (!pos) reasons.push('Position GPS inconnue');
      if (mocked) reasons.push('Position fictive détectée');
      const valid = verdict.ok && !!pos && !mocked;

      const record: Capture = {
        id,
        takenAt: new Date().toISOString(),
        photoUri,
        width: photo.width,
        height: photo.height,
        latitude: pos?.coords.latitude ?? null,
        longitude: pos?.coords.longitude ?? null,
        accuracy: pos?.coords.accuracy ?? null,
        gpsAgeS: pos ? Math.round((Date.now() - pos.timestamp) / 1000) : null,
        confidence: snapshot?.confidence ?? 0,
        sizeRatio: snapshot?.sizeRatio ?? 0,
        sharpness: snapshot?.sharpness ?? 0,
        brightness: snapshot?.brightness ?? 0,
        moire: snapshot?.moire ?? null,
        moirePeaks: snapshot.moirePeaks ?? null,
        photoMoire: snapshot.moire,
        photoMoirePeaks: snapshot.moireAll.join(' / '),
        photoMoireInfo: snapshot.photoInfo,
        exif: snapshot.exif,
        screenObject: snapshot?.screenObject ?? null,
        box: snapshot?.box ?? null,
        thresholds: { ...thresholds },
        valid,
        reasons,
        typeId: null,
        registration: null,
        registrationSource: null,
        registryModel: null,
        userAgent: USER_AGENT,
        zoom: Math.round(factor * 10) / 10,
        // Jeton à usage unique (anti-triche) : prouve au serveur que la photo n'est pas antidatée.
        captureToken: valid ? takeCaptureToken() : null,
      };

      if (!valid) {
        await saveNew(record);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        // La caméra reste ouverte : le joueur corrige (zoom, cadrage) et reprend la photo.
        setLastMsg({ text: `${reasons[0] || 'Photo non valide'} — reprends la photo`, ok: false });
        return;
      }

      // Capture valide : on demande le type, puis révélation de la carte.
      const ident = await identify(record);
      await new Promise((res) => setTimeout(res, 450)); // laisser la fiche se fermer (iOS)
      const res = await saveNew({ ...record, ...ident });
      await reveal(res.capture, { levelUp: res.levelUp, achievements: res.achievements });
    } catch (e) {
      toast(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, thresholds, factor, photoOutput, saveNew, identify, reveal, toast]);

  /* ---------------- Rendu ---------------- */
  if (safetyOk === null) return <View style={st.center} />;
  if (!safetyOk) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={st.safety}>
        <Text style={st.safetyTitle}>Avant de chasser</Text>
        {SAFETY_TEXT.map((t) => <Text key={t} style={st.safetyItem}>•  {t}</Text>)}
        <Text style={st.safetyNote}>Tu es responsable de respecter les lois et règlements du lieu où tu te trouves.</Text>
        <Pressable style={[st.btn, { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 14 }]} onPress={acceptSafety}>
          <Text style={st.btnText}>J’ai compris</Text>
        </Pressable>
      </ScrollView>
    );
  }
  if (!hasPermission) {
    return (
      <View style={st.center}>
        <Text style={st.text}>SkyHunt a besoin de la caméra pour photographier les avions.</Text>
        <Pressable style={st.btn} onPress={requestPermission}><Text style={st.btnText}>Autoriser la caméra</Text></Pressable>
      </View>
    );
  }
  if (device == null) {
    // Sur Android, la liste des caméras arrive quelques instants après le lancement.
    return (
      <View style={st.center}>
        <ActivityIndicator color="#fff" />
        <Text style={st.text}>Ouverture de la caméra…</Text>
      </View>
    );
  }

  const status = camState !== 'en marche' ? `Caméra : ${camState}`
    : modelError ? `Modèle : ${modelError.split('\n')[0].slice(0, 140)}`
    : busy ? 'Analyse de la photo…'
    : lastMsg ? lastMsg.text
    : !modelReady ? 'Chargement du modèle…'
    : 'Vise un avion et prends la photo';
  const statusColor = lastMsg && !busy ? (lastMsg.ok ? C.ok : C.warn) : C.text;
  const d = last;

  return (
    <View style={st.container} {...responder.panHandlers}>
      {/* Aperçu 4:3, comme la photo. */}
      <View style={[st.preview, { aspectRatio: 3 / 4 }]}>
        {/* Montée seulement sur cet onglet : la caméra est entièrement libérée ailleurs. */}
        {active && (
          <Camera
            key={camKey}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            outputs={outputs}
            zoom={camState === 'en marche' ? zoom : undefined}
            resizeMode="cover"
            onSessionConfigSelected={(c) => setSessionInfo(`${c.selectedFPS ?? '?'} i/s · ${c.nativePixelFormat}${c.isBinned ? ' · binning' : ''}`)}
            onStarted={onStarted}
            onStopped={onStopped}
            onInterruptionStarted={onInterrupted}
            onInterruptionEnded={onResumed}
            onError={onCamError}
          />
        )}
      </View>

      <View style={st.topBar} pointerEvents="box-none">
        <View style={st.status}><Text style={[st.statusText, { color: statusColor }]}>{status}</Text></View>
        <View style={st.level}>
          <Text style={st.levelText}>Niv. {lv.level}</Text>
          <View style={{ width: 44 }}><Bar value={lv.progress} height={4} /></View>
        </View>
      </View>

      {showDebug && (
        <View style={st.debug}>
          {d ? (
            <>
              <Text style={st.debugText}>Dernière photo : {d.frameInfo} · analyse {d.inferenceMs} ms (détection {d.detectMs}{d.moireMs != null && d.moireMs >= 0 ? ` · moiré ${d.moireMs}` : ''})</Text>
              <Text style={st.debugText}>Confiance : {Math.round(d.confidence * 100)} % (min {Math.round(thresholds.minConfidence * 100)})</Text>
              <Text style={st.debugText}>Taille : {Math.round(d.sizeRatio * 100)} % (min {Math.round(thresholds.minSizeRatio * 100)})</Text>
              <Text style={st.debugText}>Netteté : {Math.round(d.sharpness)} (min {thresholds.minSharpness})</Text>
              <Text style={st.debugText}>Luminosité : {Math.round(d.brightness)}</Text>
              <Text style={st.debugText}>Moiré (écran) : {Math.round(d.moire)} dB (max {thresholds.maxMoire}) · carrés {d.moireAll.join(' / ') || '–'}{d.moirePeaks ? ` · pics ${d.moirePeaks}` : ''}</Text>
              <Text style={st.debugText}>Écran détecté : {d.screenObject ? `${SCREEN_CLASSES[d.screenClass] ?? 'écran'} ${Math.round(d.screenObject * 100)} %` : 'non'}</Text>
              {d.photoInfo ? <Text style={st.debugText}>{d.photoInfo}</Text> : null}
              <Text style={st.debugText}>{d.exif}</Text>
            </>
          ) : <Text style={st.debugText}>Prends une photo : ses mesures s’afficheront ici.</Text>}
          <Text style={st.debugText}>Caméra : {camState} · {sessionInfo || 'configuration…'} · zoom ×{factor.toFixed(1)} · {USER_AGENT}</Text>
          {camErrors.map((m, i) => <Text key={i} style={[st.debugText, { color: C.warn }]}>Erreur {m}</Text>)}
          <Text style={st.debugText}>GPS : {position.current ? `±${Math.round(position.current.coords.accuracy ?? 0)} m` : 'en attente'}</Text>
        </View>
      )}

      <View style={st.zoomRow}>
        {presets.map((f) => {
          const on = Math.abs(factor - f) < 0.05;
          return (
            <Pressable key={f} onPress={() => setZoom(Math.max(minZoom, Math.min(maxZoom, f * neutral)))} style={[st.zoomBtn, on && st.zoomOn]}>
              <Text style={[st.zoomText, on && st.zoomTextOn]}>{on ? `${f < 1 ? f.toFixed(1).replace('.', ',') : f}×` : f < 1 ? '0,5' : `${f}`}</Text>
            </Pressable>
          );
        })}
        {!presets.some((f) => Math.abs(factor - f) < 0.05) && (
          <View style={[st.zoomBtn, st.zoomOn]}><Text style={[st.zoomText, st.zoomTextOn]}>{factor.toFixed(1).replace('.', ',')}×</Text></View>
        )}
      </View>

      <View style={st.bottomBar}>
        <Pressable onPress={() => setShowDebug((v) => !v)} style={st.smallBtn}>
          <Text style={st.smallBtnText}>{showDebug ? 'Masquer diag.' : 'Diagnostic'}</Text>
        </Pressable>
        <Pressable onPress={takeCapture} disabled={busy || !modelReady} style={[st.shutter, { borderColor: modelReady ? '#E2E8F0' : C.muted }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <View style={[st.shutterInner, { backgroundColor: modelReady ? '#E2E8F0' : C.muted }]} />}
        </Pressable>
        <View style={{ width: 96 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  preview: { width: '100%', overflow: 'hidden', alignSelf: 'center', maxHeight: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 24 },
  text: { color: C.text, fontSize: 16, textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: C.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700' },
  safety: { padding: 24, paddingTop: 60, flexGrow: 1, justifyContent: 'center' },
  safetyTitle: { color: '#fbbf24', fontSize: 22, fontWeight: '800', marginBottom: 16 },
  safetyItem: { color: C.text, fontSize: 16, lineHeight: 23, marginBottom: 10 },
  safetyNote: { color: C.muted, fontSize: 13, marginTop: 6, marginBottom: 22 },
  box: { position: 'absolute', borderWidth: 3, borderRadius: 6 },
  boxLabel: { position: 'absolute', top: -22, left: -3, color: '#000', fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  topBar: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 8 },
  status: { flex: 1, backgroundColor: 'rgba(11,18,32,0.78)', borderRadius: 12, padding: 12, justifyContent: 'center' },
  statusText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  level: { backgroundColor: 'rgba(11,18,32,0.78)', borderRadius: 12, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 4 },
  levelText: { color: C.text, fontWeight: '800', fontSize: 13 },
  debug: { position: 'absolute', top: 76, left: 12, backgroundColor: 'rgba(11,18,32,0.82)', borderRadius: 10, padding: 10 },
  debugText: { color: C.text2, fontSize: 12, fontVariant: ['tabular-nums'] },
  zoomRow: { position: 'absolute', bottom: 124, alignSelf: 'center', flexDirection: 'row', gap: 6, backgroundColor: 'rgba(11,18,32,0.55)', borderRadius: 999, padding: 4 },
  zoomBtn: { minWidth: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 6 },
  zoomOn: { backgroundColor: 'rgba(11,18,32,0.9)' },
  zoomText: { color: C.text, fontSize: 12, fontWeight: '700' },
  zoomTextOn: { color: '#facc15', fontSize: 13 },
  bottomBar: { position: 'absolute', bottom: 24, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30 },
  smallBtn: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginTop: 6, width: 96, alignItems: 'center' },
  smallBtnText: { color: C.text, fontSize: 12 },
});

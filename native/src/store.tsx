// État central de l'app : captures (points recalculés), état du compte, fiches modales.
// Équivalent natif de la partie « données » de web/app.js.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cloudState, initCloud, onCloudChange, onPulled, queueDelete, scheduleSync, stamp, type CloudState } from './cloud';
import { initRegistry } from './registryNative';
import { achievementState, computeStats, levelFor, recomputeAll, type Achievement, type Level } from './shared';
import { clearCaptures, deleteCapture, listCaptures, putCapture } from './storage';
import type { Capture, Identification, Scored } from './types';

export type SaveResult = { capture: Scored; levelUp: Level | null; achievements: Achievement[] };

type IdentifyRequest = { capture: Scored | Capture; resolve: (r: Identification) => void };
type RevealRequest = { capture: Scored; extras: Omit<SaveResult, 'capture'>; resolve: () => void };

type Ctx = {
  list: Scored[];
  cloud: CloudState;
  ready: boolean;
  reload: () => Promise<Scored[]>;
  saveNew: (record: Capture) => Promise<SaveResult>;
  changeType: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  ownedTypes: () => Set<string>;
  // Fiches
  identify: (capture: Scored | Capture) => Promise<Identification>;
  reveal: (capture: Scored, extras: Omit<SaveResult, 'capture'>) => Promise<void>;
  openDetail: (id: string | null) => void;
  identifyReq: IdentifyRequest | null;
  revealReq: RevealRequest | null;
  detailId: string | null;
  toast: (text: string) => void;
  toastText: string | null;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp() {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp hors du fournisseur');
  return v;
}

/** Retire les champs calculés avant d'enregistrer. */
export function rawOf(c: Scored | Capture): Capture {
  const { points, breakdown, ...raw } = c as Scored;
  return raw;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Scored[]>([]);
  const [ready, setReady] = useState(false);
  const [cloud, setCloud] = useState<CloudState>({ ...cloudState() });
  const [identifyReq, setIdentifyReq] = useState<IdentifyRequest | null>(null);
  const [revealReq, setRevealReq] = useState<RevealRequest | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const listRef = useRef<Scored[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reload = useCallback(async () => {
    const next = recomputeAll(await listCaptures());
    listRef.current = next;
    setList(next);
    return next;
  }, []);

  useEffect(() => {
    initRegistry();
    reload().then(() => setReady(true));
    const off1 = onCloudChange((s) => setCloud(s));
    const off2 = onPulled(() => { reload(); });
    initCloud()
      .then(async () => { await reload(); setCloud({ ...cloudState() }); scheduleSync(0); })
      .catch((e) => console.warn('cloud', e));
    return () => { off1(); off2(); };
  }, [reload]);

  const toast = useCallback((text: string) => {
    setToastText(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(null), 2600);
  }, []);

  // Types et séries déjà dans la flotte (« b737-800 », « b737-800.900er »).
  const ownedTypes = useCallback(() => {
    const own = new Set<string>();
    for (const c of listRef.current) {
      if (!c.valid || !c.typeId || c.typeId === 'inconnu') continue;
      own.add(c.typeId);
      if (c.seriesId) own.add(c.seriesId);
    }
    return own;
  }, []);

  /** Enregistre une nouvelle capture et renvoie ce qu'elle a débloqué (niveau, succès). */
  const saveNew = useCallback(async (record: Capture): Promise<SaveResult> => {
    const before = computeStats(listRef.current);
    const beforeAch = new Set(achievementState(before).filter((a) => a.unlocked).map((a) => a.id));
    const beforeLv = levelFor(before.xp).level;
    await putCapture(stamp(record));
    const next = await reload();
    scheduleSync();
    const after = computeStats(next);
    const lv = levelFor(after.xp);
    return {
      capture: next.find((c) => c.id === record.id)!,
      levelUp: lv.level > beforeLv ? lv : null,
      achievements: achievementState(after).filter((a) => a.unlocked && !beforeAch.has(a.id)),
    };
  }, [reload]);

  const identify = useCallback((capture: Scored | Capture) => new Promise<Identification>((resolve) => {
    setIdentifyReq({ capture, resolve: (r) => { setIdentifyReq(null); resolve(r); } });
  }), []);

  const reveal = useCallback((capture: Scored, extras: Omit<SaveResult, 'capture'>) => new Promise<void>((resolve) => {
    setRevealReq({ capture, extras, resolve: () => { setRevealReq(null); resolve(); } });
  }), []);

  const changeType = useCallback(async (id: string) => {
    const c = listRef.current.find((x) => x.id === id);
    if (!c) return;
    const ident = await identify(c);
    const before = c.points;
    await putCapture(stamp({ ...rawOf(c), ...ident }));
    const next = await reload();
    scheduleSync();
    const after = next.find((x) => x.id === id);
    toast(`Carte mise à jour : ${after ? after.points : 0} pts (avant ${before})`);
  }, [identify, reload, toast]);

  const remove = useCallback(async (id: string) => {
    const c = listRef.current.find((x) => x.id === id);
    if (c) await queueDelete(c);
    await deleteCapture(id);
    await reload();
  }, [reload]);

  const clearAll = useCallback(async () => {
    for (const c of listRef.current) await queueDelete(c);
    await clearCaptures();
    await reload();
  }, [reload]);

  const value = useMemo<Ctx>(() => ({
    list, cloud, ready, reload, saveNew, changeType, remove, clearAll, ownedTypes,
    identify, reveal, openDetail: setDetailId, identifyReq, revealReq, detailId, toast, toastText,
  }), [list, cloud, ready, reload, saveNew, changeType, remove, clearAll, ownedTypes,
    identify, reveal, identifyReq, revealReq, detailId, toast, toastText]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

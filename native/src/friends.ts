// Liste d'amis et code ami (fixe), partagés entre la section Amis du Profil et la pastille de l'onglet
// Profil (nombre de demandes reçues). Même logique que web/ui-ranks.js.
import { useEffect, useState } from 'react';
import { fetchFriends, myFriendCode } from './cloud';
import type { FriendRow } from './types';

export type FriendsState = { list: FriendRow[] | null; code: string | null; at: number; error: string | null };

let state: FriendsState = { list: null, code: null, at: 0, error: null };
let pending: Promise<void> | null = null;
const listeners = new Set<(s: FriendsState) => void>();
const emit = () => { for (const fn of listeners) fn(state); };

/** Relit la liste si elle a plus de maxAge ms (1 min par défaut), ou toujours avec force. */
export function loadFriends(force = false, maxAge = 60000): Promise<void> {
  if (pending) return pending;
  if (!force && state.list && Date.now() - state.at < maxAge) return Promise.resolve();
  pending = Promise.all([fetchFriends(), state.code ? Promise.resolve(state.code) : myFriendCode()])
    .then(([list, code]) => { state = { list, code, at: Date.now(), error: null }; })
    .catch((e) => { state = { ...state, error: (e as Error).message }; })
    .finally(() => { pending = null; emit(); });
  return pending;
}

/** À la déconnexion : on oublie tout. */
export function resetFriends() { state = { list: null, code: null, at: 0, error: null }; emit(); }

export function useFriends(): FriendsState {
  const [s, set] = useState(state);
  useEffect(() => { listeners.add(set); set(state); return () => { listeners.delete(set); }; }, []);
  return s;
}

export const incomingCount = (s: FriendsState) => (s.list || []).filter((f) => f.state === 'reçue').length;

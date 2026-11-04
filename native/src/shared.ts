// Règles du jeu partagées avec la version web : une seule source de vérité dans ../web.
// (Metro y a accès grâce à watchFolders dans metro.config.js.)
// Ce fichier ne fait que donner des types TypeScript aux modules JavaScript du web.
import * as catalog from '../../web/catalog.js';
import * as webConfig from '../../web/config.js';
import * as game from '../../web/game.js';
import * as registry from '../../web/registry.js';
import * as validation from '../../web/validation.js';
import * as screen from '../../web/screen.js';
import type { CheckResult, Detection, Scored, Capture, Thresholds } from './types';

export type RarityKey = 'commun' | 'peuCommun' | 'rare' | 'epique' | 'legendaire';
export type Rarity = { label: string; points: number; color: string; glow: string; order: number };
export type AircraftType = { id: string; name: string; maker: string; category: string | null; rarity: RarityKey };

export const RARITIES = catalog.RARITIES as Record<RarityKey, Rarity>;
export const CATEGORIES = catalog.CATEGORIES as Record<string, string>;
export const AIRCRAFT = catalog.AIRCRAFT as AircraftType[];
export const getType = catalog.getType as (id: string | null | undefined) => AircraftType;
export const nearestAirport = catalog.nearestAirport as (lat: number | null, lon: number | null) =>
  { code: string; name: string; km: number } | null;

export const DEFAULT_THRESHOLDS = webConfig.DEFAULT_THRESHOLDS as Thresholds;

// Anti-triche « photo d'écran » : fonctions 'worklet', appelées dans le frame processor.
export const PATCH = screen.PATCH as number;
export const SCREEN_CLASSES = screen.SCREEN_CLASSES as Record<number, string>;
export const findScreenObject = screen.findScreenObject as (
  boxes: Float32Array, classes: Float32Array, scores: Float32Array, count: number,
  xmin: number, ymin: number, xmax: number, ymax: number,
) => { score: number; cls: number };
export const pushMedian = screen.pushMedian as (hist: number[], value: number, k?: number) => number;
export const analyzePatch = screen.analyzePatch as (rgb: Uint8Array, n: number) =>
  { moire: number };

export const checkDetection = validation.checkDetection as (d: Detection | null, t: Thresholds) => CheckResult;

export const recomputeAll = game.recomputeAll as (list: Capture[]) => Scored[];
export const isExcellent = game.isExcellent as (c: Capture) => boolean;

export type Level = { level: number; title: string; floor: number; next: number | null; progress: number };
export const levelFor = game.levelFor as (xp: number) => Level;

export type Stats = {
  xp: number; total: number; valid: number; refused: number; unknown: number; types: number; catalogSize: number;
  makers: number; places: number; days: number; streak: number; excellent: number;
  byRarity: Record<RarityKey, number>; typesByRarity: Record<RarityKey, number>; best: Scored | null; successRate: number;
};
export const computeStats = game.computeStats as (list: Scored[]) => Stats;

export type Achievement = { id: string; icon: string; title: string; desc: string; unlocked: boolean; progress: [number, number] | null };
export const achievementState = game.achievementState as (s: Stats) => Achievement[];

export type RegistryDb = { date: string; source: string; models: [string, string, string | null][]; marks: Record<string, number> };
export type Lookup = { registration: string; make: string; model: string; label: string; typeId: string | null; date: string };
export const setRegistrySource = registry.setRegistrySource as (fn: () => Promise<RegistryDb | null> | RegistryDb | null) => void;
export const loadRegistry = registry.loadRegistry as () => Promise<RegistryDb | null>;
export const normalizeRegistration = registry.normalizeRegistration as (raw: string | null | undefined) => string;
export const lookupRegistration = registry.lookupRegistration as (reg: string) => Promise<Lookup | null>;
export const extractCandidates = registry.extractCandidates as (text: string) => Promise<{ reg: string; score: number }[]>;

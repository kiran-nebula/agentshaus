export type ThemeId = 'haus-green' | 'original' | 'graphite';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  swatches: readonly [string, string, string];
}

export const THEME_STORAGE_KEY = 'agentshaus-theme';
export const DEFAULT_THEME: ThemeId = 'haus-green';

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: 'haus-green',
    label: 'Haus Green',
    description: 'Neutral base with HAUS green reserved for accents.',
    swatches: ['#A5EF41', '#EEF1E8', '#161A13'],
  },
  {
    id: 'original',
    label: 'Original',
    description: 'The warm cream and orange palette from the earlier build.',
    swatches: ['#DD6B20', '#ECE7DD', '#1A1814'],
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Cool neutral palette with a blue accent.',
    swatches: ['#3B82F6', '#E9EDF2', '#131A23'],
  },
] as const;

export function isThemeId(value: string | null): value is ThemeId {
  return value === 'haus-green' || value === 'original' || value === 'graphite';
}

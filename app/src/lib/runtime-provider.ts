export const RUNTIME_PROVIDERS = ['openclaw', 'ironclaw'] as const;

export type RuntimeProvider = (typeof RUNTIME_PROVIDERS)[number];

export const DEFAULT_RUNTIME_PROVIDER: RuntimeProvider = 'openclaw';

export function isRuntimeProvider(value: unknown): value is RuntimeProvider {
  if (typeof value !== 'string') return false;
  return (RUNTIME_PROVIDERS as readonly string[]).includes(
    value.trim().toLowerCase(),
  );
}

export function normalizeRuntimeProvider(value: unknown): RuntimeProvider {
  if (!isRuntimeProvider(value)) return DEFAULT_RUNTIME_PROVIDER;
  return value.trim().toLowerCase() as RuntimeProvider;
}

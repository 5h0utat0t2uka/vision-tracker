export const REGION_EFFECT_OPTIONS = [
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'invert', label: 'Invert' },
  { value: 'none', label: 'None' },
] as const;

export type RegionEffect = (typeof REGION_EFFECT_OPTIONS)[number]['value'];

export function isRegionEffect(value: string): value is RegionEffect {
  return REGION_EFFECT_OPTIONS.some(
    (option) => option.value === value,
  );
}

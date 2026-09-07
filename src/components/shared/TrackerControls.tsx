import type { CameraStatus } from '../../camera/CameraSession.ts'
import {
  isRegionEffect,
  REGION_EFFECT_OPTIONS,
  type RegionEffect,
} from './rendering/regionEffect.ts';

type MetricProps = {
  label: string
  value: string
}
type RegionEffectControlProps = {
  id: string;
  value: RegionEffect;
  onChange: (value: RegionEffect) => void;
};

export function Metric({ label, value }: MetricProps) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function RegionEffectControl({
  id,
  value,
  onChange,
}: RegionEffectControlProps) {
  return (
    <div className="option-row">
      <label htmlFor={id}>Region effect</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          if (isRegionEffect(nextValue)) {
            onChange(nextValue);
          }
        }}
      >
        {REGION_EFFECT_OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type RangeControlProps = {
  id: string
  label: string
  hint?: string
  disabled?: boolean
  min: number
  max: number
  step: number
  value: number
  displayValue: string
  onChange: (value: number) => void
}

export function RangeControl({
  id,
  label,
  hint,
  disabled,
  min,
  max,
  step,
  value,
  displayValue,
  onChange,
}: RangeControlProps) {
  const hintId = `${id}-hint`

  return (
    <div className="range-control">
      <div className="control-label">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{displayValue}</output>
      </div>
      <input
        id={id}
        type="range"
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  )
}

export function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8.5h16m-16 7h16"></path></svg>
    // <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L17.94 6M18 18L6.06 6"></path></svg>
  )
}

type CameraToggleButtonProps = {
  status: CameraStatus
  active: boolean
  disabled?: boolean
  onStart: () => void
  onStop: () => void
}

export function CameraToggleButton({
  status,
  active,
  disabled = false,
  onStart,
  onStop,
}: CameraToggleButtonProps) {
  const blink = status !== 'running'
  const title = active ? 'Stop Camera' : 'Start Camera'

  if (active) {
    return (
      <button type="button" onClick={onStop} aria-label="Abort" title={title}>
        <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24"><path fill="currentColor" d="M.97 3.97a.75.75 0 0 1 1.06 0l15 15a.75.75 0 1 1-1.06 1.06l-15-15a.75.75 0 0 1 0-1.06m16.28 12.09l2.69 2.69c.944.945 2.56.276 2.56-1.06V6.31c0-1.336-1.616-2.005-2.56-1.06l-2.69 2.69zm-1.5-8.56v8.068L4.682 4.5h8.068a3 3 0 0 1 3 3m-14.25 9V7.682l11.773 11.773q-.256.045-.523.045H4.5a3 3 0 0 1-3-3"></path></svg>
      </button>
    )
  }
  return (
    <button type="button" onClick={onStart} aria-label="Start" disabled={disabled} title={title} className={blink ? 'blink' : undefined}>
      <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24"><path fill="currentColor" d="M4.5 4.5a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h8.25a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3zm15.44 14.25l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06"></path></svg>
    </button>
  )
}

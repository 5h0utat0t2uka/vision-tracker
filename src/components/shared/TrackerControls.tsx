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
    <svg width={24} height={24} viewBox="-5 -7 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1 0h5a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2m7 8h5a1 1 0 0 1 0 2H8a1 1 0 1 1 0-2M1 4h12a1 1 0 0 1 0 2H1a1 1 0 1 1 0-2"
      />
    </svg>
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
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10.713 14.713Q11 14.425 11 14v-4q0-.425-.288-.712T10 9t-.712.288T9 10v4q0 .425.288.713T10 15t.713-.288m4 0Q15 14.426 15 14v-4q0-.425-.288-.712T14 9t-.712.288T13 10v4q0 .425.288.713T14 15t.713-.288M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12q0-.8.125-1.6T2.5 8.825q.125-.4.513-.537t.737.062q.375.2.538.588t.037.812q-.15.55-.238 1.113T4 12q0 3.35 2.325 5.675T12 20t5.675-2.325T20 12t-2.325-5.675T12 4q-.6 0-1.187.087T9.65 4.35q-.425.125-.8-.025T8.3 3.8t-.013-.762t.563-.513q.75-.275 1.55-.4T12 2q2.075 0 3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22M4.438 6.563Q4 6.125 4 5.5t.438-1.062T5.5 4t1.063.438T7 5.5t-.437 1.063T5.5 7t-1.062-.437M12 12"
          />
        </svg>
      </button>
    )
  }

  return (
    <button type="button" onClick={onStart} aria-label="Start" disabled={disabled} title={title} className={blink ? 'blink' : undefined}>
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="m10.775 15.475l4.6-3.05q.225-.15.225-.425t-.225-.425l-4.6-3.05q-.25-.175-.513-.038T10 8.926v6.15q0 .3.263.438t.512-.038M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12q0-.8.125-1.6T2.5 8.825q.125-.4.513-.537t.737.062q.375.2.538.588t.037.812q-.15.55-.238 1.113T4 12q0 3.35 2.325 5.675T12 20t5.675-2.325T20 12t-2.325-5.675T12 4q-.6 0-1.187.087T9.65 4.35q-.425.125-.8-.025T8.3 3.8t-.013-.762t.563-.513q.75-.275 1.55-.4T12 2q2.075 0 3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22M4.438 6.563Q4 6.125 4 5.5t.438-1.062T5.5 4t1.063.438T7 5.5t-.437 1.063T5.5 7t-1.062-.437M12 12"
        />
      </svg>
    </button>
  )
}

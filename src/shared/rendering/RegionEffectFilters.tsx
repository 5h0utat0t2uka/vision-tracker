import { FALSE_COLOR_FILTER_MATRIX, FALSE_COLOR_FILTER_TABLES } from './falseColor.ts'

export function RegionEffectFilters() {
  return (
    <svg className="region-effect-definitions" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="region-false-color" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={FALSE_COLOR_FILTER_MATRIX} />
          <feComponentTransfer>
            <feFuncR type="table" tableValues={FALSE_COLOR_FILTER_TABLES[0]} />
            <feFuncG type="table" tableValues={FALSE_COLOR_FILTER_TABLES[1]} />
            <feFuncB type="table" tableValues={FALSE_COLOR_FILTER_TABLES[2]} />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  )
}

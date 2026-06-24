'use client'

import { useState } from 'react'
import { RotateCcw, ChevronDown, ChevronUp, Calculator, Delete } from 'lucide-react'
import { linearInterpolate, formatNumber, parseValue } from '@/lib/interpolation'

type Mode = 'linear' | 'bilinear'

// Field order for the keypad "Next" button — editable inputs only (calculated
// y2 / final result fields are skipped). Bilinear x2 fields are auto-linked, so
// they are skipped too.
const LINEAR_ORDER = ['x1', 'y1', 'x2', 'x3', 'y3'] as const
const BILINEAR_ORDER = [
  'c1value', 'c1x1', 'c1y1', 'c1x3', 'c1y3',
  'c2value', 'c2x1', 'c2y1', 'c2x3', 'c2y3',
  'targetX', 'targetCond',
] as const

// Short, readable rendering of a parsed value for the fraction hint.
function shortNum(n: number): string {
  return String(Math.round(n * 1e6) / 1e6)
}

function CalcInput({ label, value, active, keypadMode, onChange, onFocus }: {
  label: string
  value: string
  active: boolean
  keypadMode: boolean
  onChange: (v: string) => void
  onFocus: () => void
}) {
  const trimmed = value.trim()
  const parsed = parseValue(value)
  const invalid = trimmed !== '' && trimmed !== '-' && parsed === null
  const showFractionHint = !invalid && parsed !== null && value.includes('/')
  return (
    <div>
      <label className="label-base">{label}</label>
      <input
        // text + inputMode lets the on-screen keypad show partial values like "-" or "1/".
        type="text"
        // When the custom keypad is active, suppress the native mobile keyboard but keep
        // the field tappable/selectable (readOnly stays focusable and fires onFocus).
        readOnly={keypadMode}
        inputMode={keypadMode ? 'none' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          onFocus()
          // When the on-screen keypad is up, keep the tapped field visible above it.
          if (keypadMode) {
            const el = e.currentTarget
            setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
          }
        }}
        onClick={onFocus}
        className={`input-base ${active ? 'ring-2 ring-brand-500 border-brand-500' : ''} ${invalid ? 'border-red-400' : ''}`}
        placeholder="0"
      />
      {invalid && <p className="text-xs text-red-600 mt-1">Invalid number or fraction</p>}
      {showFractionHint && <p className="text-xs text-gray-500 mt-1">{trimmed} = {shortNum(parsed!)}</p>}
    </div>
  )
}

export default function InterpolationCalculator() {
  const [mode, setMode] = useState<Mode>('linear')
  const [decimals, setDecimals] = useState(3)
  const [showKeypad, setShowKeypad] = useState(false)
  const [activeField, setActiveField] = useState<string | null>(null)

  const [lin, setLin] = useState({ x1: '', y1: '', x2: '', x3: '', y3: '' })
  const [bi, setBi] = useState({
    c1value: '', c1x1: '', c1y1: '', c1x3: '', c1y3: '',
    c2value: '', c2x1: '', c2y1: '', c2x3: '', c2y3: '',
    targetX: '', targetCond: '',
  })
  const [showDetails, setShowDetails] = useState(false)

  // --- Shared field access (routes to the active mode's state) ---
  function getFieldValue(key: string): string {
    return (mode === 'linear' ? (lin as Record<string, string>) : (bi as Record<string, string>))[key] ?? ''
  }
  function setFieldValue(key: string, val: string) {
    if (mode === 'linear') setLin(p => ({ ...p, [key]: val }))
    else setBi(p => ({ ...p, [key]: val }))
  }

  const order: readonly string[] = mode === 'linear' ? LINEAR_ORDER : BILINEAR_ORDER

  // --- Keypad operations ---
  function pressKey(op: string) {
    const key = activeField ?? order[0]
    if (key !== activeField) setActiveField(key)
    const cur = getFieldValue(key)

    if (op === 'back') { setFieldValue(key, cur.slice(0, -1)); return }
    if (op === 'clear') { setFieldValue(key, ''); return }
    if (op === 'next') {
      const i = order.indexOf(key)
      setActiveField(order[(i + 1) % order.length])
      return
    }
    if (op === '-') {
      setFieldValue(key, cur.startsWith('-') ? cur.slice(1) : '-' + cur)
      return
    }
    if (op === '.') {
      if (!cur.includes('.')) setFieldValue(key, cur === '' ? '0.' : cur + '.')
      return
    }
    if (op === '/') {
      if (!cur.includes('/') && cur !== '' && cur !== '-') setFieldValue(key, cur + '/')
      return
    }
    // digit
    setFieldValue(key, cur + op)
  }

  function resetLinear() { setLin({ x1: '', y1: '', x2: '', x3: '', y3: '' }); setActiveField(null) }
  function resetBilinear() {
    setBi({
      c1value: '', c1x1: '', c1y1: '', c1x3: '', c1y3: '',
      c2value: '', c2x1: '', c2y1: '', c2x3: '', c2y3: '',
      targetX: '', targetCond: '',
    })
    setActiveField(null)
  }

  // --- Linear computation (y2 = y1 + ((x2-x1)/(x3-x1))*(y3-y1)) ---
  const lx1 = parseValue(lin.x1), ly1 = parseValue(lin.y1), lx2 = parseValue(lin.x2), lx3 = parseValue(lin.x3), ly3 = parseValue(lin.y3)
  let linError: string | null = null
  let y2: number | null = null
  if (lx1 !== null && lx3 !== null && lx1 === lx3) {
    linError = 'x1 and x3 cannot be the same.'
  } else if ([lx1, ly1, lx2, lx3, ly3].every(v => v !== null)) {
    y2 = linearInterpolate(lx1!, ly1!, lx3!, ly3!, lx2!)
  }

  // --- Bilinear computation: two condition interpolations, then interpolate between them ---
  const tX = parseValue(bi.targetX)
  const c1v = parseValue(bi.c1value), c2v = parseValue(bi.c2value), tCond = parseValue(bi.targetCond)

  // Condition 1 grid → y2_c1
  const c1x1 = parseValue(bi.c1x1), c1y1 = parseValue(bi.c1y1), c1x3 = parseValue(bi.c1x3), c1y3 = parseValue(bi.c1y3)
  const c1SameX = c1x1 !== null && c1x3 !== null && c1x1 === c1x3
  const y2c1 = (!c1SameX && tX !== null && [c1x1, c1y1, c1x3, c1y3].every(v => v !== null))
    ? linearInterpolate(c1x1!, c1y1!, c1x3!, c1y3!, tX) : null

  // Condition 2 grid → y2_c2
  const c2x1 = parseValue(bi.c2x1), c2y1 = parseValue(bi.c2y1), c2x3 = parseValue(bi.c2x3), c2y3 = parseValue(bi.c2y3)
  const c2SameX = c2x1 !== null && c2x3 !== null && c2x1 === c2x3
  const y2c2 = (!c2SameX && tX !== null && [c2x1, c2y1, c2x3, c2y3].every(v => v !== null))
    ? linearInterpolate(c2x1!, c2y1!, c2x3!, c2y3!, tX) : null

  // Final interpolation between the two conditions
  const condSame = c1v !== null && c2v !== null && c1v === c2v
  const finalResult = (y2c1 !== null && y2c2 !== null && !condSame &&
    c1v !== null && c2v !== null && tCond !== null)
    ? linearInterpolate(c1v, y2c1, c2v, y2c2, tCond) : null

  const biError =
    c1SameX ? 'Condition 1: x1 and x3 cannot be the same.'
    : c2SameX ? 'Condition 2: x1 and x3 cannot be the same.'
    : condSame ? 'Condition 1 and Condition 2 values cannot be the same.'
    : null

  return (
    <div className={`mx-auto space-y-6 max-w-7xl ${showKeypad ? 'pb-72 lg:pb-0' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
          <Calculator className="h-5 w-5 text-brand-700" />
        </div>
        <div>
          <h1 className="page-title">Interpolation Calculator</h1>
          <p className="text-gray-500 mt-0.5 text-sm">Estimate values between known points during tank / fuel calculations.</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
        {([['linear', 'Linear'], ['bilinear', 'Bilinear']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setActiveField(null) }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label} Interpolation
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Decimal places</label>
          <select value={decimals} onChange={(e) => setDecimals(parseInt(e.target.value))} className="input-base w-20 py-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setShowKeypad(s => !s)}
          className="btn-secondary"
        >
          <Calculator className="h-4 w-4" />
          {showKeypad ? 'Hide keypad' : 'Show keypad'}
        </button>
      </div>

      {/* LINEAR MODE — 3×2 grid */}
      {mode === 'linear' && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Row 1 */}
            <CalcInput label="x1" value={lin.x1} active={activeField === 'x1'} keypadMode={showKeypad} onChange={(v) => setLin(p => ({ ...p, x1: v }))} onFocus={() => setActiveField('x1')} />
            <CalcInput label="y1" value={lin.y1} active={activeField === 'y1'} keypadMode={showKeypad} onChange={(v) => setLin(p => ({ ...p, y1: v }))} onFocus={() => setActiveField('y1')} />
            {/* Row 2 — x2 (target) + y2 (result) */}
            <CalcInput label="x2 (target)" value={lin.x2} active={activeField === 'x2'} keypadMode={showKeypad} onChange={(v) => setLin(p => ({ ...p, x2: v }))} onFocus={() => setActiveField('x2')} />
            <div>
              <label className="label-base text-brand-700">y2 (result)</label>
              <div className={`input-base flex items-center font-mono font-semibold ${
                y2 !== null ? 'bg-green-50 border-green-400 text-green-800' : 'bg-brand-50 border-brand-300 text-brand-400'
              }`}>
                {y2 !== null ? formatNumber(y2, decimals) : '?'}
              </div>
            </div>
            {/* Row 3 */}
            <CalcInput label="x3" value={lin.x3} active={activeField === 'x3'} keypadMode={showKeypad} onChange={(v) => setLin(p => ({ ...p, x3: v }))} onFocus={() => setActiveField('x3')} />
            <CalcInput label="y3" value={lin.y3} active={activeField === 'y3'} keypadMode={showKeypad} onChange={(v) => setLin(p => ({ ...p, y3: v }))} onFocus={() => setActiveField('y3')} />
          </div>

          {linError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{linError}</div>
          )}
          {y2 !== null && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
              Interpolated y2 at x2 = {formatNumber(lx2!, decimals)} is {formatNumber(y2, decimals)}
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={resetLinear} className="btn-secondary"><RotateCcw className="h-4 w-4" />Clear</button>
          </div>
        </div>
      )}

      {/* BILINEAR MODE — Condition 1 & 2 side-by-side on desktop, Target full-width.
          On mobile the blocks stack with Target first (order utilities). */}
      {mode === 'bilinear' && (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Helper to render a condition block */}
          {([
            { n: 1, valueKey: 'c1value', x1: 'c1x1', y1: 'c1y1', x3: 'c1x3', y3: 'c1y3', y2: y2c1, orderCls: 'order-2 lg:order-1' },
            { n: 2, valueKey: 'c2value', x1: 'c2x1', y1: 'c2y1', x3: 'c2x3', y3: 'c2y3', y2: y2c2, orderCls: 'order-3 lg:order-2' },
          ] as const).map(blk => {
            const biVals = bi as Record<string, string>
            const set = (key: string) => (v: string) => setBi(p => ({ ...p, [key]: v }))
            return (
              <div key={blk.n} className={`card p-5 space-y-4 ${blk.orderCls}`}>
                <h2 className="section-title">Condition {blk.n} (e.g. Trim {blk.n})</h2>
                <CalcInput
                  label={`Condition ${blk.n} value (e.g. Trim)`}
                  value={biVals[blk.valueKey]} active={activeField === blk.valueKey} keypadMode={showKeypad}
                  onChange={set(blk.valueKey)} onFocus={() => setActiveField(blk.valueKey)}
                />
                <div className="grid grid-cols-2 gap-3">
                  {/* Row 1 */}
                  <CalcInput label="x1" value={biVals[blk.x1]} active={activeField === blk.x1} keypadMode={showKeypad} onChange={set(blk.x1)} onFocus={() => setActiveField(blk.x1)} />
                  <CalcInput label="y1" value={biVals[blk.y1]} active={activeField === blk.y1} keypadMode={showKeypad} onChange={set(blk.y1)} onFocus={() => setActiveField(blk.y1)} />
                  {/* Row 2 — x2 linked from Target X, y2 calculated */}
                  <div>
                    <label className="label-base text-gray-400">x2 (= target x)</label>
                    <div className="input-base flex items-center font-mono bg-gray-50 text-gray-500">
                      {tX !== null ? formatNumber(tX, decimals) : '—'}
                    </div>
                  </div>
                  <div>
                    <label className="label-base text-brand-700">y2 (calculated)</label>
                    <div className={`input-base flex items-center font-mono font-semibold ${
                      blk.y2 !== null ? 'bg-green-50 border-green-400 text-green-800' : 'bg-brand-50 border-brand-300 text-brand-400'
                    }`}>
                      {blk.y2 !== null ? formatNumber(blk.y2, decimals) : '?'}
                    </div>
                  </div>
                  {/* Row 3 */}
                  <CalcInput label="x3" value={biVals[blk.x3]} active={activeField === blk.x3} keypadMode={showKeypad} onChange={set(blk.x3)} onFocus={() => setActiveField(blk.x3)} />
                  <CalcInput label="y3" value={biVals[blk.y3]} active={activeField === blk.y3} keypadMode={showKeypad} onChange={set(blk.y3)} onFocus={() => setActiveField(blk.y3)} />
                </div>
              </div>
            )
          })}

          {/* BLOCK 3 — Target (full width below the conditions on desktop, first on mobile) */}
          <div className="card p-5 space-y-4 order-1 lg:order-3 lg:col-span-2">
            <h2 className="section-title">Target</h2>
            <div className="grid grid-cols-2 gap-3">
              <CalcInput label="Target x (e.g. Sounding/Height)" value={bi.targetX} active={activeField === 'targetX'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, targetX: v }))} onFocus={() => setActiveField('targetX')} />
              <CalcInput label="Target condition (e.g. Trim)" value={bi.targetCond} active={activeField === 'targetCond'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, targetCond: v }))} onFocus={() => setActiveField('targetCond')} />
            </div>

            {biError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{biError}</div>
            )}

            <div>
              <label className="label-base text-brand-700">Final result (e.g. Volume)</label>
              <div className={`rounded-lg border p-4 font-mono ${
                finalResult !== null ? 'bg-green-50 border-green-300' : 'bg-brand-50 border-brand-200'
              }`}>
                <p className={`text-2xl font-bold ${finalResult !== null ? 'text-green-900' : 'text-brand-400'}`}>
                  {finalResult !== null ? formatNumber(finalResult, decimals) : '?'}
                </p>
              </div>
            </div>

            {(y2c1 !== null || y2c2 !== null) && (
              <div>
                <button type="button" onClick={() => setShowDetails(s => !s)} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium">
                  {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Calculation details
                </button>
                {showDetails && (
                  <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600 space-y-1 font-mono">
                    <p>Condition 1 y2 = {y2c1 !== null ? formatNumber(y2c1, decimals) : '—'}</p>
                    <p>Condition 2 y2 = {y2c2 !== null ? formatNumber(y2c2, decimals) : '—'}</p>
                    <p>Final = {finalResult !== null ? formatNumber(finalResult, decimals) : '—'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={resetBilinear} className="btn-secondary"><RotateCcw className="h-4 w-4" />Clear</button>
        </div>
        </>
      )}

      {/* On-screen keypad — sticky at the bottom on mobile, inline on desktop.
          Only affects this calculator. */}
      {showKeypad && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] lg:static lg:inset-auto lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="mx-auto max-w-md lg:max-w-none">
            <Keypad onKey={pressKey} />
          </div>
        </div>
      )}
    </div>
  )
}

// Keypad layout — declared once at module scope so no component is created
// during render (a React Compiler lint requirement).
const KEYPAD_BTN_BASE =
  'h-11 rounded-lg border border-gray-200 bg-white text-gray-800 font-medium text-base active:bg-gray-100 hover:bg-gray-50 transition-colors flex items-center justify-center'

const KEYPAD_KEYS: { op: string; label: React.ReactNode; className?: string }[] = [
  { op: '7', label: '7' }, { op: '8', label: '8' }, { op: '9', label: '9' },
  { op: 'back', label: <Delete className="h-4 w-4" />, className: 'text-gray-500' },
  { op: '4', label: '4' }, { op: '5', label: '5' }, { op: '6', label: '6' },
  { op: 'clear', label: 'C', className: 'text-red-600 text-sm' },
  { op: '1', label: '1' }, { op: '2', label: '2' }, { op: '3', label: '3' },
  { op: '-', label: '−', className: 'text-brand-700 font-bold' },
  { op: '.', label: '.' }, { op: '0', label: '0' },
  { op: '/', label: '/', className: 'text-brand-700 font-bold' },
  { op: 'next', label: 'Next', className: 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700 active:bg-brand-700' },
]

// On-screen keypad — renders inline (below results, never covering them).
function Keypad({ onKey }: { onKey: (op: string) => void }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
      <div className="grid grid-cols-4 gap-2">
        {KEYPAD_KEYS.map(k => (
          <button
            key={k.op}
            type="button"
            onClick={() => onKey(k.op)}
            className={`${KEYPAD_BTN_BASE} ${k.className ?? ''}`}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { RotateCcw, ChevronDown, ChevronUp, Calculator, Delete } from 'lucide-react'
import { linearInterpolate, bilinearInterpolate, formatNumber, parseValue } from '@/lib/interpolation'

type Mode = 'linear' | 'bilinear'

// Field order for the keypad "Next" button (y2 is calculated, so it's skipped).
const LINEAR_ORDER = ['x1', 'y1', 'x2', 'x3', 'y3'] as const
const BILINEAR_ORDER = ['x1', 'x2', 'tx', 'y1', 'y2', 'ty', 'q11', 'q21', 'q12', 'q22'] as const

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
        onFocus={onFocus}
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
    x1: '', x2: '', tx: '', y1: '', y2: '', ty: '', q11: '', q21: '', q12: '', q22: '',
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
    setBi({ x1: '', x2: '', tx: '', y1: '', y2: '', ty: '', q11: '', q21: '', q12: '', q22: '' })
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

  // --- Bilinear computation ---
  function computeBilinear(): { error?: string; r1?: number; r2?: number; result?: number } {
    const v = {
      x1: parseValue(bi.x1), x2: parseValue(bi.x2), tx: parseValue(bi.tx),
      y1: parseValue(bi.y1), y2: parseValue(bi.y2), ty: parseValue(bi.ty),
      q11: parseValue(bi.q11), q21: parseValue(bi.q21), q12: parseValue(bi.q12), q22: parseValue(bi.q22),
    }
    if (Object.values(v).some(x => x === null)) return {}
    if (v.x1 === v.x2) return { error: 'X1 and X2 (Trim) cannot be the same.' }
    if (v.y1 === v.y2) return { error: 'Y1 and Y2 (Sounding) cannot be the same.' }
    const { r1, r2, result } = bilinearInterpolate({
      x1: v.x1!, x2: v.x2!, targetX: v.tx!, y1: v.y1!, y2: v.y2!, targetY: v.ty!,
      q11: v.q11!, q21: v.q21!, q12: v.q12!, q22: v.q22!,
    })
    return { r1, r2, result }
  }
  const biResult = mode === 'bilinear' ? computeBilinear() : null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
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

          {showKeypad && <Keypad onKey={pressKey} />}

          <div className="flex justify-end">
            <button onClick={resetLinear} className="btn-secondary"><RotateCcw className="h-4 w-4" />Clear</button>
          </div>
        </div>
      )}

      {/* BILINEAR MODE */}
      {mode === 'bilinear' && (
        <div className="card p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">X axis — Trim</p>
              <CalcInput label="X1 (Trim)" value={bi.x1} active={activeField === 'x1'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, x1: v }))} onFocus={() => setActiveField('x1')} />
              <CalcInput label="X2 (Trim)" value={bi.x2} active={activeField === 'x2'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, x2: v }))} onFocus={() => setActiveField('x2')} />
              <CalcInput label="Target X (Trim)" value={bi.tx} active={activeField === 'tx'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, tx: v }))} onFocus={() => setActiveField('tx')} />
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Y axis — Sounding / Height</p>
              <CalcInput label="Y1 (Sounding)" value={bi.y1} active={activeField === 'y1'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, y1: v }))} onFocus={() => setActiveField('y1')} />
              <CalcInput label="Y2 (Sounding)" value={bi.y2} active={activeField === 'y2'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, y2: v }))} onFocus={() => setActiveField('y2')} />
              <CalcInput label="Target Y (Sounding)" value={bi.ty} active={activeField === 'ty'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, ty: v }))} onFocus={() => setActiveField('ty')} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Known Volumes (2×2 grid)</p>
            <div className="grid grid-cols-2 gap-3">
              <CalcInput label="Volume at X1 / Y1" value={bi.q11} active={activeField === 'q11'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, q11: v }))} onFocus={() => setActiveField('q11')} />
              <CalcInput label="Volume at X2 / Y1" value={bi.q21} active={activeField === 'q21'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, q21: v }))} onFocus={() => setActiveField('q21')} />
              <CalcInput label="Volume at X1 / Y2" value={bi.q12} active={activeField === 'q12'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, q12: v }))} onFocus={() => setActiveField('q12')} />
              <CalcInput label="Volume at X2 / Y2" value={bi.q22} active={activeField === 'q22'} keypadMode={showKeypad} onChange={(v) => setBi(p => ({ ...p, q22: v }))} onFocus={() => setActiveField('q22')} />
            </div>
          </div>

          {biResult?.error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{biResult.error}</div>
          ) : biResult?.result !== undefined ? (
            <>
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-xs font-medium text-green-700 mb-0.5">Interpolated Volume</p>
                <p className="text-2xl font-bold text-green-900 font-mono">{formatNumber(biResult.result, decimals)}</p>
              </div>
              <div>
                <button type="button" onClick={() => setShowDetails(s => !s)} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium">
                  {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Calculation details
                </button>
                {showDetails && (
                  <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600 space-y-1 font-mono">
                    <p>R1 (along X at Y1) = {formatNumber(biResult.r1!, decimals)}</p>
                    <p>R2 (along X at Y2) = {formatNumber(biResult.r2!, decimals)}</p>
                    <p>Result (along Y) = {formatNumber(biResult.result, decimals)}</p>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {showKeypad && <Keypad onKey={pressKey} />}

          <div className="flex justify-end">
            <button onClick={resetBilinear} className="btn-secondary"><RotateCcw className="h-4 w-4" />Clear</button>
          </div>
        </div>
      )}
    </div>
  )
}

// On-screen keypad — renders inline (below results, never covering them).
function Keypad({ onKey }: { onKey: (op: string) => void }) {
  const Btn = ({ children, op, className = '' }: { children: React.ReactNode; op: string; className?: string }) => (
    <button
      type="button"
      onClick={() => onKey(op)}
      className={`h-11 rounded-lg border border-gray-200 bg-white text-gray-800 font-medium text-base active:bg-gray-100 hover:bg-gray-50 transition-colors flex items-center justify-center ${className}`}
    >
      {children}
    </button>
  )
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
      <div className="grid grid-cols-4 gap-2">
        <Btn op="7">7</Btn><Btn op="8">8</Btn><Btn op="9">9</Btn>
        <Btn op="back" className="text-gray-500"><Delete className="h-4 w-4" /></Btn>
        <Btn op="4">4</Btn><Btn op="5">5</Btn><Btn op="6">6</Btn>
        <Btn op="clear" className="text-red-600 text-sm">C</Btn>
        <Btn op="1">1</Btn><Btn op="2">2</Btn><Btn op="3">3</Btn>
        <Btn op="-" className="text-brand-700 font-bold">−</Btn>
        <Btn op=".">.</Btn><Btn op="0">0</Btn><Btn op="/" className="text-brand-700 font-bold">/</Btn>
        <Btn op="next" className="bg-brand-600 text-white border-brand-600 hover:bg-brand-700 active:bg-brand-700">Next</Btn>
      </div>
    </div>
  )
}

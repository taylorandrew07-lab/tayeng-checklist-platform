'use client'

import { useState } from 'react'
import { RotateCcw, ChevronDown, ChevronUp, Calculator } from 'lucide-react'
import { linearInterpolate, bilinearInterpolate, formatNumber } from '@/lib/interpolation'

type Mode = 'linear' | 'bilinear'

// Parse a user-entered string to a finite number, or null if blank/invalid.
function parse(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return isFinite(n) ? n : null
}

function NumberField({ label, value, onChange, hint }: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
}) {
  return (
    <div>
      <label className="label-base">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base"
        placeholder={hint ?? '0'}
      />
    </div>
  )
}

export default function InterpolationCalculator() {
  const [mode, setMode] = useState<Mode>('linear')
  const [decimals, setDecimals] = useState(3)

  // Linear state
  const [lin, setLin] = useState({ x1: '', y1: '', x2: '', y2: '', tx: '' })
  // Bilinear state
  const [bi, setBi] = useState({
    x1: '', x2: '', tx: '', y1: '', y2: '', ty: '',
    q11: '', q21: '', q12: '', q22: '',
  })
  const [showDetails, setShowDetails] = useState(false)

  function resetLinear() { setLin({ x1: '', y1: '', x2: '', y2: '', tx: '' }) }
  function resetBilinear() {
    setBi({ x1: '', x2: '', tx: '', y1: '', y2: '', ty: '', q11: '', q21: '', q12: '', q22: '' })
  }

  // --- Linear computation ---
  function computeLinear(): { error?: string; y?: number; tx?: number } {
    const x1 = parse(lin.x1), y1 = parse(lin.y1), x2 = parse(lin.x2), y2 = parse(lin.y2), tx = parse(lin.tx)
    if ([x1, y1, x2, y2, tx].some(v => v === null)) return { error: 'Enter valid numbers in all fields.' }
    if (x1 === x2) return { error: 'X1 and X2 cannot be the same (division by zero).' }
    return { y: linearInterpolate(x1!, y1!, x2!, y2!, tx!), tx: tx! }
  }

  // --- Bilinear computation ---
  function computeBilinear(): { error?: string; r1?: number; r2?: number; result?: number } {
    const vals = {
      x1: parse(bi.x1), x2: parse(bi.x2), tx: parse(bi.tx),
      y1: parse(bi.y1), y2: parse(bi.y2), ty: parse(bi.ty),
      q11: parse(bi.q11), q21: parse(bi.q21), q12: parse(bi.q12), q22: parse(bi.q22),
    }
    if (Object.values(vals).some(v => v === null)) return { error: 'Enter valid numbers in all fields.' }
    if (vals.x1 === vals.x2) return { error: 'X1 and X2 (Trim) cannot be the same.' }
    if (vals.y1 === vals.y2) return { error: 'Y1 and Y2 (Sounding) cannot be the same.' }
    const { r1, r2, result } = bilinearInterpolate({
      x1: vals.x1!, x2: vals.x2!, targetX: vals.tx!,
      y1: vals.y1!, y2: vals.y2!, targetY: vals.ty!,
      q11: vals.q11!, q21: vals.q21!, q12: vals.q12!, q22: vals.q22!,
    })
    return { r1, r2, result }
  }

  const linResult = mode === 'linear' ? computeLinear() : null
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
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label} Interpolation
          </button>
        ))}
      </div>

      {/* Decimal places */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Decimal places</label>
        <select
          value={decimals}
          onChange={(e) => setDecimals(parseInt(e.target.value))}
          className="input-base w-20 py-1.5"
        >
          {[0, 1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* LINEAR MODE */}
      {mode === 'linear' && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="X1" value={lin.x1} onChange={(v) => setLin(p => ({ ...p, x1: v }))} />
            <NumberField label="Y1" value={lin.y1} onChange={(v) => setLin(p => ({ ...p, y1: v }))} />
            <NumberField label="X2" value={lin.x2} onChange={(v) => setLin(p => ({ ...p, x2: v }))} />
            <NumberField label="Y2" value={lin.y2} onChange={(v) => setLin(p => ({ ...p, y2: v }))} />
          </div>
          <NumberField label="Target X" value={lin.tx} onChange={(v) => setLin(p => ({ ...p, tx: v }))} />

          {linResult?.error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{linResult.error}</div>
          ) : linResult?.y !== undefined ? (
            <div className="rounded-lg bg-brand-50 border border-brand-200 p-4">
              <p className="text-xs font-medium text-brand-600 mb-0.5">Interpolated Y</p>
              <p className="text-2xl font-bold text-brand-900 font-mono">{formatNumber(linResult.y, decimals)}</p>
              <p className="text-xs text-brand-700 mt-1">
                Interpolated Y at X = {formatNumber(linResult.tx!, decimals)} is {formatNumber(linResult.y, decimals)}
              </p>
            </div>
          ) : null}

          <div className="flex justify-end">
            <button onClick={resetLinear} className="btn-secondary">
              <RotateCcw className="h-4 w-4" />Clear
            </button>
          </div>
        </div>
      )}

      {/* BILINEAR MODE */}
      {mode === 'bilinear' && (
        <div className="card p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* X axis (Trim) */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">X axis — Trim</p>
              <NumberField label="X1 (Trim)" value={bi.x1} onChange={(v) => setBi(p => ({ ...p, x1: v }))} />
              <NumberField label="X2 (Trim)" value={bi.x2} onChange={(v) => setBi(p => ({ ...p, x2: v }))} />
              <NumberField label="Target X (Trim)" value={bi.tx} onChange={(v) => setBi(p => ({ ...p, tx: v }))} />
            </div>
            {/* Y axis (Sounding) */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Y axis — Sounding / Height</p>
              <NumberField label="Y1 (Sounding)" value={bi.y1} onChange={(v) => setBi(p => ({ ...p, y1: v }))} />
              <NumberField label="Y2 (Sounding)" value={bi.y2} onChange={(v) => setBi(p => ({ ...p, y2: v }))} />
              <NumberField label="Target Y (Sounding)" value={bi.ty} onChange={(v) => setBi(p => ({ ...p, ty: v }))} />
            </div>
          </div>

          {/* 2x2 grid of known values */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Known Volumes (2×2 grid)</p>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Volume at X1 / Y1" value={bi.q11} onChange={(v) => setBi(p => ({ ...p, q11: v }))} />
              <NumberField label="Volume at X2 / Y1" value={bi.q21} onChange={(v) => setBi(p => ({ ...p, q21: v }))} />
              <NumberField label="Volume at X1 / Y2" value={bi.q12} onChange={(v) => setBi(p => ({ ...p, q12: v }))} />
              <NumberField label="Volume at X2 / Y2" value={bi.q22} onChange={(v) => setBi(p => ({ ...p, q22: v }))} />
            </div>
          </div>

          {biResult?.error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{biResult.error}</div>
          ) : biResult?.result !== undefined ? (
            <>
              <div className="rounded-lg bg-brand-50 border border-brand-200 p-4">
                <p className="text-xs font-medium text-brand-600 mb-0.5">Interpolated Volume</p>
                <p className="text-2xl font-bold text-brand-900 font-mono">{formatNumber(biResult.result, decimals)}</p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowDetails(s => !s)}
                  className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium"
                >
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

          <div className="flex justify-end">
            <button onClick={resetBilinear} className="btn-secondary">
              <RotateCcw className="h-4 w-4" />Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

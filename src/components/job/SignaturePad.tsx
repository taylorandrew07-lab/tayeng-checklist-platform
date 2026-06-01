'use client'

import { useRef, useEffect, useState } from 'react'
import { Trash2, CheckCircle } from 'lucide-react'

interface SignaturePadProps {
  value: string
  onChange: (data: string) => void
  disabled?: boolean
}

export default function SignaturePad({ value, onChange, disabled = false }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(!!value)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (value && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (!ctx) return
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = value
      setHasSignature(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    if ('touches' in e) {
      const touch = e.touches[0]
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    if (disabled) return
    e.preventDefault()
    setIsDrawing(true)
    lastPos.current = getPos(e)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing || disabled) return
    e.preventDefault()
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const pos = getPos(e)

    ctx.beginPath()
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1e293b'

    if (lastPos.current) {
      ctx.moveTo(lastPos.current.x, lastPos.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    }
    lastPos.current = pos
    setHasSignature(true)
  }

  function endDraw() {
    if (!isDrawing) return
    setIsDrawing(false)
    lastPos.current = null
    const canvas = canvasRef.current!
    onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    onChange('')
  }

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full touch-none cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-gray-400 text-sm">Sign here</p>
          </div>
        )}
      </div>
      {!disabled && (
        <div className="flex items-center justify-between">
          {hasSignature ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="h-3.5 w-3.5" />
              Signed
            </span>
          ) : (
            <span className="text-xs text-gray-400">Draw your signature above</span>
          )}
          <button
            type="button"
            onClick={clear}
            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

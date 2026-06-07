import React from 'react'
import { Svg, Line, Polyline, Text as SvgText, View, Text } from '@react-pdf/renderer'
import { layoutChart, formatTick, type ChartModel } from '../charts'

/** A single trend chart rendered with react-pdf SVG primitives (vector, offline). */
export function CargoChart({ model, width = 535, height = 180 }: { model: ChartModel; width?: number; height?: number }) {
  const L = layoutChart(model, width, height)

  return (
    <View>
      <Svg width={width} height={height}>
        {/* horizontal gridlines + y labels */}
        {L.yTicks.map((t, i) => (
          <React.Fragment key={`y${i}`}>
            <Line x1={L.plot.left} y1={t.y} x2={L.plot.left + L.plot.w} y2={t.y} stroke="#e2e8f0" strokeWidth={0.5} />
            <SvgText x={L.plot.left - 4} y={t.y + 2} style={{ fontSize: 6 }} fill="#94a3b8" textAnchor="end">{formatTick(t.value)}</SvgText>
          </React.Fragment>
        ))}

        {/* x axis + sparse labels */}
        <Line x1={L.plot.left} y1={L.baselineY} x2={L.plot.left + L.plot.w} y2={L.baselineY} stroke="#94a3b8" strokeWidth={0.5} />
        {L.xTicks.map((t, i) => (
          <SvgText key={`x${i}`} x={t.x} y={height - 16} style={{ fontSize: 6 }} fill="#94a3b8" textAnchor="middle">{t.label}</SvgText>
        ))}

        {/* one polyline per contiguous (non-gap) run, per hold */}
        {L.series.map(s => s.segments.map((seg, si) => (
          <Polyline
            key={`${s.key}-${si}`}
            points={seg.map(p => `${p.x},${p.y}`).join(' ')}
            stroke={s.color}
            strokeWidth={1}
            fill="none"
          />
        )))}
      </Svg>

      {/* legend */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
        {L.series.map(s => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8, marginBottom: 2 }}>
            <View style={{ width: 7, height: 7, backgroundColor: s.color, marginRight: 2, borderRadius: 1 }} />
            <Text style={{ fontSize: 6, color: '#475569' }}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

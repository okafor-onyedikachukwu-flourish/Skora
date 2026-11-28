import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { BANDS, formatPercent } from '../lib/db/scores';
import { colors, radius, space } from './theme';

/** A ring that fills to the percentage, with the percentage in the middle. */
export function ScoreRing({ percent, size = 88 }: { percent: number | null; size?: number }) {
  const stroke = Math.round(size / 9);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={percent === null ? 'No score' : `${Math.round(percent)} percent`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.primarySoft} strokeWidth={stroke} fill="none" />
        {filled > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.primary}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * filled} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: size / 4.4, fontWeight: '800', color: colors.text }}>{formatPercent(percent)}</Text>
      </View>
    </View>
  );
}

/** Pass or fail, as a small coloured label. */
export function PassBadge({ pass }: { pass: boolean }) {
  return (
    <View style={[styles.pass, { backgroundColor: pass ? colors.successSoft : colors.warningSoft }]}>
      <Text style={[styles.passText, { color: pass ? colors.success : colors.warning }]}>{pass ? 'Pass' : 'Below the pass mark'}</Text>
    </View>
  );
}

/** One number with a label above it and a line under it. */
export function StatTile({ label, value, note, tone = 'plain' }: { label: string; value: string; note?: string; tone?: 'plain' | 'success' }) {
  const fg = tone === 'success' ? colors.success : colors.text;
  const sub = tone === 'success' ? colors.success : colors.muted;
  return (
    <View style={[styles.tile, tone === 'success' && { backgroundColor: colors.successSoft, borderColor: colors.successSoft }]}>
      <Text style={[styles.tileLabel, { color: sub }]}>{label}</Text>
      <Text style={[styles.tileValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {note ? (
        <Text style={[styles.tileNote, { color: sub }]} numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** Two tiles side by side. */
export function TileRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: space.sm }}>{children}</View>;
}

/** How many scripts fall in each score band, as bars. Bands below the pass mark are orange. */
export function SpreadChart({ spread, passMark }: { spread: number[]; passMark: number }) {
  const most = Math.max(1, ...spread);
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.bars}>
        {spread.map((n, i) => (
          <View key={BANDS[i].label} style={styles.barCol}>
            <Text style={styles.barCount}>{n}</Text>
            <View
              style={[
                styles.bar,
                { height: Math.max(4, Math.round((n / most) * 84)), backgroundColor: BANDS[i].from >= passMark ? colors.primary : colors.accent },
                n === 0 && { backgroundColor: colors.border },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {BANDS.map((b) => (
          <Text key={b.label} style={styles.barLabel}>
            {b.label}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' }}>
        <Legend color={colors.accent} label={`Below ${passMark}%`} />
        <Legend color={colors.primary} label={`${passMark}% or more`} />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
    </View>
  );
}

/** A card that opens something when tapped, with a chevron. */
export function TapCard({ children, onPress, label }: { children: ReactNode; onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tapCard, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: space.md }}>{children}</View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} style={{ marginTop: 2 }} />
    </Pressable>
  );
}

/** A thin progress bar. */
export function ProgressBar({ value, color = colors.primary, track = colors.border, height = 6 }: { value: number; color?: string; track?: string; height?: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(v * 100)}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  pass: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  passText: { fontSize: 13, fontWeight: '700' },
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  tileLabel: { fontSize: 13 },
  tileValue: { fontSize: 24, fontWeight: '800', marginTop: 2 },
  tileNote: { fontSize: 12, marginTop: 1 },
  bars: { flexDirection: 'row', gap: 6, alignItems: 'flex-end', height: 108 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barCount: { fontSize: 12, fontWeight: '700', color: colors.text },
  bar: { alignSelf: 'stretch', borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  barLabel: { flex: 1, fontSize: 10, color: colors.muted, textAlign: 'center' },
  tapCard: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
});

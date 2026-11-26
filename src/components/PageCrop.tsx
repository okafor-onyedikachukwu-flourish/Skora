import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import type { Where } from '../lib/handwriting/parse';
import type { ScriptPage } from '../lib/scan/pending';
import { colors, radius, space } from './theme';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The part of a handwritten page around one answer, with the answer outlined. */
export function PageCrop({ page, where, width }: { page: ScriptPage; where: Where; width: number }) {
  const cw = clamp(Math.max(where.w * 3, 0.4), 0, 1); // crop width, as a share of the page
  const chPx = Math.max(where.h * page.height * 3.2, 90); // crop height in page pixels
  const ch = clamp(chPx / page.height, 0, 1);
  const x0 = clamp(where.x + where.w / 2 - cw / 2, 0, 1 - cw);
  const y0 = clamp(where.y + where.h / 2 - ch / 2, 0, 1 - ch);
  const scale = width / (cw * page.width);
  return (
    <View
      style={{
        width,
        height: ch * page.height * scale,
        overflow: 'hidden',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: '#fff',
      }}
    >
      <Image
        source={{ uri: page.uri }}
        style={{ position: 'absolute', left: -x0 * page.width * scale, top: -y0 * page.height * scale, width: page.width * scale, height: page.height * scale }}
      />
      <Outline where={where} left={-x0 * page.width * scale} top={-y0 * page.height * scale} pageW={page.width * scale} pageH={page.height * scale} />
    </View>
  );
}

function Outline({ where, left, top, pageW, pageH }: { where: Where; left: number; top: number; pageW: number; pageH: number }) {
  const pad = 4;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: left + where.x * pageW - pad,
        top: top + where.y * pageH - pad,
        width: where.w * pageW + pad * 2,
        height: where.h * pageH + pad * 2,
        borderWidth: 2,
        borderColor: colors.accent,
        borderRadius: 6,
      }}
    />
  );
}

/** A whole page, small to fit the screen; tap it to see it larger and slide around it. */
export function PageView({ page, where, width }: { page: ScriptPage; where?: Where; width: number }) {
  const [big, setBig] = useState(false);
  const w = big ? width * 2.2 : width;
  const h = (w * page.height) / page.width;
  const body = (
    <Pressable onPress={() => setBig((b) => !b)} accessibilityLabel={big ? 'Show the page smaller' : 'Show the page larger'}>
      <View style={{ width: w, height: h, backgroundColor: '#fff' }}>
        <Image source={{ uri: page.uri }} style={{ width: w, height: h }} />
        {where ? <Outline where={where} left={0} top={0} pageW={w} pageH={h} /> : null}
      </View>
    </Pressable>
  );
  return (
    <View style={{ borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      {big ? (
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
          {body}
        </ScrollView>
      ) : (
        body
      )}
      <Text style={{ fontSize: 12, color: colors.muted, padding: space.xs, textAlign: 'center' }}>
        {big ? 'Tap to make it smaller. Slide sideways to see more.' : 'Tap the page to make it larger.'}
      </Text>
    </View>
  );
}

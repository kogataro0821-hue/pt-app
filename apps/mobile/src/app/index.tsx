import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatNutrients, scaleByGrams, sumNutrients, toInternal, type Nutrients } from '@pt/core';

import { APP_NAME, isFirebaseConfigured } from '@/config/env';
import { darkTheme, fontSize, lightTheme, radius, space, type ThemeTokens } from '@/theme/tokens';

/**
 * Phase 1 の動作確認画面。
 *
 * 目的:
 *   1. 実機で Expo アプリが起動することを確認する
 *   2. モノレポの @pt/core（PFC計算エンジン）がアプリから呼べることを確認する
 *   3. 設計書 §15「食材合計 == 食事合計」が実機でも成立することを目で見る
 *
 * Phase 5 でカレンダー画面に置き換わります。
 */

const PER_100G = {
  白米: toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 34.6 }),
  鶏ささみ: toInternal({ kcal: 98, p: 23.9, f: 0.8, c: 0.1 }),
  卵: toInternal({ kcal: 142, p: 12.2, f: 10.2, c: 0.4 }),
};

const SAMPLE_ITEMS = [
  { name: '白米', grams: 180, nutrients: scaleByGrams(PER_100G.白米, 180) },
  { name: '鶏ささみ', grams: 150, nutrients: scaleByGrams(PER_100G.鶏ささみ, 150) },
  { name: '卵', grams: 60, nutrients: scaleByGrams(PER_100G.卵, 60) },
];

export default function Home() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
  const insets = useSafeAreaInsets();
  const s = styles(theme);

  const total = sumNutrients(SAMPLE_ITEMS.map((i) => i.nutrients));
  const firebaseReady = isFirebaseConfigured();

  return (
    <>
      <Stack.Screen options={{ title: APP_NAME }} />
      <ScrollView
        style={s.screen}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + space.xxl }]}
      >
        <Text style={s.eyebrow}>PHASE 1 · 動作確認</Text>
        <Text style={s.title}>セットアップが完了しました</Text>
        <Text style={s.lede}>
          モノレポ・Expo・PFC計算エンジンが動いています。この画面は Phase 5
          でカレンダー画面に置き換わります。
        </Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>1食目（サンプル）</Text>
          {SAMPLE_ITEMS.map((item) => (
            <Row
              key={item.name}
              theme={theme}
              label={`${item.name} ${item.grams}g`}
              value={item.nutrients}
            />
          ))}
          <View style={s.divider} />
          <Row theme={theme} label="合計" value={total} emphasis />
          <Text style={s.note}>合計は各食品の値を積み上げて算出しています（設計書 §15）。</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>次のフェーズの準備状況</Text>
          <Status theme={theme} label="Expo アプリ" done />
          <Status theme={theme} label="PFC計算エンジン（@pt/core）" done />
          <Status theme={theme} label="AIスキーマ（@pt/ai-contract）" done />
          <Status
            theme={theme}
            label="Firebase 接続設定（Phase 2）"
            done={firebaseReady}
            hint={firebaseReady ? undefined : '.env が未設定です'}
          />
        </View>
      </ScrollView>
    </>
  );
}

function Row({
  theme,
  label,
  value,
  emphasis,
}: {
  theme: ThemeTokens;
  label: string;
  value: Nutrients;
  emphasis?: boolean;
}) {
  const s = styles(theme);
  const f = formatNutrients(value);
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, emphasis && s.rowLabelStrong]}>{label}</Text>
      <View style={s.macros}>
        <Text style={[s.kcal, emphasis && s.rowLabelStrong]}>{f.kcal}kcal</Text>
        <Text style={[s.macro, { color: theme.p }]}>P {f.p}</Text>
        <Text style={[s.macro, { color: theme.f }]}>F {f.f}</Text>
        <Text style={[s.macro, { color: theme.c }]}>C {f.c}</Text>
      </View>
    </View>
  );
}

function Status({
  theme,
  label,
  done,
  hint,
}: {
  theme: ThemeTokens;
  label: string;
  done: boolean;
  hint?: string;
}) {
  const s = styles(theme);
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.badge, done ? s.badgeOk : s.badgeWait]}>{done ? '完了' : '未設定'}</Text>
      {hint !== undefined && <Text style={s.note}>{hint}</Text>}
    </View>
  );
}

const styles = (t: ThemeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.ground },
    content: { padding: space.lg, gap: space.md },
    eyebrow: {
      color: t.accent,
      fontSize: fontSize.caption,
      letterSpacing: 1.5,
      fontWeight: '600',
    },
    title: { color: t.ink, fontSize: fontSize.display, fontWeight: '700', lineHeight: 36 },
    lede: { color: t.inkMuted, fontSize: fontSize.body, lineHeight: 24 },
    card: {
      backgroundColor: t.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.rule,
      padding: space.lg,
      gap: space.sm,
      marginTop: space.sm,
    },
    cardTitle: {
      color: t.inkFaint,
      fontSize: fontSize.caption,
      letterSpacing: 1,
      fontWeight: '600',
      marginBottom: space.xs,
    },
    row: { gap: space.xs, paddingVertical: space.xs },
    rowLabel: { color: t.ink, fontSize: fontSize.body },
    rowLabelStrong: { fontWeight: '700' },
    macros: { flexDirection: 'row', gap: space.md, alignItems: 'baseline', flexWrap: 'wrap' },
    kcal: { color: t.ink, fontSize: fontSize.small, fontVariant: ['tabular-nums'] },
    macro: { fontSize: fontSize.small, fontVariant: ['tabular-nums'], fontWeight: '600' },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.rule,
      marginVertical: space.sm,
    },
    note: { color: t.inkFaint, fontSize: fontSize.caption, lineHeight: 18 },
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: space.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      fontSize: fontSize.caption,
      fontWeight: '700',
      overflow: 'hidden',
    },
    badgeOk: { backgroundColor: t.accentSoft, color: t.accent },
    badgeWait: { backgroundColor: t.attentionSoft, color: t.attention },
  });

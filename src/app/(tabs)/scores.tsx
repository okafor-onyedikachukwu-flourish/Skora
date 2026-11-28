import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, Text, View } from 'react-native';
import { StatTile, TapCard, TileRow } from '../../components/scores';
import { colors, radius, space } from '../../components/theme';
import { EmptyState, ErrorView, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { examSummaries, formatPercent, type ExamSummary } from '../../lib/db/scores';
import { PHOTOS } from '../../lib/photos';
import { useSettings } from '../../lib/settings';
import { useLoad } from '../../lib/useLoad';
import { whenSaved } from '../../lib/when';

/** Scores tab: each exam's results at a glance. Tap one for the full list. */
export default function Scores() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const passMark = settings?.passMarkPercent ?? 50;
  const { data, loading, error, reload, refreshing, refresh } = useLoad(() => examSummaries(db, passMark), `scores:${passMark}`);

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const exams = data!;
  const scored = exams.filter((e) => e.scripts > 0);
  const waiting = exams.filter((e) => e.scripts === 0);

  if (scored.length === 0) {
    return (
      <Screen>
        <EmptyState
          photo={PHOTOS.books}
          icon="bar-chart-outline"
          title="No saved scores yet"
          text="Scan and save some scripts. Each exam's scores show here, with the class average, pass rate, the questions most students missed, and a spreadsheet to share."
        />
      </Screen>
    );
  }

  const total = scored.reduce((t, e) => t + e.scripts, 0);
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <TileRow>
        <StatTile label="Scripts saved" value={String(total)} />
        <StatTile label="Exams with scores" value={String(scored.length)} />
      </TileRow>

      <SectionTitle>Choose an exam</SectionTitle>
      <View style={{ gap: space.md }}>
        {scored.map((e) => (
          <ExamCard key={e.examId} exam={e} />
        ))}
        {waiting.map((e) => (
          <View key={e.examId} style={styles.waiting}>
            <Ionicons name="document-text-outline" size={20} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>
                {e.title}
              </Text>
              <Text style={styles.sub}>No scores yet. Scan its scripts first.</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={[styles.sub, { marginTop: space.lg }]}>{`Pass mark: ${passMark}%. You can change it in Settings.`}</Text>
    </Screen>
  );
}

function ExamCard({ exam: e }: { exam: ExamSummary }) {
  const saved = e.lastSavedAt ? whenSaved(e.lastSavedAt) : '';
  return (
    <TapCard label={`${e.title}, ${e.scripts} scripts`} onPress={() => router.push({ pathname: '/exams/[id]/scores', params: { id: String(e.examId) } })}>
      <View>
        <Text style={styles.title} numberOfLines={2}>
          {e.title}
        </Text>
        <Text style={styles.sub}>{[e.classNames.join(', '), `${e.scripts} ${e.scripts === 1 ? 'script' : 'scripts'}`, saved ? `last saved ${saved}` : ''].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Mini value={formatPercent(e.averagePercent)} label="average" />
        <Mini value={`${e.passed}/${e.scripts}`} label="passed" good />
        <Mini value={formatPercent(e.highestPercent)} label="highest" />
      </View>
    </TapCard>
  );
}

function Mini({ value, label, good }: { value: string; label: string; good?: boolean }) {
  return (
    <View style={[styles.mini, good && { backgroundColor: colors.successSoft }]}>
      <Text style={[styles.miniValue, good && { color: colors.success }]}>{value}</Text>
      <Text style={[styles.miniLabel, good && { color: colors.success }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  mini: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 },
  miniValue: { fontSize: 18, fontWeight: '800', color: colors.text },
  miniLabel: { fontSize: 12, color: colors.muted },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C9CEDB',
    padding: space.lg,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UpdateBanner } from '../../components/UpdateBanner';
import { ProgressBar, TapCard } from '../../components/scores';
import { colors, radius, space } from '../../components/theme';
import { Badge, Button, EmptyState, ErrorView, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { listClasses } from '../../lib/db/classes';
import { listExams, type Exam } from '../../lib/db/exams';
import { examSummaries, formatPercent, type ExamSummary } from '../../lib/db/scores';
import { optionsLabel } from '../../lib/exams';
import { PHOTOS } from '../../lib/photos';
import { useSettings } from '../../lib/settings';
import { useLoad } from '../../lib/useLoad';
import { whenSaved } from '../../lib/when';

/** Exams tab: carry on scanning, then every exam with its progress. */
export default function Exams() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const passMark = settings?.passMarkPercent ?? 50;
  const { data, loading, error, reload, refreshing, refresh } = useLoad(
    async () => ({ exams: await listExams(db), summaries: await examSummaries(db, passMark), classes: (await listClasses(db)).length }),
    `exams:${passMark}`,
  );

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { exams, summaries, classes } = data!;
  const byId = new Map(summaries.map((s) => [s.examId, s]));

  if (exams.length === 0) {
    return (
      <Screen>
        <UpdateBanner />
        <EmptyState
          photo={PHOTOS.writing}
          icon="document-text-outline"
          title="No exams yet"
          text={
            classes === 0
              ? 'Start by adding the classes you mark for. Then create an exam and set its answer key.'
              : 'Create an exam, set its answer key and marks, then scan the scripts after the exam.'
          }
          action={
            classes === 0 ? (
              <Button icon="people-outline" title="Add your classes" onPress={() => router.push('/classes')} />
            ) : (
              <Button icon="add" title="New exam" onPress={() => router.push('/exams/new')} />
            )
          }
        />
      </Screen>
    );
  }

  // The exam scanned most recently, if its key is ready.
  const latest = summaries.find((s) => s.lastSavedAt !== null);
  const latestExam = latest ? exams.find((e) => e.id === latest.examId) : undefined;
  const carryOn = latest && latestExam && latestExam.keySet === latestExam.questionCount ? { s: latest, e: latestExam } : null;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <UpdateBanner />
      {carryOn ? <CarryOn exam={carryOn.e} summary={carryOn.s} /> : null}

      <SectionTitle>{`${exams.length} ${exams.length === 1 ? 'exam' : 'exams'}`}</SectionTitle>
      <View style={{ gap: space.md }}>
        {exams.map((e) => (
          <ExamCard key={e.id} exam={e} summary={byId.get(e.id)} />
        ))}
      </View>
    </Screen>
  );
}

function CarryOn({ exam: e, summary: s }: { exam: Exam; summary: ExamSummary }) {
  const left = s.listSize - s.scripts;
  return (
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>CONTINUE SCANNING</Text>
      <View>
        <Text style={styles.heroTitle} numberOfLines={2}>
          {e.title}
        </Text>
        <Text style={styles.heroSub}>{[e.classes.map((c) => c.name).join(', '), s.lastSavedAt ? `last saved ${whenSaved(s.lastSavedAt)}` : ''].filter(Boolean).join(' · ')}</Text>
      </View>
      {s.listSize > 0 ? (
        <View style={{ gap: 6 }}>
          <ProgressBar value={s.scripts / s.listSize} color={colors.accent} track="rgba(255,255,255,0.18)" height={8} />
          <Text style={styles.heroSub}>{left > 0 ? `${s.scripts} of ${s.listSize} students saved · ${left} to go` : `${s.scripts} saved · everyone on the class lists`}</Text>
        </View>
      ) : (
        <Text style={styles.heroSub}>{`${s.scripts} ${s.scripts === 1 ? 'script' : 'scripts'} saved`}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/exams/[id]/scan', params: { id: String(e.id) } })}
        style={({ pressed }) => [styles.heroButton, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="camera-outline" size={20} color={colors.primaryDark} />
        <Text style={styles.heroButtonText}>Scan next script</Text>
      </Pressable>
    </View>
  );
}

function ExamCard({ exam: e, summary: s }: { exam: Exam; summary?: ExamSummary }) {
  const ready = e.keySet === e.questionCount;
  return (
    <TapCard label={e.title} onPress={() => router.push({ pathname: '/exams/[id]', params: { id: String(e.id) } })}>
      <View>
        <Text style={styles.title} numberOfLines={2}>
          {e.title}
        </Text>
        <Text style={styles.sub}>{`${e.classes.map((c) => c.name).join(', ')} · ${e.questionCount} questions · ${optionsLabel(e.optionCount)}`}</Text>
      </View>
      {ready ? (
        <View style={styles.badges}>
          <Badge label="Key ready" tone="success" />
          <Badge label={e.saved > 0 ? `${e.saved} saved` : 'None scanned yet'} tone="primary" />
          {s && s.scripts > 0 ? <Badge label={`Average ${formatPercent(s.averagePercent)}`} /> : null}
          {s && s.scripts > 0 ? <Badge label={`${formatPercent((100 * s.passed) / s.scripts)} passed`} /> : null}
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <ProgressBar value={e.questionCount ? e.keySet / e.questionCount : 0} />
            </View>
            <Badge label={`Key ${e.keySet} of ${e.questionCount}`} tone="warning" />
          </View>
          <Text style={[styles.sub, { color: colors.warning, fontWeight: '600' }]}>Finish the answer key before scanning.</Text>
        </View>
      )}
    </TapCard>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.hero, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  heroLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#C9C6FF' },
  heroTitle: { fontSize: 19, fontWeight: '800', color: '#FFFFFF' },
  heroSub: { fontSize: 13, color: '#E4E2FF', marginTop: 3 },
  heroButton: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  heroButtonText: { fontSize: 16, fontWeight: '700', color: colors.primaryDark },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});

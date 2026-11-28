import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../../components/theme';
import { Badge, Banner, Button, EmptyState, ErrorView, Group, ListRow, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { listExams, type Exam } from '../../lib/db/exams';
import { queueCount } from '../../lib/db/queue';
import { examSummaries } from '../../lib/db/scores';
import { PHOTOS } from '../../lib/photos';
import { useSettings } from '../../lib/settings';
import { useLoad } from '../../lib/useLoad';

/** Scan tab: carry on with the exam scanned last, or pick another. */
export default function Scan() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const passMark = settings?.passMarkPercent ?? 50;
  const { data, loading, error, reload, refreshing, refresh } = useLoad(
    async () => ({ exams: await listExams(db), summaries: await examSummaries(db, passMark), queue: await queueCount(db) }),
    `scan:${passMark}`,
  );

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { exams, summaries, queue } = data!;

  if (exams.length === 0) {
    return (
      <Screen>
        <EmptyState
          photo={PHOTOS.pencils}
          icon="scan-outline"
          title="No exams to scan yet"
          text="Create an exam and set its answer key, then come here to scan the scripts."
          action={<Button icon="add" title="New exam" onPress={() => router.push('/exams/new')} />}
        />
      </Screen>
    );
  }

  const ready = (e: Exam) => e.keySet === e.questionCount;
  const open = (e: Exam) => router.push({ pathname: '/exams/[id]/scan', params: { id: String(e.id) } });
  // The exam scanned last; else the newest exam whose key is ready.
  const lastId = summaries.find((s) => s.lastSavedAt !== null)?.examId;
  const main = exams.find((e) => e.id === lastId && ready(e)) ?? exams.find(ready) ?? null;
  const mainSummary = main ? summaries.find((s) => s.examId === main.id) : undefined;
  const others = exams.filter((e) => e.id !== main?.id);
  const left = mainSummary ? mainSummary.listSize - mainSummary.scripts : 0;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {main ? (
        <View style={styles.card}>
          <View style={styles.camera}>
            <Ionicons name="camera-outline" size={34} color={colors.accentText} />
          </View>
          <Text style={styles.label}>{main.saved > 0 ? 'CARRY ON WITH' : 'READY TO SCAN'}</Text>
          <Text style={styles.title}>{main.title}</Text>
          <Text style={styles.sub}>
            {main.saved === 0
              ? `${main.classes.map((c) => c.name).join(', ')} · none saved yet`
              : left > 0
                ? `${main.saved} saved · ${left} on the class ${mainSummary!.listSize === 1 ? 'list' : 'lists'} not scanned yet`
                : `${main.saved} saved`}
          </Text>
          <Button icon="camera-outline" title={main.saved > 0 ? 'Scan next script' : 'Start scanning'} onPress={() => open(main)} style={{ alignSelf: 'stretch', marginTop: space.sm }} />
          <Text style={[styles.sub, { textAlign: 'center' }]}>Skora answer sheets or answers on any paper · works without internet</Text>
        </View>
      ) : (
        <Banner tone="warning" icon="key-outline" title="Set an answer key first" text="Skora marks each script against the exam's answer key. Open an exam below to finish its key." />
      )}

      {queue.total > 0 ? (
        <View style={{ marginTop: space.md }}>
          <Banner
            tone="info"
            icon="time-outline"
            title={`${queue.total} ${queue.total === 1 ? 'script is' : 'scripts are'} kept for later`}
            text={queue.waiting > 0 ? 'Skora asks Gemini about them when you are online.' : 'Gemini has looked at them. Check and save them.'}
            action={<Button small title="Open the waiting list" onPress={() => router.push('/waiting')} />}
          />
        </View>
      ) : null}

      {others.length > 0 ? (
        <>
          <SectionTitle>{main ? 'Or scan another exam' : 'Your exams'}</SectionTitle>
          <Group>
            {others.map((e) => (
              <ListRow
                key={e.id}
                icon="document-text-outline"
                title={e.title}
                subtitle={[e.classes.map((c) => c.name).join(', '), e.saved > 0 ? `${e.saved} saved` : 'none saved yet'].join(' · ')}
                right={ready(e) ? undefined : <Badge label={`Key ${e.keySet}/${e.questionCount}`} tone="warning" />}
                onPress={() => open(e)}
              />
            ))}
          </Group>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
  camera: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  label: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5, color: colors.muted },
  title: { fontSize: 19, fontWeight: '800', color: colors.text, textAlign: 'center' },
  sub: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});

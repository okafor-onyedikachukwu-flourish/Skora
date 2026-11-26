import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Text } from 'react-native';
import { colors, space } from '../../components/theme';
import { Badge, Banner, Button, EmptyState, ErrorView, Group, ListRow, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { listExams } from '../../lib/db/exams';
import { queueCount } from '../../lib/db/queue';
import { PHOTOS } from '../../lib/photos';
import { useLoad } from '../../lib/useLoad';

/** Scan tab: pick the exam, then scan its scripts. */
export default function Scan() {
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useLoad(async () => ({ exams: await listExams(db), queue: await queueCount(db) }), 'exams');
  const exams = data?.exams;

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  if (!exams || exams.length === 0) {
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

  const queue = data!.queue;
  return (
    <Screen>
      {queue.total > 0 ? (
        <Banner
          tone="info"
          icon="time-outline"
          title={`${queue.total} ${queue.total === 1 ? 'script is' : 'scripts are'} kept for later`}
          text={queue.waiting > 0 ? 'Skora asks Gemini about them when you are online.' : 'Gemini has looked at them. Check and save them.'}
          action={<Button small title="Open the waiting list" onPress={() => router.push('/waiting')} />}
        />
      ) : null}
      <Text style={{ fontSize: 15, lineHeight: 21, color: colors.text, marginBottom: space.sm }}>
        Choose the exam, then photograph each script: a Skora answer sheet, or answers written on any paper. You check the score, type the
        name, subject and date, and save.
      </Text>
      <SectionTitle>Which exam?</SectionTitle>
      <Group>
        {exams.map((e) => {
          const ready = e.keySet === e.questionCount;
          return (
            <ListRow
              key={e.id}
              icon="scan-outline"
              title={e.title}
              subtitle={[e.classes.map((c) => c.name).join(', '), e.saved > 0 ? `${e.saved} saved` : 'none saved yet'].join(' · ')}
              right={ready ? undefined : <Badge label={`Key ${e.keySet}/${e.questionCount}`} tone="warning" />}
              onPress={() => router.push({ pathname: '/exams/[id]/scan', params: { id: String(e.id) } })}
            />
          );
        })}
      </Group>
    </Screen>
  );
}

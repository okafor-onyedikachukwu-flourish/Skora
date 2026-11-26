import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Text } from 'react-native';
import { colors, space } from '../../components/theme';
import { Badge, Button, EmptyState, ErrorView, Group, ListRow, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { listExams } from '../../lib/db/exams';
import { PHOTOS } from '../../lib/photos';
import { useLoad } from '../../lib/useLoad';

/** Scan tab: pick the exam, then scan its scripts. */
export default function Scan() {
  const db = useSQLiteContext();
  const { data: exams, loading, error, reload } = useLoad(() => listExams(db), 'exams');

  if (loading) return <LoadingView />;
  if (error && !exams) return <ErrorView message={error} onRetry={reload} />;

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

  return (
    <Screen>
      <Text style={{ fontSize: 15, lineHeight: 21, color: colors.text, marginBottom: space.sm }}>
        Choose the exam, then photograph each Skora answer sheet. You check the score, type the name, subject and date, and save.
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

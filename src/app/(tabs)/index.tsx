import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { UpdateBanner } from '../../components/UpdateBanner';
import { Badge, Button, EmptyState, ErrorView, Group, ListRow, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { listClasses } from '../../lib/db/classes';
import { listExams, type Exam } from '../../lib/db/exams';
import { PHOTOS } from '../../lib/photos';
import { useLoad } from '../../lib/useLoad';

function subtitle(e: Exam) {
  const parts = [e.classes.map((c) => c.name).join(', '), `${e.questionCount} questions`];
  if (e.saved > 0) parts.push(`${e.saved} saved`);
  return parts.join(' · ');
}

/** Exams tab: every exam, newest first. */
export default function Exams() {
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useLoad(async () => ({ exams: await listExams(db), classes: (await listClasses(db)).length }), 'exams');

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { exams, classes } = data!;

  return (
    <Screen>
      <UpdateBanner />
      {exams.length === 0 ? (
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
      ) : (
        <>
          <Button icon="add" title="New exam" onPress={() => router.push('/exams/new')} />
          <SectionTitle>{`${exams.length} ${exams.length === 1 ? 'exam' : 'exams'}`}</SectionTitle>
          <Group>
            {exams.map((e) => {
              const ready = e.keySet === e.questionCount;
              return (
                <ListRow
                  key={e.id}
                  icon="document-text-outline"
                  title={e.title}
                  subtitle={subtitle(e)}
                  right={<Badge label={ready ? 'Key ready' : `Key ${e.keySet}/${e.questionCount}`} tone={ready ? 'success' : 'warning'} />}
                  onPress={() => router.push({ pathname: '/exams/[id]', params: { id: String(e.id) } })}
                />
              );
            })}
          </Group>
        </>
      )}
    </Screen>
  );
}

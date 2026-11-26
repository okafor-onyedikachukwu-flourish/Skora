import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Text } from 'react-native';
import { AddNamesBox } from '../../components/AddNamesBox';
import { colors, space } from '../../components/theme';
import { Banner, EmptyState, ErrorView, Group, ListRow, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { addClasses, listClasses, type ClassRow } from '../../lib/db/classes';
import { friendlyError } from '../../lib/errors';
import { PHOTOS } from '../../lib/photos';
import { useLoad } from '../../lib/useLoad';

function subtitle(c: ClassRow) {
  const list = c.students === 0 ? 'No class list' : `${c.students} ${c.students === 1 ? 'student' : 'students'}`;
  return c.exams === 0 ? list : `${list} · ${c.exams} ${c.exams === 1 ? 'exam' : 'exams'}`;
}

export default function Classes() {
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useLoad(() => listClasses(db), 'classes');
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  async function add(names: string[]) {
    setMessage(null);
    try {
      const added = await addClasses(db, names);
      const skipped = names.length - added;
      if (skipped > 0) setMessage({ tone: 'info', text: `${skipped} ${skipped === 1 ? 'was' : 'were'} already there, so ${skipped === 1 ? 'it was' : 'they were'} skipped.` });
      await reload();
      return true;
    } catch (e) {
      setMessage({ tone: 'danger', text: friendlyError(e) });
      return false;
    }
  }

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const classes = data ?? [];

  return (
    <Screen>
      {message ? <Banner tone={message.tone} icon={message.tone === 'info' ? 'information-circle' : 'alert-circle'} title={message.text} /> : null}
      <AddNamesBox placeholder="e.g. JSS3A, SS1B, SS2 Science" onAdd={add} />
      <Text style={{ fontSize: 12, color: colors.muted, marginTop: space.xs }}>Add several at once by separating them with commas.</Text>

      {classes.length === 0 ? (
        <EmptyState
          photo={PHOTOS.classroom}
          icon="people-outline"
          title="No classes yet"
          text="Add the classes you mark for. Each exam is written by one or more of them, and scores are saved class by class."
        />
      ) : (
        <>
          <SectionTitle>{`${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`}</SectionTitle>
          <Group>
            {classes.map((c) => (
              <ListRow
                key={c.id}
                icon="people-outline"
                title={c.name}
                subtitle={subtitle(c)}
                onPress={() => router.push({ pathname: '/classes/[id]', params: { id: String(c.id) } })}
              />
            ))}
          </Group>
        </>
      )}
    </Screen>
  );
}

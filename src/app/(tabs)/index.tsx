import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { UpdateBanner } from '../../components/UpdateBanner';
import { Button, EmptyState, Screen } from '../../components/ui';
import { listClasses } from '../../lib/db/classes';
import { PHOTOS } from '../../lib/photos';
import { useLoad } from '../../lib/useLoad';

/** Exams tab. Creating exams and answer keys is the next build stage. */
export default function Exams() {
  const db = useSQLiteContext();
  const { data } = useLoad(() => listClasses(db), 'classes');
  const classCount = data?.length ?? 0;

  return (
    <Screen>
      <UpdateBanner />
      <EmptyState
        photo={PHOTOS.writing}
        icon="document-text-outline"
        title="No exams yet"
        text={
          classCount === 0
            ? 'Creating exams and answer keys comes in the next Skora build. Add your classes now so they are ready.'
            : `Creating exams and answer keys comes in the next Skora build. Your ${classCount} ${classCount === 1 ? 'class is' : 'classes are'} ready.`
        }
        action={<Button small variant="secondary" icon="people-outline" title="Your classes" onPress={() => router.push('/classes')} />}
      />
    </Screen>
  );
}

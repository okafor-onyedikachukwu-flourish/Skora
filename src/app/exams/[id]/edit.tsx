import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExamForm } from '../../../components/ExamForm';
import { ErrorView, LoadingView, confirm } from '../../../components/ui';
import { getExam, savedByClass, updateExam } from '../../../lib/db/exams';
import { useLoad } from '../../../lib/useLoad';

export default function EditExam() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useLoad(async () => {
    const exam = await getExam(db, id);
    if (!exam) throw new Error('This exam was deleted.');
    return { exam, saved: await savedByClass(db, id) };
  }, idParam);

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { exam, saved } = data!;

  return (
    <ExamForm
      initial={{ title: exam.title, classIds: exam.classes.map((c) => c.id), questionCount: exam.questionCount, optionCount: exam.optionCount }}
      locked={exam.saved > 0}
      submitLabel="Save changes"
      onSubmit={async (values) => {
        const dropped = exam.classes.filter((c) => !values.classIds.includes(c.id) && (saved.get(c.id) ?? 0) > 0);
        if (dropped.length > 0) {
          const n = dropped.reduce((sum, c) => sum + (saved.get(c.id) ?? 0), 0);
          const names = dropped.map((c) => c.name).join(', ');
          const ok = await confirm(
            `Take ${names} off this exam?`,
            `${n} saved ${n === 1 ? 'score' : 'scores'} for ${names} will be deleted. This can't be undone.`,
            'Delete scores',
          );
          if (!ok) throw new Error(`${names} kept on the exam. Nothing was changed.`);
        }
        await updateExam(db, id, values);
        router.back();
      }}
    />
  );
}

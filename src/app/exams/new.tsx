import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExamForm } from '../../components/ExamForm';
import { createExam } from '../../lib/db/exams';

export default function NewExam() {
  const db = useSQLiteContext();
  return (
    <ExamForm
      submitLabel="Create exam"
      onSubmit={async (values) => {
        const id = await createExam(db, values);
        router.replace({ pathname: '/exams/[id]', params: { id: String(id) } });
      }}
    />
  );
}

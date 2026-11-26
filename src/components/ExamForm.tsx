import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { listClasses } from '../lib/db/classes';
import type { ExamValues } from '../lib/db/exams';
import { friendlyError } from '../lib/errors';
import { MAX_QUESTIONS, optionsLabel } from '../lib/exams';
import { useLoad } from '../lib/useLoad';
import { colors, space } from './theme';
import { Banner, Button, Chip, EmptyState, ErrorView, Field, Input, LoadingView, Screen } from './ui';

export function ExamForm({
  initial,
  submitLabel,
  locked,
  onSubmit,
}: {
  initial?: ExamValues;
  submitLabel: string;
  /** Scores are saved, so the number of questions and options can't change. */
  locked?: boolean;
  onSubmit: (values: ExamValues) => Promise<void>;
}) {
  const db = useSQLiteContext();
  const { data: classes, loading, error, reload } = useLoad(() => listClasses(db), 'classes');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [classIds, setClassIds] = useState<number[]>(initial?.classIds ?? []);
  const [questions, setQuestions] = useState(initial ? String(initial.questionCount) : '');
  const [optionCount, setOptionCount] = useState<4 | 5>(initial?.optionCount ?? 4);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error && !classes) return <ErrorView message={error} onRetry={reload} />;

  if (!classes || classes.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="people-outline"
          title="Add your classes first"
          text="Each exam is written by one or more of your classes. Add them, then come back."
          action={<Button title="Add classes" icon="add" onPress={() => router.push('/classes')} />}
        />
      </Screen>
    );
  }

  function toggle(id: number) {
    setClassIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      await onSubmit({ title, classIds, questionCount: Number(questions), optionCount });
    } catch (e) {
      setMessage(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}
      <Field label="Title">
        <Input value={title} onChangeText={setTitle} placeholder="e.g. First Term Examination" maxLength={120} />
      </Field>
      <Field label="Classes that write it" hint="Choose one or more.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {classes.map((c) => (
            <Chip key={c.id} label={c.name} selected={classIds.includes(c.id)} onPress={() => toggle(c.id)} />
          ))}
          <Chip label="+ Add a class" onPress={() => router.push('/classes')} />
        </View>
      </Field>
      <Field label="Number of questions" hint={locked ? undefined : `1 to ${MAX_QUESTIONS}.`}>
        <Input
          value={questions}
          onChangeText={(t) => setQuestions(t.replace(/\D/g, '').slice(0, 3))}
          keyboardType="number-pad"
          placeholder="e.g. 40"
          editable={!locked}
          style={locked ? { opacity: 0.5 } : undefined}
        />
      </Field>
      <Field label="Options per question">
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {([4, 5] as const).map((n) => (
            <Chip key={n} label={optionsLabel(n)} selected={optionCount === n} disabled={locked} onPress={() => setOptionCount(n)} />
          ))}
        </View>
      </Field>
      {locked ? (
        <Text style={{ fontSize: 13, color: colors.warning, marginBottom: space.md }}>
          Scores are saved for this exam, so the number of questions and options can&apos;t change.
        </Text>
      ) : null}
      <Button title={submitLabel} icon="checkmark" onPress={submit} loading={busy} />
    </Screen>
  );
}

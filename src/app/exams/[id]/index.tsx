import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space } from '../../../components/theme';
import { Banner, Button, Card, ErrorView, Group, ListRow, LoadingView, Screen, SectionTitle, confirm } from '../../../components/ui';
import { deleteExam, getExam } from '../../../lib/db/exams';
import { friendlyError } from '../../../lib/errors';
import { formatMarks, optionsLabel } from '../../../lib/exams';
import { useLoad } from '../../../lib/useLoad';

export default function ExamDetail() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { data: exam, loading, error, reload } = useLoad(async () => {
    const e = await getExam(db, id);
    if (!e) throw new Error('This exam was deleted.');
    return e;
  }, idParam);
  const [message, setMessage] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error && !exam) return <ErrorView message={error} onRetry={reload} />;
  const e = exam!;
  const keyDone = e.keySet === e.questionCount;
  const go = (path: '/exams/[id]/key' | '/exams/[id]/sheets' | '/exams/[id]/edit') => router.push({ pathname: path, params: { id: String(e.id) } });

  async function remove() {
    const extra = e.saved > 0 ? ` and ${e.saved} saved ${e.saved === 1 ? 'score' : 'scores'}` : '';
    if (!(await confirm(`Delete "${e.title}"?`, `Its answer key${extra} will be deleted too. This can't be undone.`))) return;
    try {
      await deleteExam(db, e.id);
      router.back();
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: e.title }} />
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}

      <Card>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{e.title}</Text>
        <Text style={{ fontSize: 15, color: colors.text, marginTop: 4 }}>{e.classes.map((c) => c.name).join(', ')}</Text>
        <Text style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>
          {e.questionCount} questions · options {optionsLabel(e.optionCount)}
          {e.keySet > 0 ? ` · ${formatMarks(e.totalMarks)} in all` : ''}
        </Text>
      </Card>

      {!keyDone ? (
        <View style={{ marginTop: space.md }}>
          <Banner
            tone="warning"
            icon="key-outline"
            title={e.keySet === 0 ? 'Set the answer key first' : `${e.questionCount - e.keySet} questions still need an answer`}
            text="Skora marks every script against the key."
            action={<Button small title="Set the answer key" onPress={() => go('/exams/[id]/key')} />}
          />
        </View>
      ) : null}

      <SectionTitle>Before the exam</SectionTitle>
      <Group>
        <ListRow
          icon="key-outline"
          title="Answer key and marks"
          subtitle={keyDone ? `All ${e.questionCount} answers set · ${formatMarks(e.totalMarks)}` : `${e.keySet} of ${e.questionCount} answers set`}
          right={<Progress value={e.questionCount ? e.keySet / e.questionCount : 0} />}
          onPress={() => go('/exams/[id]/key')}
        />
        <ListRow
          icon="print-outline"
          title="Answer sheets (optional)"
          subtitle="Print Skora bubble sheets, or let students write answers on any paper"
          onPress={() => go('/exams/[id]/sheets')}
        />
      </Group>

      <SectionTitle>After the exam</SectionTitle>
      <Group>
        <ListRow icon="scan-outline" title="Scan scripts" subtitle="Comes in the next Skora build" />
        <ListRow
          icon="bar-chart-outline"
          title="Saved scores"
          subtitle={e.saved === 0 ? 'None yet' : `${e.saved} ${e.saved === 1 ? 'script' : 'scripts'} saved`}
        />
      </Group>

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
        <Button variant="secondary" icon="create-outline" title="Edit" onPress={() => go('/exams/[id]/edit')} style={{ flex: 1 }} />
        <Button variant="danger" icon="trash-outline" title="Delete" onPress={remove} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <View style={{ width: 56, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(value * 100)}%`, height: 6, backgroundColor: value >= 1 ? colors.success : colors.primary }} />
    </View>
  );
}

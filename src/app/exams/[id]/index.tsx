import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ProgressBar } from '../../../components/scores';
import { colors, radius, space } from '../../../components/theme';
import { Banner, Button, Card, ErrorView, LoadingView, Screen, SectionTitle, confirm } from '../../../components/ui';
import { deleteExam, getExam } from '../../../lib/db/exams';
import { examSummaries, formatPercent } from '../../../lib/db/scores';
import { friendlyError } from '../../../lib/errors';
import { formatMarks, optionsLabel } from '../../../lib/exams';
import { useSettings } from '../../../lib/settings';
import { useLoad } from '../../../lib/useLoad';

/** One exam, as steps: answer key, answer sheets, scan, scores. */
export default function ExamDetail() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const passMark = settings?.passMarkPercent ?? 50;
  const { data, loading, error, reload } = useLoad(async () => {
    const e = await getExam(db, id);
    if (!e) throw new Error('This exam was deleted.');
    const summary = (await examSummaries(db, passMark)).find((s) => s.examId === id) ?? null;
    return { exam: e, summary };
  }, `${idParam}:${passMark}`);
  const [message, setMessage] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { exam: e, summary } = data!;
  const keyDone = e.keySet === e.questionCount;
  const params = { id: String(e.id) };
  const listSize = summary?.listSize ?? 0;

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

  const scanNote =
    e.saved === 0
      ? 'Photograph each script; works without internet'
      : listSize > e.saved
        ? `${e.saved} of ${listSize} students saved · works without internet`
        : `${e.saved} saved · works without internet`;

  return (
    <Screen>
      <Stack.Screen options={{ title: e.title }} />
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}

      <Card>
        <Text style={styles.title}>{e.title}</Text>
        <Text style={{ fontSize: 15, color: colors.text, marginTop: 4 }}>{e.classes.map((c) => c.name).join(', ')}</Text>
        <Text style={styles.muted}>
          {e.questionCount} questions · options {optionsLabel(e.optionCount)}
          {e.keySet > 0 ? ` · ${formatMarks(e.totalMarks)} in all` : ''}
        </Text>
      </Card>

      <SectionTitle>Steps</SectionTitle>

      <Step n={1} done={keyDone} current={!keyDone}>
        <StepRow
          title="Answer key and marks"
          note={keyDone ? `All ${e.questionCount} answers set · ${formatMarks(e.totalMarks)}` : `${e.keySet} of ${e.questionCount} answers set`}
          onPress={() => router.push({ pathname: '/exams/[id]/key', params })}
          highlight={!keyDone}
        >
          {!keyDone ? <ProgressBar value={e.questionCount ? e.keySet / e.questionCount : 0} /> : null}
        </StepRow>
      </Step>

      <Step n={2} done={keyDone}>
        <StepRow
          title="Answer sheets"
          optional
          note="Print Skora bubble sheets, or use any paper"
          onPress={() => router.push({ pathname: '/exams/[id]/sheets', params })}
        />
      </Step>

      <Step n={3} done={false} current={keyDone}>
        <View style={[styles.stepCard, keyDone && styles.stepCardOn]}>
          <Text style={styles.stepTitle}>Scan scripts</Text>
          <Text style={styles.stepNote}>{scanNote}</Text>
          {listSize > 0 && e.saved > 0 ? (
            <View style={{ marginTop: space.sm }}>
              <ProgressBar value={e.saved / listSize} />
            </View>
          ) : null}
          {!keyDone ? (
            <Text style={[styles.stepNote, { color: colors.warning, marginTop: space.sm }]}>Finish the answer key first, so Skora can mark every question.</Text>
          ) : null}
          <Button
            icon="camera-outline"
            variant={keyDone ? 'primary' : 'secondary'}
            title={e.saved > 0 ? 'Scan next script' : 'Start scanning'}
            onPress={() => router.push({ pathname: '/exams/[id]/scan', params })}
            style={{ marginTop: space.md }}
          />
        </View>
      </Step>

      <Step n={4} done={false} last>
        <StepRow
          title="Scores"
          note={
            e.saved === 0
              ? 'None saved yet'
              : `Average ${formatPercent(summary?.averagePercent ?? null)} · ${summary?.passed ?? 0} of ${e.saved} passed`
          }
          action={e.saved > 0 ? 'See all' : undefined}
          onPress={e.saved > 0 ? () => router.push({ pathname: '/exams/[id]/scores', params }) : undefined}
        />
      </Step>

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
        <Button variant="secondary" icon="create-outline" title="Edit" onPress={() => router.push({ pathname: '/exams/[id]/edit', params })} style={{ flex: 1 }} />
        <Button variant="danger" icon="trash-outline" title="Delete" onPress={remove} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

/** A numbered step with a line down to the next one. */
function Step({ n, done, current, last, children }: { n: number; done: boolean; current?: boolean; last?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      <View style={{ width: 32, alignItems: 'center' }}>
        <View style={[styles.dot, done ? { backgroundColor: colors.success } : current ? { backgroundColor: colors.primary } : { backgroundColor: colors.primarySoft }]}>
          {done ? (
            <Ionicons name="checkmark" size={18} color="#FFFFFF" />
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '800', color: current ? '#FFFFFF' : colors.primary }}>{n}</Text>
          )}
        </View>
        {!last ? <View style={styles.line} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : space.md }}>{children}</View>
    </View>
  );
}

function StepRow({
  title,
  note,
  optional,
  action,
  highlight,
  onPress,
  children,
}: {
  title: string;
  note: string;
  optional?: boolean;
  action?: string;
  highlight?: boolean;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <View style={[styles.stepCard, highlight && styles.stepCardOn, { flexDirection: 'row', alignItems: 'center', gap: space.sm }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.stepTitle}>
          {title}
          {optional ? <Text style={{ fontWeight: '500', color: colors.muted }}> (optional)</Text> : null}
        </Text>
        <Text style={styles.stepNote}>{note}</Text>
        {children ? <View style={{ marginTop: space.sm }}>{children}</View> : null}
      </View>
      {action ? <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primary }}>{action}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={action ? colors.primary : colors.muted} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  muted: { fontSize: 14, color: colors.muted, marginTop: 4 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, backgroundColor: colors.border, minHeight: 12, marginTop: 2 },
  stepCard: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14 },
  stepCardOn: { borderWidth: 2, borderColor: colors.primary },
  stepTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  stepNote: { fontSize: 13, color: colors.muted },
});

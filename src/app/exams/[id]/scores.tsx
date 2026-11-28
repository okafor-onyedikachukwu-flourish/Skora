import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SpreadChart, StatTile, TileRow } from '../../../components/scores';
import { colors, radius, space } from '../../../components/theme';
import { Banner, Button, Card, Chip, EmptyState, ErrorView, IconButton, LoadingView, Screen, SectionTitle } from '../../../components/ui';
import { getExam } from '../../../lib/db/exams';
import {
  examStats,
  formatPercent,
  formatScore,
  listScripts,
  missedQuestions,
  passes,
  type MissedQuestion,
  type ScriptRow,
} from '../../../lib/db/scores';
import { friendlyError } from '../../../lib/errors';
import { shareScores } from '../../../lib/scoresSheet';
import { useSettings } from '../../../lib/settings';
import { useLoad } from '../../../lib/useLoad';

/** How many students show before "Show all". */
const FIRST = 10;

/** One exam's scores: class average, pass rate, spread, the questions most missed, and every student. */
export default function ExamScores() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const passMark = settings?.passMarkPercent ?? 50;
  const [classId, setClassId] = useState<number | null>(null);
  const [order, setOrder] = useState<'score' | 'name'>('score');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data, loading, error, reload, refreshing, refresh } = useLoad(async () => {
    const exam = await getExam(db, id);
    if (!exam) throw new Error('This exam was deleted.');
    const all = await listScripts(db, id);
    return { exam, all, missed: await missedQuestions(db, id, classId) };
  }, `${idParam}:${classId ?? 'all'}`);

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { exam, all, missed } = data!;
  const scripts = classId === null ? all : all.filter((s) => s.classId === classId);
  const stats = examStats(scripts, passMark);
  const className = classId === null ? null : (exam.classes.find((c) => c.id === classId)?.name ?? null);

  async function share() {
    setBusy(true);
    setMessage(null);
    try {
      await shareScores(db, exam, classId, className, passMark);
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const header = <Stack.Screen options={{ title: exam.title, headerRight: all.length ? () => <IconButton icon="share-outline" label="Share as a spreadsheet" color={colors.primary} onPress={share} /> : undefined }} />;

  if (all.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="bar-chart-outline"
          title="No scores yet"
          text="Scan and save this exam's scripts. Their scores show here."
          action={<Button icon="camera-outline" title="Scan scripts" onPress={() => router.push({ pathname: '/exams/[id]/scan', params: { id: String(id) } })} />}
        />
      </Screen>
    );
  }

  const sorted = order === 'score' ? scripts : [...scripts].sort((a, b) => a.studentName.localeCompare(b.studentName, undefined, { sensitivity: 'base' }));
  const shown = showAll ? sorted : sorted.slice(0, FIRST);
  const places = positions(scripts);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {header}
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}

      {exam.classes.length > 1 ? (
        <View style={styles.chips}>
          <Chip label={`All · ${all.length}`} selected={classId === null} onPress={() => setClassId(null)} />
          {exam.classes.map((c) => (
            <Chip key={c.id} label={`${c.name} · ${all.filter((s) => s.classId === c.id).length}`} selected={classId === c.id} onPress={() => setClassId(c.id)} />
          ))}
        </View>
      ) : null}

      {scripts.length === 0 ? (
        <Card>
          <Text style={styles.body}>{`No scores are saved for ${className ?? 'this class'} yet.`}</Text>
        </Card>
      ) : (
        <>
          <View style={{ gap: space.sm }}>
            <TileRow>
              <StatTile
                label="Class average"
                value={formatPercent(stats.averagePercent)}
                note={stats.averageScore === null ? undefined : `${formatScore(stats.averageScore)} of ${formatScore(stats.maxScore)}`}
              />
              <StatTile
                tone="success"
                label={`Passed (${passMark}% or more)`}
                value={`${stats.passed} of ${stats.scripts}`}
                note={`${formatPercent((100 * stats.passed) / stats.scripts)} · ${stats.scripts - stats.passed} below`}
              />
            </TileRow>
            <TileRow>
              <StatTile
                label="Highest"
                value={stats.highest ? `${formatScore(stats.highest.score)}/${formatScore(stats.highest.maxScore)}` : '–'}
                note={stats.highest?.studentName}
              />
              <StatTile
                label="Lowest"
                value={stats.lowest ? `${formatScore(stats.lowest.score)}/${formatScore(stats.lowest.maxScore)}` : '–'}
                note={stats.lowest ? formatPercent(stats.lowest.percent) : 'Needs 2 or more scripts'}
              />
            </TileRow>
          </View>

          <SectionTitle>How the scores spread</SectionTitle>
          <Card>
            <SpreadChart spread={stats.spread} passMark={passMark} />
          </Card>

          {missed.length > 0 ? (
            <>
              <SectionTitle>Questions most got wrong</SectionTitle>
              <Card style={{ gap: space.md }}>
                <Text style={styles.muted}>Worth going over in class.</Text>
                {missed.map((m) => (
                  <Missed key={m.q} m={m} />
                ))}
              </Card>
            </>
          ) : null}

          <SectionTitle
            right={
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Toggle label="Highest first" on={order === 'score'} onPress={() => setOrder('score')} />
                <Toggle label="A–Z" on={order === 'name'} onPress={() => setOrder('name')} />
              </View>
            }
          >
            {`${scripts.length} ${scripts.length === 1 ? 'student' : 'students'}`}
          </SectionTitle>
          <View style={styles.list}>
            {shown.map((s, i) => (
              <StudentRow key={s.id} s={s} place={places.get(s.id) ?? 0} passMark={passMark} first={i === 0} showClass={classId === null && exam.classes.length > 1} />
            ))}
            {sorted.length > FIRST ? (
              <Pressable onPress={() => setShowAll((v) => !v)} style={styles.more} accessibilityRole="button">
                <Text style={styles.moreText}>{showAll ? 'Show fewer' : `Show all ${sorted.length}`}</Text>
              </Pressable>
            ) : null}
          </View>

          <Button icon="grid-outline" title="Share as a spreadsheet" onPress={share} loading={busy} style={{ marginTop: space.xl }} />
          <Text style={[styles.muted, { textAlign: 'center', marginTop: space.sm }]}>
            Send it on WhatsApp or email, or open it in Excel or Google Sheets.
          </Text>
        </>
      )}
    </Screen>
  );
}

/** Each script's place, highest score first; equal scores share a place. */
function positions(scripts: ScriptRow[]): Map<number, number> {
  const out = new Map<number, number>();
  let place = 0;
  scripts.forEach((s, i) => {
    if (i === 0 || s.score !== scripts[i - 1].score) place = i + 1;
    out.set(s.id, place);
  });
  return out;
}

function Missed({ m }: { m: MissedQuestion }) {
  const w = m.commonWrong;
  const what = !w ? '' : w.chosen === 'blank' ? `${w.count} left it blank` : w.chosen === 'several' ? `${w.count} chose more than one` : `${w.count} chose ${w.chosen}`;
  // Nearly everyone picked the same wrong letter: the key itself may be wrong.
  const checkKey = !!w && w.chosen.length === 1 && w.count >= 0.6 * m.answered && m.answered >= 5;
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
      <View style={styles.qBox}>
        <Text style={styles.qText}>{`Q${m.q}`}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.strong}>{`${m.wrong} of ${m.answered} wrong`}</Text>
        <Text style={styles.muted}>{[what, `the key is ${m.key}`].filter(Boolean).join(' · ')}</Text>
        {checkKey ? <Text style={[styles.muted, { color: colors.warning, fontWeight: '600' }]}>Most chose the same letter. Check the key is right.</Text> : null}
      </View>
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.toggle, on && styles.toggleOn]}>
      <Text style={[styles.toggleText, on && { color: '#FFFFFF' }]}>{label}</Text>
    </Pressable>
  );
}

function StudentRow({ s, place, passMark, first, showClass }: { s: ScriptRow; place: number; passMark: number; first: boolean; showClass: boolean }) {
  const pass = passes(s.percent, passMark);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/scripts/[id]', params: { id: String(s.id) } })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, !first && styles.rowLine, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.place}>{place}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.strong} numberOfLines={1}>
          {s.studentName}
        </Text>
        {showClass ? <Text style={styles.small}>{s.className}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.score}>{`${formatScore(s.score)}/${formatScore(s.maxScore)}`}</Text>
        <Text style={[styles.small, { fontWeight: '700', color: pass ? colors.success : colors.warning }]}>
          {pass ? formatPercent(s.percent) : `${formatPercent(s.percent)} · below`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  small: { fontSize: 12, color: colors.muted },
  strong: { fontSize: 15, fontWeight: '700', color: colors.text },
  qBox: { width: 44, height: 40, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  qText: { fontSize: 14, fontWeight: '800', color: colors.accentText },
  toggle: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  toggleOn: { backgroundColor: colors.text, borderColor: colors.text },
  toggleText: { fontSize: 13, fontWeight: '700', color: colors.text },
  list: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12, paddingHorizontal: space.lg, minHeight: 56 },
  rowLine: { borderTopWidth: 1, borderTopColor: '#EEF0F5' },
  place: { width: 26, fontSize: 13, fontWeight: '700', color: colors.muted },
  score: { fontSize: 15, fontWeight: '800', color: colors.text },
  more: { borderTopWidth: 1, borderTopColor: '#EEF0F5', paddingVertical: 14, alignItems: 'center' },
  moreText: { fontSize: 14, fontWeight: '700', color: colors.primary },
});

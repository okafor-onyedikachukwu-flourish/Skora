import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { DateField } from '../../../components/DateField';
import { PageCrop, PageView } from '../../../components/PageCrop';
import { QuestionCrop } from '../../../components/QuestionCrop';
import { colors, radius, space } from '../../../components/theme';
import { Banner, Button, Card, Chip, EmptyState, ErrorView, Field, Input, LoadingView, Screen, SectionTitle, confirm } from '../../../components/ui';
import { getExam, getKey, type Exam, type KeyRow } from '../../../lib/db/exams';
import { addToQueue, removeFromQueue } from '../../../lib/db/queue';
import { AlreadySaved, knownNames, recentSubjects, saveScript, suggestNames, type Chosen } from '../../../lib/db/scripts';
import { boxFields, type ReadFields } from '../../../lib/handwriting/parse';
import { matchNames, matchOption, sureMatch, type NameMatch } from '../../../lib/nameMatch';
import { readText } from '../../../../modules/skora-text';
import { friendlyError } from '../../../lib/errors';
import { formatMarks, lettersFor, today } from '../../../lib/exams';
import { askGemini, readByOf } from '../../../lib/handwriting/script';
import { describeAnswer, handwrittenAnswers, type ReadAnswer } from '../../../lib/scan/answers';
import {
  clearPending,
  deletePhoto,
  getPending,
  getSaveDefaults,
  releasePending,
  rememberSaveDefaults,
  setLastSaved,
  type GeminiOutcome,
  type PendingScript,
} from '../../../lib/scan/pending';
import { useSettings } from '../../../lib/settings';
import { useLoad } from '../../../lib/useLoad';

/** fixed: the teacher changed the answer; touched: she chose or accepted it, so Gemini leaves it alone. */
type Entry = ReadAnswer & { fixed: boolean; touched: boolean };

export default function ResultScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const [pending] = useState(() => getPending(id));
  const { data, loading, error, reload } = useLoad(async () => {
    const exam = await getExam(db, id);
    if (!exam) throw new Error('This exam was deleted.');
    return { exam, key: await getKey(db, id), subjects: await recentSubjects(db) };
  }, idParam);

  if (!pending) {
    return (
      <Screen>
        <EmptyState icon="scan-outline" title="Nothing to save" text="Scan a script first." action={<Button title="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  return <Result exam={data!.exam} keyRows={data!.key} subjects={data!.subjects} pending={pending} />;
}

function Result({ exam, keyRows, subjects, pending }: { exam: Exam; keyRows: KeyRow[]; subjects: string[]; pending: PendingScript }) {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const defaults = getSaveDefaults(exam.id);
  const [entries, setEntries] = useState<Entry[]>(() =>
    Array.from({ length: exam.questionCount }, (_, i) => ({
      ...(pending.answers[i] ?? { chosen: null, unsure: true, source: 'mlkit' }),
      fixed: false,
      touched: false,
    })),
  );
  const { settings } = useSettings();
  const [gemini, setGemini] = useState<GeminiOutcome | undefined>(pending.gemini);
  const [readBy, setReadBy] = useState(pending.readBy);
  const geminiStop = useRef<AbortController | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showPage, setShowPage] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState(defaults.subject);
  const [writtenOn, setWrittenOn] = useState<string | null>(defaults.writtenOn ?? today());
  const [classId, setClassId] = useState(
    exam.classes.some((c) => c.id === defaults.classId) ? defaults.classId! : (exam.classes[0]?.id ?? 0),
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);
  /** What Skora read from the script's name box or header, and the students it could be. */
  const [fromScript, setFromScript] = useState<{ read: string; matches: NameMatch[]; filled: boolean } | null>(null);
  const typedName = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const handwritten = pending.sheetType === 'handwritten';

  // Read the student's name (and class and subject) from the script, and fill in the form when
  // it clearly matches a student Skora knows. Runs after the screen opens, so it never delays it.
  useEffect(() => {
    let active = true;
    (async () => {
      let fields: ReadFields | undefined = pending.fields;
      const img = pending.fieldsImage;
      if (!fields && img) {
        try {
          const page = await readText(img.uri);
          if (page) fields = boxFields(page, img.rows);
        } catch {
          // Reading the name is a help, not a must.
        } finally {
          deletePhoto(img.uri);
        }
      }
      if (!active || !fields) return;
      const known = await knownNames(db, exam.id);
      if (!active) return;
      const examClassIds = new Set(exam.classes.map((c) => c.id));
      const matches = fields.name ? matchNames(fields.name, known.filter((k) => examClassIds.has(k.classId))) : [];
      const sure = sureMatch(matches);
      const fill = !!sure && !typedName.current;
      if (fill) {
        setName(sure.name);
        setClassId(sure.classId);
      } else if (fields.className) {
        const cls = matchOption(fields.className, exam.classes.map((c) => c.name));
        const found = exam.classes.find((c) => c.name === cls);
        if (found) setClassId(found.id);
      }
      if (fields.subject) {
        const sub = matchOption(fields.subject, subjects);
        setSubject((current) => (current.trim() ? current : (sub ?? current)));
      }
      if (fields.name) setFromScript({ read: fields.name, matches, filled: fill });
    })().catch(() => undefined);
    return () => {
      active = false;
    };
    // Only once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    suggestNames(db, classId, name)
      .then((s) => active && setSuggestions(s.filter((x) => x.toLowerCase() !== name.trim().toLowerCase())))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [db, classId, name]);

  const key = new Map(keyRows.map((k) => [k.q, k]));
  const letters = lettersFor(exam.optionCount);
  let score = 0;
  let right = 0;
  entries.forEach((e, i) => {
    const k = key.get(i + 1);
    if (k && e.chosen === k.option) {
      score += k.marks;
      right++;
    }
  });
  const maxScore = keyRows.reduce((s, k) => s + k.marks, 0);
  const unsure = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.unsure);
  const noGuess = unsure.filter(({ e }) => e.chosen === null).length;
  const blanks = entries.filter((e) => e.chosen === 'blank').length;
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;

  function choose(i: number, chosen: Chosen) {
    setEntries((list) =>
      list.map((e, j) => (j === i ? { ...e, chosen, unsure: false, touched: true, fixed: e.fixed || chosen !== e.chosen } : e)),
    );
    setEditing(null);
  }

  function acceptAll() {
    setEntries((list) => list.map((e) => (e.unsure && e.chosen !== null ? { ...e, unsure: false, touched: true } : e)));
  }

  // Gemini reads the unclear answers while the teacher already sees the score and can fix them.
  async function askGeminiNow() {
    if (!settings || !pending.phone) return;
    geminiStop.current?.abort();
    const stop = new AbortController();
    geminiStop.current = stop;
    setGemini({ state: 'asking' });
    try {
      const r = await askGemini(settings, pending.pages, exam.questionCount, exam.optionCount, stop.signal);
      if (stop.signal.aborted) return;
      if (!r.ok) {
        setGemini({ state: r.retryLater ? 'later' : 'failed', message: r.message });
        return;
      }
      const merged = handwrittenAnswers(pending.phone, r.answers, exam.questionCount);
      setEntries((list) => list.map((e, i) => (e.touched || !merged[i] ? e : { ...merged[i], fixed: false, touched: false })));
      setReadBy(readByOf(pending.phone, r.answers));
      setGemini({ state: 'used' });
    } catch (e) {
      if (!stop.signal.aborted) setGemini({ state: 'failed', message: friendlyError(e) });
    }
  }

  useEffect(() => {
    if (pending.gemini?.state === 'asking') Promise.resolve().then(askGeminiNow);
    return () => geminiStop.current?.abort();
    // Only once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(replace = false) {
    setMessage(null);
    if (unsure.length > 0) return setMessage(`Check the ${unsure.length} highlighted ${unsure.length === 1 ? 'answer' : 'answers'} first.`);
    if (!writtenOn) return setMessage('Choose the date.');
    setBusy(true);
    try {
      const result = await saveScript(db, {
        examId: exam.id,
        classId,
        studentName: name,
        subject,
        writtenOn,
        sheetType: pending.sheetType,
        readBy,
        teacherFixes: entries.filter((e) => e.fixed).length,
        answers: entries.map((e, i) => ({ q: i + 1, chosen: e.chosen ?? 'blank', source: e.fixed ? 'teacher' : e.source })),
        replace,
      });
      rememberSaveDefaults(exam.id, { classId, subject: subject.trim(), writtenOn });
      if (pending.queueId === undefined) setLastSaved({ examId: exam.id, name: name.trim(), score: result.score, maxScore: result.maxScore });
      await finish();
    } catch (e) {
      setBusy(false);
      if (e instanceof AlreadySaved) {
        const className = exam.classes.find((c) => c.id === classId)?.name ?? 'this class';
        if (await confirm('Replace the saved score?', `${e.message.replace('this class', className)} Replace it with this script?`, 'Replace')) {
          await save(true);
        }
        return;
      }
      setMessage(friendlyError(e));
    }
  }

  /** Done with this script: delete its photos, and take it off the waiting list if it was there. */
  async function finish() {
    if (pending.queueId !== undefined) await removeFromQueue(db, pending.queueId);
    clearPending();
    router.back();
  }

  async function discard() {
    const fromList = pending.queueId !== undefined;
    const ok = await confirm(
      'Discard this script?',
      `Nothing is saved and the ${pending.pages.length > 1 ? 'photos are' : 'photo is'} deleted.${fromList ? ' It also leaves the waiting list.' : ''}`,
      'Discard',
    );
    if (!ok) return;
    try {
      await finish();
    } catch (e) {
      setMessage(friendlyError(e));
    }
  }

  async function keepForLater() {
    setBusy(true);
    geminiStop.current?.abort();
    try {
      await addToQueue(db, exam.id, pending.pages, pending.phone ?? [], gemini?.message);
      releasePending();
      setLastSaved({ examId: exam.id, kept: true });
      router.back();
    } catch (e) {
      setBusy(false);
      setMessage(friendlyError(e));
    }
  }

  const cropWidth = Math.min(width - space.lg * 2 - space.md * 2 - 2, 420);
  const canKeep = handwritten && pending.queueId === undefined && (gemini?.state === 'later' || gemini?.state === 'asking');

  return (
    <Screen>
      <Stack.Screen options={{ title: pending.queueId !== undefined ? 'Waiting script' : 'Result' }} />

      <Card>
        <Text style={styles.score}>
          {formatMarks(score)} <Text style={styles.outOf}>of {maxScore}</Text>
        </Text>
        <Text style={{ fontSize: 15, color: colors.text, marginTop: 2 }}>
          {maxScore > 0 ? `${percent}% · ${right} of ${keyRows.length} correct` : 'Set the answer key to see the score.'}
        </Text>
        <Text style={{ fontSize: 14, color: unsure.length ? colors.warning : colors.muted, marginTop: 4 }}>
          {[unsure.length ? `${unsure.length} to check` : 'Nothing to check', blanks ? `${blanks} left blank` : ''].filter(Boolean).join(' · ')}
        </Text>
        {handwritten ? (
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>
            {readBy === 'both' ? 'Read by the phone and Gemini.' : readBy === 'gemini' ? 'Read by Gemini.' : 'Read by the phone.'}
            {unsure.length ? ' The score counts only the answers read so far.' : ''}
          </Text>
        ) : null}
      </Card>

      {gemini?.state === 'asking' ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ flex: 1, fontSize: 14, color: colors.text }}>
            {`Gemini is checking the ${unsure.length} unclear ${unsure.length === 1 ? 'answer' : 'answers'}. You can fix them yourself meanwhile, or save once they are done.`}
          </Text>
        </Card>
      ) : gemini?.state === 'later' ? (
        <Banner
          tone="info"
          icon="cloud-offline-outline"
          title="Gemini could not help this time"
          text={`${gemini.message ?? 'No internet.'} Fix the highlighted answers yourself${canKeep ? ', try again, or keep this script for later: Skora asks Gemini again from the waiting list.' : ', or try again.'}`}
          action={
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {pending.queueId === undefined ? <Button small variant="secondary" title="Try again" icon="refresh" onPress={askGeminiNow} /> : null}
              {canKeep ? <Button small title="Keep for later" icon="time-outline" onPress={keepForLater} loading={busy} /> : null}
            </View>
          }
        />
      ) : gemini?.state === 'failed' ? (
        <Banner tone="warning" icon="alert-circle-outline" title="Gemini could not read this script" text={`${gemini.message ?? ''} Fix the highlighted answers yourself.`.trim()} />
      ) : gemini?.state === 'off' && unsure.length > 0 ? (
        <Banner tone="info" icon="information-circle-outline" title="Gemini is off" text="Only the phone read this script. Turn on Gemini in Settings to help with hard-to-read writing." />
      ) : null}

      {unsure.length > 0 ? (
        <>
          <SectionTitle
            right={unsure.length > noGuess ? <Button small variant="ghost" title="Accept all" onPress={acceptAll} /> : undefined}
          >
            Check these
          </SectionTitle>
          <Text style={{ fontSize: 13, color: colors.muted, marginBottom: space.sm }}>
            {handwritten
              ? `Look at the photo and tap the student's answer.${unsure.length > noGuess ? " Accept all keeps Skora's choices." : ''}`
              : "Faint, rubbed-out or double marks. Look at the photo and tap the student's answer, or Accept all to keep Skora's choice."}
          </Text>
          {unsure.map(({ e, i }) => (
            <Card key={i} style={{ marginBottom: space.sm, borderColor: colors.warning, borderWidth: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>
                Question {i + 1} · {e.chosen === null ? 'Not read' : `Skora read ${describeAnswer(e.chosen)}`}
              </Text>
              {e.note ? <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{e.note}</Text> : null}
              <View style={{ marginTop: space.sm }}>
                {handwritten ? (
                  e.where && pending.pages[e.where.page] ? (
                    <PageCrop page={pending.pages[e.where.page]} where={e.where} width={cropWidth} />
                  ) : (
                    <Button
                      small
                      variant="secondary"
                      icon="document-outline"
                      title={showPage === i ? 'Hide the script' : 'Look at the script'}
                      onPress={() => setShowPage(showPage === i ? null : i)}
                    />
                  )
                ) : (
                  <QuestionCrop uri={pending.pages[0]?.uri ?? ''} index={i} optionCount={exam.optionCount} width={cropWidth} />
                )}
              </View>
              {showPage === i ? (
                <View style={{ marginTop: space.sm, gap: space.sm }}>
                  {pending.pages.map((p, n) => (
                    <PageView key={p.uri} page={p} width={cropWidth} where={e.where?.page === n ? e.where : undefined} />
                  ))}
                </View>
              ) : null}
              <AnswerButtons letters={letters} value={e.chosen} onChoose={(c) => choose(i, c)} />
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle right={<Button small variant="ghost" title={showAll ? 'Hide' : 'Show'} onPress={() => setShowAll((s) => !s)} />}>
        All answers
      </SectionTitle>
      {showAll ? (
        <Card style={{ paddingVertical: space.xs }}>
          {entries.map((e, i) => {
            const k = key.get(i + 1);
            const ok = k && e.chosen !== null ? e.chosen === k.option : null;
            return (
              <View key={i}>
                <Pressable onPress={() => setEditing(editing === i ? null : i)} style={[styles.answerRow, e.unsure && { backgroundColor: colors.warningSoft }]}>
                  <Text style={styles.qNo}>{i + 1}</Text>
                  <Text style={styles.chosen}>
                    {e.chosen === null ? '?' : describeAnswer(e.chosen)}
                    {e.source === 'gemini' && !e.fixed ? <Text style={styles.by}>  Gemini</Text> : null}
                    {e.fixed ? <Text style={styles.by}>  you</Text> : null}
                  </Text>
                  <Text style={styles.keyText}>{k ? `key ${k.option}` : 'no key'}</Text>
                  <Text style={[styles.mark, { color: ok ? colors.success : ok === false ? colors.danger : colors.faint }]}>
                    {ok ? '✓' : ok === false ? '✗' : '–'}
                  </Text>
                </Pressable>
                {editing === i ? <AnswerButtons letters={letters} value={e.chosen} onChoose={(c) => choose(i, c)} /> : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      {handwritten && unsure.length === 0 ? (
        <>
          <SectionTitle right={<Button small variant="ghost" title={showPage === -1 ? 'Hide' : 'Show'} onPress={() => setShowPage(showPage === -1 ? null : -1)} />}>
            {pending.pages.length > 1 ? 'The pages' : 'The page'}
          </SectionTitle>
          {showPage === -1 ? (
            <View style={{ gap: space.sm, marginBottom: space.md }}>
              {pending.pages.map((p) => (
                <PageView key={p.uri} page={p} width={Math.min(width - space.lg * 2, 460)} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <SectionTitle>Save this script</SectionTitle>
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}
      <Card>
        <Field label="Student's name">
          <Input
            value={name}
            onChangeText={(t) => {
              typedName.current = true;
              setName(t);
            }}
            placeholder="As written on the script"
            autoCapitalize="words"
            maxLength={120}
          />
        </Field>
        {fromScript ? (
          fromScript.filled && name === fromScript.matches[0]?.name ? (
            <Text style={{ fontSize: 13, color: colors.success, marginTop: -space.sm, marginBottom: space.md }}>
              {`Read from the script ("${fromScript.read}"). Check it is right.`}
            </Text>
          ) : !fromScript.filled ? (
            <View style={{ marginTop: -space.sm, marginBottom: space.sm }}>
              <Text style={{ fontSize: 13, color: colors.muted, marginBottom: space.xs }}>
                {fromScript.matches.length > 0 ? `The script says "${fromScript.read}". Is it one of these?` : `The script says "${fromScript.read}".`}
              </Text>
              <View style={styles.chips}>
                {(fromScript.matches.length > 0 ? fromScript.matches : [{ name: fromScript.read, classId, score: 0 }]).map((m) => (
                  <Chip
                    key={`${m.classId}:${m.name}`}
                    label={m.name}
                    onPress={() => {
                      setName(m.name);
                      if (exam.classes.some((c) => c.id === m.classId)) setClassId(m.classId);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null
        ) : null}
        {suggestions.length > 0 ? (
          <View style={styles.chips}>
            {suggestions.map((s) => (
              <Chip key={s} label={s} onPress={() => setName(s)} />
            ))}
          </View>
        ) : null}
        <Field label="Subject">
          <Input value={subject} onChangeText={setSubject} placeholder="e.g. Mathematics" autoCapitalize="words" maxLength={80} />
        </Field>
        {subjects.length > 0 ? (
          <View style={styles.chips}>
            {subjects
              .filter((s) => s.toLowerCase() !== subject.trim().toLowerCase())
              .slice(0, 5)
              .map((s) => (
                <Chip key={s} label={s} onPress={() => setSubject(s)} />
              ))}
          </View>
        ) : null}
        <Field label="Date">
          <DateField value={writtenOn} onChange={setWrittenOn} />
        </Field>
        {exam.classes.length > 1 ? (
          <Field label="Class">
            <View style={styles.chips}>
              {exam.classes.map((c) => (
                <Chip key={c.id} label={c.name} selected={classId === c.id} onPress={() => setClassId(c.id)} />
              ))}
            </View>
          </Field>
        ) : null}
        <Button
          title="Save"
          icon="checkmark"
          onPress={() => save()}
          loading={busy}
          disabled={name.trim().length < 2 || !subject.trim() || unsure.length > 0}
        />
        {unsure.length > 0 ? (
          <Text style={{ fontSize: 13, color: colors.warning, marginTop: space.sm, textAlign: 'center' }}>
            Check the highlighted answers above before saving.
          </Text>
        ) : null}
      </Card>

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        {pending.queueId === undefined ? (
          <Button
            variant="secondary"
            icon="camera-outline"
            title="Scan again"
            onPress={() => {
              clearPending();
              router.back();
            }}
            style={{ flex: 1 }}
          />
        ) : null}
        <Button variant="danger" icon="trash-outline" title="Discard" onPress={discard} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

function AnswerButtons({ letters, value, onChoose }: { letters: string[]; value: Chosen | null; onChoose: (c: Chosen) => void }) {
  const options: Chosen[] = [...(letters as Chosen[]), 'blank', 'several'];
  return (
    <View style={[styles.chips, { marginTop: space.sm }]}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChoose(o)}
          accessibilityLabel={describeAnswer(o)}
          accessibilityState={{ selected: value === o }}
          style={[styles.answerButton, value === o && styles.answerButtonOn, o.length > 1 && { paddingHorizontal: space.md }]}
        >
          <Text style={[styles.answerButtonText, value === o && { color: '#fff' }]}>{describeAnswer(o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  score: { fontSize: 30, fontWeight: '800', color: colors.text },
  outOf: { fontSize: 18, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  answerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: space.xs, borderRadius: radius.sm, gap: space.md },
  qNo: { width: 32, textAlign: 'right', fontWeight: '700', color: colors.text },
  chosen: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  by: { fontSize: 12, fontWeight: '500', color: colors.faint },
  keyText: { fontSize: 13, color: colors.muted },
  mark: { width: 20, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  answerButton: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerButtonOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  answerButtonText: { fontSize: 15, fontWeight: '700', color: colors.muted },
});

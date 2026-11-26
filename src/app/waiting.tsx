import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { colors, space } from '../components/theme';
import { Badge, Banner, Button, EmptyState, ErrorView, Group, ListRow, LoadingView, Screen, SectionTitle } from '../components/ui';
import { getExam } from '../lib/db/exams';
import { listQueue, type QueueEntry } from '../lib/db/queue';
import { friendlyError } from '../lib/errors';
import { askGeminiForWaiting, pendingFromQueue } from '../lib/handwriting/script';
import { setPending } from '../lib/scan/pending';
import { useSettings } from '../lib/settings';
import { useLoad } from '../lib/useLoad';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Handwritten scripts kept for later, until Gemini has read them and the teacher saves them. */
export default function Waiting() {
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const { data: items, loading, error, reload } = useLoad(() => listQueue(db), 'queue');
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'warning'; text: string } | null>(null);
  const triedOnOpen = useRef(false);
  const waiting = (items ?? []).filter((e) => e.status === 'waiting').length;

  async function ask() {
    if (!settings || asking) return;
    setNotice(null);
    setAsking('Asking Gemini…');
    try {
      const r = await askGeminiForWaiting(db, settings, (done, total) => setAsking(`Asking Gemini… ${done + 1 > total ? total : done + 1} of ${total}`));
      if (r.stopped) setNotice({ tone: 'warning', text: `${r.read > 0 ? `Gemini read ${r.read}. ` : ''}${r.stopped}` });
      else if (r.read > 0) setNotice({ tone: 'success', text: `Gemini read ${r.read} ${r.read === 1 ? 'script' : 'scripts'}. Open each one to check and save it.` });
    } catch (e) {
      setNotice({ tone: 'warning', text: friendlyError(e) });
    } finally {
      setAsking(null);
      reload();
    }
  }

  // Try once when the list opens, so scripts get read as soon as the phone is back online.
  useEffect(() => {
    if (triedOnOpen.current || !items || !settings?.geminiOn) return;
    if (items.some((e) => e.status === 'waiting')) {
      triedOnOpen.current = true;
      Promise.resolve().then(ask);
    }
    // ask() is safe to call here: it only reads the latest settings and list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, settings?.geminiOn]);

  async function open(entry: QueueEntry) {
    try {
      const exam = await getExam(db, entry.examId);
      if (!exam) throw new Error('This exam was deleted.');
      setPending(pendingFromQueue(entry, exam.questionCount));
      router.push({ pathname: '/exams/[id]/result', params: { id: String(entry.examId) } });
    } catch (e) {
      setNotice({ tone: 'warning', text: friendlyError(e) });
    }
  }

  if (loading) return <LoadingView />;
  if (error && !items) return <ErrorView message={error} onRetry={reload} />;
  if (!items || items.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="checkmark-done-outline"
          title="Nothing waiting"
          text="When Gemini cannot be reached while you scan a handwritten script, you can keep the script here and save it later."
          action={<Button title="Back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {!settings?.geminiOn ? (
        <Banner tone="info" icon="information-circle-outline" title="Gemini is off" text="Turn it on in Settings to have these scripts read, or open each one and fix it by hand." />
      ) : null}
      {notice ? <Banner tone={notice.tone} icon={notice.tone === 'success' ? 'checkmark-circle' : 'alert-circle-outline'} title={notice.text} /> : null}

      {waiting > 0 && settings?.geminiOn ? (
        <Button
          icon="sparkles-outline"
          title={asking ?? `Ask Gemini now (${waiting})`}
          onPress={ask}
          disabled={asking !== null}
          style={{ marginBottom: space.md }}
        />
      ) : null}

      <SectionTitle>{`${items.length} ${items.length === 1 ? 'script' : 'scripts'}`}</SectionTitle>
      <Group>
        {items.map((e) => (
          <ListRow
            key={e.id}
            icon="document-text-outline"
            title={e.examTitle}
            subtitle={[
              `Kept ${when(e.createdAt)}`,
              e.status === 'read' ? 'Gemini has read it' : e.status === 'failed' ? (e.lastError ?? 'Gemini could not read it') : `${e.unclear} to check`,
            ].join(' · ')}
            right={
              <Badge
                label={e.status === 'read' ? 'Ready' : e.status === 'failed' ? 'By hand' : 'Waiting'}
                tone={e.status === 'read' ? 'success' : 'warning'}
              />
            }
            onPress={() => open(e)}
          />
        ))}
      </Group>
      <Text style={{ fontSize: 13, color: colors.muted, marginTop: space.md }}>
        Open a script to check its answers, type the student&apos;s name and save it, or discard it. You can also fix a waiting script by hand without Gemini.
      </Text>
    </Screen>
  );
}

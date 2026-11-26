import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Paths } from 'expo-file-system';
import { colors, radius, space } from '../../../components/theme';
import { Button, EmptyState, ErrorView, LoadingView } from '../../../components/ui';
import { getExam, type Exam } from '../../../lib/db/exams';
import { queuedPhotoNames } from '../../../lib/db/queue';
import { friendlyError } from '../../../lib/errors';
import { formatMarks } from '../../../lib/exams';
import { MAX_PAGES, preparePage, readHandwrittenScript, type PreparedPage } from '../../../lib/handwriting/script';
import { omrAnswers } from '../../../lib/scan/answers';
import { deletePhoto, getScanMode, setPending, setScanMode, takeLastSaved, tidyScanPhotos, type ScanMode } from '../../../lib/scan/pending';
import { loadPhoto, saveGrayJpeg } from '../../../lib/scan/photo';
import { READ_HINTS, readSheet, straighten } from '../../../lib/scan/read';
import { useSettings } from '../../../lib/settings';
import { useLoad } from '../../../lib/useLoad';

export default function ScanScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const { data: exam, loading, error, reload } = useLoad(async () => {
    const e = await getExam(db, Number(idParam));
    if (!e) throw new Error('This exam was deleted.');
    return e;
  }, idParam);

  if (loading || !permission) return <LoadingView />;
  if (error && !exam) return <ErrorView message={error} onRetry={reload} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
        <EmptyState
          icon="camera-outline"
          title="Allow the camera"
          text="Skora needs the camera to photograph answer scripts. Photos stay on this phone and are deleted after you save or discard."
          action={
            <Button
              title={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
              onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
            />
          }
        />
      </View>
    );
  }
  return <Scanner exam={exam!} />;
}

type Notice = { tone: 'warning' | 'success'; title: string; text: string };

function Scanner({ exam }: { exam: Exam }) {
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saved, setSaved] = useState(exam.saved);
  const [mode, setMode] = useState<ScanMode>(() => getScanMode(exam.id));
  const [pages, setPages] = useState<PreparedPage[]>([]);
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    queuedPhotoNames(db)
      .then((names) => tidyScanPhotos(names))
      .catch(() => undefined);
    // Pages photographed but never read are deleted when the camera closes.
    return () => {
      for (const p of pagesRef.current) deletePhoto(p.uri);
    };
  }, [db]);

  // Coming back from the result screen: show what was just saved or kept.
  useFocusEffect(
    useCallback(() => {
      const last = takeLastSaved(exam.id);
      if (!last) return;
      if (last.kept) {
        setNotice({ tone: 'success', title: 'Kept for later', text: 'Find it on the Scan tab. Skora asks Gemini about it when you are online.' });
        return;
      }
      setSaved((n) => n + 1);
      setNotice({ tone: 'success', title: `Saved: ${last.name}`, text: `${formatMarks(last.score)} of ${last.maxScore}. Scan the next script.` });
    }, [exam.id]),
  );

  function switchMode(next: ScanMode) {
    if (next === mode) return;
    for (const p of pages) deletePhoto(p.uri);
    setPages([]);
    setNotice(null);
    setMode(next);
    setScanMode(exam.id, next);
  }

  async function readSkoraSheet(uri: string, width: number, height: number) {
    const g = await loadPhoto(uri, width, height);
    dropCacheCopy(uri);
    const read = readSheet(g, { questionCount: exam.questionCount, optionCount: exam.optionCount });
    if (!read.ok) {
      setNotice({
        tone: 'warning',
        title: 'Try again',
        text:
          read.reason === 'no-markers'
            ? `${READ_HINTS['no-markers']} For answers written on plain paper, switch to Any paper above.`
            : READ_HINTS[read.reason],
      });
      return;
    }
    // A straightened copy of the page lets the teacher check unclear answers on the result screen.
    const page = straighten(g, read.toImage, 3);
    const imageUri = saveGrayJpeg(page, `${randomUUID()}.jpg`, 70);
    setPending({
      examId: exam.id,
      sheetType: 'omr',
      pages: [{ uri: imageUri, width: page.width, height: page.height }],
      answers: omrAnswers(read.answers, exam.questionCount),
      readBy: 'phone',
    });
    router.push({ pathname: '/exams/[id]/result', params: { id: String(exam.id) } });
  }

  /** Adds page photos to the handwritten script being photographed; returns all its pages. */
  async function addPages(uris: string[]): Promise<PreparedPage[]> {
    const room = MAX_PAGES - pages.length;
    const added: PreparedPage[] = [];
    for (const uri of uris.slice(0, room)) {
      added.push(await preparePage(uri));
      dropCacheCopy(uri);
    }
    const all = [...pages, ...added];
    setPages(all);
    if (uris.length > room) {
      setNotice({ tone: 'warning', title: `${MAX_PAGES} pages at most`, text: `Skora reads up to ${MAX_PAGES} pages of one script. The rest were left out.` });
    }
    return all;
  }

  async function readScript(list: PreparedPage[]) {
    if (list.length === 0) return;
    if (!settings) throw new Error('Skora is still starting. Try again in a moment.');
    const r = await readHandwrittenScript({
      examId: exam.id,
      questionCount: exam.questionCount,
      optionCount: exam.optionCount,
      pages: list,
      settings,
      onStep: setBusy,
    });
    pagesRef.current = []; // the result screen (or nobody, if none were found) owns them now
    setPages([]);
    if (!r.ok) {
      setNotice({ tone: 'warning', title: 'No answers found', text: r.message });
      return;
    }
    setPending(r.pending);
    router.push({ pathname: '/exams/[id]/result', params: { id: String(exam.id) } });
  }

  async function run(text: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(text);
    setNotice(null);
    await new Promise((r) => setTimeout(r, 30)); // let the busy screen appear before the heavy work
    try {
      await work();
    } catch (e) {
      setNotice({ tone: 'warning', title: 'Something went wrong', text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  const capture = () =>
    run(mode === 'omr' ? 'Reading the sheet…' : 'Saving the page…', async () => {
      if (!ready || !camera.current) return;
      if (mode === 'handwritten' && pages.length >= MAX_PAGES) {
        setNotice({ tone: 'warning', title: `${MAX_PAGES} pages at most`, text: 'Tap Read script, or remove a page first.' });
        return;
      }
      const photo = await camera.current.takePictureAsync({ quality: 0.9 });
      if (!photo) return;
      if (mode === 'omr') await readSkoraSheet(photo.uri, photo.width, photo.height);
      else await addPages([photo.uri]);
    });

  const fromGallery = () =>
    run(mode === 'omr' ? 'Reading the sheet…' : 'Adding the pages…', async () => {
      if (mode === 'omr') {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
        if (res.canceled) return;
        const a = res.assets[0];
        await readSkoraSheet(a.uri, a.width, a.height);
        return;
      }
      const room = MAX_PAGES - pages.length;
      if (room <= 0) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: room > 1,
        selectionLimit: room,
        orderedSelection: true,
      });
      if (res.canceled) return;
      await addPages(res.assets.map((a) => a.uri));
    });

  // Google's page scanner finds the page edges, flattens the page and cleans it up.
  const pageScanner = () =>
    run('Opening the page scanner…', async () => {
      const result = await CameraView.scanDocumentAsync();
      if (!result || result.pages.length === 0) return;
      setBusy('Saving the pages…');
      const all = await addPages(result.pages);
      await readScript(all);
    });

  const readNow = () => run('Reading the writing…', () => readScript(pages));

  function removePage(i: number) {
    deletePhoto(pages[i].uri);
    setPages((list) => list.filter((_, j) => j !== i));
  }

  const keyMissing = exam.questionCount - exam.keySet;
  const canUseScanner = mode === 'handwritten' && CameraView.isDocumentScannerAvailable;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} onCameraReady={() => setReady(true)} />

      {mode === 'omr' ? (
        <View pointerEvents="none" style={styles.guides}>
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <View key={c} style={[styles.corner, styles[c]]} />
          ))}
        </View>
      ) : null}

      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.topRow}>
          <RoundButton icon="close" label="Close" onPress={() => router.back()} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.title} numberOfLines={1}>
              {exam.title}
            </Text>
            <Text style={styles.subtitle}>{saved === 0 ? 'No scripts saved yet' : `${saved} ${saved === 1 ? 'script' : 'scripts'} saved`}</Text>
          </View>
          <RoundButton icon={torch ? 'flash' : 'flash-off'} label="Light" onPress={() => setTorch((t) => !t)} />
        </View>
        <View style={styles.modes} accessibilityRole="tablist">
          <ModeButton label="Skora sheet" selected={mode === 'omr'} onPress={() => switchMode('omr')} />
          <ModeButton label="Any paper" selected={mode === 'handwritten'} onPress={() => switchMode('handwritten')} />
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        {notice ? (
          <View style={[styles.card, { backgroundColor: notice.tone === 'success' ? colors.successSoft : colors.warningSoft }]}>
            <Text style={{ color: notice.tone === 'success' ? colors.success : colors.warning, fontWeight: '700' }}>{notice.title}</Text>
            <Text style={{ color: colors.text, marginTop: 2 }}>{notice.text}</Text>
          </View>
        ) : null}

        {mode === 'handwritten' && pages.length > 0 ? (
          <View style={[styles.card, { backgroundColor: 'rgba(255,255,255,0.95)' }]}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {pages.length} {pages.length === 1 ? 'page' : 'pages'} of this script
            </Text>
            <ScrollView horizontal style={{ marginVertical: space.sm }} contentContainerStyle={{ gap: space.sm }}>
              {pages.map((p, i) => (
                <View key={p.uri}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Pressable onPress={() => removePage(i)} accessibilityLabel={`Remove page ${i + 1}`} hitSlop={8} style={styles.thumbRemove}>
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: space.sm }}>
              {pages.length < MAX_PAGES ? 'Photograph the next page of the same script, or read it now.' : 'That is the most pages for one script.'}
            </Text>
            <Button title="Read script" icon="checkmark" onPress={readNow} />
          </View>
        ) : !notice ? (
          <View style={[styles.card, { backgroundColor: 'rgba(255,255,255,0.92)' }]}>
            {mode === 'omr' ? (
              <Text style={{ color: colors.text }}>
                Lay the Skora sheet flat in good light and fit the whole page in the frame, so all four black squares show.
              </Text>
            ) : (
              <>
                <Text style={{ color: colors.text }}>
                  Photograph the student&apos;s answers flat, in good light, close enough to read. Answers should be written as a number and a
                  letter, like 1. B. A script can have up to {MAX_PAGES} pages.
                </Text>
                {canUseScanner ? (
                  <Button small variant="secondary" icon="document-outline" title="Use the page scanner" onPress={pageScanner} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
                ) : null}
              </>
            )}
            {keyMissing > 0 ? (
              <Text style={{ color: colors.warning, marginTop: 4 }}>
                {`${keyMissing} ${keyMissing === 1 ? 'question has' : 'questions have'} no answer in the key yet, so ${keyMissing === 1 ? 'it gives' : 'they give'} no marks until you set ${keyMissing === 1 ? 'it' : 'them'}.`}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.controls}>
          <RoundButton icon="images-outline" label="Choose a photo" onPress={fromGallery} />
          <Pressable
            onPress={capture}
            disabled={busy !== null || !ready}
            accessibilityLabel={mode === 'omr' ? 'Take photo' : `Photograph page ${pages.length + 1}`}
            style={({ pressed }) => [styles.shutter, (pressed || busy !== null) && { opacity: 0.6 }]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          {canUseScanner && pages.length === 0 ? (
            <RoundButton icon="document-outline" label="Use the page scanner" onPress={pageScanner} />
          ) : (
            <RoundButton icon="checkmark-done" label="Done" onPress={() => router.back()} />
          )}
        </View>
      </View>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: '#fff', marginTop: space.sm, fontWeight: '600', textAlign: 'center', paddingHorizontal: space.xl }}>{busy}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Camera, picker and page-scanner photos are copies in the app's cache: delete them once Skora has its own copy. */
function dropCacheCopy(uri: string) {
  try {
    if (uri.startsWith(Paths.cache.uri)) deletePhoto(uri);
  } catch {
    // Not important.
  }
}

function ModeButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      style={[styles.mode, selected && { backgroundColor: '#fff' }]}
    >
      <Text style={{ color: selected ? colors.primary : '#fff', fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [styles.round, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={24} color="#fff" />
    </Pressable>
  );
}

const GUIDE = 34;
const styles = StyleSheet.create({
  guides: { position: 'absolute', top: '18%', bottom: '24%', left: '8%', right: '8%' },
  corner: { position: 'absolute', width: GUIDE, height: GUIDE, borderColor: 'rgba(255,255,255,0.9)' },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 6 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 6 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 6 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 6 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  modes: { flexDirection: 'row', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.pill, padding: 3 },
  mode: { paddingVertical: 6, paddingHorizontal: space.lg, borderRadius: radius.pill },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, gap: space.md },
  card: { backgroundColor: '#fff', borderRadius: radius.md, padding: space.md },
  thumb: { width: 54, height: 72, borderRadius: 6, backgroundColor: colors.border },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md },
  round: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});

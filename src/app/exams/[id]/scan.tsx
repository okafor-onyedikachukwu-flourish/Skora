import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '../../../components/theme';
import { Button, EmptyState, ErrorView, LoadingView } from '../../../components/ui';
import { getExam, type Exam } from '../../../lib/db/exams';
import { friendlyError } from '../../../lib/errors';
import { formatMarks } from '../../../lib/exams';
import { setPending, takeLastSaved, tidyScanPhotos } from '../../../lib/scan/pending';
import { loadPhoto, saveGrayJpeg } from '../../../lib/scan/photo';
import { READ_HINTS, readSheet, straighten } from '../../../lib/scan/read';
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

function Scanner({ exam }: { exam: Exam }) {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'success'; title: string; text: string } | null>(null);
  const [saved, setSaved] = useState(exam.saved);
  useEffect(() => {
    tidyScanPhotos();
  }, []);

  // Coming back from the result screen: show what was just saved.
  useFocusEffect(
    useCallback(() => {
      const last = takeLastSaved(exam.id);
      if (last) {
        setSaved((n) => n + 1);
        setNotice({
          tone: 'success',
          title: `Saved: ${last.name}`,
          text: `${formatMarks(last.score)} of ${last.maxScore}. Scan the next script.`,
        });
      }
    }, [exam.id]),
  );

  async function handle(uri: string, width: number, height: number) {
    setNotice(null);
    await new Promise((r) => setTimeout(r, 30)); // let "Reading…" appear before the heavy work
    const g = await loadPhoto(uri, width, height);
    const read = readSheet(g, { questionCount: exam.questionCount, optionCount: exam.optionCount });
    if (!read.ok) {
      setNotice({
        tone: 'warning',
        title: 'Try again',
        text:
          read.reason === 'no-markers'
            ? `${READ_HINTS['no-markers']} Handwritten scripts on foolscap come in the next Skora build.`
            : READ_HINTS[read.reason],
      });
      return;
    }
    // A straightened copy of the page lets the teacher check unclear answers on the result screen.
    const imageUri = saveGrayJpeg(straighten(g, read.toImage, 3), `${randomUUID()}.jpg`, 70);
    setPending({ examId: exam.id, answers: read.answers, imageUri, sheetType: 'omr' });
    router.push({ pathname: '/exams/[id]/result', params: { id: String(exam.id) } });
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setNotice({ tone: 'warning', title: 'Something went wrong', text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  const capture = () =>
    run(async () => {
      if (!ready || !camera.current) return;
      const photo = await camera.current.takePictureAsync({ quality: 0.9 });
      if (photo) await handle(photo.uri, photo.width, photo.height);
    });

  const fromGallery = () =>
    run(async () => {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (res.canceled) return;
      const a = res.assets[0];
      await handle(a.uri, a.width, a.height);
    });

  const keyMissing = exam.questionCount - exam.keySet;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} onCameraReady={() => setReady(true)} />

      {/* Corner guides */}
      <View pointerEvents="none" style={styles.guides}>
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <View key={c} style={[styles.corner, styles[c]]} />
        ))}
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <RoundButton icon="close" label="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.title} numberOfLines={1}>
            {exam.title}
          </Text>
          <Text style={styles.subtitle}>{saved === 0 ? 'No scripts saved yet' : `${saved} ${saved === 1 ? 'script' : 'scripts'} saved`}</Text>
        </View>
        <RoundButton icon={torch ? 'flash' : 'flash-off'} label="Light" onPress={() => setTorch((t) => !t)} />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        {notice ? (
          <View style={[styles.card, { backgroundColor: notice.tone === 'success' ? colors.successSoft : colors.warningSoft }]}>
            <Text style={{ color: notice.tone === 'success' ? colors.success : colors.warning, fontWeight: '700' }}>{notice.title}</Text>
            <Text style={{ color: colors.text, marginTop: 2 }}>{notice.text}</Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: 'rgba(255,255,255,0.92)' }]}>
            <Text style={{ color: colors.text }}>
              Lay the Skora sheet flat in good light and fit the whole page in the frame, so all four black squares show.
            </Text>
            {keyMissing > 0 ? (
              <Text style={{ color: colors.warning, marginTop: 4 }}>
                {`${keyMissing} ${keyMissing === 1 ? 'question has' : 'questions have'} no answer in the key yet, so ${keyMissing === 1 ? 'it gives' : 'they give'} no marks until you set ${keyMissing === 1 ? 'it' : 'them'}.`}
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.controls}>
          <RoundButton icon="images-outline" label="Choose a photo" onPress={fromGallery} />
          <Pressable
            onPress={capture}
            disabled={busy || !ready}
            accessibilityLabel="Take photo"
            style={({ pressed }) => [styles.shutter, (pressed || busy) && { opacity: 0.6 }]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <RoundButton icon="checkmark-done" label="Done" onPress={() => router.back()} />
        </View>
      </View>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: '#fff', marginTop: space.sm, fontWeight: '600' }}>Reading the sheet…</Text>
        </View>
      ) : null}
    </View>
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
  guides: { position: 'absolute', top: '14%', bottom: '24%', left: '8%', right: '8%' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, gap: space.md },
  card: { backgroundColor: '#fff', borderRadius: radius.md, padding: space.md },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md },
  round: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});

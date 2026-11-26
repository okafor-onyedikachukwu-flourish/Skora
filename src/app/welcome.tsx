import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo, Photo, useLightStatusBar } from '../components/Photo';
import { colors, space } from '../components/theme';
import { Banner, Button, Field, Input, type IconName } from '../components/ui';
import { addClasses } from '../lib/db/classes';
import { friendlyError } from '../lib/errors';
import { splitList } from '../lib/names';
import { PHOTOS } from '../lib/photos';
import { useSettings } from '../lib/settings';

const POINTS: { icon: IconName; text: string; bg: string; fg: string }[] = [
  { icon: 'scan-outline', text: 'Scan objective scripts with your camera', bg: colors.accentSoft, fg: colors.accentText },
  { icon: 'create-outline', text: 'Skora answer sheets or handwriting on any paper', bg: colors.primarySoft, fg: colors.primary },
  { icon: 'phone-portrait-outline', text: 'No log-in. Your scores stay on this phone', bg: colors.successSoft, fg: colors.success },
];

/** The first screen, shown once. Everything on it is optional and can be changed in Settings. */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  useLightStatusBar();
  const db = useSQLiteContext();
  const { update } = useSettings();
  const [teacherName, setTeacherName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [classes, setClasses] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      const names = splitList(classes);
      if (names.length > 0) await addClasses(db, names);
      // Saving setUpDone switches the app to the tabs.
      await update({ teacherName: teacherName.trim(), schoolName: schoolName.trim(), setUpDone: true });
    } catch (e) {
      setMessage(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.card }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <Photo photo={PHOTOS.start} width={420} scrim style={{ height: 330 + insets.top }}>
        <View style={{ flex: 1, justifyContent: 'space-between', paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, paddingBottom: 52 }}>
          <Logo light />
          <View style={{ gap: space.sm }}>
            <Text style={{ fontSize: 30, lineHeight: 36, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.6 }}>
              Mark objective scripts in minutes.
            </Text>
            <Text style={{ fontSize: 16, lineHeight: 23, color: '#E4E2FF' }}>Enter the answer key once, then scan.</Text>
          </View>
        </View>
      </Photo>

      <View
        style={{
          flex: 1,
          marginTop: -28,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          backgroundColor: colors.card,
          paddingTop: 28,
          paddingHorizontal: space.xl,
          paddingBottom: insets.bottom + space.lg,
          gap: space.lg,
        }}
      >
        <View style={{ gap: 12 }}>
          {POINTS.map((p) => (
            <View key={p.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={p.icon} size={20} color={p.fg} />
              </View>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>{p.text}</Text>
            </View>
          ))}
        </View>

        <View>
          {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}
          <Field label="Your name (optional)" hint="Printed on your Skora answer sheets.">
            <Input value={teacherName} onChangeText={setTeacherName} placeholder="e.g. Mrs Okafor" autoCapitalize="words" />
          </Field>
          <Field label="School (optional)">
            <Input value={schoolName} onChangeText={setSchoolName} placeholder="e.g. Community Secondary School, Nnewi" autoCapitalize="words" />
          </Field>
          <Field label="Your classes (optional)" hint="Separate them with commas. You can add more later.">
            <Input value={classes} onChangeText={setClasses} placeholder="e.g. JSS3A, SS1B, SS2 Science" autoCapitalize="characters" />
          </Field>
        </View>

        <View style={{ marginTop: 'auto', gap: space.xs }}>
          <Button title="Start" icon="arrow-forward" onPress={start} loading={busy} />
          <Text style={{ fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: space.xs }}>Photo: {PHOTOS.start.by} on Unsplash</Text>
        </View>
      </View>
    </ScrollView>
  );
}

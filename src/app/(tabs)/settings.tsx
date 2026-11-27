import * as Application from 'expo-application';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { colors, space } from '../../components/theme';
import { UpdateBanner } from '../../components/UpdateBanner';
import { Banner, Button, Card, Field, Group, Input, ListRow, LoadingView, Screen, SectionTitle, confirm } from '../../components/ui';
import { listClasses } from '../../lib/db/classes';
import { readingAccuracy } from '../../lib/db/scripts';
import { modelInfo } from '../../lib/reader/info';
import { hasReader } from '../../lib/reader/reader';
import { backUp, pickBackup, restore } from '../../lib/db/backup';
import type { Settings } from '../../lib/db/settings';
import { friendlyError } from '../../lib/errors';
import { useSettings } from '../../lib/settings';
import { useLoad } from '../../lib/useLoad';

function lastBackupText(iso: string): string {
  if (!iso) return 'No backup yet. Back up after each exam, so a lost phone does not lose your scores.';
  const d = new Date(iso);
  return `Last backup: ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export default function SettingsTab() {
  const { settings } = useSettings();
  // Bumped after a restore, so the text boxes start again from the restored values.
  const [restores, setRestores] = useState(0);
  if (!settings) return <LoadingView />;
  return <SettingsBody key={restores} settings={settings} justRestored={restores > 0} onRestored={() => setRestores((n) => n + 1)} />;
}

function SettingsBody({ settings, justRestored, onRestored }: { settings: Settings; justRestored: boolean; onRestored: () => void }) {
  const db = useSQLiteContext();
  const { update, reload: reloadSettings } = useSettings();
  const classes = useLoad(() => listClasses(db), 'classes');
  const accuracy = useLoad(() => readingAccuracy(db), 'accuracy');
  const reader = useLoad(() => hasReader(), 'reader');
  const [teacherName, setTeacherName] = useState(settings.teacherName);
  const [schoolName, setSchoolName] = useState(settings.schoolName);
  const [passMark, setPassMark] = useState(String(settings.passMarkPercent));
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(
    justRestored ? { tone: 'success', text: 'Backup restored.' } : null,
  );

  async function save(changes: Parameters<typeof update>[0]) {
    setMessage(null);
    try {
      await update(changes);
    } catch (e) {
      setMessage({ tone: 'danger', text: friendlyError(e) });
    }
  }

  function savePassMark() {
    const n = Number(passMark.replace(',', '.'));
    if (!passMark.trim() || !Number.isFinite(n) || n < 0 || n > 100) {
      setMessage({ tone: 'danger', text: 'The pass mark must be a number from 0 to 100.' });
      setPassMark(String(settings.passMarkPercent));
      return;
    }
    if (n !== settings.passMarkPercent) save({ passMarkPercent: Math.round(n * 10) / 10 });
  }

  async function doBackup() {
    setBusy('backup');
    setMessage(null);
    try {
      await backUp(db);
      await reloadSettings();
    } catch (e) {
      setMessage({ tone: 'danger', text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function doRestore() {
    setBusy('restore');
    setMessage(null);
    try {
      const found = await pickBackup();
      if (!found) return;
      const ok = await confirm(
        'Replace everything on this phone?',
        `The backup has ${found.classes} classes, ${found.exams} exams and ${found.scripts} saved scripts. Everything now on this phone is replaced, and this can't be undone. Back up first if you are not sure.`,
        'Restore',
      );
      if (!ok) return;
      await restore(db, found);
      await reloadSettings();
      onRestored();
    } catch (e) {
      setMessage({ tone: 'danger', text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  const classCount = classes.data?.length ?? 0;
  const build = Application.nativeBuildVersion;

  return (
    <Screen>
      <UpdateBanner />
      {message ? <Banner tone={message.tone} icon={message.tone === 'success' ? 'checkmark-circle' : 'alert-circle'} title={message.text} /> : null}

      <SectionTitle>On your answer sheets</SectionTitle>
      <Card>
        <Field label="Your name">
          <Input
            value={teacherName}
            onChangeText={setTeacherName}
            onEndEditing={() => teacherName.trim() !== settings.teacherName && save({ teacherName: teacherName.trim() })}
            placeholder="Optional"
            autoCapitalize="words"
          />
        </Field>
        <Field label="School">
          <Input
            value={schoolName}
            onChangeText={setSchoolName}
            onEndEditing={() => schoolName.trim() !== settings.schoolName && save({ schoolName: schoolName.trim() })}
            placeholder="Optional"
            autoCapitalize="words"
          />
        </Field>
      </Card>

      <SectionTitle>Classes</SectionTitle>
      <Group>
        <ListRow
          icon="people-outline"
          title="Your classes"
          subtitle={classCount === 0 ? 'None yet' : `${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
          onPress={() => router.push('/classes')}
        />
      </Group>

      <SectionTitle>Marking</SectionTitle>
      <Card>
        <Field label="Pass mark (%)" hint="Pass rates count scores at or above this.">
          <Input value={passMark} onChangeText={setPassMark} onEndEditing={savePassMark} keyboardType="decimal-pad" maxLength={5} />
        </Field>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>Gemini for unclear handwriting</Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: colors.muted }}>
              {"When the phone can't read handwriting clearly, Skora sends that photo to Google's Gemini. On the free tier, Google may use these photos to improve its products. Turn this off and you check unclear answers yourself."}
            </Text>
          </View>
          <Switch
            value={settings.geminiOn}
            onValueChange={(on) => save({ geminiOn: on })}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Gemini for unclear handwriting"
          />
        </View>
      </Card>

      <SectionTitle>How well Skora reads</SectionTitle>
      <Card>
        <View style={{ marginBottom: space.sm }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
            {"Skora's own reader: "}
            {reader.data && modelInfo ? 'on' : 'not in this version yet'}
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>
            {reader.data && modelInfo
              ? `Reads handwritten letters on the phone, checked against ML Kit. On ${modelInfo.testExamples} test characters it had never seen: letters ${(modelInfo.lettersAtoE * 100).toFixed(1)}% right, numbers ${(modelInfo.digits * 100).toFixed(1)}%. Trained ${modelInfo.trainedOn}.`
              : 'Until it is trained and built into the app, ML Kit and Gemini read handwriting.'}
          </Text>
        </View>
        {accuracy.data && accuracy.data.length > 0 ? (
          accuracy.data.map((a) => {
            const right = a.answers > 0 ? Math.floor(((a.answers - a.changed) / a.answers) * 1000) / 10 : 100;
            return (
              <View key={a.sheetType} style={{ marginBottom: space.sm }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                  {a.sheetType === 'omr' ? 'Skora sheets' : 'Handwritten scripts'}: {right}% read right
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>
                  {`${a.answers} answers on ${a.scripts} ${a.scripts === 1 ? 'script' : 'scripts'}; you changed ${a.changed}.`}
                </Text>
              </View>
            )
          })
        ) : (
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>
            Save a few scripts and Skora shows here how many of the answers it read you had to change.
          </Text>
        )}
      </Card>

      <SectionTitle>Backup</SectionTitle>
      <Card>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted, marginBottom: space.md }}>{lastBackupText(settings.lastBackupAt)}</Text>
        <View style={{ gap: space.sm }}>
          <Button icon="cloud-upload-outline" title="Back up now" onPress={doBackup} loading={busy === 'backup'} disabled={busy !== null} />
          <Button
            variant="secondary"
            icon="cloud-download-outline"
            title="Restore from a backup"
            onPress={doRestore}
            loading={busy === 'restore'}
            disabled={busy !== null}
          />
        </View>
        <Text style={{ fontSize: 12, lineHeight: 17, color: colors.faint, marginTop: space.sm }}>
          A backup is one file with all your classes, exams and saved scores. Keep it in Google Drive or send it to yourself on WhatsApp.
        </Text>
      </Card>

      <Text style={{ fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: space.lg }}>
        Skora{build ? ` · build ${build}` : ''} · your data stays on this phone
      </Text>
    </Screen>
  );
}

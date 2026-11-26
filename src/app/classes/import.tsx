import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Text, View } from 'react-native';
import * as XLSX from 'xlsx';
import { colors, space } from '../../components/theme';
import { Badge, Banner, Button, ErrorView, Field, Group, IconButton, Input, ListRow, LoadingView, Screen, SectionTitle } from '../../components/ui';
import { addClassNames, getClass, listClassNames } from '../../lib/db/classes';
import { friendlyError } from '../../lib/errors';
import { parseNames } from '../../lib/names';
import { useLoad } from '../../lib/useLoad';

/** Reads a spreadsheet (Excel, Google Sheets download, LibreOffice) or a CSV/text file as text. */
async function readListFile(uri: string, name: string): Promise<string> {
  const file = new File(uri);
  if (/\.(xlsx|xlsm|xls|ods)$/i.test(name)) {
    const book = XLSX.read(await file.bytes(), { type: 'array' });
    const first = book.Sheets[book.SheetNames[0]];
    if (!first) throw new Error('That spreadsheet is empty.');
    return XLSX.utils.sheet_to_csv(first);
  }
  return file.text();
}

export default function ImportNames() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const id = Number(classId);
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useLoad(async () => {
    const cls = await getClass(db, id);
    if (!cls) throw new Error('This class was deleted.');
    const names = await listClassNames(db, id);
    return { cls, existing: new Set(names.map((n) => n.fullName.toLowerCase())) };
  }, classId);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { cls, existing } = data!;

  const parsed = parseNames(text).filter((n) => !removed.has(n));
  const fresh = parsed.filter((n) => !existing.has(n.toLowerCase()));
  const already = parsed.length - fresh.length;

  async function pickFile() {
    setMessage(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      setText(await readListFile(asset.uri, asset.name));
      setFileName(asset.name);
      setRemoved(new Set());
    } catch (e) {
      setMessage(friendlyError(e));
    }
  }

  async function save() {
    if (fresh.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await addClassNames(db, cls.id, fresh);
      router.back();
    } catch (e) {
      setMessage(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `Class list for ${cls.name}` }} />
      {message ? <Banner tone="warning" icon="alert-circle" title={message} /> : null}

      <Button variant="secondary" icon="folder-open-outline" title="Pick a spreadsheet or CSV file" onPress={pickFile} />
      {fileName ? <Text style={{ fontSize: 13, color: colors.muted, marginTop: space.xs }}>From {fileName}</Text> : null}

      <Text style={{ textAlign: 'center', color: colors.faint, marginVertical: space.md }}>or</Text>

      <Field label="Paste names" hint="One student per line. You can copy a column from Excel, Google Sheets or WhatsApp.">
        <Input
          value={text}
          onChangeText={(t) => {
            setText(t);
            setFileName(null);
          }}
          placeholder={'Okeke Chidi\nBello Fatima\nAdeyemi Grace'}
          multiline
          style={{ minHeight: 140, textAlignVertical: 'top' }}
        />
      </Field>

      {parsed.length > 0 ? (
        <>
          <SectionTitle>{`Check the names (${fresh.length} new)`}</SectionTitle>
          {already > 0 ? (
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: space.sm }}>{already} already on the class list will be skipped.</Text>
          ) : null}
          <Group>
            {parsed.map((n) => (
              <ListRow
                key={n}
                title={n}
                right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    {existing.has(n.toLowerCase()) ? <Badge label="Already added" /> : null}
                    <IconButton icon="close-circle-outline" label={`Leave out ${n}`} onPress={() => setRemoved((prev) => new Set(prev).add(n))} />
                  </View>
                }
              />
            ))}
          </Group>
        </>
      ) : null}

      <Button
        title={fresh.length > 0 ? `Add ${fresh.length} ${fresh.length === 1 ? 'name' : 'names'}` : 'Add names'}
        icon="checkmark"
        onPress={save}
        loading={busy}
        disabled={fresh.length === 0}
        style={{ marginTop: space.xl }}
      />
    </Screen>
  );
}

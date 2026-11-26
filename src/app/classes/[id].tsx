import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space } from '../../components/theme';
import { Banner, Button, EmptyState, ErrorView, Group, IconButton, Input, ListRow, LoadingView, Screen, SectionTitle, confirm } from '../../components/ui';
import { cleanName } from '../../lib/db';
import { addClassNames, deleteClass, deleteClassName, getClass, listClassNames, renameClass, type ClassName } from '../../lib/db/classes';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';

export default function ClassDetail() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useLoad(async () => {
    const cls = await getClass(db, id);
    if (!cls) throw new Error('This class was deleted.');
    return { cls, names: await listClassNames(db, id) };
  }, idParam);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  const { cls, names } = data!;
  const q = search.trim().toLowerCase();
  const shown = q ? names.filter((n) => n.fullName.toLowerCase().includes(q)) : names;

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const saveName = () =>
    attempt(async () => {
      await renameClass(db, cls.id, renaming ?? '');
      setRenaming(null);
      await reload();
    });

  const addOne = () =>
    attempt(async () => {
      const name = cleanName(newName);
      if (name.length < 2) throw new Error("Enter the student's full name.");
      if (names.some((n) => n.fullName.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already on the list.`);
      await addClassNames(db, cls.id, [name]);
      setNewName('');
      await reload();
    });

  const removeOne = (n: ClassName) =>
    attempt(async () => {
      if (!(await confirm(`Remove ${n.fullName}?`, `They will be taken off the ${cls.name} list. Saved scores keep the name.`, 'Remove'))) return;
      await deleteClassName(db, n.id);
      await reload();
    });

  const removeClass = () =>
    attempt(async () => {
      const extra = names.length > 0 ? ` Its list of ${names.length} names is deleted too.` : '';
      if (!(await confirm(`Delete ${cls.name}?`, `This can't be undone.${extra}`))) return;
      await deleteClass(db, cls.id);
      router.back();
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: cls.name }} />
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}

      {renaming !== null ? (
        <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
          <Input value={renaming} onChangeText={setRenaming} style={{ flex: 1 }} autoFocus onSubmitEditing={saveName} maxLength={40} />
          <Button small title="Save" onPress={saveName} loading={busy} />
          <Button small variant="ghost" title="Cancel" onPress={() => setRenaming(null)} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <Button
          small
          icon="document-text-outline"
          title="Add a class list"
          onPress={() => router.push({ pathname: '/classes/import', params: { classId: String(cls.id) } })}
        />
        <Button small variant="secondary" icon="create-outline" title="Rename" onPress={() => setRenaming(cls.name)} />
      </View>

      <SectionTitle>{`${names.length} ${names.length === 1 ? 'name' : 'names'}`}</SectionTitle>
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
        <Input value={newName} onChangeText={setNewName} placeholder="Add one name" style={{ flex: 1 }} onSubmitEditing={addOne} autoCapitalize="words" />
        <Button title="Add" onPress={addOne} disabled={newName.trim().length < 2} />
      </View>

      {names.length > 15 ? <Input value={search} onChangeText={setSearch} placeholder="Search this class" style={{ marginBottom: space.md }} /> : null}

      {names.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="No class list"
          text="A class list is optional. With one, Skora suggests the student's name as you type it when you save a score."
        />
      ) : (
        <Group>
          {shown.map((n) => (
            <ListRow key={n.id} title={n.fullName} right={<IconButton icon="trash-outline" label={`Remove ${n.fullName}`} onPress={() => removeOne(n)} />} />
          ))}
        </Group>
      )}

      {cls.exams > 0 ? (
        <Text style={{ fontSize: 13, color: colors.muted, marginTop: space.xl, textAlign: 'center' }}>
          {`${cls.exams} ${cls.exams === 1 ? 'exam uses' : 'exams use'} this class, so it can't be deleted.`}
        </Text>
      ) : (
        <Button variant="danger" icon="trash-outline" title="Delete class" onPress={removeClass} style={{ marginTop: space.xl }} />
      )}
    </Screen>
  );
}

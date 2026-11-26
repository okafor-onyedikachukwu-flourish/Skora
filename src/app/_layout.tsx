import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../components/theme';
import { ErrorView, LoadingView } from '../components/ui';
import { DB_NAME, prepareDatabase } from '../lib/db';
import { friendlyError } from '../lib/errors';
import { SettingsProvider, useSettings } from '../lib/settings';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Suspense fallback={<LoadingView />}>
        <SQLiteProvider databaseName={DB_NAME} onInit={prepareDatabase} useSuspense>
          <SettingsProvider>
            <RootNavigator />
          </SettingsProvider>
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}

/** Shown if the database can't open, so the teacher sees a message instead of a blank screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorView message={friendlyError(error)} onRetry={retry} />;
}

function RootNavigator() {
  const { settings, error, reload } = useSettings();
  if (error) return <ErrorView message={friendlyError(error)} onRetry={reload} />;
  if (!settings) return <LoadingView />;
  const ready = settings.setUpDone;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* First open: a short welcome, then straight to the app. */}
      <Stack.Protected guard={!ready}>
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="classes/index" options={{ title: 'Your classes' }} />
        <Stack.Screen name="classes/[id]" options={{ title: 'Class' }} />
        <Stack.Screen name="classes/import" options={{ title: 'Add a class list', presentation: 'modal' }} />
        <Stack.Screen name="exams/new" options={{ title: 'New exam', presentation: 'modal' }} />
        <Stack.Screen name="exams/[id]/index" options={{ title: 'Exam' }} />
        <Stack.Screen name="exams/[id]/edit" options={{ title: 'Edit exam' }} />
        <Stack.Screen name="exams/[id]/key" options={{ title: 'Answer key' }} />
        <Stack.Screen name="exams/[id]/sheets" options={{ title: 'Answer sheets' }} />
      </Stack.Protected>
    </Stack>
  );
}

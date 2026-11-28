import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, space } from '../../components/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        headerTitleStyle: { color: colors.text, fontWeight: '700', fontSize: 20 },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Exams',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/exams/new')}
              style={({ pressed }) => [styles.newExam, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={styles.newExamText}>New exam</Text>
            </Pressable>
          ),
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'document-text' : 'document-text-outline'} color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'scan' : 'scan-outline'} color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="scores"
        options={{
          title: 'Scores',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'bar-chart' : 'bar-chart-outline'} color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  newExam: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: 14,
    marginRight: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  newExamText: { fontSize: 14, fontWeight: '700', color: colors.primary },
});

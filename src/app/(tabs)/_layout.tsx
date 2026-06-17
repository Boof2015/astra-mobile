import { Tabs } from 'expo-router';
import { TabBar, type TabItem } from '@/components/TabBar';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bgPrimary },
      }}
      tabBar={({ state, navigation }) => {
        const items: TabItem[] = state.routes.map((route, index) => ({
          key: route.key,
          name: route.name,
          focused: state.index === index,
        }));

        const handlePress = (item: TabItem) => {
          const event = navigation.emit({
            type: 'tabPress',
            target: item.key,
            canPreventDefault: true,
          });
          if (!item.focused && !event.defaultPrevented) {
            navigation.navigate(item.name);
          }
        };

        return <TabBar items={items} onPress={handlePress} />;
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="eq" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

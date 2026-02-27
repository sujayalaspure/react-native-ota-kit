/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { NewAppScreen } from '@react-native/new-app-screen';
import { useEffect } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { OtaProvider, markSuccessfulLaunch } from './packages/ota-sdk/src';

/** OTA server config — update serverUrl with your actual host in production */
const OTA_CONFIG = {
  serverUrl: 'http://10.0.2.2:3000', // Android emulator → host machine; use your IP for physical device
  channel: 'production',
  appVersion: '1.0.0',
  strategy: 'BACKGROUND' as const,
};

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <OtaProvider config={OTA_CONFIG}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppContent />
      </OtaProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();

  useEffect(() => {
    // ✅ App rendered successfully — reset crash counter so normal
    //    launches don't accumulate toward the rollback threshold.
    markSuccessfulLaunch();
  }, []);

  return (
    <View style={styles.container}>
      <NewAppScreen
        templateFileName="App.tsx"
        safeAreaInsets={safeAreaInsets}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;

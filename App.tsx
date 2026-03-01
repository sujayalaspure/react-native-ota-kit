/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { NewAppScreen } from '@react-native/new-app-screen';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { OtaProvider, markSuccessfulLaunch, useOtaUpdate } from './packages/ota-sdk/src';

/** OTA server config — update serverUrl with your actual host in production */
const OTA_CONFIG = {
  serverUrl: 'http://192.168.1.3:3000', // LAN IP — phone and laptop must be on the same Wi-Fi
  channel: 'production',
  appVersion: '1.0.0',
  strategy: 'BACKGROUND' as const,
};

// ─── OTA Banner ───────────────────────────────────────────────────────────────

const BANNER_CONFIG: Record<string, { bg: string; text: string; icon: string } | null> = {
  CHECKING:          { bg: '#4A90D9', text: 'Checking for updates…',          icon: '🔄' },
  UPDATE_AVAILABLE:  { bg: '#F5A623', text: 'Update found! Downloading…',     icon: '📦' },
  DOWNLOADING:       { bg: '#F5A623', text: 'Downloading update…',            icon: '⬇️' },
  READY_TO_INSTALL:  { bg: '#27AE60', text: 'Update ready — restart to apply', icon: '✅' },
  INSTALLING:        { bg: '#8E44AD', text: 'Installing update, restarting…', icon: '⚙️' },
  ROLLED_BACK:       { bg: '#E74C3C', text: 'Update rolled back',             icon: '↩️' },
  ERROR:             { bg: '#E74C3C', text: 'Update failed',                  icon: '❌' },
};

// Statuses that should auto-dismiss after a timeout
const AUTO_HIDE_STATUSES: Partial<Record<string, number>> = {
  ERROR:      5000,
  ROLLED_BACK: 5000,
  UP_TO_DATE:  3000,
};

function OtaBanner() {
  const { status, progress, error, applyNow } = useOtaUpdate();
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [dismissed, setDismissed] = React.useState(false);
  const prevStatus = useRef(status);

  // Reset dismissed whenever status changes to a new value
  useEffect(() => {
    if (status !== prevStatus.current) {
      setDismissed(false);
      prevStatus.current = status;
    }
  }, [status]);

  // Auto-hide for transient statuses
  useEffect(() => {
    const delay = AUTO_HIDE_STATUSES[status];
    if (!delay) return;
    const timer = setTimeout(() => setDismissed(true), delay);
    return () => clearTimeout(timer);
  }, [status]);

  const config = BANNER_CONFIG[status] ?? null;
  const visible = config !== null && !dismissed;

  // Slide in/out
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : -120,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [visible, slideAnim]);

  // Animate progress bar
  useEffect(() => {
    if (status === 'DOWNLOADING') {
      Animated.timing(progressAnim, {
        toValue: progress / 100,
        duration: 200,
        useNativeDriver: false,
      }).start();
    } else {
      progressAnim.setValue(0);
    }
  }, [status, progress, progressAnim]);

  if (!config) return null;

  const isDownloading = status === 'DOWNLOADING';
  const isReady = status === 'READY_TO_INSTALL';
  const isError = status === 'ERROR';

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: config.bg, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.bannerRow}>
        <Text style={styles.bannerIcon}>{config.icon}</Text>
        <View style={styles.bannerTextCol}>
          <Text style={styles.bannerText}>
            {isError ? `${config.text}: ${error ?? ''}` : config.text}
          </Text>
          {isDownloading && (
            <Text style={styles.bannerSubText}>{progress}%</Text>
          )}
        </View>
        {isReady && (
          <TouchableOpacity style={styles.bannerBtn} onPress={applyNow}>
            <Text style={styles.bannerBtnText}>Restart</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Progress bar */}
      {isDownloading && (
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      )}
    </Animated.View>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <OtaProvider config={OTA_CONFIG}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppContent />
        <OtaBanner />
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
      <Text style={{ padding: 16, fontSize: 18, fontWeight: 'bold' }}>
        Welcome to the React Native OTA Update Demo! This is the currently.
        New changes after APK install
        new line
      </Text>
      <Text style={{ padding: 16, fontSize: 18, fontWeight: 'bold' }}>
        Welcome to the React Native OTA Update Demo! This is the currently.
        New changes after APK install
        new line
      </Text>
      <Text style={{ padding: 16, fontSize: 18, fontWeight: 'bold' }}>
        Welcome to the React Native OTA Update Demo! This is the currently.
        New changes after APK install
        new line
      </Text>
      <Text style={{ padding: 16, fontSize: 18, fontWeight: 'bold' }}>
        Line 5
        Line 6
      </Text>
      <Text style={{ padding: 16, fontSize: 18, fontWeight: 'bold' }}>
        Line 7
        Line 8
      </Text>
      <NewAppScreen
        templateFileName="App.tsx"
        safeAreaInsets={safeAreaInsets}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Banner
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 16,
    zIndex: 999,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bannerIcon: {
    fontSize: 20,
  },
  bannerTextCol: {
    flex: 1,
  },
  bannerText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  bannerSubText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  bannerBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  bannerBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#fff',
    borderRadius: 2,
  },
});

export default App;

/**
 * OtaNativeModule
 * ───────────────
 * Thin JS wrapper around the native TurboModule (Android / iOS).
 * The actual native code lives in:
 *   Android → packages/ota-sdk/android/.../OtaUpdateModule.kt
 *   iOS     → packages/ota-sdk/ios/OtaUpdateModule.swift
 *
 * Both platforms expose identical JS-callable methods.
 */

import { NativeModules, Platform } from 'react-native';

interface NativeOtaInterface {
  /** Returns the absolute path of the bundle pending activation, or null */
  getPendingBundlePath(): Promise<string | null>;
  /** Saves a pending bundle path to persistent native storage */
  setPendingBundle(path: string): Promise<void>;
  /** Clears the pending bundle (used after successful activation) */
  clearPendingBundle(): Promise<void>;

  /** Returns the absolute path of the currently active OTA bundle, or null */
  getActiveBundlePath(): Promise<string | null>;
  /** Saves the active bundle path after first-boot activation */
  setActiveBundlePath(path: string): Promise<void>;
  /** Clears the active bundle path (reverts to APK-bundled JS) */
  clearActiveBundlePath(): Promise<void>;

  /** Stores the previous bundle path for rollback */
  setPreviousBundlePath(path: string | null): Promise<void>;
  getPreviousBundlePath(): Promise<string | null>;

  /** JS-crash counter — called on every cold start before registerComponent */
  incrementCrashCount(): Promise<void>;
  getCrashCount(): Promise<number>;
  resetCrashCount(): Promise<void>;

  /** Restarts the React Native runtime to pick up a new bundle */
  restartApp(): Promise<void>;
}

function getNativeModule(): NativeOtaInterface {
  const mod = NativeModules.OtaUpdateModule as NativeOtaInterface | undefined;
  if (!mod) {
    // Return a no-op stub so the app doesn't crash if the native module
    // hasn't been linked yet (e.g. running in Jest or web).
    console.warn(
      '[OtaSDK] OtaUpdateModule native module not found. ' +
        'Make sure the SDK is properly linked and you have rebuilt the app.',
    );
    const noop = () => Promise.resolve(null as any);
    return {
      getPendingBundlePath: noop,
      setPendingBundle: noop,
      clearPendingBundle: noop,
      getActiveBundlePath: noop,
      setActiveBundlePath: noop,
      clearActiveBundlePath: noop,
      setPreviousBundlePath: noop,
      getPreviousBundlePath: noop,
      incrementCrashCount: noop,
      getCrashCount: () => Promise.resolve(0),
      resetCrashCount: noop,
      restartApp: noop,
    };
  }
  return mod;
}

export const OtaNativeModule: NativeOtaInterface = new Proxy(
  {} as NativeOtaInterface,
  {
    get(_target, prop: string) {
      return (...args: any[]) =>
        (getNativeModule() as any)[prop]?.(...args) ?? Promise.resolve(null);
    },
  },
);

/** Convenience: is the SDK running on a supported platform? */
export const isSupported =
  Platform.OS === 'android' || Platform.OS === 'ios';

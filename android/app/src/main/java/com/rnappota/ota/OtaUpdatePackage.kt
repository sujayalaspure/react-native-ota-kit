package com.rnappota.ota

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * OtaUpdatePackage
 * ─────────────────
 * Registers OtaUpdateModule with the React Native package list.
 * Added to MainApplication manually (cannot be autolinked since
 * it lives inside the app, not a separate library).
 */
class OtaUpdatePackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(OtaUpdateModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}

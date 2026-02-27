package com.rnappota

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.rnappota.ota.OtaBundleManager
import com.rnappota.ota.OtaUpdatePackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    // OtaBundleManager reads SharedPreferences and returns the filesystem
    // path of the active OTA bundle, or null to fall back to the APK asset.
    val otaBundlePath: String? = OtaBundleManager.getActiveBundlePath()

    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // OTA native module — manually registered (lives inside the app)
          add(OtaUpdatePackage())
        },
      // Passing a non-null path overrides the bundled APK JS asset.
      // Passing null causes RN to load the default assets://index.android.bundle.
      jsBundleFilePath = otaBundlePath,
    )
  }

  override fun onCreate() {
    super.onCreate()
    // IMPORTANT: init before loadReactNative so getActiveBundlePath() is ready.
    OtaBundleManager.init(this)
    loadReactNative(this)
  }
}

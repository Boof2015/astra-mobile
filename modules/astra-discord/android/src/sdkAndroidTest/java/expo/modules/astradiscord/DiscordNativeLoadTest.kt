package expo.modules.astradiscord

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DiscordNativeLoadTest {
  @Test
  fun loadsBridgeAndSdkAndInvokesJniWithoutOpeningAClient() {
    // Exercises both the rebuilt bridge and the pinned SDK on the device's
    // real page size. No account, RPC client or presence publication is used.
    val transport = SdkTransport()
    transport.close()
    transport.close()
  }
}

package expo.modules.astraaudioroute

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OutputDeviceSelectorTest {
  private data class Device(val name: String, val kind: String)

  @Test
  fun predictedMediaDeviceWinsOverConnectedBluetoothPriority() {
    val bluetooth = Device("car bluetooth", "bluetooth")
    val usb = Device("android auto usb", "usb")

    val selected = selectPredictedOutputDevice(
      predicted = listOf(usb),
      connected = listOf(bluetooth, usb),
      kindFor = Device::kind,
    )

    assertEquals(usb, selected)
  }

  @Test
  fun legacyFallbackKeepsExistingPriorityWithoutPrediction() {
    val speaker = Device("phone", "speaker")
    val usb = Device("dac", "usb")
    val bluetooth = Device("headphones", "bluetooth")

    val selected = selectPredictedOutputDevice(
      predicted = emptyList(),
      connected = listOf(speaker, usb, bluetooth),
      kindFor = Device::kind,
    )

    assertEquals(bluetooth, selected)
  }

  @Test
  fun externalAddressProducesStablePrivacySafeKey() {
    val first = buildOutputRouteKey("bluetooth", "Sony WH-1000XM5", "AA:BB:CC:DD:EE:FF")
    val same = buildOutputRouteKey("bluetooth", "Renamed headphones", "aa:bb:cc:dd:ee:ff")
    val other = buildOutputRouteKey("bluetooth", "Sony WH-1000XM5", "11:22:33:44:55:66")

    assertTrue(first.startsWith("bluetooth:id:"))
    assertEquals(first, same)
    assertNotEquals(first, other)
    assertTrue(!first.contains("aa:bb"))
  }

  @Test
  fun namedExternalDevicesFallBackToLabelIdentity() {
    assertEquals("bluetooth:name:sony-wh-1000xm5", buildOutputRouteKey("bluetooth", "Sony WH-1000XM5", null))
    assertEquals("usb:name:fiio-k7", buildOutputRouteKey("usb", "FiiO K7", null))
    assertEquals("hdmi:name:living-room-tv", buildOutputRouteKey("hdmi", "Living Room TV", null))
  }

  @Test
  fun genericAndBuiltInOutputsKeepClassKeys() {
    assertEquals("speaker", buildOutputRouteKey("speaker", "Pixel speaker", "internal"))
    assertEquals("wired", buildOutputRouteKey("wired", "3.5mm", "jack"))
    assertEquals("bluetooth", buildOutputRouteKey("bluetooth", "Bluetooth audio", null))
    assertEquals("usb", buildOutputRouteKey("usb", "USB audio", null))
    assertEquals("hdmi", buildOutputRouteKey("hdmi", "HDMI audio", null))
    assertEquals("unknown", buildOutputRouteKey("unknown", "Unknown output", null))
  }
}

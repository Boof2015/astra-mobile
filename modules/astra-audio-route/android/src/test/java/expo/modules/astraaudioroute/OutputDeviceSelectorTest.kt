package expo.modules.astraaudioroute

import org.junit.Assert.assertEquals
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
}

package expo.modules.astradiscord

import expo.modules.astracar.AstraCarPlaybackSnapshot
import expo.modules.astracar.AstraCarTrack
import org.junit.Assert.*
import org.junit.Test

class DiscordPresenceControllerTest {
  private class Fake : DiscordTransport {
    var opens = 0
    var clears = 0
    var closes = 0
    val sent = mutableListOf<Pair<Long, DiscordActivity>>()
    val receipts = mutableListOf<DiscordReceipt>()
    override fun open() { opens++ }
    override fun publish(request: Long, activity: DiscordActivity) { sent.add(request to activity) }
    override fun clear() { clears++ }
    override fun poll() = receipts.toList().also { receipts.clear() }
    override fun close() { closes++ }
    fun ack(success: Boolean = true, id: Long = sent.last().first) { receipts.add(DiscordReceipt(id, success)) }
  }
  private class Session {
    var now = 1_000L
    var sequence = 0L
    val fake = Fake()
    var state = ""
    val controller = DiscordPresenceController(fake, { now }, { 1_800_000_000_000L + now }) { s, _, _ -> state = s }
    init { controller.enabled = true; controller.serviceActive = true; controller.activityReady = true }
    fun snapshot(state: String = "playing", position: Long = 0, title: String = "Song", duration: Long = 180_000, speed: Float = 1f) =
      AstraCarPlaybackSnapshot(1, ++sequence,
        AstraCarTrack(title, title, "Artist", "Album", entryId = title, queuePosition = 0),
        state, position, duration, speed, now)
    fun play() { controller.accept(snapshot()); controller.tick() }
    fun advance(ms: Long) { now += ms; controller.tick() }
  }

  @Test fun disabledOrRestoredSessionNeverOpensTheSdk() {
    val s = Session()
    s.controller.enabled = false
    s.play()
    assertEquals(0, s.fake.opens)
    s.controller.enabled = true
    s.controller.serviceActive = false
    s.controller.tick()
    assertEquals(0, s.fake.opens)
  }

  @Test fun coldHeadlessPlaybackWaitsForActivityWithoutLosingCurrentTrack() {
    val s = Session()
    s.controller.activityReady = false
    s.play()
    assertEquals("waiting", s.state)
    assertEquals(0, s.fake.opens)
    s.controller.activityReady = true
    s.controller.tick()
    assertEquals("Song", s.fake.sent.single().second.title)
  }

  @Test fun progressUsesSecondsAndDoesNotPublishEveryTick() {
    val s = Session()
    s.controller.accept(s.snapshot(position = 60_000))
    s.controller.tick()
    val activity = s.fake.sent.single().second
    assertEquals(1_799_999_941L, activity.start)
    assertEquals(180L, activity.end - activity.start)
    s.fake.ack()
    repeat(100) { s.advance(50) }
    assertEquals(1, s.fake.sent.size)
    assertEquals("active", s.state)
  }

  @Test fun seeksSpeedAndUnknownDurationUseTheNativeClock() {
    val s = Session()
    s.play(); s.fake.ack(); s.advance(1_000)
    s.controller.accept(s.snapshot(position = 60_000, speed = 2f))
    s.controller.tick()
    assertEquals(90L, s.fake.sent.last().second.let { it.end - it.start })
    s.fake.ack(); s.advance(1_000)
    s.controller.accept(s.snapshot(duration = 0))
    s.controller.tick()
    assertEquals(0L, s.fake.sent.last().second.start)
  }

  @Test fun pauseRemovesTimestampsAndExpiresWithoutMorePlaybackEvents() {
    val s = Session()
    s.play(); s.fake.ack(); s.advance(1_000)
    s.controller.accept(s.snapshot(state = "paused", position = 1000))
    s.controller.tick()
    assertEquals("Paused • Artist", s.fake.sent.last().second.state)
    assertEquals(0L, s.fake.sent.last().second.start)
    s.fake.ack(); s.advance(DiscordPresenceController.PAUSE_CLEAR_MS)
    assertEquals(1, s.fake.clears)
    s.advance(1000)
    assertEquals(1, s.fake.closes)
    s.controller.accept(s.snapshot(position = 1000))
    s.controller.tick()
    assertEquals("Artist", s.fake.sent.last().second.state)
    assertEquals(2, s.fake.opens)
  }

  @Test fun stopDisableAndTeardownClearEvenWhenAnUpdateIsStillPending() {
    for (action in listOf<(Session) -> Unit>(
      { it.controller.enabled = false },
      { it.controller.serviceActive = false },
      { it.controller.accept(it.snapshot(state = "stopped")) },
      { it.controller.accept(it.snapshot(state = "error")) },
    )) {
      val s = Session(); s.play(); action(s); s.controller.tick()
      assertEquals(1, s.fake.clears)
      s.fake.ack(); s.advance(1000)
      assertNotEquals("active", s.state)
      assertEquals(1, s.fake.closes)
      assertNull(s.controller.tick())
    }
  }

  @Test fun rapidSkipsCoalesceAndAnOldReceiptDoesNotDescribeTheNewTrack() {
    val s = Session(); s.play()
    s.controller.accept(s.snapshot(title = "Second"))
    s.controller.accept(s.snapshot(title = "Third"))
    s.fake.ack(); s.advance(1_000)
    assertEquals(2, s.fake.sent.size)
    assertEquals("Third", s.fake.sent.last().second.title)
    assertEquals("updating", s.state)
    s.fake.ack(id = s.fake.sent.first().first); s.advance(50)
    assertEquals("updating", s.state)
    s.fake.ack(); s.advance(50)
    assertEquals("active", s.state)
  }

  @Test fun failureBackoffKeepsOnlyTheLatestTrackAndHeartbeatRepublishes() {
    val s = Session(); s.play(); s.fake.ack(false); s.advance(50)
    assertEquals("unavailable", s.state)
    s.controller.accept(s.snapshot(title = "Latest")); s.advance(500)
    assertEquals(1, s.fake.sent.size)
    s.advance(1500)
    assertEquals("Latest", s.fake.sent.last().second.title)
    s.fake.ack(); s.advance(50)
    s.advance(30_000)
    assertEquals(3, s.fake.sent.size)
  }

  @Test fun unicodeTruncationDoesNotSplitSupplementaryCharacters() {
    assertEquals("A\u200B", DiscordPresenceController.text(" A "))
    val value = DiscordPresenceController.text("🎵".repeat(140))
    assertEquals(128, value.codePointCount(0, value.length))
    assertTrue(value.endsWith("…"))
    assertFalse(value.contains("\uFFFD"))
  }

  @Test fun pauseTimeoutChangesApplyToTheContinuousPauseAndOffKeepsPresence() {
    val s = Session()
    s.controller.preferences = DiscordPreferences(pauseClearMinutes = 0)
    s.controller.accept(s.snapshot(state = "paused"))
    s.controller.tick(); s.fake.ack(); s.advance(31 * 60_000L)
    assertEquals(0, s.fake.clears)
    s.controller.preferences = s.controller.preferences.copy(pauseClearMinutes = 1)
    s.controller.tick()
    assertEquals(1, s.fake.clears)
    s.controller.preferences = s.controller.preferences.copy(pauseClearMinutes = 0)
    s.advance(1000)
    assertEquals("Paused • Artist", s.fake.sent.last().second.state)
  }

  @Test fun lateArtworkIsIgnoredAfterSkippingAndDisablingArtRemovesTheBadge() {
    val s = Session()
    s.controller.preferences = DiscordPreferences(coverArtEnabled = true)
    val first = s.snapshot()
    s.controller.accept(first); s.controller.tick(); s.fake.ack(); s.advance(1000)
    s.controller.accept(s.snapshot(title = "Next")); s.controller.tick(); s.fake.ack(); s.advance(1000)
    s.controller.artwork = DiscordArtworkQuery.from(first.track!!) to "https://archive.org/previous.jpg"
    s.controller.tick()
    assertEquals(DISCORD_ASTRA_ICON, s.fake.sent.last().second.largeImage)
    val next = s.snapshot(title = "Next")
    s.controller.artwork = DiscordArtworkQuery.from(next.track!!) to "https://archive.org/current.jpg"
    s.controller.tick()
    assertEquals("https://archive.org/current.jpg", s.fake.sent.last().second.largeImage)
    assertEquals(DISCORD_ASTRA_ICON, s.fake.sent.last().second.smallImage)
    s.fake.ack(); s.advance(1000)
    s.controller.preferences = s.controller.preferences.copy(coverArtEnabled = false, linkDestination = "off", compactStatusMode = "artist")
    s.controller.tick()
    assertEquals(DISCORD_ASTRA_ICON, s.fake.sent.last().second.largeImage)
    assertEquals("", s.fake.sent.last().second.smallImage)
    assertEquals("", s.fake.sent.last().second.detailsUrl)
    assertEquals(1, s.fake.sent.last().second.statusDisplay)
  }
}

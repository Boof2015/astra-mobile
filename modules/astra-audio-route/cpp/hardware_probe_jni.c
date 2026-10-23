// Plain-JNI bridge for HardwareOutputProbe.kt.
//
// Opens (never starts) a shared AAudio stream and reads the format of the hardware
// stream Android attached it to. libaaudio is dlopen'd rather than linked: the module's
// minSdk predates AAudio, and the getHardware* calls only exist from Android 14 (API 34),
// which the Kotlin side checks before calling in.

#include <jni.h>

#include <aaudio/AAudio.h>
#include <dlfcn.h>
#include <stddef.h>

typedef aaudio_result_t (*CreateBuilderFn)(AAudioStreamBuilder **);
typedef void (*SetBuilderIntFn)(AAudioStreamBuilder *, int32_t);
typedef aaudio_result_t (*OpenStreamFn)(AAudioStreamBuilder *, AAudioStream **);
typedef aaudio_result_t (*DeleteBuilderFn)(AAudioStreamBuilder *);
typedef int32_t (*StreamIntFn)(AAudioStream *);
typedef aaudio_result_t (*CloseStreamFn)(AAudioStream *);

static struct {
  int state;  // 0 = not tried, 1 = loaded, -1 = unavailable
  CreateBuilderFn createBuilder;
  SetBuilderIntFn setDirection, setSharingMode, setPerformanceMode, setUsage, setContentType,
      setSampleRate, setChannelCount, setFormat;
  OpenStreamFn openStream;
  DeleteBuilderFn deleteBuilder;
  StreamIntFn hardwareSampleRate, hardwareChannelCount, hardwareFormat, deviceId;
  CloseStreamFn closeStream;
} api;

// Only the probe's single executor thread calls this.
static int loadApi(void) {
  if (api.state != 0) return api.state > 0;
  void *lib = dlopen("libaaudio.so", RTLD_NOW);
  if (lib == NULL) {
    api.state = -1;
    return 0;
  }
#define SYM(field, name) api.field = (__typeof__(api.field))dlsym(lib, name)
  SYM(createBuilder, "AAudio_createStreamBuilder");
  SYM(setDirection, "AAudioStreamBuilder_setDirection");
  SYM(setSharingMode, "AAudioStreamBuilder_setSharingMode");
  SYM(setPerformanceMode, "AAudioStreamBuilder_setPerformanceMode");
  SYM(setUsage, "AAudioStreamBuilder_setUsage");
  SYM(setContentType, "AAudioStreamBuilder_setContentType");
  SYM(setSampleRate, "AAudioStreamBuilder_setSampleRate");
  SYM(setChannelCount, "AAudioStreamBuilder_setChannelCount");
  SYM(setFormat, "AAudioStreamBuilder_setFormat");
  SYM(openStream, "AAudioStreamBuilder_openStream");
  SYM(deleteBuilder, "AAudioStreamBuilder_delete");
  SYM(hardwareSampleRate, "AAudioStream_getHardwareSampleRate");
  SYM(hardwareChannelCount, "AAudioStream_getHardwareChannelCount");
  SYM(hardwareFormat, "AAudioStream_getHardwareFormat");
  SYM(deviceId, "AAudioStream_getDeviceId");
  SYM(closeStream, "AAudioStream_close");
#undef SYM
  int ok = api.createBuilder && api.setDirection && api.setSharingMode && api.setPerformanceMode &&
           api.setUsage && api.setContentType && api.setSampleRate && api.setChannelCount &&
           api.setFormat && api.openStream && api.deleteBuilder && api.hardwareSampleRate &&
           api.hardwareChannelCount && api.hardwareFormat && api.deviceId && api.closeStream;
  api.state = ok ? 1 : -1;
  return ok;
}

// Returns [hardwareSampleRate, hardwareChannelCount, hardwareFormat, deviceId], or null.
// A zero argument leaves that property unspecified.
JNIEXPORT jintArray JNICALL
Java_expo_modules_astraaudioroute_HardwareOutputProbe_nativeProbe(
    JNIEnv *env, jclass clazz, jint sampleRate, jint channels, jint format) {
  (void)clazz;
  if (!loadApi()) return NULL;
  AAudioStreamBuilder *builder = NULL;
  if (api.createBuilder(&builder) != AAUDIO_OK || builder == NULL) return NULL;
  // Shaped like ExoPlayer's AudioTrack (shared, no fast/MMAP path, media usage) so the
  // audio policy picks the output the player's track is on.
  api.setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
  api.setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
  api.setPerformanceMode(builder, AAUDIO_PERFORMANCE_MODE_NONE);
  api.setUsage(builder, AAUDIO_USAGE_MEDIA);
  api.setContentType(builder, AAUDIO_CONTENT_TYPE_MUSIC);
  if (sampleRate > 0) api.setSampleRate(builder, sampleRate);
  if (channels > 0) api.setChannelCount(builder, channels);
  if (format > 0) api.setFormat(builder, format);

  AAudioStream *stream = NULL;
  aaudio_result_t result = api.openStream(builder, &stream);
  api.deleteBuilder(builder);
  if (result != AAUDIO_OK || stream == NULL) return NULL;

  jint values[4] = {
      api.hardwareSampleRate(stream),
      api.hardwareChannelCount(stream),
      api.hardwareFormat(stream),
      api.deviceId(stream),
  };
  api.closeStream(stream);

  jintArray out = (*env)->NewIntArray(env, 4);
  if (out != NULL) (*env)->SetIntArrayRegion(env, out, 0, 4, values);
  return out;
}

/** Source metadata only: this does not describe the active output device. */
export function hasAtmosMetadata(track: {
  codec?: string | null;
  codecProfile?: string | null;
  isAtmosJoc?: boolean | null;
}): boolean {
  return track.isAtmosJoc === true || /atmos|joc/i.test(
    `${track.codec ?? ''} ${track.codecProfile ?? ''}`
  );
}

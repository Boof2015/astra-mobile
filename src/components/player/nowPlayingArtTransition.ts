export interface ArtTransition {
  key: string | null;
  previousKey: string | null;
  direction: 1 | -1;
  front: number;
  generation: number;
}

export function advanceArtTransition(
  current: ArtTransition,
  key: string | null,
  direction: 1 | -1,
): ArtTransition {
  if (key === current.key) return current;
  return {
    key,
    previousKey: current.key,
    direction: key !== null && key === current.previousKey
      ? (current.direction === 1 ? -1 : 1)
      : direction,
    front: 1 - current.front,
    generation: current.generation + 1,
  };
}

export function canReleaseArtSlot(current: ArtTransition, slot: number, generation: number): boolean {
  return current.generation === generation && current.front !== slot;
}

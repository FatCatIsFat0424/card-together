import useMediaQuery from '@mui/material/useMediaQuery';
import { useMotionStore } from '../../stores/motion-store';
import type { SplitSvg } from './svg-layers';

/** Animated artwork as composited layers; `image` fields are data URLs. */
export type LayeredArtwork = SplitSvg;

/** Keys `*.svg?layers` glob results by file name; artwork that does not animate yields null and is skipped. */
export function artByName(modules: Record<string, LayeredArtwork | null>): ReadonlyMap<string, LayeredArtwork> {
  return new Map(Object.entries(modules).flatMap(([path, art]) =>
    art ? [[path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), art]] : []));
}

/** Site or system reduced motion: artwork shows the original file's still frame instead of layers. */
export function useStillArt(): boolean {
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return reducedMotion || systemReducedMotion;
}

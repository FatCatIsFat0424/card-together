import { memo } from 'react';
import type { CSSProperties, ReactNode, RefCallback } from 'react';
import type { LayeredArtwork } from './art-layers';
import type { ArtLayer, ArtLayerImage, ArtLayerMotion } from './svg-layers';
import styles from './LayeredArt.module.css';

const MOTION_REFS = new WeakMap<ArtLayerMotion, RefCallback<HTMLElement>>();
const ANIMATIONS = new WeakMap<Element, Animation>();
let visibility: IntersectionObserver | null = null;

/**
 * Hidden or off-screen layers pause: browsers cannot composite an animation they cannot see and would
 * otherwise update it on the main thread. Playing again re-syncs to the shared timeline.
 */
function observeVisibility(element: HTMLElement): void {
  if (typeof IntersectionObserver !== 'function') return;
  visibility ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const animation = ANIMATIONS.get(entry.target);
      if (!animation) continue;
      if (!entry.isIntersecting) animation.pause();
      else if (animation.playState === 'paused') {
        animation.play();
        animation.startTime = 0;
      }
    }
  });
  visibility.observe(element);
}

/** Stable per motion, so re-renders keep the running animation. */
function motionRef(motion: ArtLayerMotion): RefCallback<HTMLElement> {
  let ref = MOTION_REFS.get(motion);
  if (!ref) {
    ref = (element) => {
      if (!element || typeof element.animate !== 'function') return;
      const animation = element.animate(motion.keyframes, {
        duration: motion.duration, iterations: Infinity, direction: motion.direction,
      });
      // Every copy follows the page timeline, as all uses of one animated SVG image move in step.
      animation.startTime = 0;
      ANIMATIONS.set(element, animation);
      observeVisibility(element);
      return () => {
        visibility?.unobserve(element);
        ANIMATIONS.delete(element);
        animation.cancel();
      };
    };
    MOTION_REFS.set(motion, ref);
  }
  return ref;
}

function ArtImage({ layer }: { layer: ArtLayerImage }): ReactNode {
  const [left, top, width, height] = layer.box;
  const inner = layer.motions[layer.motions.length - 1];
  let content: ReactNode = <img className={styles.fill} src={layer.image} alt="" draggable={false} decoding="async"
    ref={inner && motionRef(inner)} style={inner && { transformOrigin: inner.origin }} />;
  // Outer motions wrap inner ones, as the animated SVG groups nest.
  for (const motion of layer.motions.slice(0, -1).reverse()) {
    content = <span className={styles.fill} ref={motionRef(motion)} style={{ transformOrigin: motion.origin }}>{content}</span>;
  }
  return <span className={styles.layer} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
    {content}
  </span>;
}

function ArtLayers({ layers }: { layers: readonly ArtLayer[] }): ReactNode {
  return layers.map((layer, index) => 'image' in layer ? <ArtImage key={index} layer={layer} />
    : <span key={index} className={styles.fill} style={{ opacity: layer.opacity }}><ArtLayers layers={layer.layers} /></span>);
}

interface LayeredArtProps {
  art: LayeredArtwork;
  /** `cover` matches `background-size: cover`; `fill` stretches the artwork over the element. */
  fit: 'cover' | 'fill';
  /** Positions and sizes the artwork; the element itself only clips. */
  className?: string;
}

/**
 * Animated artwork drawn as stacked images that the compositor moves and fades, so the browser never
 * re-rasterizes the artwork while it animates. Decorative and hidden from assistive technology.
 */
export const LayeredArt = memo(function LayeredArt({ art, fit, className }: LayeredArtProps): ReactNode {
  return <span className={`${styles.art} ${className ?? ''}`} aria-hidden="true">
    <span className={fit === 'cover' ? styles.cover : styles.fill} style={{ '--art-aspect': art.width / art.height } as CSSProperties}>
      <ArtLayers layers={art.layers} />
    </span>
  </span>;
});

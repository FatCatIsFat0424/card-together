import { memo } from 'react';
import type { CSSProperties, ReactNode, RefCallback } from 'react';
import type { LayeredArtwork } from './art-layers';
import type { ArtLayer, ArtLayerImage, ArtLayerMotion } from './svg-layers';
import styles from './LayeredArt.module.css';

interface LayerMotion {
  element: HTMLElement;
  motion: ArtLayerMotion;
  animation: Animation | null;
  /** The image is decoded and painted, so the browser can composite the animation. */
  ready: boolean;
  visible: boolean;
}

const MOTION_REFS = new WeakMap<ArtLayerMotion, RefCallback<HTMLElement>>();
const MOTIONS = new WeakMap<Element, LayerMotion>();
let visibility: IntersectionObserver | null = null;

/**
 * Browsers composite an animation only if its target is painted when it starts; otherwise it runs on
 * the main thread and repaints every frame. Layers therefore start once their image is drawn and
 * visible, pause while hidden or off-screen, and restart (re-synced to the shared timeline) when shown.
 */
function update(entry: LayerMotion): void {
  if (!entry.ready || !entry.visible) {
    entry.animation?.pause();
    return;
  }
  if (entry.animation?.playState === 'running') return;
  entry.animation?.cancel();
  entry.animation = entry.element.animate(entry.motion.keyframes, {
    duration: entry.motion.duration, iterations: Infinity, direction: entry.motion.direction,
  });
  // Every copy follows the page timeline, as all uses of one animated SVG image move in step.
  entry.animation.startTime = 0;
}

function observeVisibility(entry: LayerMotion): void {
  if (typeof IntersectionObserver !== 'function') {
    entry.visible = true;
    return;
  }
  visibility ??= new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const observed = MOTIONS.get(target);
      if (!observed) continue;
      observed.visible = isIntersecting;
      update(observed);
    }
  });
  visibility.observe(entry.element);
}

/** Stable per motion, so re-renders keep the running animation. */
function motionRef(motion: ArtLayerMotion): RefCallback<HTMLElement> {
  let ref = MOTION_REFS.get(motion);
  if (!ref) {
    ref = (element) => {
      if (!element || typeof element.animate !== 'function') return;
      const entry: LayerMotion = { element, motion, animation: null, ready: false, visible: false };
      let mounted = true;
      MOTIONS.set(element, entry);
      observeVisibility(entry);
      const image = element instanceof HTMLImageElement ? element : element.querySelector('img');
      // Two frames: the first paints the decoded image, so the animation starts on a painted target.
      void (image?.decode() ?? Promise.resolve()).catch(() => undefined).then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!mounted) return;
        entry.ready = true;
        update(entry);
      })));
      return () => {
        mounted = false;
        visibility?.unobserve(element);
        MOTIONS.delete(element);
        entry.animation?.cancel();
      };
    };
    MOTION_REFS.set(motion, ref);
  }
  return ref;
}

/** Keeps each moving layer on its own compositing layer, so parents never repaint for it. */
function motionStyle(motion: ArtLayerMotion): CSSProperties {
  const properties = [
    ...motion.keyframes.some((frame) => frame.transform) ? ['transform'] : [],
    ...motion.keyframes.some((frame) => frame.opacity !== undefined) ? ['opacity'] : [],
  ];
  return { transformOrigin: motion.origin, willChange: properties.join(', ') };
}

function ArtImage({ layer }: { layer: ArtLayerImage }): ReactNode {
  const [left, top, width, height] = layer.box;
  const inner = layer.motions[layer.motions.length - 1];
  let content: ReactNode = <img className={styles.fill} src={layer.image} alt="" draggable={false} decoding="async"
    ref={inner && motionRef(inner)} style={inner && motionStyle(inner)} />;
  // Outer motions wrap inner ones, as the animated SVG groups nest.
  for (const motion of layer.motions.slice(0, -1).reverse()) {
    content = <span className={styles.fill} ref={motionRef(motion)} style={motionStyle(motion)}>{content}</span>;
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

// ─── Animated SVG artwork split into separately composited image layers ───
//
// Build-time only (see scripts/assets/vite-svg-layers.ts). A browser re-rasterizes a whole SVG image
// whenever any element inside it animates, so each animated element moves to its own image that the
// page animates with `transform`/`opacity` only; static artwork is drawn once. Parts keep their paint
// order: a part may share a lower layer only when its conservatively estimated area clears every layer
// in between. Unsupported markup throws so the build fails instead of shipping a different picture.

/** One keyframe in Web Animations form, in the coordinate space of its layer box. */
export type ArtLayerKeyframe = {
  offset: number;
  easing: string;
  transform?: string;
  opacity?: number;
};

/** An infinitely repeating motion; every instance shares the document timeline. */
export interface ArtLayerMotion {
  keyframes: ArtLayerKeyframe[];
  /** Milliseconds per iteration. */
  duration: number;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  /** CSS `transform-origin` relative to the layer box. */
  origin: string;
}

export interface ArtLayerImage<Image = string> {
  /** Standalone SVG source cropped to the layer's content. */
  image: Image;
  /** Left, top, width, and height as percentages of the artwork. */
  box: [number, number, number, number];
  /** Nested motions, outermost first; empty for static artwork. */
  motions: ArtLayerMotion[];
}

/** A translucent group whose parts overlap across layers; its opacity applies to their composite. */
export interface ArtLayerGroup<Image = string> {
  opacity: number;
  layers: Array<ArtLayer<Image>>;
}

export type ArtLayer<Image = string> = ArtLayerImage<Image> | ArtLayerGroup<Image>;

export interface SplitSvg<Image = string> {
  width: number;
  height: number;
  /** Bottom to top. */
  layers: Array<ArtLayer<Image>>;
}

export interface SplitSvgOptions {
  /** Parts closer than this many artwork units count as overlapping, covering antialiased edges. */
  margin?: number;
}

/** Splits animated artwork into paint-ordered layers; null when nothing in it animates. */
export function splitAnimatedSvg(source: string, options: SplitSvgOptions = {}): SplitSvg | null {
  const root = parseSvg(source);
  if (root.name !== 'svg') throw new Error('Expected an <svg> root element.');
  const viewBox = numberList(attribute(root, 'viewBox') ?? '');
  if (viewBox.length !== 4 || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error('Expected a positive viewBox.');
  const [minX, minY, width, height] = viewBox;
  const styles = root.children.filter(isElement).filter((child) => child.name === 'style');
  const sheet = parseStyleSheet(styles.map(textContent).join('\n'));
  const pad = (options.margin ?? 1.5) / 2;
  const nested = new Set<SvgElement>();
  for (;;) {
    const units = collectUnits(root, sheet, pad, nested);
    if (!units.some(animates)) return null;
    const layers = placeUnits(units);
    const group = overlappingGroup(layers);
    if (!group) {
      const view = { x0: minX, y0: minY, x1: minX + width, y1: minY + height };
      return { width, height, layers: renderLayers(root, layers, view, pad, []) };
    }
    if (nested.has(group)) throw new Error('Could not separate a translucent group.');
    nested.add(group);
  }
}

// ─── Minimal SVG document model ───

interface SvgElement {
  name: string;
  attributes: Array<[string, string]>;
  children: SvgNode[];
}

type SvgNode = SvgElement | string;

function isElement(node: SvgNode): node is SvgElement {
  return typeof node !== 'string';
}

function attribute(element: SvgElement, name: string): string | undefined {
  return element.attributes.find(([key]) => key === name)?.[1];
}

function textContent(element: SvgElement): string {
  return element.children.map((child) => isElement(child) ? textContent(child) : child).join('');
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    }
    const value = ENTITIES[name];
    if (value === undefined) throw new Error(`Unsupported entity ${match}.`);
    return value;
  });
}

function parseSvg(source: string): SvgElement {
  let index = 0;
  const fail = (message: string): never => {
    throw new Error(`${message} (offset ${index}).`);
  };
  const skipMarkup = (): void => {
    for (;;) {
      while (/\s/.test(source[index] ?? '')) index += 1;
      if (source.startsWith('<?', index)) index = closing('?>');
      else if (source.startsWith('<!--', index)) index = closing('-->');
      else if (source.startsWith('<!', index) && !source.startsWith('<![CDATA[', index)) fail('Unsupported declaration');
      else return;
    }
  };
  const closing = (marker: string): number => {
    const end = source.indexOf(marker, index);
    if (end < 0) fail(`Missing ${marker}`);
    return end + marker.length;
  };
  const name = (): string => {
    const match = /[A-Za-z_][\w:.-]*/y;
    match.lastIndex = index;
    const result = match.exec(source);
    if (!result) return fail('Expected a name');
    index = match.lastIndex;
    return result[0];
  };
  const element = (): SvgElement => {
    if (source[index] !== '<') fail('Expected an element');
    index += 1;
    const node: SvgElement = { name: name(), attributes: [], children: [] };
    for (;;) {
      while (/\s/.test(source[index] ?? '')) index += 1;
      if (source.startsWith('/>', index)) {
        index += 2;
        return node;
      }
      if (source[index] === '>') break;
      const key = name();
      const value = /\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
      value.lastIndex = index;
      const result = value.exec(source);
      if (!result) fail(`Expected a quoted value for ${key}`);
      index = value.lastIndex;
      node.attributes.push([key, decodeEntities(result![1] ?? result![2])]);
    }
    index += 1;
    for (;;) {
      if (index >= source.length) fail(`Unclosed <${node.name}>`);
      if (source.startsWith('</', index)) {
        index += 2;
        if (name() !== node.name) fail(`Mismatched </${node.name}>`);
        while (/\s/.test(source[index] ?? '')) index += 1;
        if (source[index] !== '>') fail('Expected >');
        index += 1;
        return node;
      }
      if (source.startsWith('<!--', index)) index = closing('-->');
      else if (source.startsWith('<![CDATA[', index)) {
        const start = index + 9;
        index = closing(']]>');
        node.children.push(source.slice(start, index - 3));
      } else if (source[index] === '<') node.children.push(element());
      else {
        const end = source.indexOf('<', index);
        const text = source.slice(index, end < 0 ? source.length : end);
        index += text.length;
        if (text.trim()) node.children.push(decodeEntities(text));
      }
    }
  };
  skipMarkup();
  const root = element();
  skipMarkup();
  if (index < source.length) fail('Unexpected content after the root element');
  return root;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function serialize(node: SvgNode): string {
  if (!isElement(node)) return escapeXml(node);
  const attributes = node.attributes.map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
  return node.children.length
    ? `<${node.name}${attributes}>${node.children.map(serialize).join('')}</${node.name}>`
    : `<${node.name}${attributes}/>`;
}

// ─── Animation styles ───

type Direction = ArtLayerMotion['direction'];

interface Keyframes {
  transform: Array<{ offset: number; value: CssTransform }>;
  opacity: Array<{ offset: number; value: number }>;
}

type CssTransform = { rotate: number } | { translate: Point };

interface ClassAnimation {
  keyframes: Keyframes;
  duration: number;
  easing: string;
  direction: Direction;
  fillBoxCenter: boolean;
}

interface StyleSheet {
  animations: Map<string, ClassAnimation>;
}

const EASINGS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
const DIRECTIONS = new Set<string>(['normal', 'reverse', 'alternate', 'alternate-reverse']);

function cssBlocks(text: string): Array<{ prelude: string; body: string }> {
  const blocks: Array<{ prelude: string; body: string }> = [];
  let index = 0;
  for (;;) {
    const open = text.indexOf('{', index);
    if (open < 0) {
      if (text.slice(index).trim()) throw new Error(`Unexpected style text: ${text.slice(index).trim()}`);
      return blocks;
    }
    let depth = 1;
    let end = open + 1;
    for (; depth; end += 1) {
      if (end >= text.length) throw new Error('Unbalanced braces in <style>.');
      if (text[end] === '{') depth += 1;
      else if (text[end] === '}') depth -= 1;
    }
    blocks.push({ prelude: text.slice(index, open).trim(), body: text.slice(open + 1, end - 1) });
    index = end;
  }
}

function declarations(body: string): Array<[string, string]> {
  return body.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':');
    if (colon < 0) throw new Error(`Invalid declaration: ${part}`);
    return [part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()];
  });
}

function parseStyleSheet(css: string): StyleSheet {
  const keyframes = new Map<string, Keyframes>();
  const classes = new Map<string, Array<[string, string]>>();
  for (const { prelude, body } of cssBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    const named = /^@keyframes\s+([\w-]+)$/.exec(prelude);
    const className = /^\.([\w-]+)$/.exec(prelude);
    if (named) keyframes.set(named[1], parseKeyframes(body));
    else if (className) classes.set(className[1], declarations(body));
    // The still variant and reduced-motion fallback are served from the original file.
    else if (prelude === 'svg:target *' || /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/.test(prelude)) continue;
    else throw new Error(`Unsupported style rule: ${prelude}`);
  }
  const animations = new Map<string, ClassAnimation>();
  for (const [name, rules] of classes) {
    let animation: Omit<ClassAnimation, 'fillBoxCenter'> | null = null;
    let box = 'view-box';
    let origin = '0 0';
    for (const [property, value] of rules) {
      if (property === 'animation') animation = parseAnimation(value, keyframes);
      else if (property === 'transform-box') box = value;
      else if (property === 'transform-origin') origin = value;
      else throw new Error(`Unsupported property ${property} in .${name}.`);
    }
    if (!animation) throw new Error(`Class .${name} has no animation.`);
    animations.set(name, {
      ...animation,
      fillBoxCenter: box === 'fill-box' && ['center', 'center center', '50% 50%'].includes(origin),
    });
  }
  return { animations };
}

function parseKeyframes(body: string): Keyframes {
  const frames: Keyframes = { transform: [], opacity: [] };
  for (const { prelude, body: block } of cssBlocks(body)) {
    const offsets = prelude.split(',').map((selector) => {
      const value = selector.trim();
      if (value === 'from') return 0;
      if (value === 'to') return 1;
      const percent = /^(\d+(?:\.\d+)?)%$/.exec(value);
      if (!percent || Number(percent[1]) > 100) throw new Error(`Invalid keyframe selector: ${value}`);
      return Number(percent[1]) / 100;
    });
    for (const [property, value] of declarations(block)) {
      for (const offset of offsets) {
        if (property === 'transform') frames.transform.push({ offset, value: parseCssTransform(value) });
        else if (property === 'opacity') frames.opacity.push({ offset, value: cssNumber(value) });
        else throw new Error(`Unsupported keyframe property: ${property}`);
      }
    }
  }
  frames.transform.sort((a, b) => a.offset - b.offset);
  frames.opacity.sort((a, b) => a.offset - b.offset);
  return frames;
}

function cssNumber(value: string): number {
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value)) throw new Error(`Expected a number: ${value}`);
  return Number(value);
}

function cssLength(value: string): number {
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+))(px)?$/.exec(value.trim());
  if (!match || (!match[2] && Number(match[1]) !== 0)) throw new Error(`Expected a px length: ${value}`);
  return Number(match[1]);
}

function cssAngle(value: string): number {
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad)?$/.exec(value.trim());
  if (!match || (!match[2] && Number(match[1]) !== 0)) throw new Error(`Expected an angle: ${value}`);
  const amount = Number(match[1]);
  return match[2] === 'turn' ? amount * 360 : match[2] === 'rad' ? amount * 180 / Math.PI : amount;
}

function parseCssTransform(value: string): CssTransform {
  const match = /^(rotate|translate|translateX|translateY)\(([^)]*)\)$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported keyframe transform: ${value}`);
  const args = match[2].split(',');
  if (match[1] === 'rotate' && args.length === 1) return { rotate: cssAngle(args[0]) };
  if (match[1] === 'translate' && args.length <= 2) {
    return { translate: { x: cssLength(args[0]), y: args[1] === undefined ? 0 : cssLength(args[1]) } };
  }
  if (match[1] === 'translateX' && args.length === 1) return { translate: { x: cssLength(args[0]), y: 0 } };
  if (match[1] === 'translateY' && args.length === 1) return { translate: { x: 0, y: cssLength(args[0]) } };
  throw new Error(`Unsupported keyframe transform: ${value}`);
}

function parseAnimation(value: string, keyframes: ReadonlyMap<string, Keyframes>): Omit<ClassAnimation, 'fillBoxCenter'> {
  if (value.includes(',')) {
    const parenthesized = value.replace(/\([^)]*\)/g, '');
    if (parenthesized.includes(',')) throw new Error(`Only one animation per class is supported: ${value}`);
  }
  let name: string | null = null;
  const times: number[] = [];
  let easing = 'ease';
  let direction: Direction = 'normal';
  let infinite = false;
  for (const token of value.match(/[\w-]+\([^)]*\)|\S+/g) ?? []) {
    const time = /^([-+]?(?:\d+\.?\d*|\.\d+))(m?s)$/.exec(token);
    if (time) times.push(Number(time[1]) * (time[2] === 's' ? 1000 : 1));
    else if (EASINGS.has(token)) easing = token;
    else if (/^cubic-bezier\(/.test(token)) {
      const [, y1, , y2] = numberList(token.slice(13, -1));
      // Overshooting curves would move parts outside their estimated sweep.
      if (!(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1)) throw new Error(`Overshooting easing: ${token}`);
      easing = token;
    } else if (DIRECTIONS.has(token)) direction = token as Direction;
    else if (token === 'infinite') infinite = true;
    else if (keyframes.has(token) && !name) name = token;
    else throw new Error(`Unsupported animation value: ${token}`);
  }
  if (!name) throw new Error(`Animation names no keyframes: ${value}`);
  if (!infinite) throw new Error(`Only infinite animations are supported: ${value}`);
  if (!times[0] || times[0] <= 0 || times.length > 2 || (times[1] ?? 0) !== 0) {
    throw new Error(`Expected a positive duration without delay: ${value}`);
  }
  return { keyframes: keyframes.get(name)!, duration: times[0], easing, direction };
}

// ─── Geometry ───

interface Point {
  x: number;
  y: number;
}

/** Affine matrix in SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, point: Point): Point {
  return { x: m[0] * point.x + m[2] * point.y + m[4], y: m[1] * point.x + m[3] * point.y + m[5] };
}

function applyLinear(m: Matrix, vector: Point): Point {
  return { x: m[0] * vector.x + m[2] * vector.y, y: m[1] * vector.x + m[3] * vector.y };
}

function isSimilarity(m: Matrix): boolean {
  const tolerance = 1e-9 * (Math.abs(m[0]) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[3]));
  return (Math.abs(m[0] - m[3]) <= tolerance && Math.abs(m[1] + m[2]) <= tolerance)
    || (Math.abs(m[0] + m[3]) <= tolerance && Math.abs(m[1] - m[2]) <= tolerance);
}

/** Largest stretch the matrix applies to any direction. */
function maxScale(m: Matrix): number {
  const [a, b, c, d] = m;
  const sum = a * a + b * b + c * c + d * d;
  return Math.sqrt((sum + Math.sqrt((a * a + b * b - c * c - d * d) ** 2 + 4 * (a * c + b * d) ** 2)) / 2);
}

function numberList(text: string): number[] {
  return (text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

function parseTransform(text: string | undefined): Matrix {
  let matrix = IDENTITY;
  if (!text) return matrix;
  const pattern = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy;
  let index = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    index = pattern.lastIndex;
    const args = numberList(match[2]);
    const radians = (args[0] ?? 0) * Math.PI / 180;
    let next: Matrix;
    if (match[1] === 'matrix' && args.length === 6) next = args as unknown as Matrix;
    else if (match[1] === 'translate' && args.length >= 1 && args.length <= 2) next = [1, 0, 0, 1, args[0], args[1] ?? 0];
    else if (match[1] === 'scale' && args.length >= 1 && args.length <= 2) next = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
    else if (match[1] === 'rotate' && (args.length === 1 || args.length === 3)) {
      const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      next = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    } else if (match[1] === 'skewX' && args.length === 1) next = [1, 0, Math.tan(radians), 1, 0, 0];
    else if (match[1] === 'skewY' && args.length === 1) next = [1, Math.tan(radians), 0, 1, 0, 0];
    else throw new Error(`Invalid transform: ${text}`);
    matrix = multiply(matrix, next);
  }
  if (text.slice(index).trim()) throw new Error(`Invalid transform: ${text}`);
  return matrix;
}

interface Subpath {
  points: Point[];
  closed: boolean;
}

interface Shape {
  subpaths: Subpath[];
  circle?: { center: Point; radius: number };
  fillable: boolean;
}

/** Curves are flattened to within this many local units; estimates widen by the same amount. */
const FLATNESS = 0.05;

function arcStep(radius: number): number {
  return radius <= FLATNESS ? Math.PI / 2 : Math.min(Math.PI / 8, 2 * Math.acos(1 - FLATNESS / radius));
}

function ellipsePoints(center: Point, rx: number, ry: number): Point[] {
  const segments = 4 * Math.ceil(Math.PI / 2 / arcStep(Math.max(rx, ry)));
  return Array.from({ length: segments }, (_, index) => {
    const angle = index / segments * 2 * Math.PI;
    return { x: center.x + rx * Math.cos(angle), y: center.y + ry * Math.sin(angle) };
  });
}

function parseLength(value: string, label: string): number {
  if (!/^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s*(?:px)?\s*$/i.test(value)) throw new Error(`Unsupported ${label}: ${value}`);
  return parseFloat(value);
}

function length(element: SvgElement, name: string): number {
  const value = attribute(element, name);
  return value === undefined ? 0 : parseLength(value, `${name} on <${element.name}>`);
}

function shapeGeometry(element: SvgElement): Shape {
  switch (element.name) {
    case 'rect': {
      const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((name) => length(element, name));
      if (width <= 0 || height <= 0) return { subpaths: [], fillable: true };
      const rxValue = attribute(element, 'rx') === undefined ? undefined : length(element, 'rx');
      const ryValue = attribute(element, 'ry') === undefined ? undefined : length(element, 'ry');
      const rx = Math.min(width / 2, Math.max(0, rxValue ?? ryValue ?? 0));
      const ry = Math.min(height / 2, Math.max(0, ryValue ?? rxValue ?? 0));
      if (!rx || !ry) {
        return {
          subpaths: [{ points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], closed: true }],
          fillable: true,
        };
      }
      const corner = ellipsePoints({ x: 0, y: 0 }, rx, ry);
      const quarter = corner.length / 4;
      const corners = [
        { x: x + width - rx, y: y + height - ry }, { x: x + rx, y: y + height - ry },
        { x: x + rx, y: y + ry }, { x: x + width - rx, y: y + ry },
      ];
      const points = corners.flatMap((center, index) => corner.slice(index * quarter, (index + 1) * quarter + 1)
        .map((point) => ({ x: center.x + point.x, y: center.y + point.y })))
        .concat({ x: corners[3].x + corner[0].x, y: corners[3].y + corner[0].y });
      return { subpaths: [{ points, closed: true }], fillable: true };
    }
    case 'circle': {
      const center = { x: length(element, 'cx'), y: length(element, 'cy') };
      const radius = length(element, 'r');
      if (radius <= 0) return { subpaths: [], fillable: true };
      return { subpaths: [{ points: ellipsePoints(center, radius, radius), closed: true }], circle: { center, radius }, fillable: true };
    }
    case 'ellipse': {
      const rx = length(element, 'rx');
      const ry = length(element, 'ry');
      if (rx <= 0 || ry <= 0) return { subpaths: [], fillable: true };
      return { subpaths: [{ points: ellipsePoints({ x: length(element, 'cx'), y: length(element, 'cy') }, rx, ry), closed: true }], fillable: true };
    }
    case 'line':
      return {
        subpaths: [{ points: [{ x: length(element, 'x1'), y: length(element, 'y1') }, { x: length(element, 'x2'), y: length(element, 'y2') }], closed: false }],
        fillable: false,
      };
    case 'polyline':
    case 'polygon': {
      const values = numberList(attribute(element, 'points') ?? '');
      const points = Array.from({ length: Math.floor(values.length / 2) }, (_, index) => ({ x: values[index * 2], y: values[index * 2 + 1] }));
      return { subpaths: [{ points, closed: element.name === 'polygon' }], fillable: true };
    }
    case 'path':
      return { subpaths: parsePath(attribute(element, 'd') ?? ''), fillable: true };
    default:
      throw new Error(`Unsupported element <${element.name}>.`);
  }
}

function parsePath(d: string): Subpath[] {
  const subpaths: Subpath[] = [];
  let index = 0;
  const skip = (): void => {
    while (index < d.length && /[\s,]/.test(d[index])) index += 1;
  };
  const number = (): number => {
    skip();
    const pattern = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
    pattern.lastIndex = index;
    const match = pattern.exec(d);
    if (!match) throw new Error(`Invalid path data near "${d.slice(index, index + 12)}".`);
    index = pattern.lastIndex;
    return Number(match[0]);
  };
  const flag = (): boolean => {
    skip();
    if (d[index] !== '0' && d[index] !== '1') throw new Error('Invalid arc flag in path data.');
    index += 1;
    return d[index - 1] === '1';
  };
  let current: Point = { x: 0, y: 0 };
  let start: Point = current;
  let points: Point[] | null = null;
  let control: Point | null = null;
  let previous = '';
  let command = '';
  const lineTo = (point: Point): void => {
    if (!points) {
      points = [current];
      subpaths.push({ points, closed: false });
    }
    points.push(point);
    current = point;
  };
  const cubic = (p1: Point, p2: Point, p3: Point): void => {
    const flatten = (a: Point, b: Point, c: Point, e: Point, depth: number): void => {
      if (depth > 12 || Math.max(lineDistance(b, a, e), lineDistance(c, a, e)) <= FLATNESS) {
        lineTo(e);
        return;
      }
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ce = mid(c, e);
      const abc = mid(ab, bc);
      const bce = mid(bc, ce);
      const middle = mid(abc, bce);
      flatten(a, ab, abc, middle, depth + 1);
      flatten(middle, bce, ce, e, depth + 1);
    };
    flatten(current, p1, p2, p3, 0);
  };
  for (skip(); index < d.length; skip()) {
    if (/[a-z]/i.test(d[index])) command = d[index++];
    else if (!command || command.toUpperCase() === 'Z') throw new Error(`Invalid path data near "${d.slice(index, index + 12)}".`);
    const relative = command === command.toLowerCase();
    const at = (x: number, y: number): Point => relative ? { x: current.x + x, y: current.y + y } : { x, y };
    const upper = command.toUpperCase();
    let nextControl: Point | null = null;
    if (upper === 'Z') {
      if (points) subpaths[subpaths.length - 1].closed = true;
      current = start;
      points = null;
    } else if (upper === 'M') {
      current = at(number(), number());
      start = current;
      points = [current];
      subpaths.push({ points, closed: false });
      // Further coordinate pairs after a moveto are implicit linetos.
      command = relative ? 'l' : 'L';
    } else if (upper === 'L') lineTo(at(number(), number()));
    else if (upper === 'H') lineTo({ x: relative ? current.x + number() : number(), y: current.y });
    else if (upper === 'V') lineTo({ x: current.x, y: relative ? current.y + number() : number() });
    else if (upper === 'C' || upper === 'S') {
      const first: Point = upper === 'C' ? at(number(), number())
        : control && (previous === 'C' || previous === 'S') ? reflect(control, current) : current;
      const second = at(number(), number());
      cubic(first, second, at(number(), number()));
      nextControl = second;
    } else if (upper === 'Q' || upper === 'T') {
      const quad: Point = upper === 'Q' ? at(number(), number())
        : control && (previous === 'Q' || previous === 'T') ? reflect(control, current) : current;
      const begin = current;
      const end = at(number(), number());
      cubic(lerp(begin, quad, 2 / 3), lerp(end, quad, 2 / 3), end);
      nextControl = quad;
    } else if (upper === 'A') {
      const rx = number();
      const ry = number();
      const rotation = number();
      const large = flag();
      const sweepFlag = flag();
      for (const point of arcPoints(current, rx, ry, rotation, large, sweepFlag, at(number(), number()))) lineTo(point);
    } else throw new Error(`Unsupported path command ${command}.`);
    control = nextControl;
    previous = upper;
  }
  return subpaths;
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function reflect(control: Point, about: Point): Point {
  return { x: 2 * about.x - control.x, y: 2 * about.y - control.y };
}

function lineDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = Math.hypot(dx, dy);
  return span ? Math.abs(dx * (a.y - point.y) - dy * (a.x - point.x)) / span : Math.hypot(point.x - a.x, point.y - a.y);
}

/** Endpoint-parameterized elliptical arc (SVG 1.1 F.6.5), flattened; excludes the start point. */
function arcPoints(from: Point, rxIn: number, ryIn: number, rotation: number, large: boolean, sweep: boolean, to: Point): Point[] {
  if (from.x === to.x && from.y === to.y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry) return [to];
  const phi = rotation * Math.PI / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coefficient = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cx1 = coefficient * rx * y1 / ry;
  const cy1 = -coefficient * ry * x1 / rx;
  const center = { x: cos * cx1 - sin * cy1 + (from.x + to.x) / 2, y: sin * cx1 + cos * cy1 + (from.y + to.y) / 2 };
  const angle = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / arcStep(Math.max(rx, ry))));
  const angles = Array.from({ length: steps - 1 }, (_, index) => start + delta * (index + 1) / steps);
  // Axis extremes keep the bounding box exact for unrotated arcs.
  if (!phi) {
    for (let quadrant = Math.ceil(Math.min(start, start + delta) / (Math.PI / 2));
      quadrant * Math.PI / 2 < Math.max(start, start + delta); quadrant += 1) angles.push(quadrant * Math.PI / 2);
    angles.sort((a, b) => delta > 0 ? a - b : b - a);
  }
  return angles.map((theta) => ({
    x: center.x + rx * Math.cos(theta) * cos - ry * Math.sin(theta) * sin,
    y: center.y + rx * Math.cos(theta) * sin + ry * Math.sin(theta) * cos,
  })).concat(to);
}

// ─── Painted-area estimates ───

/** Conservative painted area in artwork units: a convex hull grown by `r`, or an annulus (r0 = 0 for a disc). */
type Piece =
  | { kind: 'hull'; points: Point[]; r: number }
  | { kind: 'ring'; c: Point; r0: number; r1: number };

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bounds(piece: Piece): Box {
  if (piece.kind === 'ring') return { x0: piece.c.x - piece.r1, y0: piece.c.y - piece.r1, x1: piece.c.x + piece.r1, y1: piece.c.y + piece.r1 };
  return pointBounds(piece.points, piece.r);
}

function pointBounds(points: readonly Point[], pad: number): Box {
  let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const { x, y } of points) box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
  return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
}

function corners(box: Box): Point[] {
  return [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Counter-clockwise convex hull (monotone chain); one or two points for degenerate input. */
function convexHull(input: readonly Point[]): Point[] {
  const points = [...input].sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, all) => index === 0 || distance(point, all[index - 1]) > 1e-9);
  if (points.length < 3) return points;
  const half = (list: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const point of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  const result = [...half(points), ...half([...points].reverse())];
  return result.length ? result : [points[0], points[points.length - 1]];
}

function hull(points: readonly Point[], r: number): Piece {
  return { kind: 'hull', points: convexHull(points), r };
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const t = span ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / span)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentsDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b));
}

function edges(points: readonly Point[]): Array<[Point, Point]> {
  if (points.length < 3) return [[points[0], points[points.length - 1]]];
  return points.map((point, index) => [point, points[(index + 1) % points.length]]);
}

function insideHull(point: Point, points: readonly Point[]): boolean {
  return points.length >= 3 && points.every((vertex, index) => cross(vertex, points[(index + 1) % points.length], point) >= 0);
}

/** Distance from a point to a convex hull's core polygon; zero inside. */
function hullPointDistance(point: Point, points: readonly Point[]): number {
  if (insideHull(point, points)) return 0;
  return Math.min(...edges(points).map(([a, b]) => segmentDistance(point, a, b)));
}

function hullsDistance(first: readonly Point[], second: readonly Point[]): number {
  if (insideHull(first[0], second) || insideHull(second[0], first)) return 0;
  let best = Infinity;
  for (const [a, b] of edges(first)) {
    for (const [c, d] of edges(second)) best = Math.min(best, segmentsDistance(a, b, c, d));
  }
  return best;
}

function piecesOverlap(first: Piece, second: Piece): boolean {
  const one = bounds(first);
  const two = bounds(second);
  if (one.x0 > two.x1 || two.x0 > one.x1 || one.y0 > two.y1 || two.y0 > one.y1) return false;
  if (first.kind === 'hull' && second.kind === 'hull') return hullsDistance(first.points, second.points) <= first.r + second.r;
  if (first.kind === 'ring' && second.kind === 'ring') {
    const gap = distance(first.c, second.c);
    return gap <= first.r1 + second.r1 && gap + second.r1 >= first.r0 && gap + first.r1 >= second.r0;
  }
  const [shape, ring] = first.kind === 'hull' ? [first, second] : [second, first];
  if (shape.kind !== 'hull' || ring.kind !== 'ring') return true;
  return hullPointDistance(ring.c, shape.points) <= ring.r1 + shape.r
    && Math.max(...shape.points.map((point) => distance(point, ring.c))) + shape.r >= ring.r0;
}

function anyOverlap(first: readonly Piece[], second: readonly Piece[]): boolean {
  return first.some((one) => second.some((two) => piecesOverlap(one, two)));
}

/** Area covered by a piece over a whole animation cycle. */
function sweep(piece: Piece, motion: RootMotion): Piece {
  if (motion.origin) {
    const far = piece.kind === 'ring' ? distance(motion.origin, piece.c) + piece.r1
      : Math.max(...piece.points.map((point) => distance(point, motion.origin!))) + piece.r;
    let near: number;
    if (piece.kind === 'hull') near = Math.max(0, hullPointDistance(motion.origin, piece.points) - piece.r);
    else {
      const gap = distance(motion.origin, piece.c);
      near = gap > piece.r1 ? gap - piece.r1 : gap >= piece.r0 ? 0 : piece.r0 - gap;
    }
    return { kind: 'ring', c: motion.origin, r0: near, r1: far };
  }
  const shifts = motion.frames.flatMap((frame) => frame.translate ? [frame.translate] : []);
  if (!shifts.length) return piece;
  const range = corners(pointBounds(shifts, 0));
  const [points, r] = piece.kind === 'hull' ? [piece.points, piece.r] : [[piece.c], piece.r1];
  return hull(points.flatMap((point) => range.map((shift) => ({ x: point.x + shift.x, y: point.y + shift.y }))), r);
}

interface Paint {
  fill: string;
  stroke: string;
  'fill-opacity': string;
  'stroke-opacity': string;
  'stroke-width': string;
  'stroke-linejoin': string;
  'stroke-linecap': string;
  'stroke-miterlimit': string;
}

const INITIAL_PAINT: Paint = {
  fill: 'black', stroke: 'none', 'fill-opacity': '1', 'stroke-opacity': '1', 'stroke-width': '1',
  'stroke-linejoin': 'miter', 'stroke-linecap': 'butt', 'stroke-miterlimit': '4',
};

const PAINT_ATTRIBUTES = Object.keys(INITIAL_PAINT) as Array<keyof Paint>;

const UNSUPPORTED_ATTRIBUTES = [
  'style', 'clip-path', 'mask', 'filter', 'display', 'visibility', 'vector-effect', 'marker-start', 'marker-mid',
  'marker-end', 'transform-origin', 'mix-blend-mode', 'paint-order', 'href', 'xlink:href',
];

function painted(value: string, opacity: string): boolean {
  return value !== 'none' && value !== 'transparent' && Number(opacity) !== 0;
}

function shapePieces(element: SvgElement, matrix: Matrix, paint: Paint, pad: number): Piece[] {
  const shape = shapeGeometry(element);
  const scale = maxScale(matrix);
  const similar = isSimilarity(matrix);
  const tolerance = FLATNESS * scale + pad;
  const pieces: Piece[] = [];
  if (shape.fillable && painted(paint.fill, paint['fill-opacity'])) {
    if (shape.circle && similar) pieces.push({ kind: 'ring', c: apply(matrix, shape.circle.center), r0: 0, r1: shape.circle.radius * scale + pad });
    else {
      for (const subpath of shape.subpaths) {
        if (subpath.points.length > 2) pieces.push(hull(subpath.points.map((point) => apply(matrix, point)), tolerance));
      }
    }
  }
  const strokeWidth = parseLength(paint['stroke-width'], 'stroke-width');
  if (painted(paint.stroke, paint['stroke-opacity']) && strokeWidth > 0) {
    const half = strokeWidth * scale / 2;
    if (shape.circle && similar) {
      const radius = shape.circle.radius * scale;
      pieces.push({ kind: 'ring', c: apply(matrix, shape.circle.center), r0: Math.max(0, radius - half - pad), r1: radius + half + pad });
    } else {
      for (const subpath of shape.subpaths) pieces.push(...strokePieces(subpath, matrix, half, tolerance, paint));
    }
  }
  return pieces;
}

function strokePieces(subpath: Subpath, matrix: Matrix, half: number, tolerance: number, paint: Paint): Piece[] {
  const points = subpath.points.map((point) => apply(matrix, point))
    .filter((point, index, all) => index === 0 || distance(point, all[index - 1]) > 1e-9);
  if (subpath.closed && points.length > 1 && distance(points[0], points[points.length - 1]) <= 1e-9) points.pop();
  if (points.length < 2) return [];
  const pieces: Piece[] = [];
  const segments = subpath.closed ? points.length : points.length - 1;
  for (let index = 0; index < segments; index += 1) {
    pieces.push({ kind: 'hull', points: [points[index], points[(index + 1) % points.length]], r: half + tolerance });
  }
  if (paint['stroke-linejoin'] === 'miter' || paint['stroke-linejoin'] === 'miter-clip') {
    const limit = Number(paint['stroke-miterlimit']);
    for (let index = subpath.closed ? 0 : 1; index < (subpath.closed ? points.length : points.length - 1); index += 1) {
      const vertex = points[index];
      const before = points[(index - 1 + points.length) % points.length];
      const after = points[(index + 1) % points.length];
      const turn = Math.abs(Math.atan2(cross(vertex, before, after),
        (before.x - vertex.x) * (after.x - vertex.x) + (before.y - vertex.y) * (after.y - vertex.y)));
      const ratio = 1 / Math.sin(turn / 2);
      if (ratio > 1.001 && ratio <= limit) pieces.push({ kind: 'ring', c: vertex, r0: 0, r1: half * ratio + tolerance });
    }
  }
  if (paint['stroke-linecap'] === 'square' && !subpath.closed) {
    for (const end of [points[0], points[points.length - 1]]) pieces.push({ kind: 'ring', c: end, r0: 0, r1: half * Math.SQRT2 + tolerance });
  }
  return pieces;
}

/** Untransformed geometry bounds in the element's own user space, as browsers compute `fill-box`. */
function objectBox(element: SvgElement): Box | null {
  if (element.name !== 'g') {
    const points = shapeGeometry(element).subpaths.flatMap((subpath) => subpath.points);
    return points.length ? pointBounds(points, 0) : null;
  }
  const points = element.children.filter(isElement).filter((child) => !NON_RENDERED.has(child.name)).flatMap((child) => {
    const box = objectBox(child);
    const matrix = parseTransform(attribute(child, 'transform'));
    return box ? corners(box).map((corner) => apply(matrix, corner)) : [];
  });
  return points.length ? pointBounds(points, 0) : null;
}

// ─── Parts and layers ───

interface RootFrame {
  offset: number;
  easing: string;
  rotate?: number;
  translate?: Point;
  opacity?: number;
}

/** A class animation resolved into artwork coordinates. */
interface RootMotion {
  frames: RootFrame[];
  duration: number;
  direction: Direction;
  origin: Point | null;
}

interface Link {
  element: SvgElement;
  motion: RootMotion;
}

/** A subtree that keeps its place in one layer. */
interface Unit {
  element: SvgElement;
  /** Animated ancestors and self, outermost first. */
  chain: Link[];
  rest: Piece[];
  swept: Piece[];
  key: string;
  /** Translucent ancestors whose parts are spread over several units. */
  groups: SvgElement[];
  nested?: NestedGroup;
}

/** A translucent group drawn as its own stack because its overlapping parts need separate layers. */
interface NestedGroup {
  units: Unit[];
  layers: Layer[];
  opacity: number;
  /** Elements whose opacity moves from the layer images to the group. */
  cleared: SvgElement[];
}

interface Layer {
  key: string;
  units: Unit[];
}

const NON_RENDERED = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'linearGradient', 'radialGradient', 'stop']);

function animatedClass(element: SvgElement, sheet: StyleSheet): ClassAnimation | null {
  const classes = (attribute(element, 'class') ?? '').split(/\s+/).filter(Boolean);
  for (const name of classes) {
    if (!sheet.animations.has(name)) throw new Error(`Class .${name} has no supported style rule.`);
  }
  if (classes.length > 1) throw new Error(`Only one animated class per element: ${classes.join(' ')}`);
  return classes.length ? sheet.animations.get(classes[0])! : null;
}

function hasAnimatedDescendant(element: SvgElement, sheet: StyleSheet): boolean {
  return element.children.filter(isElement).some((child) => animatedClass(child, sheet) || hasAnimatedDescendant(child, sheet));
}

function opacityOf(element: SvgElement): number {
  const value = attribute(element, 'opacity');
  return value === undefined ? 1 : cssNumber(value.trim());
}

function rootMotion(element: SvgElement, animation: ClassAnimation, parent: Matrix): RootMotion {
  const { keyframes } = animation;
  if (keyframes.transform.length && attribute(element, 'transform')) {
    throw new Error(`<${element.name}> animates transform but also has a transform attribute.`);
  }
  const rotates = keyframes.transform.some(({ value }) => 'rotate' in value);
  if (rotates && keyframes.transform.some(({ value }) => 'translate' in value)) throw new Error('Mixed rotate and translate keyframes.');
  let origin: Point | null = null;
  let sign = 1;
  if (rotates) {
    if (!animation.fillBoxCenter) throw new Error('Rotations need transform-box: fill-box and transform-origin: center.');
    if (!isSimilarity(parent)) throw new Error('Rotations inside non-uniform transforms are unsupported.');
    const box = objectBox(element);
    if (!box) throw new Error('Rotating element has no geometry.');
    origin = apply(parent, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 });
    sign = parent[0] * parent[3] - parent[1] * parent[2] < 0 ? -1 : 1;
  }
  const transforms = withEnds<CssTransform>(keyframes.transform, rotates ? { rotate: 0 } : { translate: { x: 0, y: 0 } });
  const opacities = withEnds(keyframes.opacity, opacityOf(element));
  const offsets = [...new Set([...transforms, ...opacities].map(({ offset }) => offset))].sort((a, b) => a - b);
  const frames = offsets.map((offset): RootFrame => {
    const frame: RootFrame = { offset, easing: animation.easing };
    const transform = transforms.find((entry) => entry.offset === offset)?.value;
    if (transform && 'rotate' in transform) frame.rotate = transform.rotate * sign;
    if (transform && 'translate' in transform) frame.translate = applyLinear(parent, transform.translate);
    const opacity = opacities.find((entry) => entry.offset === offset)?.value;
    if (opacity !== undefined) frame.opacity = opacity;
    return frame;
  });
  return { frames, duration: animation.duration, direction: animation.direction, origin };
}

/** CSS fills a missing first or last keyframe from the underlying value. */
function withEnds<Value>(frames: Array<{ offset: number; value: Value }>, base: Value): Array<{ offset: number; value: Value }> {
  if (!frames.length) return [];
  const result = [...frames];
  if (result[0].offset !== 0) result.unshift({ offset: 0, value: base });
  if (result[result.length - 1].offset !== 1) result.push({ offset: 1, value: base });
  return result;
}

function fades(link: Link): boolean {
  return link.motion.frames.some((frame) => frame.opacity !== undefined);
}

function animates(unit: Unit): boolean {
  return unit.chain.length > 0 || (unit.nested?.units.some(animates) ?? false);
}

/**
 * Walks the artwork into paint-ordered units. A subtree without animated descendants stays whole, so
 * a translucent or animated group keeps its composite; other groups are split into their children.
 */
function collectUnits(root: SvgElement, sheet: StyleSheet, pad: number, nested: ReadonlySet<SvgElement>): Unit[] {
  const units: Unit[] = [];
  let target = units;
  let groups: SvgElement[] = [];
  let faded: SvgElement[] = [];
  let current: Unit | null = null;
  let nextGroup = 0;
  const visit = (element: SvgElement, matrix: Matrix, inherited: Paint, chain: Link[]): void => {
    if (NON_RENDERED.has(element.name)) return;
    for (const name of UNSUPPORTED_ATTRIBUTES) {
      if (attribute(element, name) !== undefined) throw new Error(`Unsupported attribute ${name} on <${element.name}>.`);
    }
    const local = multiply(matrix, parseTransform(attribute(element, 'transform')));
    const paint = { ...inherited };
    for (const name of PAINT_ATTRIBUTES) paint[name] = attribute(element, name) ?? paint[name];
    const animation = animatedClass(element, sheet);
    const links = animation ? [...chain, { element, motion: rootMotion(element, animation, matrix) }] : chain;
    const opacity = opacityOf(element);
    const children = (): void => {
      for (const child of element.children) {
        if (!isElement(child)) throw new Error('Unexpected text inside a group.');
        visit(child, local, paint, links);
      }
    };
    if (current) {
      if (element.name === 'g') children();
      else current.rest.push(...shapePieces(element, local, paint, pad));
      return;
    }
    if (nested.has(element)) {
      if (links.length) throw new Error('A translucent group with overlapping animated parts must not move or fade.');
      const group: NestedGroup = { units: [], layers: [], opacity: [...faded, element].reduce((product, entry) => product * opacityOf(entry), 1), cleared: [...faded, element] };
      const outer = { target, groups, faded };
      [target, groups, faded] = [group.units, [], []];
      children();
      [target, groups, faded] = [outer.target, outer.groups, outer.faded];
      group.layers = placeUnits(group.units);
      const unit: Unit = {
        element, chain: [], key: `group:${nextGroup++}`, groups: [...groups], nested: group,
        rest: group.units.flatMap((entry) => entry.rest), swept: group.units.flatMap((entry) => entry.swept),
      };
      if (unit.rest.length) target.push(unit);
      return;
    }
    if (element.name !== 'g' || ((animation || opacity < 1) && !hasAnimatedDescendant(element, sheet))) {
      const unit: Unit = { element, chain: links, rest: [], swept: [], key: JSON.stringify(links.map((link) => link.motion)), groups: [...groups] };
      current = unit;
      if (element.name === 'g') children();
      else unit.rest.push(...shapePieces(element, local, paint, pad));
      current = null;
      unit.swept = unit.rest.map((piece) => links.reduceRight((area, link) => sweep(area, link.motion), piece));
      if (unit.rest.length) target.push(unit);
      return;
    }
    const composite = opacity < 1 || (links.length > chain.length && fades(links[links.length - 1]));
    if (composite) groups.push(element);
    if (opacity < 1) faded.push(element);
    children();
    if (opacity < 1) faded.pop();
    if (composite) groups.pop();
  };
  const rootPaint = { ...INITIAL_PAINT };
  for (const name of PAINT_ATTRIBUTES) rootPaint[name] = attribute(root, name) ?? rootPaint[name];
  for (const child of root.children) {
    if (isElement(child)) visit(child, IDENTITY, rootPaint, []);
  }
  return units;
}

function sameChain(first: Unit, second: Unit): boolean {
  return first.chain.length === second.chain.length && first.chain.every((link, index) => link.element === second.chain[index].element);
}

/**
 * Places each unit in the lowest layer it can share without changing what it covers or what covers it.
 * Animated layers apply one opacity to their whole image, so parts of different animated elements share
 * one only when they do not overlap.
 */
function placeUnits(units: readonly Unit[]): Layer[] {
  const layers: Layer[] = [];
  for (const unit of units) {
    let top = layers.length - 1;
    while (top >= 0 && !layers[top].units.some((member) => anyOverlap(member.swept, unit.swept))) top -= 1;
    const joinable = (layer: Layer): boolean => layer.key === unit.key
      && (!unit.chain.length || layer.units.every((member) => sameChain(member, unit) || !anyOverlap(member.rest, unit.rest)));
    let target = top >= 0 && joinable(layers[top]) ? top : layers.findIndex((layer, index) => index > top && joinable(layer));
    if (target < 0) {
      layers.push({ key: unit.key, units: [] });
      target = layers.length - 1;
    }
    layers[target].units.push(unit);
  }
  return layers;
}

/** Group opacity applies to the group's composite, so its overlapping parts must share a layer. */
function overlappingGroup(layers: readonly Layer[]): SvgElement | null {
  const placed = layers.flatMap((layer, index) => layer.units.map((unit) => ({ unit, index })));
  for (const [position, { unit, index }] of placed.entries()) {
    for (const other of placed.slice(position + 1)) {
      if (other.index === index) continue;
      const shared = unit.groups.filter((group) => other.unit.groups.includes(group));
      if (shared.length && anyOverlap(unit.swept, other.unit.swept)) return shared[shared.length - 1];
    }
  }
  for (const { unit } of placed) {
    const group = unit.nested && overlappingGroup(unit.nested.layers);
    if (group) return group;
  }
  return null;
}

function renderLayers(root: SvgElement, layers: readonly Layer[], view: Box, pad: number, cleared: readonly SvgElement[]): ArtLayer[] {
  const width = view.x1 - view.x0;
  const height = view.y1 - view.y0;
  return layers.map((layer): ArtLayer => {
    const group = layer.units[0].nested;
    if (group) return { opacity: round(group.opacity), layers: renderLayers(root, group.layers, view, pad, [...cleared, ...group.cleared]) };
    const crop = cropBox(layer, pad, view);
    return {
      image: layerSource(root, layer, crop, cleared),
      box: [
        round((crop.x0 - view.x0) / width * 100), round((crop.y0 - view.y0) / height * 100),
        round((crop.x1 - crop.x0) / width * 100), round((crop.y1 - crop.y0) / height * 100),
      ],
      motions: layer.units[0].chain.map((link) => layerMotion(link.motion, crop)),
    };
  });
}

function cropBox(layer: Layer, pad: number, view: Box): Box {
  const area = pointBounds(layer.units.flatMap((unit) => unit.rest.flatMap((piece) => corners(bounds(piece)))), pad);
  const box = {
    x0: Math.max(view.x0, Math.floor(area.x0)), y0: Math.max(view.y0, Math.floor(area.y0)),
    x1: Math.min(view.x1, Math.ceil(area.x1)), y1: Math.min(view.y1, Math.ceil(area.y1)),
  };
  if (box.x0 >= box.x1 || box.y0 >= box.y1) throw new Error('A layer lies outside the viewBox.');
  return box;
}

/** The layer's units with their ancestors and definitions; animation moves out of the image. */
function layerSource(root: SvgElement, layer: Layer, crop: Box, cleared: readonly SvgElement[]): string {
  const members = new Set(layer.units.map((unit) => unit.element));
  const faded = new Set([...cleared, ...layer.units.flatMap((unit) => unit.chain.filter(fades).map((link) => link.element))]);
  const attributes = (element: SvgElement): Array<[string, string]> =>
    element.attributes.filter(([key]) => key !== 'class' && !(key === 'opacity' && faded.has(element)));
  const strip = (element: SvgElement): SvgElement => ({
    ...element,
    attributes: attributes(element),
    children: element.children.map((child) => isElement(child) ? strip(child) : child),
  });
  const prune = (element: SvgElement): SvgElement | null => {
    if (members.has(element) || element.name === 'defs') return strip(element);
    if (element.name !== 'g') return null;
    const children = element.children.filter(isElement).map(prune).filter((child): child is SvgElement => child !== null);
    return children.length ? { ...element, attributes: attributes(element), children } : null;
  };
  const children = root.children.filter(isElement).filter((child) => child.name !== 'style')
    .map(prune).filter((child): child is SvgElement => child !== null);
  const width = crop.x1 - crop.x0;
  const height = crop.y1 - crop.y0;
  return serialize({
    name: 'svg',
    attributes: [
      ...root.attributes.filter(([key]) => !['id', 'width', 'height', 'viewBox'].includes(key)),
      ['viewBox', `${round(crop.x0)} ${round(crop.y0)} ${round(width)} ${round(height)}`],
      ['width', String(round(width))],
      ['height', String(round(height))],
    ],
    children,
  });
}

function layerMotion(motion: RootMotion, crop: Box): ArtLayerMotion {
  const width = crop.x1 - crop.x0;
  const height = crop.y1 - crop.y0;
  return {
    keyframes: motion.frames.map((frame) => {
      const keyframe: ArtLayerKeyframe = { offset: frame.offset, easing: frame.easing };
      if (frame.rotate !== undefined) keyframe.transform = `rotate(${round(frame.rotate)}deg)`;
      if (frame.translate) {
        keyframe.transform = `translate(${round(frame.translate.x / width * 100)}%, ${round(frame.translate.y / height * 100)}%)`;
      }
      if (frame.opacity !== undefined) keyframe.opacity = frame.opacity;
      return keyframe;
    }),
    duration: motion.duration,
    direction: motion.direction,
    origin: motion.origin
      ? `${round((motion.origin.x - crop.x0) / width * 100)}% ${round((motion.origin.y - crop.y0) / height * 100)}%`
      : '50% 50%',
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000 || 0;
}

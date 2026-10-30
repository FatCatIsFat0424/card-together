export interface DemoText {
  readonly title: string;
  readonly caption: string;
  readonly rule?: string;
  readonly outcome?: string;
}

export interface DemoScene<TextKey extends string = string> {
  readonly text: TextKey;
  readonly seconds: number;
  readonly step: number;
  readonly until?: number;
  readonly interaction?: 'front' | 'middle' | 'back' | 'edit';
}

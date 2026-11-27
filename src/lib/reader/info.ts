import raw from './modelInfo.json';

/** The short summary training writes (tools/model/train.py --info) for the model in this app. */
export type ModelInfo = {
  version: string;
  trainedOn: string;
  data: string;
  lettersAtoE: number;
  lettersAtoD: number;
  digits: number;
  testExamples: number;
};

/** Null until the model has been trained and built into the app. */
export const modelInfo: ModelInfo | null = (raw as { version: unknown }).version ? (raw as unknown as ModelInfo) : null;

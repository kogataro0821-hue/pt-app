import type { MealRecognition, RecognizedItem } from './schemas';

/**
 * ★ 設計書 §12「AIの勝手な補完禁止」の第3層 — 後処理バリデータ。
 *
 * プロンプトとスキーマだけでは、AIが「報告されていないこと」を足すのを防げない。
 * 「徒歩出勤した」→「徒歩帰宅した」のような補完を、機械的に検出して落とす。
 *
 * 仕組み:
 *   各 item が返してきた evidence（根拠の引用）が、実際の原文に含まれるかを照合する。
 *   含まれていなければ、AIがどこにも書いていないことを言っている＝補完である。
 *
 * 実装は Phase 9 で完成させるが、契約（入出力の形）は Phase 1 で確定させておく。
 */

export interface GuardResult {
  /** 検査を通った、そのまま使ってよい項目。 */
  accepted: RecognizedItem[];
  /** 根拠は弱いが、ユーザーが確認すれば使える項目（needsReview を立てる）。 */
  flagged: RecognizedItem[];
  /** 根拠が原文に存在しないため破棄した項目。 */
  rejected: Array<{ item: RecognizedItem; reason: string }>;
}

export interface GuardOptions {
  /** これ未満の確信度は flagged に落とす。 */
  minConfidence: number;
  /** テキスト解析のとき、照合対象の原文。写真解析では null。 */
  sourceText: string | null;
}

export const DEFAULT_GUARD_OPTIONS: GuardOptions = {
  minConfidence: 0.6,
  sourceText: null,
};

/**
 * 文字列を照合用に正規化する。
 * 全角/半角・空白・記号のゆれで誤って破棄しないようにするための前処理。
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .toLowerCase();
}

/**
 * evidence が原文に含まれるか。
 * 完全一致は厳しすぎるので、正規化したうえで部分一致を見る。
 */
export function isEvidenceGrounded(evidence: string, sourceText: string): boolean {
  const haystack = normalizeForMatch(sourceText);
  const needle = normalizeForMatch(evidence);
  if (needle.length === 0) return false;
  return haystack.includes(needle);
}

/**
 * 認識結果をふるいにかける。
 *
 * Phase 9 で本実装。ここでは「写真解析では evidence の照合ができないため
 * confidence だけで判定する」「テキスト解析では原文照合を行う」という
 * 骨格だけを置いている。
 */
export function guardRecognition(
  recognition: MealRecognition,
  options: GuardOptions = DEFAULT_GUARD_OPTIONS,
): GuardResult {
  const accepted: RecognizedItem[] = [];
  const flagged: RecognizedItem[] = [];
  const rejected: Array<{ item: RecognizedItem; reason: string }> = [];

  for (const item of recognition.items) {
    if (options.sourceText !== null && !isEvidenceGrounded(item.evidence, options.sourceText)) {
      rejected.push({
        item,
        reason: `根拠「${item.evidence}」が入力文に存在しません（AIによる補完の可能性）`,
      });
      continue;
    }

    if (item.confidence < options.minConfidence || item.needsUserInput) {
      flagged.push(item);
      continue;
    }

    accepted.push(item);
  }

  return { accepted, flagged, rejected };
}

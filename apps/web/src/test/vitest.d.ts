/**
 * jest-dom の言い回し（toBeInTheDocument など）を TypeScript に教える。
 *
 * ★ これが無いと、テストは動くのに typecheck だけが落ちます。
 *   走るかどうかと、型が通るかどうかは別なので、両方そろえておきます。
 *
 * ★ 中身の無い interface は、ふつうは書き間違いなので lint が止めます。
 *   ここは「既存の型に足す」ための決まった書き方なので、この2行だけ外します。
 */
import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  /* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any */
  interface Assertion<T = any> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
  /* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any */
}

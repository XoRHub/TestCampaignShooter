// Type-only: brings jest-dom's `expect` matcher augmentations (toBeInTheDocument,
// toHaveClass, ...) into this package's TS program. The runtime side is loaded
// once for every test file via the root vitest.setup.ts.
import '@testing-library/jest-dom/vitest';

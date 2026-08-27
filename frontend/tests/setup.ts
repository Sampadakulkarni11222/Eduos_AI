import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library does not unmount between tests on its own here, and a
// leaked tree makes later getByRole queries match the previous test's DOM.
afterEach(() => cleanup());

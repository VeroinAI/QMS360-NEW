import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DronaSignIn } from './drona-sign-in';

describe('Drona-only sign-in state', () => {
  it('shows blocked activation without a password form or implying verified login', () => {
    const markup = renderToStaticMarkup(<DronaSignIn
      config={{ mode: 'drona', localLoginAllowed: false, dronaReady: false, blockers: ['Backend verification is required.'] }}
      onSession={() => undefined}
    />);
    expect(markup).toContain('Drona sign-in is awaiting activation');
    expect(markup).toContain('Backend verification is required.');
    expect(markup).toContain('Check Drona connection');
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain('type="email"');
    expect(markup).toContain('does not grant access');
  });
});
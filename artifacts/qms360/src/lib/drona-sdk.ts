import sdkUrl from '../../../../attached_assets/dronahq_1446_1791109292884.js?url';

type Profile = { uid?: unknown; nonce?: unknown };
type DronaSdk = {
  IsReady?: boolean;
  user?: { getProfile?: (success: (profile: Profile) => void, error: (error: unknown) => void) => void };
};
declare global { interface Window { DronaHQ?: DronaSdk } }

let loading: Promise<void> | undefined;

function loadSdk(): Promise<void> {
  // Do not overwrite an SDK already supplied/initializing in the container.
  if (window.DronaHQ) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = sdkUrl;
    script.async = true;
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error('DronaHQ SDK loading timed out. Reopen QMS360 from Drona.'));
    }, 10000);
    script.onload = () => { window.clearTimeout(timer); resolve(); };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error('DronaHQ SDK could not be loaded.'));
    };
    document.head.appendChild(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}

export function dronaProfileProof(profile: Profile): { uid: string; nonce: string } {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Drona did not supply a supported user ID and session proof.');
  }
  // SDKs may emit a small integer. Reject already-rounded/unsafe numbers.
  const uid = typeof profile.uid === 'number' && Number.isSafeInteger(profile.uid) && profile.uid > 0
    ? String(profile.uid) : profile.uid;
  if (typeof uid !== 'string' || !/^[1-9][0-9]*$/.test(uid) || uid.length > 19
    || BigInt(uid) > 9223372036854775807n
    || typeof profile.nonce !== 'string' || !profile.nonce.trim() || profile.nonce.length > 4096) {
    throw new Error('Drona did not supply a supported user ID and session proof.');
  }
  return { uid, nonce: profile.nonce };
}

/** Never log/store the full profile or nonce. This reads the container only;
 * the backend must independently verify the result before issuing a session. */
export async function fetchDronaSessionProof(): Promise<{ uid: string; nonce: string }> {
  await loadSdk();
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (window.DronaHQ?.user?.getProfile && window.DronaHQ.IsReady !== false) {
        resolve();
      } else if (Date.now() - started >= 10000) {
        reject(new Error('Open QMS360 inside the DronaHQ container. Its user session is unavailable here.'));
      } else {
        window.setTimeout(poll, 100);
      }
    };
    poll();
  });
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Drona profile loading timed out.')), 10000);
    try {
      window.DronaHQ!.user!.getProfile!(profile => {
        window.clearTimeout(timer);
        try { resolve(dronaProfileProof(profile)); }
        catch (error) { reject(error); }
      }, () => {
        window.clearTimeout(timer);
        reject(new Error('Drona could not provide the current session.'));
      });
    } catch {
      window.clearTimeout(timer);
      reject(new Error('Drona could not provide the current session.'));
    }
  });
}